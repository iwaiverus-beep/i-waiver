import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { ONBOARDING_STEPS, completeStep } from "@/lib/partners/onboarding";
import { staffCan } from "@/lib/platform/roles";

export const runtime = "nodejs";

/**
 * POST /api/admin/partners/[id]/onboarding — tick or untick a step.
 *
 * Only the `attested` steps. An `observed` step is a record that something
 * actually happened — a key was issued, a sandbox quote returned 200 — and being
 * able to tick one by hand would make the whole checklist worthless, because the
 * live-key gate reads it. The refusal names the reason rather than hiding the
 * button, so nobody spends an afternoon wondering why the click did nothing.
 *
 * `compliance_review` is further narrowed to the compliance capability. It is the
 * one step that is a legal judgement rather than an operational one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: partnerId } = await params;
    const staff = await requireStaff("partners.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const key = text(body.step, 60);
    const step = ONBOARDING_STEPS.find((s) => s.key === key);

    if (!step) {
      return NextResponse.json({ error: "Unknown step." }, { status: 400 });
    }

    if (step.kind === "observed") {
      return NextResponse.json(
        {
          error: `"${step.title}" records something happening. It cannot be ticked by hand.`,
        },
        { status: 409 },
      );
    }

    if (step.key === "compliance_review" && !staffCan(staff.role, "compliance.states")) {
      return NextResponse.json(
        { error: "Compliance sign-off has to come from the compliance role." },
        { status: 403 },
      );
    }

    const undo = body.undo === true;

    if (undo) {
      await staff.db
        .from("partner_onboarding")
        .delete()
        .eq("partner_id", partnerId)
        .eq("step", step.key);
    } else {
      await completeStep(staff.db, {
        partnerId,
        step: step.key,
        completedBy: staff.userId,
        note: text(body.note, 1000),
      });
    }

    await logStaffAction(staff, {
      action: undo ? "partner.onboarding.undone" : "partner.onboarding.completed",
      subjectType: "partner",
      subjectId: partnerId,
      detail: { step: step.key, note: text(body.note, 1000) },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
