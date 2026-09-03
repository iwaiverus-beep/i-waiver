import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { realUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import {
  EMULATION_COOKIE,
  EMULATION_MINUTES,
  emulationConfigured,
  endEmulation,
  isStaffAccount,
  startEmulation,
} from "@/lib/platform/emulation";

export const runtime = "nodejs";

/**
 * Starting and ending a support emulation.
 *
 * Two verbs on one path, because getting in and getting out are the same
 * question asked in two directions and splitting them invites the exit to be
 * forgotten. The path is also named in lib/platform/emulation-shared.ts as the
 * single exception to the middleware's write block: the way out cannot require
 * the thing being blocked.
 */

/**
 * POST — begin viewing the product as a customer.
 *
 * `users.emulate`, which only a super admin holds. Read the capability's comment
 * in lib/platform/roles.ts for why it is not on `support`, whose job this is.
 *
 * A reason is required. Not paperwork: it is the only field in
 * `staff_emulations` that says WHY somebody went into a customer's account, and
 * it is the first thing anybody reviewing the log will want. Requiring it at the
 * moment of the act is the only time it can be answered honestly.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff("users.emulate");

    // Checked before anything is written, so a missing secret cannot leave a
    // started session that no page can honour.
    if (!emulationConfigured()) {
      return NextResponse.json(
        {
          error:
            "Emulation is not configured on this deployment. SUPABASE_JWT_SECRET is missing.",
        },
        { status: 503 },
      );
    }

    const body = await readJson<Record<string, unknown>>(request);
    const targetUserId = text(body.userId, 64);
    const reason = text(body.reason, 400);

    if (!targetUserId) {
      return NextResponse.json({ error: "Pick an account." }, { status: 400 });
    }
    if (!reason || reason.trim().length < 3) {
      return NextResponse.json(
        { error: "Say why you are opening this account." },
        { status: 400 },
      );
    }

    // The account must be one the console actually offers. Reading the view back
    // rather than trusting the id closes the obvious hole — a posted uuid is not
    // evidence that the console listed it — and gives us the label to record.
    const { data: account } = await staff.db
      .from("platform_emulatable_accounts")
      .select("user_id, account_name, lender_name, lender_kind")
      .eq("user_id", targetUserId)
      .limit(1)
      .maybeSingle<{
        user_id: string;
        account_name: string;
        lender_name: string;
        lender_kind: string;
      }>();

    if (!account) {
      return NextResponse.json(
        { error: "That is not an account you can view." },
        { status: 404 },
      );
    }

    // The view excludes staff already. Asked again here because that was a list
    // and this is authorisation — and because emulating a colleague would turn
    // "look at a customer's screen" into a way to inherit console access while
    // the audit row named the wrong person as the one who looked.
    if (await isStaffAccount(staff.db, targetUserId)) {
      return NextResponse.json(
        { error: "Staff accounts cannot be emulated." },
        { status: 403 },
      );
    }

    // Refusing to emulate yourself is not pedantry: it would produce a session
    // the middleware then blocks every write from, which reads as the product
    // being broken rather than as a mistake.
    if (targetUserId === staff.userId) {
      return NextResponse.json(
        { error: "That is your own account." },
        { status: 400 },
      );
    }

    const label =
      account.lender_kind === "organization"
        ? `${account.account_name} at ${account.lender_name}`
        : account.account_name;

    const id = await startEmulation(staff.db, {
      staffUserId: staff.userId,
      staffEmail: staff.email,
      staffRole: staff.role,
      targetUserId,
      targetLabel: label,
      reason,
    });

    const store = await cookies();
    store.set(EMULATION_COOKIE, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Matched to the row's lifetime so the browser drops it as the session
      // lapses — which is what lets the middleware's write block work off cookie
      // presence without a database read. See emulation-shared.ts.
      maxAge: EMULATION_MINUTES * 60,
    });

    await logStaffAction(staff, {
      action: "emulation.start",
      subjectType: "emulation",
      subjectId: targetUserId,
      detail: { label, reason: reason.trim(), minutes: EMULATION_MINUTES },
    });

    return NextResponse.json({ ok: true, label, minutes: EMULATION_MINUTES });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * DELETE — stop, and go back to being yourself.
 *
 * Deliberately does NOT use `requireStaff`. During an emulation `currentStaff()`
 * resolves to the customer, who is not staff, so asking that question here would
 * make the exit impossible — the door would lock from the inside. What is checked
 * instead is stronger: the real session behind the browser must be the same
 * person the session was opened by.
 *
 * The cookie is cleared whatever happens. A cookie the server will not honour
 * still trips the middleware's write block, so leaving one behind would strand
 * the operator in a product that silently refuses everything.
 */
export async function DELETE() {
  const store = await cookies();
  const id = store.get(EMULATION_COOKIE)?.value;

  store.delete(EMULATION_COOKIE);

  if (!id) return NextResponse.json({ ok: true });

  const db = serviceClient();
  const { data: row } = await db
    .from("staff_emulations")
    .select("id, staff_user_id, target_user_id, target_label, ended_at")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      staff_user_id: string | null;
      target_user_id: string | null;
      target_label: string;
      ended_at: string | null;
    }>();

  if (!row || row.ended_at) return NextResponse.json({ ok: true });

  const real = await realUser();
  if (!real || real.id !== row.staff_user_id) {
    // Somebody else's browser holding the id. The cookie is already gone, and
    // the session is left for its owner or the clock to close.
    return NextResponse.json({ ok: true });
  }

  await endEmulation(db, row.id, "operator");

  // Logged from the emulation row rather than from `currentStaff()`, which is
  // the customer at this point. `staffFor` would have to be re-resolved against
  // the real user and the row already holds everything the log needs.
  const { data: grant } = await db
    .from("platform_staff")
    .select("role, email")
    .eq("user_id", real.id)
    .is("revoked_at", null)
    .maybeSingle<{ role: string; email: string }>();

  if (grant) {
    await db.from("staff_actions").insert({
      actor_id: real.id,
      actor_email: grant.email,
      actor_role: grant.role,
      action: "emulation.end",
      subject_type: "emulation",
      subject_id: row.target_user_id,
      detail: { label: row.target_label },
    });
  }

  return NextResponse.json({ ok: true });
}
