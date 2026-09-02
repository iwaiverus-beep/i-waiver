import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import {
  ConfigRefused,
  setClauseReview,
  updateState,
} from "@/lib/platform/config";
import { isStateCode } from "@/lib/jurisdictions";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/states/[state] — the two judgements about a state that a
 * person actually makes.
 *
 * NOT whether the state is open. That is `carrier_admitted`, a cache maintained
 * by a trigger from the filings (20260901000018) — a value written here would be
 * overwritten by the next filing change and would meanwhile disagree with what
 * `lib/coverage/` reads to decide whether a quote may be given. Opening a state
 * happens on the carrier screen, by recording the filing that actually opened it.
 *
 * What is here is the clause-set review and the enforceability reading. Both are
 * legal judgements, which is why the capability is `compliance.states` and why
 * `admin` does not have it: an operator under pressure to open a state must not
 * be able to assert that counsel has reviewed it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ state: string }> },
) {
  try {
    const { state } = await params;
    const staff = await requireStaff("compliance.states");

    if (!isStateCode(state)) {
      return NextResponse.json({ error: "Not a jurisdiction." }, { status: 400 });
    }

    const body = await readJson<Record<string, unknown>>(request);

    // The review flag is its own call rather than a field among others. Flipping
    // a state out of specimen is the single most consequential thing on this
    // screen — it is what stops every document in that state carrying the banner
    // saying it is not for use with a real signer — and it deserves its own row
    // in the action log rather than being one key in a bag of edits.
    if (typeof body.clause_set_reviewed === "boolean") {
      const row = await setClauseReview(staff.db, state, body.clause_set_reviewed);

      await logStaffAction(staff, {
        action: body.clause_set_reviewed
          ? "state.clause_set.reviewed"
          : "state.clause_set.review_withdrawn",
        subjectType: "state_availability",
        detail: {
          state,
          reviewed_at: row.clause_set_reviewed_at,
          resulting_status: row.status,
          reason: text(body.reason, 500),
        },
      });

      return NextResponse.json({ ok: true, state: row });
    }

    const waiverEfficacy = text(body.waiver_efficacy, 20);
    const notes = body.notes === null ? null : text(body.notes, 2000);

    const row = await updateState(staff.db, state, {
      waiverEfficacy: waiverEfficacy ?? undefined,
      notes: body.notes === undefined ? undefined : notes,
    });

    await logStaffAction(staff, {
      action: "state.updated",
      subjectType: "state_availability",
      detail: {
        state,
        waiver_efficacy: row.waiver_efficacy,
        resulting_status: row.status,
      },
    });

    return NextResponse.json({ ok: true, state: row });
  } catch (error) {
    if (error instanceof ConfigRefused) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return jsonError(error);
  }
}
