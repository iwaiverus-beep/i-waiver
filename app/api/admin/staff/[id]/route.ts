import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { logStaffAction, NotStaff, requireStaff } from "@/lib/platform/access";

export const runtime = "nodejs";

/**
 * DELETE /api/admin/staff/[id] — end somebody's staff access.
 *
 * Revoked, not deleted: the record of who had which role and when is exactly the
 * thing an auditor asks for, and it does not survive a DELETE.
 *
 * Two refusals, both about not locking the building:
 *   * you cannot revoke yourself — an accidental click should not require another
 *     super admin to undo, and there may not be one;
 *   * you cannot revoke the last super admin, because the only way back in after
 *     that is redeploying with IWAIVER_BOOTSTRAP_ADMINS set.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("staff.manage");

    const { data: grant } = await staff.db
      .from("platform_staff")
      .select("id, user_id, email, role")
      .eq("id", id)
      .is("revoked_at", null)
      .maybeSingle();

    if (!grant) throw new NotStaff("No such grant.");

    if (grant.user_id === staff.userId) {
      return NextResponse.json(
        { error: "You cannot revoke your own access. Ask another super admin." },
        { status: 409 },
      );
    }

    if (grant.role === "super_admin") {
      const { count } = await staff.db
        .from("platform_staff")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin")
        .is("revoked_at", null);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "That is the last super admin. Promote somebody else first." },
          { status: 409 },
        );
      }
    }

    await staff.db
      .from("platform_staff")
      .update({ revoked_at: new Date().toISOString(), revoked_by: staff.userId })
      .eq("id", id);

    await logStaffAction(staff, {
      action: "staff.revoked",
      subjectType: "platform_staff",
      subjectId: grant.user_id,
      detail: { email: grant.email, role: grant.role },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
