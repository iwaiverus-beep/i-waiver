import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAuditEvent, type RequestContext } from "@/lib/audit";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

/**
 * Correcting how a signer is reached, after the agreement has gone out.
 *
 * The case this exists for is the ordinary one: the address bounced, the mailbox
 * was full, somebody typed gmial.com. Without this the only remedy was to void a
 * perfectly good agreement and rebuild it, which is a heavy answer to a typo.
 *
 * WHY IT IS NARROW.
 *
 * A signer's contact detail is not metadata sitting beside the document — it is
 * inside it. `canonicalise` in lib/render/agreement.ts writes the parties as
 *
 *     borrower: Jane Smith <jane@example.com> [uuid]
 *
 * so changing an address re-renders the agreement and changes its hash. That is
 * correct, not a defect: the record of who was party to this and how they were
 * reached belongs in the instrument. But it means an edit is only safe while
 * nothing is bound to the old bytes.
 *
 * Hence the rule below is NOT "the status is sent". It is that nobody has signed
 * — anybody, not just the signer being edited. If the lender has already signed,
 * their `signatures.document_hash_at_signing` was computed over text containing
 * the old address, and quietly changing it underneath them leaves a signature
 * that fails its own verification. Nobody would discover that until it mattered.
 *
 * Once anyone has signed, the remedy is the one the schema was built for: void
 * and re-execute, linked by `replaces_agreement_id`.
 */

/**
 * Deliberately permissive, and only about shape.
 *
 * The purpose is to catch a hand slipping — a missing @, a trailing comma, a
 * pasted display name — not to adjudicate what the RFC permits. Anything
 * stricter rejects real addresses, and the real proof that an address works is
 * the delivery webhook, which is now wired.
 */
function cleanEmail(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 320) throw new TransitionRefused("That email is too long.");
  if (!/^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(value)) {
    throw new TransitionRefused(`"${value}" does not look like an email address.`);
  }
  return value.toLowerCase();
}

/**
 * E.164, or a sentence explaining why not.
 *
 * Exported because the account screen puts a phone number on `profiles` and
 * there is no version of "two normalisers for one column shape" that stays in
 * step with itself.
 */
export function cleanPhone(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  // Stored E.164 so it is ready for the SMS channel whenever that is built —
  // `delivery_channel` has carried an `sms` value since the initial schema.
  const compact = value.replace(/[\s()\-.]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(compact)) {
    throw new TransitionRefused(
      `"${value}" does not look like a phone number. Include the country code, e.g. +1 555 010 0123.`,
    );
  }
  return compact.startsWith("+") ? compact : `+${compact}`;
}

export async function updateSignerContact(
  db: SupabaseClient,
  input: {
    agreementId: string;
    signerId: string;
    email: string | null;
    phone: string | null;
    context: RequestContext;
  },
): Promise<{
  email: string | null;
  phone: string | null;
  linksRevoked: number;
}> {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, status, legal_hold_at")
    .eq("id", input.agreementId)
    .single();

  if (!agreement) throw new TransitionRefused("Agreement not found.");

  if (agreement.legal_hold_at) {
    throw new TransitionRefused(
      "This agreement is under legal hold and cannot be changed.",
    );
  }

  if (!["draft", "sent"].includes(agreement.status)) {
    throw new TransitionRefused(
      agreement.status === "partially_signed"
        ? "Somebody has already signed this. Changing an address now would break the signature already on it — void it and send a fresh one instead."
        : `This agreement is ${agreement.status.replace(/_/g, " ")}, so its details are fixed.`,
    );
  }

  const { data: signers } = await db
    .from("signers")
    .select("id, role, display_name, email, phone, signed_at, declined_at")
    .eq("agreement_id", input.agreementId);

  // The belt to the status check's braces. `sent` should already mean nobody has
  // signed, but the thing being protected here is every existing signature on the
  // agreement, and that is worth asking about directly rather than inferring from
  // a status column two writers can move.
  const alreadySigned = (signers ?? []).filter((s) => s.signed_at);
  if (alreadySigned.length > 0) {
    throw new TransitionRefused(
      `${alreadySigned[0].display_name} has already signed. Changing an address now would break that signature — void this and send a fresh one instead.`,
    );
  }

  const signer = (signers ?? []).find((s) => s.id === input.signerId);
  if (!signer) throw new TransitionRefused("No such signer on this agreement.");

  if (signer.declined_at) {
    throw new TransitionRefused(
      `${signer.display_name} declined to sign. A new address will not reopen that — send a fresh agreement if they have changed their mind.`,
    );
  }

  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phone);

  // The database says so too (`signer_is_reachable`), but arriving there with a
  // constraint violation gives the lender a Postgres error where a sentence
  // belongs.
  if (!email && !phone) {
    throw new TransitionRefused(
      "Give an email address or a phone number — there has to be some way to reach them.",
    );
  }

  if (email === signer.email && phone === signer.phone) {
    throw new TransitionRefused("That is already what is on file.");
  }

  const { error } = await db
    .from("signers")
    .update({ email, phone })
    .eq("id", signer.id);

  if (error) throw new TransitionRefused(`Could not update: ${error.message}`);

  // Every outstanding link for this signer dies here.
  //
  // Not tidiness. The usual reason for an edit is that the address was wrong,
  // and a wrong address is one somebody else may be reading — a live, single-use
  // capability to sign this agreement as this person, sitting in a stranger's
  // inbox. Consuming rather than deleting keeps the record that it existed, the
  // same way voiding does.
  const { data: revoked } = await db
    .from("signing_links")
    .update({ consumed_at: new Date().toISOString() })
    .eq("signer_id", signer.id)
    .is("consumed_at", null)
    .select("id");

  const linksRevoked = revoked?.length ?? 0;

  // Both values, because "the address was changed" is half a fact. The half that
  // matters afterwards is what it was changed FROM — that is the record of where
  // a capability to sign was originally sent.
  await recordAuditEvent(db, {
    agreementId: input.agreementId,
    signerId: signer.id,
    type: "contact_updated",
    actor: "lender",
    payload: {
      role: signer.role,
      from: { email: signer.email, phone: signer.phone },
      to: { email, phone },
      links_revoked: linksRevoked,
    },
    context: input.context,
  });

  return { email, phone, linksRevoked };
}
