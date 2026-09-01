import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent, type AuditActor, type RequestContext } from "@/lib/audit";
import { runComplianceGate, type Attestations } from "@/lib/compliance";
import { assembleAgreement, type AssembledDocument } from "@/lib/render/agreement";
import { executeAgreement, SIGNATURES_BUCKET, TransitionRefused } from "@/lib/agreements/lifecycle";
import { hashToken, sha256Hex } from "@/lib/tokens";
import { bindCoverage } from "@/lib/coverage/client";
import { verifyBiometricSignature, type VerifiedAssertion } from "@/lib/webauthn";

/**
 * The borrower's session.
 *
 * There is no account, no password and no cookie. The token in the URL is the
 * entire capability, and it is checked here — in the application, against a hash,
 * on every request — because the database policy layer deliberately has nothing to
 * say about it. RLS answers "who is this user"; there is no user.
 */

/**
 * Which side of the instrument acted, for the audit chain.
 *
 * A participant is recorded as a participant rather than folded into `borrower`.
 * A twelve-person booking whose trail reads as twelve borrowers describes a boat
 * that was lent to twelve people, which is not what happened and is exactly the
 * kind of thing the chain exists to be precise about.
 */
function actorFor(role: string): AuditActor {
  if (role === "lender") return "lender";
  if (role === "participant") return "participant";
  return "borrower";
}

export class InvalidLink extends Error {
  constructor(readonly reason: "unknown" | "expired" | "used" | "closed" | "done") {
    super(
      {
        unknown: "This link is not valid.",
        expired: "This link has expired.",
        used: "This link has already been used.",
        closed: "This agreement is no longer open for signature.",
        done: "You have already signed this agreement.",
      }[reason],
    );
  }
}

export type SigningSession = {
  linkId: string;
  signerId: string;
  role: string;
  displayName: string;
  email: string | null;
  agreementId: string;
  document: AssembledDocument;
  /** The ESIGN disclosure the signer must accept, taken from the clause set. */
  consentText: string;
  consentTextHash: string;
  alreadySigned: boolean;
  /** Whether this state requires an education card for this activity. */
  educationRequired: boolean;
  educationAuthority: string | null;
};

/**
 * Validates a token and loads everything the signing page needs.
 *
 * `touch` records the first open — address, agent, timestamp — which is evidence
 * that the link reached a person, and is written once so a refresh does not
 * overwrite the moment it actually arrived.
 */
export async function resolveSigningSession(
  db: SupabaseClient,
  token: string,
  options: { touch?: RequestContext } = {},
): Promise<SigningSession> {
  if (!token || token.length < 20) throw new InvalidLink("unknown");

  const { data: link } = await db
    .from("signing_links")
    .select("id, signer_id, expires_at, consumed_at, first_opened_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!link) throw new InvalidLink("unknown");
  if (link.consumed_at) throw new InvalidLink("used");
  if (new Date(link.expires_at) < new Date()) throw new InvalidLink("expired");

  const { data: signer } = await db
    .from("signers")
    .select("id, agreement_id, role, display_name, email, signed_at, declined_at")
    .eq("id", link.signer_id)
    .single();

  if (!signer) throw new InvalidLink("unknown");
  if (signer.signed_at) throw new InvalidLink("done");

  const { data: agreement } = await db
    .from("agreements")
    .select("id, status")
    .eq("id", signer.agreement_id)
    .single();

  if (!agreement) throw new InvalidLink("unknown");
  if (!["sent", "partially_signed"].includes(agreement.status)) {
    throw new InvalidLink("closed");
  }

  const document = await assembleAgreement(db, signer.agreement_id);

  const consentClause = document.clauses.find((c) => c.kind === "esign_consent");
  if (!consentClause) {
    throw new TransitionRefused(
      "This template has no electronic-signature consent clause, so it cannot be signed electronically.",
    );
  }

  if (options.touch && !link.first_opened_at) {
    await db
      .from("signing_links")
      .update({
        first_opened_at: new Date().toISOString(),
        open_ip: options.touch.ip,
        open_user_agent: options.touch.userAgent,
      })
      .eq("id", link.id)
      .is("first_opened_at", null);

    await recordAuditEvent(db, {
      agreementId: signer.agreement_id,
      signerId: signer.id,
      type: "opened",
      actor: actorFor(signer.role),
      payload: { channel: "email" },
      context: options.touch,
    });
  }

  // Only ask a signer a question the rules for their state actually raise.
  const { data: ruleSet } = await db
    .from("jurisdiction_rule_sets")
    .select("education_required, education_authority")
    .eq("state", document.agreement.jurisdiction)
    .eq("activity_class", document.agreement.activity_class)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    linkId: link.id,
    signerId: signer.id,
    role: signer.role,
    displayName: signer.display_name,
    email: signer.email,
    agreementId: signer.agreement_id,
    document,
    educationRequired: ruleSet?.education_required === true,
    educationAuthority: ruleSet?.education_authority ?? null,
    consentText: consentClause.body,
    // Hashing the rendered clause ties the consent to a versioned, published
    // instrument rather than to a string constant someone can quietly edit.
    consentTextHash: sha256Hex(consentClause.body),
    alreadySigned: Boolean(signer.signed_at),
  };
}

