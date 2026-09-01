import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent, type RequestContext } from "@/lib/audit";
import { runComplianceGate } from "@/lib/compliance";
import { assembleAgreement } from "@/lib/render/agreement";
import { renderAgreementPdf, type SignatureEvidence } from "@/lib/render/pdf";
import { executedCopy, sendEmail, signingInvitation } from "@/lib/email";
import { hashToken, linkExpiry, mintToken, sha256Hex, SIGNING_LINK_TTL_HOURS } from "@/lib/tokens";
import { siteOrigin } from "@/lib/env";

/**
 * The transitions.
 *
 * Every state change after `draft` lives here rather than being a column a client
 * can set, because each one has side effects — snapshotting, rendering, hashing,
 * delivery, audit — that must happen together or not at all. "Set status to sent"
 * is not a thing anyone can do.
 */

export class TransitionRefused extends Error {
  constructor(message: string, readonly reasons: string[] = []) {
    super(message);
  }
}

const DOCUMENTS_BUCKET = "agreement-documents";
const SIGNATURES_BUCKET = "signature-images";

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SendResult = {
  status: string;
  documentHash: string;
  specimen: boolean;
  links: { signerId: string; role: string; url: string; delivered: boolean }[];
  warnings: string[];
};

/**
 * Freezes the agreement and puts it in front of its signers.
 *
 * Order matters and is not negotiable:
 *   1. compliance gate — a blocking failure stops everything here;
 *   2. snapshot every item — after this no live row can change the document;
 *   3. render — which asserts the clause set has been reviewed;
 *   4. mint links, deliver, audit.
 *
 * Rendering before snapshotting would produce a document describing an asset the
 * agreement does not record.
 */
