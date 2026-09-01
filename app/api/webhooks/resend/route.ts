import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { recordAuditEvent, requestContext } from "@/lib/audit";
import { resendWebhookSecret } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/resend — what became of a message we sent.
 *
 * The gap this closes: `delivered_at` on a signing link has only ever meant the
 * provider accepted it. A full mailbox, a typo, a dead domain — all of them
 * succeeded at send and failed silently afterwards, and the lender found out
 * because the borrower never signed.
 *
 * Unauthenticated by nature, so everything below is written on the assumption
 * that the caller is hostile until the signature says otherwise:
 *
 *   * No secret configured means every request is refused. An open endpoint here
 *     would let anyone mark a borrower's link bounced and send a lender chasing
 *     an address that was fine.
 *   * The raw body is verified before it is parsed. Verifying a re-serialised
 *     object checks a signature over something the sender never signed.
 *   * An unknown message id is a 200, not a 404. The reply to an unauthenticated
 *     caller must not be an oracle for which of our message ids exist, and Resend
 *     retries anything that is not 2xx — including for messages this deployment
 *     never sent, which is the normal state of a staging environment pointed at a
 *     shared account.
 */

/** Svix's tolerance, and the reason a replayed capture stops working. */
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

/**
 * Resend signs with Svix. The scheme is HMAC-SHA256 over `id.timestamp.body`,
 * keyed by the secret with its `whsec_` prefix stripped and the remainder
 * base64-decoded — the key is bytes, not the text of the secret.
 *
 * `svix-signature` carries a space-separated list so a secret can be rotated with
 * both live at once. Any one match is a pass, and every candidate is compared in
 * constant time.
 */
function verify(
  secret: string,
  headers: Headers,
  body: string,
): { ok: true } | { ok: false; why: string } {
  // Svix's own header names, and the vendor-neutral aliases from the
  // standard-webhooks spec that Resend also emits.
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const signature = headers.get("svix-signature") ?? headers.get("webhook-signature");

  if (!id || !timestamp || !signature) return { ok: false, why: "unsigned" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, why: "bad timestamp" };

  const drift = Math.abs(Math.floor(Date.now() / 1000) - sentAt);
  if (drift > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, why: "stale" };

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  for (const candidate of signature.split(" ")) {
    // Each entry is `v1,<base64>`. A version we do not know is skipped rather
    // than treated as a failure, so a future scheme does not become an outage.
    const [version, encoded] = candidate.split(",");
    if (version !== "v1" || !encoded) continue;

    const provided = Buffer.from(encoded, "base64");
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, why: "signature mismatch" };
}

type Outcome = "sent" | "delivered" | "delayed" | "bounced" | "complained";

const OUTCOMES: Record<string, Outcome> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/**
 * Once a message has bounced or been marked as spam, that is the answer.
 *
 * Webhooks arrive out of order, and a late `email.sent` landing after a bounce
 * would otherwise erase the one fact on this row a lender needs to act on. The
 * timestamp check below catches most of it; this catches the rest, including a
 * provider that stamps two events in the same second.
 */
const TERMINAL: Outcome[] = ["bounced", "complained"];

/** The provider's reason, in the shape each event type puts it. */
function detailFrom(type: string, data: Record<string, any>): string | null {
  if (type === "email.bounced") {
    const bounce = data.bounce ?? {};
    const parts = [bounce.type, bounce.subType, bounce.message].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ").slice(0, 500) : "Bounced.";
  }
  if (type === "email.complained") return "Marked as spam by the recipient.";
  if (type === "email.delivery_delayed") {
    return String(data.reason ?? "Delivery delayed; the provider is retrying.").slice(0, 500);
  }
  return null;
}

export async function POST(request: Request) {
  const secret = resendWebhookSecret();
  if (!secret) {
    // Deliberately not 501. An unconfigured endpoint and a rejected caller should
    // look identical from outside.
    return NextResponse.json({ error: "Not accepted." }, { status: 401 });
  }

  const raw = await request.text();
  const check = verify(secret, request.headers, raw);
  if (!check.ok) {
    return NextResponse.json({ error: "Not accepted." }, { status: 401 });
  }

  let event: { type?: string; created_at?: string; data?: Record<string, any> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Unreadable." }, { status: 400 });
  }

  const type = event.type ?? "";
  const outcome = OUTCOMES[type];
  const messageId = event.data?.email_id;

  // Opens and clicks come down the same pipe and are none of this endpoint's
  // business. Acknowledged so the provider stops retrying them.
  if (!outcome || typeof messageId !== "string") {
    return NextResponse.json({ ok: true, ignored: type || "unknown" });
  }

  const db = serviceClient();

  // `delivery_ref` is stored as `<transport>:<id>` so a console-transport send is
  // never mistaken for a real one. The webhook only ever concerns real ones.
  const { data: link } = await db
    .from("signing_links")
    .select(
      "id, signer_id, delivery_status, delivery_status_at, signers(agreement_id, display_name, email)",
    )
    .eq("delivery_ref", `resend:${messageId}`)
    .maybeSingle();

  if (!link) return NextResponse.json({ ok: true, unknown_message: true });

  const occurredAt = event.created_at ? new Date(event.created_at) : new Date();
  const stamp = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

  // Out-of-order protection, in both the forms it arrives in.
  const known = link.delivery_status as Outcome | "pending";
  if (TERMINAL.includes(known as Outcome) && !TERMINAL.includes(outcome)) {
    return NextResponse.json({ ok: true, superseded: true });
  }
  if (
    link.delivery_status_at &&
    new Date(link.delivery_status_at).getTime() > stamp.getTime()
  ) {
    return NextResponse.json({ ok: true, superseded: true });
  }

  const detail = detailFrom(type, event.data ?? {});

  const { error } = await db
    .from("signing_links")
    .update({
      delivery_status: outcome,
      delivery_status_at: stamp.toISOString(),
      delivery_detail: detail,
    })
    .eq("id", link.id);

  if (error) {
    // 500 so the provider retries. Losing a bounce is the failure this endpoint
    // exists to prevent, so it must not be swallowed quietly.
    return NextResponse.json({ error: "Could not record." }, { status: 500 });
  }

  // Only the failures reach the audit trail. A `delivered` event for every
  // message would bury the two entries anybody actually looks for, and the link
  // row already carries the happy path.
  if (TERMINAL.includes(outcome)) {
    const signer = Array.isArray(link.signers) ? link.signers[0] : link.signers;
    if (signer?.agreement_id) {
      await recordAuditEvent(db, {
        agreementId: signer.agreement_id,
        signerId: link.signer_id,
        type: "bounced",
        actor: "system",
        payload: {
          channel: "email",
          outcome,
          to: signer.email ?? null,
          detail,
          provider_event: type,
          provider_message_id: messageId,
        },
        context: requestContext(request),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
