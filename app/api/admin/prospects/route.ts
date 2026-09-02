import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { createProspect } from "@/lib/partners/prospects";

export const runtime = "nodejs";

/**
 * POST /api/admin/prospects — put a company on the target list.
 *
 * `partners.manage` rather than a capability of its own: this is the front of the
 * same pipeline the rest of that capability covers, and a role that can run a
 * partner's onboarding can certainly write down who we would like to call.
 *
 * Always created as `identified`. See createProspect.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff("partners.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const name = text(body.name, 160);
    if (!name) {
      return NextResponse.json({ error: "What are they called?" }, { status: 400 });
    }

    const prospect = await createProspect(staff.db, {
      name,
      website: text(body.website, 500),
      kind: text(body.kind, 40),
      contactName: text(body.contact_name, 120),
      contactEmail: text(body.contact_email, 320)?.toLowerCase() ?? null,
      notes: text(body.notes, 2000),
      createdBy: staff.userId,
    });

    await logStaffAction(staff, {
      action: "prospect.created",
      subjectType: "partner_prospect",
      subjectId: prospect.id,
      detail: { name: prospect.name, kind: prospect.kind },
    });

    return NextResponse.json({ ok: true, prospect }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
