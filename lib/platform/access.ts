import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { currentUser } from "@/lib/supabase/server";
import { bootstrapAdminEmails } from "@/lib/env";
import {
  staffCan,
  type StaffCapability,
  type StaffRole,
} from "@/lib/platform/roles";

/**
 * Authorisation for the i-Waiver admin console.
 *
 * Same trade as lib/agreements/access.ts: the service client bypasses RLS, so
 * nothing in the database stops an admin route reading anything at all. Every
 * handler therefore calls `requireStaff` first, and the capability it names is
 * checked here rather than inferred at the call site.
 */

export class NotStaff extends Error {
  constructor(message = "Not found.") {
    super(message);
  }
}

export type Staff = {
  userId: string;
  email: string;
  role: StaffRole;
  /** True where the grant came from the env allowlist rather than a row. */
  bootstrap: boolean;
  db: SupabaseClient;
};

/**
 * The bootstrap allowlist.
 *
 * An empty staff table is a locked door with the key inside. IWAIVER_BOOTSTRAP_ADMINS
 * is the way in: an address listed there is treated as a super admin whether or
 * not a row exists, and the first time such a person opens the console a real row
 * is written so the grant becomes visible in the console like everyone else's.
 *
 * It is an environment variable specifically so that it is legible in a deploy
 * configuration and changing it is a deployment, not an UPDATE. Empty it once
 * real staff rows exist; the code does not need it after that, and leaving an
 * address in it means that address cannot be revoked from inside the product.
 *
 * The email must be CONFIRMED. Supabase sets `email_confirmed_at` for a magic
 * link, an OAuth sign-in and a confirmed password signup; without that check the
 * allowlist would be an invitation to sign up as someone else's address and wait.
 */
async function bootstrapGrant(
  db: SupabaseClient,
  userId: string,
  email: string,
): Promise<boolean> {
  if (!bootstrapAdminEmails().includes(email.toLowerCase())) return false;

  const { data: existing } = await db
    .from("platform_staff")
    .select("id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) return true;

  await db.from("platform_staff").insert({
    user_id: userId,
    email,
    role: "super_admin",
    note: "Created from IWAIVER_BOOTSTRAP_ADMINS on first sign-in.",
  });

  return true;
}

/**
 * The same question, asked about a user the caller has already resolved.
 *
 * Exists because `auth.getUser()` is a round trip and `currentUser()` does not
 * cache: a page or route that has already resolved the session and then calls
 * `currentStaff()` pays for it twice. `/api/profile` is fetched by the header on
 * every single page view, so that second call is the difference between one
 * network hop per page and two.
 *
 * Identical logic to `currentStaff`, which now delegates here — there is no
 * cheaper-but-slightly-different check to get out of step with the real one.
 */
export async function staffFor(user: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}): Promise<Staff | null> {
  if (!user.email) return null;

  // An unconfirmed address is a claim, not a fact, and staff access is the last
  // place to accept a claim.
  if (!user.email_confirmed_at) return null;

  const db = serviceClient();
  const email = user.email.toLowerCase();

  const { data } = await db
    .from("platform_staff")
    .select("role")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (data) {
    return {
      userId: user.id,
      email,
      role: data.role as StaffRole,
      bootstrap: false,
      db,
    };
  }

  if (await bootstrapGrant(db, user.id, email)) {
    return { userId: user.id, email, role: "super_admin", bootstrap: true, db };
  }

  return null;
}

/** The signed-in staff member, or null if this person does not work here. */
export async function currentStaff(): Promise<Staff | null> {
  const user = await currentUser();
  if (!user) return null;
  return staffFor(user);
}

/** Resolves the caller, or throws. Use at the top of every admin route. */
export async function requireStaff(capability: StaffCapability): Promise<Staff> {
  const staff = await currentStaff();
  // 404, not 403, for the same reason NotAuthorised is: whether an admin console
  // exists here is itself information.
  if (!staff) throw new NotStaff();
  if (!staffCan(staff.role, capability)) {
    throw new NotStaff("You do not have permission to do that.");
  }
  return staff;
}

/**
 * Write to the staff action log.
 *
 * Called after the thing succeeded, never before — a log that records intentions
 * is a log that disagrees with the database. It deliberately does not throw: an
 * approval that worked must not be reported as failed because the log write did,
 * and a missing log line is loud in the server logs.
 */
export async function logStaffAction(
  staff: Staff,
  entry: {
    action: string;
    subjectType:
      | "partner"
      | "partner_application"
      | "partner_integration"
      | "partner_branding"
      | "partner_prospect"
      | "carrier"
      | "carrier_product"
      | "carrier_filing"
      | "carrier_credential"
      | "support_ticket"
      | "platform_staff"
      | "state_availability"
      // Neither of these has a uuid, so `subjectId` stays null and the state code
      // or activity code goes in `detail`. `staff_actions.subject_id` is a uuid
      // column and putting 'FL' in it would fail the insert, which the logger
      // deliberately swallows — the row would simply never appear.
      | "activity_class";
    subjectId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await staff.db.from("staff_actions").insert({
    actor_id: staff.userId,
    actor_email: staff.email,
    actor_role: staff.role,
    action: entry.action,
    subject_type: entry.subjectType,
    subject_id: entry.subjectId ?? null,
    detail: entry.detail ?? {},
  });

  if (error) {
    console.error(
      `staff_actions insert failed for ${entry.action} on ${entry.subjectType}:`,
      error.message,
    );
  }
}