export type SignInput = {
  token: string;
  method: "typed" | "drawn" | "biometric";
  typedName?: string | null;
  /** data:image/png;base64,... from the signature pad. */
  drawnPng?: string | null;
  /** The raw WebAuthn registration response, verified server-side. */
  biometric?: unknown;
  attestations: Attestations;
  consented: boolean;
  /** Quote ids the signer chose to buy, if any. */
  quoteIds?: string[];
  context: RequestContext;
};

export type SignOutcome = {
  agreementId: string;
  executed: boolean;
  documentHash: string;
  policies: { number: string; kind: string; premiumCents: number }[];
};

/**
 * Records a signature and everything that has to be true alongside it.
 *
 * The consent record, the compliance checks and the signature are separate rows on
 * purpose: a signature without a recorded consent is a weaker record, and a
 * consent without the checks that ran beside it does not show what was known at
 * the time.
 */
export async function recordSignature(
  db: SupabaseClient,
  input: SignInput,
): Promise<SignOutcome> {
  const session = await resolveSigningSession(db, input.token);

  if (!input.consented) {
    throw new TransitionRefused(
      "You have to agree to sign electronically before you can sign.",
    );
  }

  if (input.method === "typed" && !input.typedName?.trim()) {
    throw new TransitionRefused("Type your name to sign.");
  }
  if (input.method === "drawn" && !input.drawnPng) {
    throw new TransitionRefused("Draw your signature to sign.");
  }
  if (input.method === "biometric" && !input.biometric) {
    throw new TransitionRefused("Your device did not return a signature.");
  }

  // The gate runs against this signer's own attestations, and a blocking failure
  // stops the signature. It is not an advisory banner.
  const gate = await runComplianceGate(db, {
    agreementId: session.agreementId,
    phase: "sign",
    signerId: session.signerId,
    signerRole: session.role,
    attestations: input.attestations,
  });

  await recordAuditEvent(db, {
    agreementId: session.agreementId,
    signerId: session.signerId,
    type: "compliance_checked",
    actor: actorFor(session.role),
    payload: {
      phase: "sign",
      passed: gate.ok,
      findings: gate.findings.map((f) => ({ kind: f.kind, result: f.result })),
    },
    context: input.context,
  });

  if (!gate.ok) {
    throw new TransitionRefused(
      "We cannot record this signature.",
      gate.blockers.map((b) => b.message),
    );
  }

  // Consent first: it is the thing that makes what follows an electronic
  // signature rather than a click.
  const { error: consentError } = await db.from("consent_records").insert({
    signer_id: session.signerId,
    consent_text_hash: session.consentTextHash,
    ip: input.context.ip,
    user_agent: input.context.userAgent,
  });

  if (consentError) {
    throw new TransitionRefused(`Consent was not recorded: ${consentError.message}`);
  }

  await recordAuditEvent(db, {
    agreementId: session.agreementId,
    signerId: session.signerId,
    type: "consented",
    actor: actorFor(session.role),
    payload: { consent_text_hash: session.consentTextHash },
    context: input.context,
  });

  let imageStorageKey: string | null = null;
  if (input.method === "drawn" && input.drawnPng) {
    const base64 = input.drawnPng.replace(/^data:image\/png;base64,/, "");
    const bytes = Buffer.from(base64, "base64");

    if (bytes.length > 512_000) {
      throw new TransitionRefused("That signature image is too large.");
    }

    imageStorageKey = `${session.agreementId}/${session.signerId}.png`;
    const { error } = await db.storage
      .from(SIGNATURES_BUCKET)
      .upload(imageStorageKey, bytes, { contentType: "image/png", upsert: false });

    if (error && !error.message.includes("already exists")) {
      throw new TransitionRefused(`Signature image was not stored: ${error.message}`);
    }
  }

  // Verified here, immediately before the insert, and bound to this session's
  // own document hash. Passing the hash from the session rather than from the
  // request is what stops a caller signing one document and presenting it as a
  // signature over another.
  let assertion: VerifiedAssertion | null = null;
  if (input.method === "biometric") {
    assertion = await verifyBiometricSignature({
      response: input.biometric as never,
      documentHash: session.document.documentHash,
    });
  }

  const signedAt = new Date().toISOString();

  const { error: signatureError } = await db.from("signatures").insert({
    signer_id: session.signerId,
    method: input.method,
    image_storage_key: imageStorageKey,
    typed_name: input.method === "typed" ? input.typedName!.trim().slice(0, 120) : null,
    // Binds the signature to the exact wording. Without this the signature proves
    // far less than it appears to.
    document_hash_at_signing: session.document.documentHash,
    device_assertion: assertion,
    user_verified: assertion ? assertion.user_verified : null,
    signed_at: signedAt,
    ip: input.context.ip,
    user_agent: input.context.userAgent,
  });

  if (signatureError) {
    throw new TransitionRefused(`Signature was not recorded: ${signatureError.message}`);
  }

  await db
    .from("signers")
    .update({ signed_at: signedAt })
    .eq("id", session.signerId)
    .is("signed_at", null);

  // Single use. The capability is spent whether or not anything else follows.
  await db
    .from("signing_links")
    .update({ consumed_at: signedAt })
    .eq("id", session.linkId)
    .is("consumed_at", null);

  await recordAuditEvent(db, {
    agreementId: session.agreementId,
    signerId: session.signerId,
    type: "signed",
    actor: actorFor(session.role),
    payload: {
      method: input.method,
      document_hash_at_signing: session.document.documentHash,
      // The credential id is enough to tie the audit entry to the signature row.
      // The public key and the rest stay on that row rather than being copied
      // into an append-only table that can never be corrected.
      ...(assertion
        ? { user_verified: true, credential_id: assertion.credential_id }
        : {}),
    },
    context: input.context,
  });

  // Cover, if they chose any. Bound after the signature, never before: the
  // signature is the thing being protected, and a policy attached to an agreement
  // nobody signed is a refund waiting to happen.
  const policies: SignOutcome["policies"] = [];
  if (input.quoteIds && input.quoteIds.length > 0) {
    try {
      const result = await bindCoverage({ quote_ids: input.quoteIds, collector: "carrier" });
      for (const policy of result.policies) {
        policies.push({
          number: policy.carrier_policy_number,
          kind: policy.coverage_kind,
          premiumCents: policy.premium_cents,
        });
        await recordAuditEvent(db, {
          agreementId: session.agreementId,
          signerId: session.signerId,
          type: "bound",
          actor: "carrier",
          payload: {
            policy_number: policy.carrier_policy_number,
            coverage_kind: policy.coverage_kind,
            premium_cents: policy.premium_cents,
          },
          context: input.context,
        });
      }
    } catch (cause) {
      // The signature stands. Cover that failed to bind is a problem to surface,
      // not a reason to throw away an executed agreement.
      console.error(`bind failed for ${session.agreementId}: ${(cause as Error).message}`);
    }
  }

  // Is that everyone?
  const { data: outstanding } = await db
    .from("signers")
    .select("id")
    .eq("agreement_id", session.agreementId)
    .is("signed_at", null)
    .is("declined_at", null);

  const everyoneSigned = (outstanding ?? []).length === 0;

  if (everyoneSigned) {
    await executeAgreement(db, session.agreementId, input.context);
  } else {
    await db
      .from("agreements")
      .update({ status: "partially_signed" })
      .eq("id", session.agreementId)
      .eq("status", "sent");
  }

  return {
    agreementId: session.agreementId,
    executed: everyoneSigned,
    documentHash: session.document.documentHash,
    policies,
  };
}
