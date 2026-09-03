import { NextResponse } from "next/server";

import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { openTicket } from "@/lib/support/tickets";
import { HELP_TOPICS, type SupportCategory } from "@/lib/support/labels";

export const runtime = "nodejs";

/**
 * POST /api/help — the help page's form.
 *
 * WHY THIS IS NOT /api/support/tickets. That route answers 401 without a session,
 * on purpose and correctly: it takes the opener's address from the session
 * precisely so that nobody can open a ticket as somebody else. This one cannot
 * work that way. The help page is reachable without signing in — a lender locked
 * out of their account is the likeliest person on it, and "sign in to tell us you
 * cannot sign in" is not a support channel.
 *
 * So the two routes make different trades, and each is written to its own:
 *
 *   * Signed in, the address comes from the SESSION and the body's is ignored.
 *     There is no reason for somebody holding an account to file as another
 *     address, and honouring it would hand a way to do so to every account.
 *   * Signed out, the address comes from the body, because there is nothing else
 *     it could come from. That is the trade every contact form on the web makes.
 *     What it buys an abuser is one acknowledgement email to an address they
 *     typed, so the guards below are proportionate to that and not more: a
 *     honeypot, hard length caps, and no attacker-controlled text anywhere but
 *     the body of a mail we send to that same address.
 */

/** The two things the page asks for, and the only two it accepts. */
const KINDS = ["help", "idea"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(request: Request) {
  try {
    const body = await readJson<Record<string, unknown>>(request);

    // The honeypot. A field positioned off-screen and unlabelled, which a person
    // never sees and a form-filling bot completes because it completes
    // everything. Answered 200 rather than 400 deliberately — telling a bot which
    // of its submissions were rejected is how it learns to stop filling the field.
    if (text(body.website, 200)) {
      return NextResponse.json({ ok: true, reference: null }, { status: 201 });
    }

    const kindValue = text(body.kind, 10);
    const kind: Kind = (KINDS as readonly string[]).includes(kindValue ?? "")
      ? (kindValue as Kind)
      : "help";

    const message = text(body.message, 8000);
    if (!message) {
      return NextResponse.json(
        {
          error:
            kind === "idea"
              ? "Tell us the idea."
              : "Tell us what is happening.",
        },
        { status: 400 },
      );
    }

    // Newlines stripped, not merely trimmed. This lands in a Subject line, and a
    // subject containing a line break is the shape of a header-injection attempt
    // — harmless against Resend's JSON API, and not something to pass along on
    // the strength of the transport happening to be safe today.
    const subject =
      text((body.subject as string | undefined)?.replace(/[\r\n]+/g, " "), 160) ??
      (kind === "idea" ? "An idea" : "A request for help");

    const user = await currentUser();

    const openerEmail = user?.email ?? text(body.email, 200);
    if (!openerEmail) {
      return NextResponse.json(
        { error: "We need an email address to reply to." },
        { status: 400 },
      );
    }
    if (!EMAIL_PATTERN.test(openerEmail)) {
      return NextResponse.json(
        { error: "That does not look like an email address." },
        { status: 400 },
      );
    }

    const openerName =
      (user?.user_metadata?.full_name as string | undefined) ??
      text(body.name, 120) ??
      null;

    // An idea is an idea; there is no second question to ask about it. A request
    // for help carries a topic, checked against the page's own list rather than
    // the full category set — 'idea' is reachable only through `kind`, so it
    // cannot arrive here wearing the other hat.
    const requested = text(body.category, 40);
    const category: SupportCategory =
      kind === "idea"
        ? "idea"
        : ((HELP_TOPICS as readonly string[]).includes(requested ?? "")
            ? (requested as SupportCategory)
            : "other");

    // The service client, because the common case has no session at all and
    // `support_tickets` is revoked from anon. Every value written below has been
    // narrowed above; nothing from the request reaches a query unchecked.
    const ticket = await openTicket(serviceClient(), {
      openedBy: user?.id ?? null,
      openerEmail,
      openerName,
      subject,
      category,
      body: message,
      // Signing in is what separates these. Somebody with a session is a
      // customer writing in; somebody without one is a member of the public, and
      // recording them as a customer would be a guess written into an
      // append-only table.
      authorKind: user ? "lender" : "public",
      // An idea has nobody waiting on it and never turns into a breach of
      // anything. Filing it at the queue's default priority would put it in
      // front of a lender who cannot send a signing link.
      priority: kind === "idea" ? "low" : undefined,
    });

    return NextResponse.json(
      { ok: true, reference: ticket.reference },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
