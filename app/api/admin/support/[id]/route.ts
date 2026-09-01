import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { setStatus, type SupportStatus } from "@/lib/support/tickets";

export const runtime = "nodejs";

const STATUSES: SupportStatus[] = [
  "open",
  "pending_customer",
  "pending_us",
  "resolved",
  "closed",
];

const PRIORITIES = ["low", "normal", "high", "urgent"];

/**
 * PATCH /api/admin/support/[id] — triage. Status, priority, assignment.
 *
 * Assignment is to the caller or to nobody. Handing a ticket to a named colleague
 * needs a picker of staff members, and until that exists an "assign to me" that
 * works is more useful than a field that takes a uuid nobody can look up.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("support.triage");
    const body = await readJson<Record<string, unknown>>(request);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const status = text(body.status, 30);
    if (status) {
      if (!STATUSES.includes(status as SupportStatus)) {
        return NextResponse.json({ error: "Unknown status." }, { status: 400 });
      }
      // Through setStatus so the resolved_at rule lives in one place.
      await setStatus(staff.db, id, status as SupportStatus);
    }

    const priority = text(body.priority, 20);
    if (priority) {
      if (!PRIORITIES.includes(priority)) {
        return NextResponse.json({ error: "Unknown priority." }, { status: 400 });
      }
      patch.priority = priority;
    }

    if (body.assign_to_me === true) patch.assigned_to = staff.userId;
    if (body.unassign === true) patch.assigned_to = null;

    if (Object.keys(patch).length > 1) {
      await staff.db.from("support_tickets").update(patch).eq("id", id);
    }

    await logStaffAction(staff, {
      action: "support.triaged",
      subjectType: "support_ticket",
      subjectId: id,
      detail: { status, priority, assigned: body.assign_to_me === true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
