import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { createDraftAgreement, DuplicateExternalRef } from "@/lib/agreements/create";
import { sendAgreement, TransitionRefused } from "@/lib/agreements/lifecycle";
import type { RequestContext } from "@/lib/audit";
import type { ApiCaller } from "@/lib/partners/api-auth";

/**
 * Agreements originated by a partner platform, on behalf of their customer.
 *
 * THE ONE THING TO KEEP STRAIGHT. The lender is the platform's customer — Bayside
 * Rentals — and never the platform. The platform is not a party to the release
 * and its name appears nowhere on the document. What it has is administrative
 * control of the lender's account: it created it, it holds the only handle to it,
 * and nobody at Bayside can sign in here.
 *
 * That is why `upsertLender` writes an `organizations` row and an `originators`
 * row with `managed_by_partner_id` set, and why every read below is scoped by
 * that column. A partner asking for a lender it did not create gets a 404, and
 * the query is written so it cannot return one — the scoping is in the `.eq`, not
 * in an `if`.
 *
 * WHY THE LICENSING STRUCTURE SURVIVES THIS. The partner creates the agreement,
 * but the signer still lands on OUR signing page, where the cover is offered,
 * disclosed, consented to and paid for. The soliciting surface is unchanged. A
 * partner originating a waiver is not a partner selling insurance.
 */

export class PartnerOriginationRefused extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly detail?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Lenders
// ---------------------------------------------------------------------------

export type LenderInput = {
  externalRef: string;
  legalName: string;
  primaryState?: string | null;
  dba?: string | null;
};

export type LenderResult = {
  lender_id: string;
  external_ref: string;
  legal_name: string;
  created: boolean;
};

/**
 * Find or create the lender a partner is acting for.
 *
 * Idempotent on `external_ref`, and the database is what guarantees it: the
 * partial unique index on (managed_by_partner_id, partner_external_ref) turns a
 * retry into a conflict, which is read back rather than surfaced. A platform
 * POSTing their whole customer list twice ends up with one row each.
 */
export async function upsertLender(
  caller: ApiCaller,
  input: LenderInput,
): Promise<LenderResult> {
  const db = serviceClient();

  const existing = await findLender(db, caller.partnerId, input.externalRef);
  if (existing) {
    return {
      lender_id: existing.id,
      external_ref: input.externalRef,
      legal_name: existing.legal_name,
      created: false,
    };
  }

  const { data: org, error: orgError } = await db
    .from("organizations")
    .insert({
      legal_name: input.legalName,
      dba: input.dba ?? null,
      primary_state: input.primaryState ?? null,
    })
    .select("id, legal_name")
    .single();

  if (orgError || !org) {
    throw new PartnerOriginationRefused(
      `Could not create the lender: ${orgError?.message}`,
      500,
    );
  }

  const { data: originator, error: originatorError } = await db
    .from("originators")
    .insert({
      org_id: org.id,
      managed_by_partner_id: caller.partnerId,
      partner_external_ref: input.externalRef,
    })
    .select("id")
    .single();

  if (originatorError || !originator) {
    // Two requests raced on the same external_ref. The other one won; read theirs
    // rather than reporting a conflict for something the caller asked for once.
    const raced = await findLender(db, caller.partnerId, input.externalRef);
    if (raced) {
      // The organization this attempt created is unreferenced. Leaving it would
      // accumulate empty companies every time a partner double-fires a request.
      await db.from("organizations").delete().eq("id", org.id);
      return {
        lender_id: raced.id,
        external_ref: input.externalRef,
        legal_name: raced.legal_name,
        created: false,
      };
    }
    throw new PartnerOriginationRefused(
      `Could not create the lender: ${originatorError?.message}`,
      500,
    );
  }

  return {
    lender_id: originator.id,
    external_ref: input.externalRef,
    legal_name: org.legal_name,
    created: true,
  };
}

async function findLender(
  db: SupabaseClient,
  partnerId: string,
  externalRef: string,
): Promise<{ id: string; legal_name: string } | null> {
  const { data } = await db
    .from("originators")
    .select("id, organizations(legal_name)")
    .eq("managed_by_partner_id", partnerId)
    .eq("partner_external_ref", externalRef)
    .maybeSingle();

  if (!data) return null;

  const org = (Array.isArray(data.organizations)
    ? data.organizations[0]
    : data.organizations) as { legal_name: string } | null;

  return { id: data.id, legal_name: org?.legal_name ?? "" };
}

