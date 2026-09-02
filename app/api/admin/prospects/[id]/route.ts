import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { deleteProspect, updateProspect } from "@/lib/partners/prospects";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/prospects/[id] — move it along, or record what was said.
 *
 * Every field is optional and only the ones present are written, so the console
 * can have one small control per decision rather than a form that silently
 * rewrites everything each time somebody edits a phone number.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const staff = await requireStaff("partners.manage");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(request);

    const patch: Parameters<typeof updateProspect>[2] = {};
    if ("status" in body) patch.status = text(body.status, 40);
    if ("website" in body) patch.website = text(body.website, 500);
    if ("kind" in body) patch.kind = text(body.kind, 40);
    if ("contact_name" in body) patch.contactName = text(body.contact_name, 120);
    if ("contact_email" in body) {
      patch.contactEmail = text(body.contact_email, 320)?.toLowerCase() ?? null;
    }
    if ("contact_phone" in body) patch.contactPhone = text(body.contact_phone, 40);
    if ("notes" in body) patch.notes = text(body.notes, 2000);
    if ("lost_reason" in body) patch.lostReason = text(body.lost_reason, 500);
    if ("partner_id" in body) patch.partnerId = text(body.partner_id, 40);
    if ("owner_staff_id" in body) patch.ownerStaffId = text(body.owner_staff_id, 40);

    const prospect = await updateProspect(staff.db, id, patch);

    await logStaffAction(staff, {
      action: "prospect.updated",
      subjectType: "partner_prospect",
      subjectId: prospect.id,
      // The whole patch, not just the status. Six months on, "who changed their
      // contact to this address" is exactly the question asked of a log.
      detail: { name: prospect.name, ...patch },
    });

    return NextResponse.json({ ok: true, prospect });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * DELETE /api/admin/prospects/[id] — take a name off the list.
 *
 * Refused once they have applied or become a partner; the library explains why.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const staff = await requireStaff("partners.manage");
    const { id } = await params;

    const removed = await deleteProspect(staff.db, id);

    await logStaffAction(staff, {
      action: "prospect.deleted",
      subjectType: "partner_prospect",
      subjectId: removed.id,
      detail: { name: removed.name, website: removed.website },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