export async function sendAgreement(
  db: SupabaseClient,
  agreementId: string,
  context: RequestContext,
): Promise<SendResult> {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, status, asset_id, starts_at, ends_at, jurisdiction, activity_class")
    .eq("id", agreementId)
    .single();

  if (!agreement) throw new TransitionRefused("Agreement not found.");
  if (agreement.status !== "draft") {
    throw new TransitionRefused(
      `This agreement is already ${agreement.status.replace(/_/g, " ")}.`,
    );
  }
  if (new Date(agreement.ends_at) <= new Date()) {
    throw new TransitionRefused("The loan period has already ended.");
  }

  const { data: signers } = await db
    .from("signers")
    .select("id, role, display_name, email, capacity")
    .eq("agreement_id", agreementId);

  const lender = signers?.find((s) => s.role === "lender");
  const borrower = signers?.find((s) => s.role === "borrower");
  if (!lender || !borrower) {
    throw new TransitionRefused("Add both a lender and a borrower before sending.");
  }
  for (const signer of [lender, borrower]) {
    if (!signer.email) {
      throw new TransitionRefused(
        `${signer.display_name} needs an email address — that is how the link gets to them.`,
      );
    }
  }

  // 1. Compliance gate.
  const gate = await runComplianceGate(db, { agreementId, phase: "send" });
  await recordAuditEvent(db, {
    agreementId,
    type: "compliance_checked",
    actor: "system",
    payload: {
      phase: "send",
      passed: gate.ok,
      findings: gate.findings.map((f) => ({ kind: f.kind, result: f.result })),
    },
    context,
  });

  if (!gate.ok) {
    throw new TransitionRefused(
      "This agreement cannot be sent yet.",
      gate.blockers.map((b) => b.message),
    );
  }

  // 2. Snapshot every item. Constraint 4: after this, the document does not move.
  //
  // All of them or none of them. A bundle where the trailer froze and the jet
  // ski did not is an agreement whose schedule half describes the past — so the
  // whole list is gathered and validated before a single row is written.
  if (agreement.asset_id) {
    const { data: bundleRows, error: bundleError } = await db
      .from("agreement_assets")
      .select(
        "order_index, assets(id, asset_class, description, identifier, declared_value_cents, year, make, model)",
      )
      .eq("agreement_id", agreementId)
      .order("order_index");

    if (bundleError) {
      throw new TransitionRefused(`Could not read the items: ${bundleError.message}`);
    }

    type Item = {
      id: string;
      asset_class: string;
      description: string;
      identifier: string | null;
      declared_value_cents: number | null;
      year: number | null;
      make: string | null;
      model: string | null;
    };

    const items = (bundleRows ?? [])
      .map((row) => {
        const embedded = row.assets as unknown as Item | Item[] | null;
        return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
      })
      .filter((item): item is Item => item !== null);

    if (items.length === 0) {
      throw new TransitionRefused("The items on this agreement no longer exist.");
    }

    const unvalued = items.filter((item) => item.declared_value_cents === null);
    if (unvalued.length > 0) {
      throw new TransitionRefused(
        unvalued.length === items.length && items.length === 1
          ? "Give the asset a declared value first — the damage clause and the cover both need it."
          : `Give ${unvalued.map((i) => i.description).join(" and ")} a declared value first — the damage clause and the cover both need one for every item.`,
      );
    }

    // `id` is dropped: a snapshot describes the thing, and keeping a live row id
    // inside it invites exactly the reference-instead-of-snapshot read that
    // constraint 4 exists to prevent.
    const snapshots = items.map(({ id: _id, ...facts }) => facts);

    const { error } = await db
      .from("agreements")
      .update({
        // The lead item stays in `asset_snapshot` so that everything written
        // against it before bundles existed keeps working unchanged.
        asset_snapshot: snapshots[0],
        asset_snapshots: snapshots,
      })
      .eq("id", agreementId)
      .eq("status", "draft");

    if (error) throw new TransitionRefused(`Could not snapshot the items: ${error.message}`);
  }

  // 3. Render. Raises if any clause in the set is unpublished.
  const document = await assembleAgreement(db, agreementId);

  // 4. Links, delivery, audit.
  const { error: statusError } = await db
    .from("agreements")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", agreementId)
    .eq("status", "draft");

  if (statusError) throw new TransitionRefused(`Could not send: ${statusError.message}`);

  await recordAuditEvent(db, {
    agreementId,
    type: "sent",
    actor: "lender",
    payload: {
      document_hash: document.documentHash,
      template_version_id: document.agreement.template_version_id,
      specimen: document.specimen,
      item_count: document.assets.length,
    },
    context,
  });

  const links: SendResult["links"] = [];
  const warnings = gate.findings
    .filter((f) => f.result === "warn")
    .map((f) => f.message);

  for (const signer of [lender, borrower]) {
    const { url, linkId } = await issueSigningLink(db, {
      signerId: signer.id,
      agreementId,
      context,
    });

    // Only the borrower is emailed. The lender is standing in the app that just
    // sent it, and mailing them a link to click would be theatre.
    let delivered = false;
    if (signer.role === "borrower") {
      const message = signingInvitation({
        borrowerName: signer.display_name,
        lenderName: lender.display_name,
        assetDescription: document.mergeValues.asset_description,
        // Spelled out for a bundle: an email has no Schedule A below it.
        items:
          document.assets.length > 1
            ? document.assets.map((item) =>
                [
                  [item.year, item.make, item.model].filter(Boolean).join(" ") ||
                    item.description,
                  item.identifier,
                ]
                  .filter(Boolean)
                  .join(" - "),
              )
            : undefined,
        starts: document.mergeValues.starts_at,
        ends: document.mergeValues.ends_at,
        url,
        expiresHours: SIGNING_LINK_TTL_HOURS,
        specimen: document.specimen,
      });

      try {
        const result = await sendEmail({
          to: signer.email!,
          subject: message.subject,
          text: message.text,
        });

        // `delivered_at` is only set for a real send. The console transport is
        // recorded as what it is.
        await db
          .from("signing_links")
          .update({
            delivery_ref: `${result.transport}:${result.id}`,
            delivered_at: result.transport === "resend" ? new Date().toISOString() : null,
          })
          .eq("id", linkId);

        delivered = result.transport === "resend";

        await recordAuditEvent(db, {
          agreementId,
          signerId: signer.id,
          type: "delivered",
          actor: "system",
          payload: { channel: "email", transport: result.transport, ref: result.id },
          context,
        });

        if (result.transport === "console") {
          warnings.push(
            "No email provider is configured, so nothing was actually sent. The borrower's link is on the agreement page.",
          );
        }
      } catch (cause) {
        // The agreement is sent; the email is not. Say so rather than rolling
        // back a state change that already has audit events behind it.
        warnings.push(
          `The agreement was sent but the email failed: ${(cause as Error).message}`,
        );
      }
    }

    links.push({ signerId: signer.id, role: signer.role, url, delivered });
  }

  return {
    status: "sent",
    documentHash: document.documentHash,
    specimen: document.specimen,
    links,
    warnings,
  };
}

