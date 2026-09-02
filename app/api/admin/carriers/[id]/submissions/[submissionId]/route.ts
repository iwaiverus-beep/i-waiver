import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { acceptSubmission, rejectSubmission } from "@/lib/coverage/onboarding";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/carriers/[id]/submissions/[submissionId]
 *
 * The moment a claim becomes a record. Everything a carrier typed sat in
 * `carrier_submissions` until somebody with `carriers.manage` read it and said
 * yes here — which is the whole reason the staging table exists.
 *
 * Accepting copies the identity and contact fields across and stops there. The
 * states a carrier listed are NOT turned into filings: a filing is an assertion
 * about a regulator's decision and the only input to whether a live quote may be
 * given in a state, which is why `carriers.filings` sits on compliance and not on
 * admin. Accepting a form would otherwise be a way for an operator — or for the
 * carrier themselves — to open a state without compliance ever seeing it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; submissionId: string }> },
) {
  try {
    const { id, submissionId } = await params;
    const staff = await requireStaff("carriers.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const decision = text(body.decision, 10);
    if (decision !== "accept" && decision !== "reject") {
      return NextResponse.json(
        { error: "Accept it or reject it." },
        { status: 400 },
      );
    }

    const note = text(body.note, 1000);

    if (decision === "reject" && !note) {
      return NextResponse.json(
        { error: "Say why. It is the only record of what was wrong with it." },
        { status: 400 },
      );
    }

    if (decision === "accept") {
      const { applied } = await acceptSubmission(staff.db, {
        submissionId,
        reviewerId: staff.userId,
        note,
      });

      await logStaffAction(staff, {
        action: "carrier.submission_accepted",
        subjectType: "carrier",
        subjectId: id,
        detail: { submission_id: submissionId, applied, note },
      });

      return NextResponse.json({ ok: true, applied });
    }

    await rejectSubmission(staff.db, {
      submissionId,
      reviewerId: staff.userId,
      note,
    });

    await logStaffAction(staff, {
      action: "carrier.submission_rejected",
      subjectType: "carrier",
      subjectId: id,
      detail: { submission_id: submissionId, note },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
