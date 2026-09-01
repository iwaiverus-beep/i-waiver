import { NextResponse } from "next/server";
import { requestContext, recordAuditEvent } from "@/lib/audit";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { issueSigningLink, TransitionRefused } from "@/lib/agreements/lifecycle";
import { assembleAgreement } from "@/lib/render/agreement";
import { sendEmail, signingInvitation } from "@/lib/email";
import { SIGNING_LINK_TTL_HOURS } from "@/lib/tokens";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/[id]/links — issue a fresh signing link.
 *
 * Always a new row, never a revived one. That is why this is a POST behind a
 * button rather than something the detail page does on load: each issue is a real
 * event, and "how many times was a capability to sign this handed out, and to
 * where" is a question the record should be able to answer.
 *
 * It also means the lender's own link is not recoverable after the send response —
 * by design. The token was never stored, only its hash.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    const agreement = await agreementForActor(actor, id);

    if (!["sent", "partially_signed"].includes(agreement.status)) {
      throw new TransitionRefused(
        `Links only exist while an agreement is out for signature. This one is ${agreement.status.replace(/_/g, " ")}.`,
      );
    }

    const body = await readJson<{ role?: unknown; deliver?: unknown }>(request);
    const role = body.role === "borrower" ? "borrower" : "lender";
    const context = requestContext(request);

    const { data: signer } = await actor.db
      .from("signers")
      .select("id, role, display_name, email, signed_at")
      .eq("agreement_id", id)
      .eq("role", role)
      .maybeSingle();

    if (!signer) throw new TransitionRefused("No such signer on this agreement.");
    if (signer.signed_at) {
      throw new TransitionRefused(`${signer.display_name} has already signed.`);
    }

    const { url, expiresAt, linkId } = await issueSigningLink(actor.db, {
      signerId: signer.id,
      agreementId: id,
      context,
    });

    let delivered = false;

    if (body.deliver === true && signer.email) {
      const document = await assembleAgreement(actor.db, id);
      const lender = document.signers.find((s) => s.role === "lender");

      const message = signingInvitation({
        borrowerName: signer.display_name,
        lenderName: lender?.display_name ?? "The lender",
        assetDescription: document.mergeValues.asset_description,
        starts: document.mergeValues.starts_at,
        ends: document.mergeValues.ends_at,
        url,
        expiresHours: SIGNING_LINK_TTL_HOURS,
        specimen: document.specimen,
      });

      const result = await sendEmail({
        to: signer.email,
        subject: message.subject,
        text: message.text,
      });

      delivered = result.transport === "resend";

      await actor.db
        .from("signing_links")
        .update({
          delivery_ref: `${result.transport}:${result.id}`,
          delivered_at: delivered ? new Date().toISOString() : null,
          // Accepted by the provider, nothing more. The webhook moves it from
          // here — see app/api/webhooks/resend/route.ts.
          delivery_status: delivered ? "sent" : "pending",
          delivery_status_at: delivered ? new Date().toISOString() : null,
        })
        .eq("id", linkId);

      await recordAuditEvent(actor.db, {
        agreementId: id,
        signerId: signer.id,
        type: "delivered",
        actor: "system",
        payload: {
          channel: "email",
          transport: result.transport,
          ref: result.id,
          reissued: true,
        },
        context,
      });
    }

    return NextResponse.json({ url, expires_at: expiresAt, delivered });
  } catch (error) {
    return jsonError(error);
  }
}
