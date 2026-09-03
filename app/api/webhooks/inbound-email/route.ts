import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { inboundEmailSecret, supportEmail } from "@/lib/env";
import { jsonError, readJson, text } from "@/lib/http";
import { serviceClient } from "@/lib/supabase/service";
import { recordInbound } from "@/lib/support/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/inbound-email — the ear on the support mailbox.
 *
 * Every @i-waiver.com address is a forward today, so nothing in the product ever
 * saw mail sent to support@. This is the endpoint that closes that: a relay in
 * front of the mailbox — a Cloudflare Email Worker on the route that already
 * exists, or a provider's inbound webhook — posts each message here as JSON, and
 * /admin/support/inbox is where it lands.
 *
 * Nothing in this repository provisions that relay; it is a route in a mail
 * account, not code. Until one is pointed here the console says so on its face
 * rather than showing an empty queue that looks like a quiet week.
 *
 * ---------------------------------------------------------------------------
 * AUTHENTICATION, and why it is a bearer secret rather than a signature.
 *
 * The Resend delivery webhook next door verifies an HMAC because Resend signs
 * with Svix and there is a signature to check. There is no such scheme here: the
 * sender is a relay we write ourselves, so the credential is a secret we choose,
 * presented in a header, compared in constant time.
 *
 * The same two rules as that endpoint hold, for a sharper reason — this one takes
 * a stranger's prose straight onto an authenticated staff screen:
 *
 *   * No secret configured means every request is refused. An open endpoint would
 *     let anyone on the internet put a message in the support queue attributed to
 *     any address they chose, and staff act on what that queue says.
 *   * The reply says as little as possible. A caller who fails the check learns
 *     only that they failed.
 * ---------------------------------------------------------------------------
 */
export async function POST(request: Request) {
  const secret = inboundEmailSecret();
  if (!secret) {
    console.error("inbound-email: INBOUND_EMAIL_SECRET is not set — refused.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  const presented =
    request.headers.get("x-inbound-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  // Length is compared first because timingSafeEqual throws on a mismatch, and
  // the length of a secret is not something worth leaking through an exception.
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Refused." }, { status: 401 });
  }

  try {
    const body = await readJson<Record<string, unknown>>(request);

    // `from` may arrive bare or as "Name <addr>". Both are accepted and the
    // address is pulled out, because which one a relay sends depends on the
    // relay and the difference is not worth a configuration note.
    const rawFrom = text(body.from, 320) ?? text(body.sender, 320);
    if (!rawFrom) {
      return NextResponse.json({ error: "No sender." }, { status: 400 });
    }

    const fromEmail = (rawFrom.match(/<([^>]+)>/)?.[1] ?? rawFrom).trim();
    const fromName =
      text(body.from_name, 200) ??
      (rawFrom.includes("<") ? rawFrom.split("<")[0].trim().replace(/^"|"$/g, "") : null);

    // Plain text, and the HTML part is not a fallback — see the note on
    // support_inbound_emails.body in migration 46. A message with no text part is
    // recorded as having none rather than being dropped: that it arrived at all
    // is the fact worth keeping.
    const messageBody =
      text(body.text, 60000) ??
      text(body.body, 60000) ??
      text(body.plain, 60000) ??
      "(No plain-text part. Open the mailbox to read this one.)";

    const result = await recordInbound(serviceClient(), {
      mailbox: text(body.to, 320) ?? supportEmail(),
      fromEmail,
      fromName,
      subject: text(body.subject, 400),
      body: messageBody,
      messageId: text(body.message_id, 400) ?? text(body.messageId, 400),
      receivedAt: text(body.received_at, 40),
    });

    // What became of it, so a relay's own log says something useful. Deliberately
    // not the row id shaped as a resource — there is nothing here to fetch.
    return NextResponse.json({ ok: true, status: result.status }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