/** The lender, only if this partner administers it. Scoping is in the query. */
async function requireLender(
  db: SupabaseClient,
  partnerId: string,
  ref: { lenderId?: string | null; externalRef?: string | null },
): Promise<string> {
  let query = db
    .from("originators")
    .select("id")
    .eq("managed_by_partner_id", partnerId);

  if (ref.lenderId) query = query.eq("id", ref.lenderId);
  else if (ref.externalRef) query = query.eq("partner_external_ref", ref.externalRef);
  else {
    throw new PartnerOriginationRefused(
      "Name the lender, by lender_id or lender_external_ref.",
      400,
    );
  }

  const { data } = await query.maybeSingle();

  // 404, not 403, for the same reason the rest of the product does it: whether a
  // lender exists is itself information about somebody else's business.
  if (!data) throw new PartnerOriginationRefused("No such lender.", 404);
  return data.id;
}

// ---------------------------------------------------------------------------
// Agreements
// ---------------------------------------------------------------------------

export type AgreementInput = {
  lenderId?: string | null;
  lenderExternalRef?: string | null;
  /** Who signs for the lender. A person at the shop, not the shop. */
  lenderSigner: { name: string; email: string };
  borrower: { name: string; email: string; phone?: string | null };
  asset: {
    assetClass: string;
    description: string;
    declaredValueCents?: number | null;
    identifier?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
  };
  jurisdiction: string;
  activityClass: string;
  startsAt: string;
  endsAt: string;
  coverRequested: boolean;
  externalRef?: string | null;
  context: RequestContext;
};

export type AgreementResult = {
  agreement_id: string;
  external_ref: string | null;
  status: string;
  document_hash: string;
  specimen: boolean;
  signing_links: { role: string; url: string; delivered: boolean }[];
  warnings: string[];
  reused: boolean;
};

const ASSET_CLASSES = ["pwc", "boat", "trailer", "vehicle", "equipment", "other"];

/**
 * Create an agreement for one of this partner's lenders and send it.
 *
 * Created and sent in one call, deliberately. A partner has no screen on which to
 * review a draft — the review happened in their product, before they called us —
 * and leaving drafts behind on a failed second call would give them a queue of
 * half-made agreements they cannot see or clean up.
 *
 * ON RETURNING SIGNING LINKS. A signing link is the borrower's entire
 * authorisation (constraint 1: a signer is not a user), so handing one to the
 * partner hands them the capability to open that signing session. That is the
 * point — the borrower is usually standing at their counter, and redirecting them
 * beats emailing them — but it means the partner is holding a bearer credential
 * for their own customer's signature, and the docs say so in those words. The
 * email is sent as well, so a link that is never used still reaches the person it
 * belongs to.
 */
export async function createPartnerAgreement(
  caller: ApiCaller,
  input: AgreementInput,
): Promise<AgreementResult> {
  const db = serviceClient();

  const originatorId = await requireLender(db, caller.partnerId, {
    lenderId: input.lenderId,
    externalRef: input.lenderExternalRef,
  });

  // The partner's own reference, checked before anything is written. A retry
  // returns what the first call made rather than a second agreement — which
  // matters more here than anywhere else in the product, because the side effect
  // of the duplicate is an email to a real person about a document they have
  // already been sent.
  if (input.externalRef) {
    const existing = await findByExternalRef(db, originatorId, input.externalRef);
    if (existing) return existing;
  }

  const assetClass = ASSET_CLASSES.includes(input.asset.assetClass)
    ? input.asset.assetClass
    : "other";

  const { data: asset, error: assetError } = await db
    .from("assets")
    .insert({
      owner_originator_id: originatorId,
      asset_class: assetClass,
      description: input.asset.description,
      identifier: input.asset.identifier ?? null,
      declared_value_cents: input.asset.declaredValueCents ?? null,
      year: input.asset.year ?? null,
      make: input.asset.make ?? null,
      model: input.asset.model ?? null,
    })
    .select("id")
    .single();

  if (assetError || !asset) {
    throw new PartnerOriginationRefused(
      `Could not record the item: ${assetError?.message}`,
      500,
    );
  }

  let agreementId: string;

  try {
    // Always `organization`: the constraint in 20260901000019 makes a
    // partner-managed originator an organization, so there is no branch here and
    // no chance of a business receiving a private-loan release.
    const draft = await createDraftAgreement(db, {
      originatorId,
      originatorKind: "organization",
      assetIds: [asset.id],
      jurisdiction: input.jurisdiction,
      activityClass: input.activityClass,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      coverRequested: input.coverRequested,
      lender: {
        // No account here, and none is implied. The name on the document comes
        // from display_name, exactly as it does for a lender who does have one.
        userId: null,
        name: input.lenderSigner.name,
        email: input.lenderSigner.email,
      },
      borrower: input.borrower,
      partnerExternalRef: input.externalRef ?? null,
      context: input.context,
      auditExtra: {
        originated_by_partner_id: caller.partnerId,
        partner_integration_id: caller.integrationId,
        partner_external_ref: input.externalRef ?? undefined,
      },
    });
    agreementId = draft.agreementId;
  } catch (error) {
    // Nothing was created, so the asset row is litter. Removing it keeps a
    // partner's failed calls from silently filling their lender's item list.
    await db.from("assets").delete().eq("id", asset.id);

    if (error instanceof DuplicateExternalRef && input.externalRef) {
      const raced = await findByExternalRef(db, originatorId, input.externalRef);
      if (raced) return raced;
    }
    if (error instanceof TransitionRefused) {
      throw new PartnerOriginationRefused(error.message, 422, "not_available");
    }
    throw error;
  }

  const sent = await sendAgreement(db, agreementId, input.context);

  return {
    agreement_id: agreementId,
    external_ref: input.externalRef ?? null,
    status: sent.status,
    document_hash: sent.documentHash,
    specimen: sent.specimen,
    signing_links: sent.links.map((link) => ({
      role: link.role,
      url: link.url,
      delivered: link.delivered,
    })),
    warnings: sent.warnings,
    reused: false,
  };
}

