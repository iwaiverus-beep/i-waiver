import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent, type RequestContext } from "@/lib/audit";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

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
  /** Schedule A, in the order it will appear. The first is the lead item. */
  assetIds: string[];
  jurisdiction: string;
  activityClass: string;
  startsAt: string;
  endsAt: string;
  coverRequested: boolean;
  lender: {
    /** Null for a partner-managed lender, who has no account here. */
    userId: string | null;
    name: string;
    email: string;
  };
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
  // Selection is exact on all three axes. There is no fallback from
  // 'organization' to 'individual': a business that has no reviewed wording of
  // its own gets a refusal, never a private-loan release with its name in it.
  // That applies to a partner-managed lender too, and it is the reason the
  // partner API refuses before it creates anything rather than after.
  const { data: templateVersions } = await db
    .from("template_versions")
    .select("id, version, published_at, superseded_at")
    .eq("jurisdiction", input.jurisdiction)
    .eq("activity_class", input.activityClass)
    .eq("originator_kind", input.originatorKind)
    .is("superseded_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false });

  const templateVersion = templateVersions?.[0];
  if (!templateVersion) {
    const activity = input.activityClass.replace(/_/g, " ");
    throw new TransitionRefused(
      input.originatorKind === "organization"
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
      status: "draft",
      cover_requested: input.coverRequested,
      partner_external_ref: input.partnerExternalRef ?? null,
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
      role: "borrower",
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
