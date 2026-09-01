import { NextResponse } from "next/server";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import type { StaffRole } from "@/lib/platform/roles";

export const runtime = "nodejs";

const ROLES: StaffRole[] = [
  "super_admin",
  "admin",
  "support",
  "compliance",
  "read_only",
];

/**
 * POST /api/admin/staff — grant somebody staff access.
 *
 * DIFFERENT FROM A PARTNER INVITATION, and the difference is deliberate. A
 * partner invitation is an email address with no account behind it yet, because
 * we are inviting a stranger at another company. Staff access is granted to an
 * account that already exists: the person works here, they have signed in, and
 * requiring that first means an address typed with a slip in it fails now rather
 * than sitting in the table as a live grant waiting for whoever eventually
 * registers it.
 *
 * `staff.manage` is a super_admin capability, so this is the narrowest door in
 * the product after the live-key route.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff("staff.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const email = text(body.email, 320)?.toLowerCase() ?? null;
    if (!email || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "That is not an email address." }, { status: 400 });
    }

    const roleValue = text(body.role, 20) ?? "read_only";
    const role: StaffRole = ROLES.includes(roleValue as StaffRole)
      ? (roleValue as StaffRole)
      : "read_only";

    // `listUsers` rather than a `profiles` lookup by email: profiles does not
    // hold the address, auth.users does, and it is the confirmed one that matters.
    const { data: users, error: lookupError } = await staff.db.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });

    if (lookupError) throw lookupError;

    const user = users.users.find((u) => u.email?.toLowerCase() === email);

    if (!user) {
      return NextResponse.json(
        {
          error:
            "No account with that address yet. Ask them to sign in once, then grant it.",
        },
        { status: 404 },
      );
    }

    if (!user.email_confirmed_at) {
      return NextResponse.json(
        { error: "That address has not been confirmed yet." },
        { status: 409 },
      );
    }

    const { error } = await staff.db.from("platform_staff").insert({
      user_id: user.id,
      email,
      role,
      note: text(body.note, 500),
      created_by: staff.userId,
    });

    if (error) {
      // The partial unique index on an unrevoked grant.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "They already have access. Revoke it first to change the role." },
          { status: 409 },
        );
      }
      throw error;
    }

    await logStaffAction(staff, {
      action: "staff.granted",
      subjectType: "platform_staff",
      subjectId: user.id,
      detail: { email, role },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
