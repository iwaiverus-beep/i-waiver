import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { currentPartnerActor, membershipFor } from "@/lib/partners/access";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import {
  SUPPORT_CATEGORIES,
  openTicket,
  type SupportCategory,
} from "@/lib/support/tickets";

export const runtime = "nodejs";

/**
 * POST /api/support/tickets — open a ticket.
 *
 * One endpoint for both audiences, because a ticket is a ticket. Who is asking is
 * worked out from the session rather than from the request: a partner member gets
 * their ticket attached to their partner, a signed-in lender gets one attached to
 * nothing, and in both cases the email address on it is the one on the account.
 *
 * Taking `opener_email` from the body instead would let anybody open a ticket as
 * anybody, and every reply on that thread would then be emailed to them.
 */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user?.email) {
      return NextResponse.json(
        { error: "Sign in first, or write to us by email." },
        { status: 401 },
      );
    }

    const body = await readJson<Record<string, unknown>>(request);
    const subject = text(body.subject, 200);
    const message = text(body.body, 8000);

    if (!subject) {
      return NextResponse.json({ error: "Give it a subject." }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Tell us what is happening." }, { status: 400 });
    }

    const categoryValue = text(body.category, 40) ?? "other";
    const category: SupportCategory = (SUPPORT_CATEGORIES as readonly string[]).includes(
      categoryValue,
    )
      ? (categoryValue as SupportCategory)
      : "other";

    const partnerActor = await currentPartnerActor();
    let partnerId: string | null = null;

    if (partnerActor) {
      const requested = text(body.partner_id, 40);
      const target =
        requested ??
        (partnerActor.memberships.length === 1
          ? partnerActor.memberships[0].partnerId
          : null);
      if (target) {
        // Checked rather than trusted: a partner member could otherwise file a
        // ticket against a company they do not belong to, and it would appear in
        // that company's console.
        membershipFor(partnerActor, target, "support.write");
        partnerId = target;
      }
    }

    const ticket = await openTicket(partnerActor?.db ?? serviceClient(), {
      partnerId,
      openedBy: user.id,
      openerEmail: user.email,
      openerName: (user.user_metadata?.full_name as string | undefined) ?? null,
      subject,
      category,
      body: message,
      authorKind: partnerId ? "partner" : "lender",
    });

    return NextResponse.json(
      { ok: true, reference: ticket.reference, id: ticket.id },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
