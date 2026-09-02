import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStateCode } from "@/lib/jurisdictions";
import { siteOrigin } from "@/lib/env";
import { CarrierRefused, type Carrier } from "@/lib/coverage/admin";

/**
 * Letting a carrier tell us about themselves, without an account.
 *
 * A carrier never signs in — there is nothing for them to sign in to, because we
 * call them rather than the reverse. But approving one leaves a row full of
 * blanks that only they can fill: their NAIC code, their AM Best rating, the
 * states they are filed in, where their sandbox lives. Until this existed those
 * blanks were filled by a member of staff retyping an email, or not at all.
 *
 * Two rules shape everything here:
 *
 *   1. The token is a capability, so it is hashed at rest and expires.
 *   2. What comes back is a CLAIM, so it lands in `carrier_submissions` and a
 *      person accepts it. Nothing typed through a public form reaches `carriers`
 *      on its own.
 */

/** Fourteen days. Long enough to survive a legal review, short enough to expire. */
const LINK_TTL_DAYS = 14;

/**
 * 32 bytes of CSPRNG, base64url.
 *
 * Not the readable alphabet `intake_links` uses, deliberately: nobody types this
 * one off a printed card, it arrives as a hyperlink in an email. That frees it to
 * be the full-strength thing a capability should be.
 */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CarrierSubmission = {
  id: string;
  carrier_id: string;
  link_id: string | null;
  status: "pending" | "accepted" | "rejected";
  legal_name: string | null;
  naic_code: string | null;
  am_best_rating: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  states: string[];
  api_base_url: string | null;
  api_docs_url: string | null;
  products: string | null;
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

export type OnboardingLink = {
  id: string;
  carrier_id: string;
  sent_to: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/**
 * Mint a link for a carrier, revoking any that came before it.
 *
 * Revoking the old one is the point rather than a tidy-up. Somebody asking for a
 * fresh link is usually doing it because the last one went to the wrong address
 * or to somebody who has left, and leaving that one live would mean the reason
 * for re-sending it is still true.
 *
 * Returns the raw token exactly once. It is never stored and cannot be recovered
 * — a second look means a second link.
 */
export async function createOnboardingLink(
  db: SupabaseClient,
  input: { carrierId: string; sentTo: string; createdBy: string | null },
): Promise<{ url: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db
    .from("carrier_onboarding_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("carrier_id", input.carrierId)
    .is("revoked_at", null);

  const { error } = await db.from("carrier_onboarding_links").insert({
    carrier_id: input.carrierId,
    token_hash: hashToken(token),
    sent_to: input.sentTo.toLowerCase(),
    expires_at: expiresAt.toISOString(),
    created_by: input.createdBy,
  });

  if (error) {
    throw new CarrierRefused(`Could not create the link: ${error.message}`, 500);
  }

  return { url: `${siteOrigin()}/carriers/onboarding/${token}`, expiresAt };
}

export type ResolvedLink = {
  linkId: string;
  carrier: Pick<Carrier, "id" | "name" | "naic_code" | "am_best_rating" | "contact_name" | "contact_email" | "contact_phone">;
  /** The last thing they sent, so reopening the form shows their own answers. */
  previous: CarrierSubmission | null;
};

/**
 * Resolve a raw token, or explain why not.
 *
 * The three failure modes are kept apart because they need different words on the
 * page. "Expired" and "replaced" both mean ask us for another one; "no such link"
 * means check the address you pasted. Collapsing them into a 404 sends a carrier
 * to support to be told to click the newer email they already have.
 */
export async function resolveOnboardingLink(
  db: SupabaseClient,
  token: string,
): Promise<
  | { ok: true; link: ResolvedLink }
  | { ok: false; reason: "unknown" | "expired" | "revoked" }
> {
  const { data: link } = await db
    .from("carrier_onboarding_links")
    .select("id, carrier_id, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!link) return { ok: false, reason: "unknown" };
  if (link.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(link.expires_at) < new Date()) return { ok: false, reason: "expired" };

  const { data: carrier } = await db
    .from("carriers")
    .select("id, name, naic_code, am_best_rating, contact_name, contact_email, contact_phone")
    .eq("id", link.carrier_id)
    .maybeSingle();

  if (!carrier) return { ok: false, reason: "unknown" };

  const { data: previous } = await db
    .from("carrier_submissions")
    .select("*")
    .eq("link_id", link.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ok: true,
    link: {
      linkId: link.id,
      carrier: carrier as ResolvedLink["carrier"],
      previous: (previous ?? null) as CarrierSubmission | null,
    },
  };
}

export type SubmissionInput = {
  legalName: string | null;
  naicCode: string | null;
  amBestRating: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  states: string[];
  apiBaseUrl: string | null;
  apiDocsUrl: string | null;
  products: string | null;
  notes: string | null;
};

/**
 * Record what a carrier told us.
 *
 * Supersedes their own earlier pending submission rather than adding a second
 * one: two pending rows for the same carrier is a question about which one is
 * current that nobody on the review side can answer. A submission already
 * accepted or rejected is left alone — that is history, and the new one is a
 * correction to it, not an edit of it.
 */
export async function submitCarrierDetails(
  db: SupabaseClient,
  input: { linkId: string; carrierId: string; details: SubmissionInput },
): Promise<{ submissionId: string }> {
  const states = [
    ...new Set(input.details.states.map((s) => s.toUpperCase()).filter(isStateCode)),
  ];

  await db
    .from("carrier_submissions")
    .delete()
    .eq("carrier_id", input.carrierId)
    .eq("status", "pending");

  const { data, error } = await db
    .from("carrier_submissions")
    .insert({
      carrier_id: input.carrierId,
      link_id: input.linkId,
      legal_name: input.details.legalName,
      naic_code: input.details.naicCode,
      am_best_rating: input.details.amBestRating,
      contact_name: input.details.contactName,
      contact_email: input.details.contactEmail?.toLowerCase() ?? null,
      contact_phone: input.details.contactPhone,
      states,
      api_base_url: input.details.apiBaseUrl,
      api_docs_url: input.details.apiDocsUrl,
      products: input.details.products,
      notes: input.details.notes,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new CarrierRefused(`Could not record that: ${error?.message}`, 500);
  }

  await db
    .from("carrier_onboarding_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", input.linkId)
    .is("used_at", null);

  return { submissionId: data.id };
}

/**
 * Accept a submission onto the carrier record.
 *
 * Copies the identity and contact fields and NOTHING else. In particular the
 * states do not become `carrier_state_filings` rows: a filing is an assertion
 * about a regulator's decision and it is the only input to whether a live quote
 * may be given in a state, which is why recording one sits on the compliance role
 * rather than on admin. A carrier asserting its own filings through a web form
 * and having them become the record would route around that check completely.
 * Staff read the list and record filings themselves, product by product.
 *
 * Blank answers do not overwrite. Someone who leaves AM Best empty because they
 * do not know it should not thereby erase the rating we already had.
 */
export async function acceptSubmission(
  db: SupabaseClient,
  input: { submissionId: string; reviewerId: string; note: string | null },
): Promise<{ carrierId: string; applied: string[] }> {
  const { data: submission } = await db
    .from("carrier_submissions")
    .select("*")
    .eq("id", input.submissionId)
    .maybeSingle();

  if (!submission) throw new CarrierRefused("No such submission.", 404);
  if (submission.status !== "pending") {
    throw new CarrierRefused("That submission has already been reviewed.", 409);
  }

  const patch: Record<string, string> = {};
  const applied: string[] = [];

  const fields: [keyof CarrierSubmission, string, string][] = [
    ["naic_code", "naic_code", "NAIC code"],
    ["am_best_rating", "am_best_rating", "AM Best rating"],
    ["contact_name", "contact_name", "contact name"],
    ["contact_email", "contact_email", "contact email"],
    ["contact_phone", "contact_phone", "contact phone"],
  ];

  for (const [from, to, label] of fields) {
    const value = submission[from];
    if (typeof value === "string" && value.trim()) {
      patch[to] = value.trim();
      applied.push(label);
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db
      .from("carriers")
      .update(patch)
      .eq("id", submission.carrier_id);

    // The unique index on NAIC is the realistic collision: two carrier rows for
    // the same insurer, one of them created from an application. Worth saying
    // precisely, because the fix is a merge and not a retry.
    if (error) {
      if (error.code === "23505") {
        throw new CarrierRefused(
          "Another carrier already has that NAIC code. Merge the two records before accepting this.",
          409,
        );
      }
      throw new CarrierRefused(`Could not apply that: ${error.message}`, 500);
    }
  }

  await db
    .from("carrier_submissions")
    .update({
      status: "accepted",
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewerId,
      review_note: input.note,
    })
    .eq("id", input.submissionId);

  return { carrierId: submission.carrier_id as string, applied };
}

/**
 * Reject one. Nothing is written to the carrier; the answers are kept.
 *
 * Kept rather than deleted because "what did they send that we turned down" is
 * the question asked when the same carrier submits again three weeks later.
 */
export async function rejectSubmission(
  db: SupabaseClient,
  input: { submissionId: string; reviewerId: string; note: string | null },
): Promise<{ carrierId: string }> {
  const { data: submission } = await db
    .from("carrier_submissions")
    .select("id, carrier_id, status")
    .eq("id", input.submissionId)
    .maybeSingle();

  if (!submission) throw new CarrierRefused("No such submission.", 404);
  if (submission.status !== "pending") {
    throw new CarrierRefused("That submission has already been reviewed.", 409);
  }

  await db
    .from("carrier_submissions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewerId,
      review_note: input.note,
    })
    .eq("id", input.submissionId);

  return { carrierId: submission.carrier_id as string };
}