/**
 * Mints a new signing link.
 *
 * Always a new row. Reissuing by extending an existing link's expiry would
 * destroy the record of how many times, and to what address, a capability to sign
 * this agreement was handed out.
 */
export async function issueSigningLink(
  db: SupabaseClient,
  input: { signerId: string; agreementId: string; context: RequestContext },
): Promise<{ url: string; expiresAt: string; linkId: string }> {
  const token = mintToken();
  const expiresAt = linkExpiry().toISOString();

  const { data, error } = await db
    .from("signing_links")
    .insert({
      signer_id: input.signerId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      delivery_channel: "email",
    })
    // The id comes back so delivery can be recorded against this exact row.
    // Finding it again by "most recent link for this signer" would be a race
    // against a second send, and would attribute a message id to the wrong link.
    .select("id")
    .single();

  if (error || !data) {
    throw new TransitionRefused(`Could not create a signing link: ${error?.message}`);
  }

  return { url: `${siteOrigin()}/sign/${token}`, expiresAt, linkId: data.id };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * Called once the last signature lands.
 *
 * Renders the executed PDF, hashes the bytes, stores it write-once, records the
 * document row, and mails both parties a copy. The PDF's metadata dates are pinned
 * to the execution time so the same inputs produce the same bytes — a document
 * whose hash drifts on re-render proves nothing.
 */
export async function executeAgreement(
  db: SupabaseClient,
  agreementId: string,
  context: RequestContext,
): Promise<{ documentId: string; sha256: string }> {
  const executedAt = new Date();

  const { data: current } = await db
    .from("agreements")
    .select("status")
    .eq("id", agreementId)
    .single();

  if (!current || !["sent", "partially_signed"].includes(current.status)) {
    throw new TransitionRefused(
      `Cannot execute an agreement that is ${current?.status ?? "missing"}.`,
    );
  }

  // Everything that can fail happens before the status moves. An agreement marked
  // executed with no document behind it is the one end state a party will look at
  // and be wrong about, so it is the one this ordering rules out.
  const document = await assembleAgreement(db, agreementId);

  const { data: signatureRows } = await db
    .from("signatures")
    .select("signer_id, method, typed_name, image_storage_key, signed_at, ip, document_hash_at_signing")
    .in("signer_id", document.signers.map((s) => s.id))
    .order("signed_at");

  const evidence: SignatureEvidence[] = [];
  for (const row of signatureRows ?? []) {
    const signer = document.signers.find((s) => s.id === row.signer_id);
    let imagePng: Uint8Array | null = null;

    if (row.image_storage_key) {
      const { data } = await db.storage
        .from(SIGNATURES_BUCKET)
        .download(row.image_storage_key);
      if (data) imagePng = new Uint8Array(await data.arrayBuffer());
    }

    evidence.push({
      signerId: row.signer_id,
      displayName: signer?.display_name ?? "Unknown",
      role: signer?.role ?? "signer",
      method: row.method,
      typedName: row.typed_name,
      imagePng,
      signedAt: row.signed_at,
      ip: row.ip,
      documentHashAtSigning: row.document_hash_at_signing,
    });
  }

  const { data: auditRows } = await db
    .from("audit_events")
    .select("id, occurred_at, event_type, actor, hash")
    .eq("agreement_id", agreementId)
    .order("id");

  const pdf = await renderAgreementPdf({
    document,
    signatures: evidence,
    audit: (auditRows ?? []).map((row) => ({
      eventId: row.id,
      occurredAt: row.occurred_at,
      eventType: row.event_type,
      actor: row.actor,
      hash: row.hash,
    })),
    producedAt: executedAt,
  });

  const sha256 = sha256Hex(pdf);
  const storageKey = `${agreementId}/agreement-${sha256.slice(0, 16)}.pdf`;

  const { error: uploadError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storageKey, pdf, {
      contentType: "application/pdf",
      // Write-once. An upsert here would let a later render quietly replace the
      // bytes someone signed.
      upsert: false,
    });

  if (uploadError && !uploadError.message.includes("already exists")) {
    throw new TransitionRefused(`Could not store the document: ${uploadError.message}`);
  }

  const { data: documentRow, error: documentError } = await db
    .from("documents")
    .insert({
      agreement_id: agreementId,
      kind: "agreement",
      storage_key: storageKey,
      sha256,
      warranted: true,
      render_inputs: {
        ...document.renderInputs,
        canonical_document_hash: document.documentHash,
        produced_at: executedAt.toISOString(),
      },
    })
    .select("id")
    .single();

  if (documentError || !documentRow) {
    throw new TransitionRefused(
      `Could not record the document: ${documentError?.message}`,
    );
  }

  // Only now. The status guard is repeated here so that a second caller that got
  // this far cannot flip an already-executed agreement a second time.
  const { error: updateError } = await db
    .from("agreements")
    .update({ status: "executed", executed_at: executedAt.toISOString() })
    .eq("id", agreementId)
    .in("status", ["sent", "partially_signed"]);

  if (updateError) throw new TransitionRefused(updateError.message);

  // Both parties get a copy. The borrower especially: they have no account to
  // come back to, so the email is their only copy.
  for (const signer of document.signers) {
    if (!signer.email) continue;
    const message = executedCopy({
      recipientName: signer.display_name,
      assetDescription: document.mergeValues.asset_description,
      itemCount: document.assets.length,
      documentHash: sha256,
      specimen: document.specimen,
    });

    try {
      await sendEmail({
        to: signer.email,
        subject: message.subject,
        text: message.text,
        attachments: [{ filename: "agreement.pdf", content: pdf }],
      });
    } catch (cause) {
      console.error(
        `executed copy to ${signer.role} failed: ${(cause as Error).message}`,
      );
    }
  }

  await recordAuditEvent(db, {
    agreementId,
    type: "signed",
    actor: "system",
    payload: {
      executed: true,
      document_id: documentRow.id,
      document_sha256: sha256,
      canonical_hash: document.documentHash,
    },
    context,
  });

  return { documentId: documentRow.id, sha256 };
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

/** Corrections happen by voiding and re-executing, with both linked. */
export async function voidAgreement(
  db: SupabaseClient,
  agreementId: string,
  reason: string,
  context: RequestContext,
): Promise<void> {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, status, legal_hold_at")
    .eq("id", agreementId)
    .single();

  if (!agreement) throw new TransitionRefused("Agreement not found.");
  if (agreement.status === "voided") throw new TransitionRefused("Already voided.");

  const { error } = await db
    .from("agreements")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_reason: reason.slice(0, 500),
    })
    .eq("id", agreementId);

  if (error) throw new TransitionRefused(error.message);

  // Outstanding links stop working immediately. Consuming rather than deleting
  // keeps the record that they existed.
  const { data: signers } = await db
    .from("signers")
    .select("id")
    .eq("agreement_id", agreementId);

  await db
    .from("signing_links")
    .update({ consumed_at: new Date().toISOString() })
    .in("signer_id", (signers ?? []).map((s) => s.id))
    .is("consumed_at", null);

  await recordAuditEvent(db, {
    agreementId,
    type: "voided",
    actor: "lender",
    payload: { reason: reason.slice(0, 500) },
    context,
  });
}

export { DOCUMENTS_BUCKET, SIGNATURES_BUCKET };
