import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { currentPartnerActor } from "@/lib/partners/access";
import { currentStaff } from "@/lib/platform/access";
import { logStaffAction } from "@/lib/platform/access";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { addMessage, TicketRefused } from "@/lib/support/tickets";
import { staffCan } from "@/lib/platform/roles";

export const runtime = "nodejs";

/**
 * POST /api/support/tickets/[id]/messages — reply on a thread.
 *
 * Three kinds of author reach this handler and the checks differ:
 *
 *   * staff with `support.respond` may reply on anything, and are the only ones
 *     who may leave an `internal` note (the database enforces that too);
 *   * a partner member may reply on their own company's tickets;
 *   * the person who opened a ticket may reply on it.
 *
 * Anything else gets a 404, not a 403, because whether a given ticket reference
 * exists is itself something worth not confirming.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }

    const body = await readJson<Record<string, unknown>>(request);
    const message = text(body.body, 8000);
    if (!message) {
      return NextResponse.json({ error: "The reply is empty." }, { status: 400 });
    }

    const db = serviceClient();
    const { data: ticket } = await db
      .from("support_tickets")
      .select("id, partner_id, opened_by, status")
      .eq("id", id)
      .maybeSingle();

    if (!ticket) throw new TicketRefused("No such ticket.", 404);

    const staff = await currentStaff();
    const wantsInternal = body.internal === true;

    if (staff && staffCan(staff.role, "support.respond")) {
      await addMessage(db, {
        ticketId: id,
        authorId: staff.userId,
        authorEmail: staff.email,
        authorKind: "staff",
        body: message,
        internal: wantsInternal,
      });

      await logStaffAction(staff, {
        action: wantsInternal ? "support.note" : "support.reply",
        subjectType: "support_ticket",
        subjectId: id,
      });

      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (wantsInternal) {
      // Not an error worth explaining. Someone who is not staff has no reason to
      // know internal notes exist.
      throw new TicketRefused("No such ticket.", 404);
    }

    const partnerActor = await currentPartnerActor();
    const belongsToTheirPartner =
      ticket.partner_id !== null &&
      (partnerActor?.memberships.some((m) => m.partnerId === ticket.partner_id) ?? false);

    if (!belongsToTheirPartner && ticket.opened_by !== user.id) {
      throw new TicketRefused("No such ticket.", 404);
    }

    await addMessage(db, {
      ticketId: id,
      authorId: user.id,
      authorEmail: user.email,
      authorKind: ticket.partner_id ? "partner" : "lender",
      body: message,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
