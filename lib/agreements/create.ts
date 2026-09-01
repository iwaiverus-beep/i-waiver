import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent, type RequestContext } from "@/lib/audit";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { timeZoneFor } from "@/lib/format";

/**
 * Creating a draft: the part that must be identical however it was asked for.
 *
 * There are two callers now — a lender filling in a form, and a partner platform
 * POSTing to /api/agreements/v1 on behalf of their customer — and the shape of
 * what gets written cannot depend on which. Template selection, Schedule A, the
 * two signer rows and the `created` audit event either happen the same way or a
 * partner-originated agreement quietly renders differently from a first-party
 * one, which is the sort of difference nobody finds until a document is disputed.
 *
 * What this deliberately does NOT do is decide WHAT is being lent or WHO may lend
 * it. Both callers arrive having already resolved an originator and a list of
 * asset ids they are entitled to use, because those checks are completely
 * different on the two paths: a session against `originators` on one, an API key
 * against `managed_by_partner_id` on the other.
 */

export type DraftInput = {
  originatorId: string;
  /** Decides which template is used. There is no fallback between the two. */
  originatorKind: "individual" | "organization";
  /**
   * Which instrument this is. `rental` is the loan — custody, damage, the
   * bailment — and is what everything that existed before bookings creates.
   * `participant` is a release by somebody who takes part without ever taking
   * the thing, and it selects an entirely different clause set. As with
   * `originatorKind`, there is no fallback between the two: a participant with
   * no participant wording published gets a refusal, never the renter's
   * document with their name in it.
   */
  instrumentKind?: "rental" | "participant";
  /** The booking this belongs to, when it is part of one. */
  groupId?: string | null;
  /** Schedule A, in the order it will appear. The first is the lead item. */
  assetIds: string[];
  jurisdiction: string;
  activityClass: string;
  startsAt: string;
  endsAt: string;
  /**
   * IANA zone the window was written in. Defaulted from the state of activity
   * by the caller, because the twelve states that straddle a boundary cannot be
   * resolved from the state alone. Falls back here so a partner posting through
   * the v1 API without one still gets a defensible zone rather than null.
   */
  timeZone?: string;
  coverRequested: boolean;
  lender: {
    /** Null for a partner-managed lender, who has no account here. */
    userId: string | null;
    name: string;
    email: string;
  };
  /**
   * The other side. On a `rental` instrument that is the borrower, who takes
   * custody; on a `participant` one it is somebody who takes part and never
   * takes the thing. The field keeps its name because every existing caller
   * uses it and only the signer's ROLE differs.
   */
  borrower: { name: string; email: string; phone?: string | null };
  /** The originating platform's own id, when there is one. */
  partnerExternalRef?: string | null;
  context: RequestContext;
  /** Merged into the `created` audit payload. Provenance, not decisions. */
  auditExtra?: Record<string, unknown>;
};

export type DraftResult = { agreementId: string; templateVersionId: string };

