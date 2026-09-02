import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { ConfigRefused, createActivity } from "@/lib/platform/config";

export const runtime = "nodejs";

/**
 * POST /api/admin/activities — add a kind of thing people do.
 *
 * Adding one is cheap and opens nothing. An activity with no rule set, no
 * template and no carrier filing appears on no lender's screen — the readiness
 * matrix simply gains a column of empty cells, which is the honest picture of a
 * thing we intend to support and have not yet.
 *
 * `compliance.states` rather than a capability of its own. Deciding that
 * "boating" is a category the product recognises is the same act as deciding a
 * state is open: it is the frame that rule sets, filings and wording are written
 * against, and the person who holds that frame is the one who reads statutes.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff("compliance.states");
    const body = await readJson<Record<string, unknown>>(request);

    const code = text(body.code, 60)?.toLowerCase();
    const label = text(body.label, 120);

    if (!code) {
      return NextResponse.json(
        { error: "Give it a code. It is permanent." },
        { status: 400 },
      );
    }
    if (!label) {
      return NextResponse.json(
        { error: "What does a lender call this?" },
        { status: 400 },
      );
    }

    const sortOrder = Number(body.sort_order);

    const activity = await createActivity(staff.db, {
      code,
      label,
      description: text(body.description, 1000),
      sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : 100,
    });

    await logStaffAction(staff, {
      action: "activity_class.created",
      subjectType: "activity_class",
      detail: { code: activity.code, label: activity.label },
    });

    return NextResponse.json({ ok: true, activity }, { status: 201 });
  } catch (error) {
    if (error instanceof ConfigRefused) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return jsonError(error);
  }
}
