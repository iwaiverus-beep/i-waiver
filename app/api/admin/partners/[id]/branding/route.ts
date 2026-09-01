import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { completeStep } from "@/lib/partners/onboarding";

export const runtime = "nodejs";

/**
 * POST /api/admin/partners/[id]/branding — approve or reject submitted branding.
 *
 * Somebody looks at the logo before it goes out on a surface that makes an
 * insurance offer in our name. That is the whole of it — see the note in
 * migration 20260901000015 for why this is not a rubber stamp.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: partnerId } = await params;
    const staff = await requireStaff("branding.review");
    const body = await readJson<Record<string, unknown>>(request);
    const approve = body.approve === true;
    const note = text(body.note, 1000);

    if (!approve && !note) {
      return NextResponse.json(
        { error: "Say what needs changing — the partner sees this." },
        { status: 400 },
      );
    }

    const { error } = await staff.db
      .from("partner_branding")
      .update({
        approved_at: approve ? new Date().toISOString() : null,
        approved_by: approve ? staff.userId : null,
        review_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq("partner_id", partnerId);

    if (error) throw error;

    if (approve) {
      await completeStep(staff.db, {
        partnerId,
        step: "branding_approved",
        completedBy: staff.userId,
      });
    } else {
      // Rejecting takes the tick back off, or the checklist would claim a partner
      // has approved branding while the widget renders the previous version.
      await staff.db
        .from("partner_onboarding")
        .delete()
        .eq("partner_id", partnerId)
        .eq("step", "branding_approved");
    }

    await logStaffAction(staff, {
      action: approve ? "partner.branding.approved" : "partner.branding.rejected",
      subjectType: "partner_branding",
      subjectId: partnerId,
      detail: { note },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