export async function createDraftAgreement(
  db: SupabaseClient,
  input: DraftInput,
): Promise<DraftResult> {
  if (input.assetIds.length === 0) {
    throw new TransitionRefused("Describe what is being lent.");
  }

  // --- The template --------------------------------------------------------
  // A published version if one exists, otherwise the newest draft. Creating a
  // draft agreement against unreviewed wording is fine; sending it is not, and
  // the render guard is what stops that. Refusing here instead would hide the
  // real reason behind an empty screen.
  //
  // Selection is exact on all four axes. There is no fallback from
  // 'organization' to 'individual': a business that has no reviewed wording of
  // its own gets a refusal, never a private-loan release with its name in it.
  // That applies to a partner-managed lender too, and it is the reason the
  // partner API refuses before it creates anything rather than after.
  //
  // The same holds for the fourth axis. A participant release and a loan are
  // different instruments — the loan makes its signer answerable for returning
  // the thing, which a passenger never had — so an unpublished participant set
  // is a refusal, not a reason to reach for the renter's document.
  const instrumentKind = input.instrumentKind ?? "rental";

  const { data: templateVersions } = await db
    .from("template_versions")
    .select("id, version, published_at, superseded_at")
    .eq("jurisdiction", input.jurisdiction)
    .eq("activity_class", input.activityClass)
    .eq("originator_kind", input.originatorKind)
    .eq("instrument_kind", instrumentKind)
    .is("superseded_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false });

  const templateVersion = templateVersions?.[0];
  if (!templateVersion) {
    const activity = input.activityClass.replace(/_/g, " ");
    throw new TransitionRefused(
      instrumentKind === "participant"
        ? `There is no ${activity} participant release for ${input.jurisdiction} yet. Somebody who rides along signs a different instrument from the person who took the thing — it says nothing about returning it in good order, because they never had it — so its wording has to be reviewed on its own before it can be used.`
        : input.originatorKind === "organization"
          ? `There is no ${activity} template for ${input.jurisdiction} for business lenders yet. A business agreement is a different instrument from a private loan, so its wording has to be reviewed on its own before it can be used.`
          : `There is no ${activity} template for ${input.jurisdiction} yet.`,
    );
  }

  // --- The agreement -------------------------------------------------------
  const { data: agreement, error: agreementError } = await db
    .from("agreements")
    .insert({
      originator_id: input.originatorId,
      asset_id: input.assetIds[0],
      template_version_id: templateVersion.id,
      jurisdiction: input.jurisdiction,
      activity_class: input.activityClass,
      starts_at: new Date(input.startsAt).toISOString(),
      ends_at: new Date(input.endsAt).toISOString(),
      time_zone: input.timeZone ?? timeZoneFor(input.jurisdiction),
      status: "draft",
      cover_requested: input.coverRequested,
      partner_external_ref: input.partnerExternalRef ?? null,
      // Both or neither — the check constraint says so, and a group_id without a
      // role would be an agreement in a booking that cannot say what it is doing
      // there.
      group_id: input.groupId ?? null,
      group_role: input.groupId ? instrumentKind : null,
    })
    .select("id")
    .single();

  if (agreementError || !agreement) {
    // The partial unique index on (originator_id, partner_external_ref). A
    // partner retrying a request that already succeeded is not an error; the
    // caller turns this into the existing agreement.
    if (agreementError?.code === "23505" && input.partnerExternalRef) {
      throw new DuplicateExternalRef(input.partnerExternalRef);
    }
    throw new TransitionRefused(
      `Could not create the agreement: ${agreementError?.message}`,
    );
  }

  // Schedule A. Written for every agreement, including a bundle of one, so that
  // nothing downstream has to ask whether this is an old-shaped record.
  const { error: bundleError } = await db.from("agreement_assets").insert(
    input.assetIds.map((id, index) => ({
      agreement_id: agreement.id,
      asset_id: id,
      order_index: index,
    })),
  );

  if (bundleError) {
    // Delete rather than leave it. An agreement whose schedule is missing still
    // renders — as a bundle of one, off the lead asset — which is the worst
    // outcome available: a draft that looks complete and quietly lends one item
    // instead of four. It is still a draft, so nothing has been signed and
    // nothing is being destroyed.
    await db.from("agreements").delete().eq("id", agreement.id).eq("status", "draft");
    throw new TransitionRefused(`Could not record the items: ${bundleError.message}`);
  }

  const { error: signerError } = await db.from("signers").insert([
    {
      agreement_id: agreement.id,
      role: "lender",
      capacity: "adult",
      // Null for a partner-managed lender. A signer is not a user (constraint 1),
      // so this is an optional convenience for people who do have an account, not
      // a requirement — and the lender's identity on the document comes from
      // display_name either way.
      user_id: input.lender.userId,
      display_name: input.lender.name,
      email: input.lender.email,
      order_index: 0,
    },
    {
      agreement_id: agreement.id,
      // The other side of the instrument. On a loan they are the borrower and
      // take custody; on a participant release they took nothing, and calling
      // them the borrower on the face of the document would say something untrue
      // about them.
      role: instrumentKind === "participant" ? "participant" : "borrower",
      capacity: "adult",
      // Deliberately no user_id. A signer is not a user, and the borrower will
      // almost certainly never have an account.
      display_name: input.borrower.name,
      email: input.borrower.email,
      phone: input.borrower.phone ?? null,
      order_index: 1,
    },
  ]);

  if (signerError) {
    throw new TransitionRefused(`Could not add the signers: ${signerError.message}`);
  }

  await recordAuditEvent(db, {
    agreementId: agreement.id,
    type: "created",
    actor: "lender",
    payload: {
      jurisdiction: input.jurisdiction,
      activity_class: input.activityClass,
      template_version_id: templateVersion.id,
      template_published: Boolean(templateVersion.published_at),
      item_count: input.assetIds.length,
      instrument_kind: instrumentKind,
      ...(input.groupId ? { group_id: input.groupId } : {}),
      ...(input.auditExtra ?? {}),
    },
    context: input.context,
  });

  return { agreementId: agreement.id, templateVersionId: templateVersion.id };
}

/** A partner POSTed a reference they have already used. Not an error to them. */
export class DuplicateExternalRef extends Error {
  constructor(readonly externalRef: string) {
    super(`An agreement already exists for external_ref ${externalRef}.`);
  }
}
