import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, NotStaff, requireStaff } from "@/lib/platform/access";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/partners/[id] — the operational levers on one partner.
 *
 * Only two things, both of which are reversible and neither of which touches a
 * credential: switching a partner off, and switching them back on. Issuing keys
 * is its own route, because it is the irreversible one.
 *
 * `disabled_at` is a bigger hammer than revoking a key. lib/coverage/auth.ts
 * refuses EVERY key belonging to a disabled partner, and lib/partners/access.ts
 * closes their console. It is the answer to "stop everything now", and the
 * before/after goes into the staff log because it will be asked about.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("partners.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const { data: partner } = await staff.db
      .from("partners")
      .select("id, name, disabled_at")
      .eq("id", id)
      .maybeSingle();

    if (!partner) throw new NotStaff("No such partner.");

    if (typeof body.disabled !== "boolean") {
      return NextResponse.json(
        { error: "Say whether the partner should be disabled." },
        { status: 400 },
      );
    }

    const reason = text(body.reason, 500);
    if (body.disabled && !reason) {
      // Turning someone's integration off in the middle of their trading day is
      // the sort of thing that needs a sentence attached to it, written at the
      // time rather than reconstructed afterwards.
      return NextResponse.json(
        { error: "Say why. It goes in the log." },
        { status: 400 },
      );
    }

    await staff.db
      .from("partners")
      .update({ disabled_at: body.disabled ? new Date().toISOString() : null })
      .eq("id", id);

    await logStaffAction(staff, {
      action: body.disabled ? "partner.disabled" : "partner.enabled",
      subjectType: "partner",
      subjectId: id,
      detail: { name: partner.name, was: partner.disabled_at, reason },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