/**
 * An agreement this partner already created under that reference.
 *
 * Returns the record without its signing links: those were minted once, are
 * single-use, and were not stored — see lib/tokens.ts. A retry gets the identity
 * of what already exists, not a fresh capability to sign it.
 */
async function findByExternalRef(
  db: SupabaseClient,
  originatorId: string,
  externalRef: string,
): Promise<AgreementResult | null> {
  const { data } = await db
    .from("agreements")
    .select("id, status")
    .eq("originator_id", originatorId)
    .eq("partner_external_ref", externalRef)
    .maybeSingle();

  if (!data) return null;

  const { data: document } = await db
    .from("documents")
    .select("sha256")
    .eq("agreement_id", data.id)
    .eq("kind", "agreement")
    .order("rendered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    agreement_id: data.id,
    external_ref: externalRef,
    status: data.status,
    document_hash: document?.sha256 ?? "",
    specimen: false,
    signing_links: [],
    warnings: [
      "An agreement already existed for that external_ref, so nothing was created and nothing was sent again. Signing links are shown once, at creation.",
    ],
    reused: true,
  };
}

/** Status of one agreement, only if this partner's lender originated it. */
export async function partnerAgreement(
  caller: ApiCaller,
  agreementId: string,
): Promise<Record<string, unknown>> {
  const db = serviceClient();

  const { data } = await db
    .from("agreements")
    .select(
      "id, status, jurisdiction, activity_class, starts_at, ends_at, cover_requested, partner_external_ref, created_at, sent_at, executed_at, voided_at, originators!inner(id, managed_by_partner_id, partner_external_ref)",
    )
    .eq("id", agreementId)
    // The scoping is in the query. An `if` after the fact is one refactor away
    // from being deleted by somebody who thinks it is redundant.
    .eq("originators.managed_by_partner_id", caller.partnerId)
    .maybeSingle();

  if (!data) throw new PartnerOriginationRefused("No such agreement.", 404);

  const { data: signers } = await db
    .from("signers")
    .select("role, display_name, email, signed_at, declined_at")
    .eq("agreement_id", agreementId)
    .order("order_index");

  const originator = (Array.isArray(data.originators)
    ? data.originators[0]
    : data.originators) as { partner_external_ref: string | null } | null;

  return {
    agreement_id: data.id,
    external_ref: data.partner_external_ref,
    lender_external_ref: originator?.partner_external_ref ?? null,
    status: data.status,
    jurisdiction: data.jurisdiction,
    activity_class: data.activity_class,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    cover_requested: data.cover_requested,
    created_at: data.created_at,
    sent_at: data.sent_at,
    executed_at: data.executed_at,
    voided_at: data.voided_at,
    // Names and signing state. No token, no document bytes, no audit chain — a
    // partner is entitled to know where their customer's transaction is, not to
    // hold the evidence.
    signers: (signers ?? []).map((signer) => ({
      role: signer.role,
      name: signer.display_name,
      email: signer.email,
      signed_at: signer.signed_at,
      declined_at: signer.declined_at,
    })),
  };
}
