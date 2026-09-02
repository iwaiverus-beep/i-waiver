import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { ConfigRefused, updateActivity } from "@/lib/platform/config";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/activities/[code] — rename, reorder, retire, bring back.
 *
 * The code itself is not editable. It is referenced by carrier products, rule
 * sets, template versions and intake links, and — the part that makes it
 * permanent rather than merely awkward — by `agreements.activity_class`, which is
 * a snapshot with no foreign key. Renaming it would leave every agreement ever
 * written under the old value pointing at a word that no longer means anything,
 * and those are the records somebody reads two years later in a dispute.
 *
 * Retiring is soft and reversible. It stops the activity being OFFERED; every
 * agreement, rule set and template already written against it still resolves.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const staff = await requireStaff("compliance.states");
    const body = await readJson<Record<string, unknown>>(request);

    const sortOrder = Number(body.sort_order);

    const activity = await updateActivity(staff.db, code, {
      label: text(body.label, 120) ?? undefined,
      description:
        body.description === undefined
          ? undefined
          : (text(body.description, 1000) ?? null),
      sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : undefined,
      retired: typeof body.retired === "boolean" ? body.retired : undefined,
    });

    await logStaffAction(staff, {
      action: activity.retired_at
        ? "activity_class.retired"
        : "activity_class.updated",
      subjectType: "activity_class",
      detail: {
        code: activity.code,
        label: activity.label,
        retired_at: activity.retired_at,
      },
    });

    return NextResponse.json({ ok: true, activity });
  } catch (error) {
    if (error instanceof ConfigRefused) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return jsonError(error);
  }
}
