import { NextResponse } from "next/server";

import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { ignoreInbound, ticketFromInbound } from "@/lib/support/inbound";
import { SUPPORT_CATEGORIES, type SupportCategory } from "@/lib/support/labels";

export const runtime = "nodejs";

/**
 * POST /api/admin/support/inbox/[id] — triage one arriving message.
 *
 * Two actions, and no third. Either this was somebody who needs an answer, in
 * which case it becomes a ticket and they get the reference back by email, or it
 * was not, in which case it is marked as read and stays where it is. There is no
 * delete: see the note at the foot of migration 46.
 *
 * `support.triage` rather than `support.respond`, which is the same capability
 * the ticket queue's own triage sits behind. Opening a ticket sends mail to the
 * outside world in our name and starts a first-response clock, and reading the
 * mailbox — which every console role that can see support already can — is a
 * different act from acting on it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("support.triage");
    const body = await readJson<Record<string, unknown>>(request);

    const action = text(body.action, 20);

    if (action === "ignore") {
      await ignoreInbound(staff.db, { id, staffId: staff.userId });

      await logStaffAction(staff, {
        action: "support.inbound_ignored",
        subjectType: "support_inbound_email",
        subjectId: id,
        detail: {},
      });

      return NextResponse.json({ ok: true, status: "ignored" });
    }

    if (action === "ticket") {
      const requested = text(body.category, 40);
      const category: SupportCategory = (SUPPORT_CATEGORIES as readonly string[]).includes(
        requested ?? "",
      )
        ? (requested as SupportCategory)
        : "other";

      const { ticketId, reference } = await ticketFromInbound(staff.db, {
        id,
        staffId: staff.userId,
        category,
      });

      await logStaffAction(staff, {
        action: "support.inbound_ticketed",
        subjectType: "support_inbound_email",
        subjectId: id,
        detail: { ticket_id: ticketId, reference, category },
      });

      return NextResponse.json({ ok: true, status: "ticketed", reference, id: ticketId });
    }

    return NextResponse.json(
      { error: "Say whether to open a ticket or to ignore it." },
      { status: 400 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
