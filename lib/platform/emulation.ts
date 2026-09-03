import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { supabaseJwtSecret } from "@/lib/env";
import type { StaffRole } from "@/lib/platform/roles";
import { EMULATION_COOKIE, EMULATION_MINUTES } from "@/lib/platform/emulation-shared";

/**
 * Support emulation: rendering the product as one customer sees it.
 *
 * WHAT PROBLEM THIS SOLVES. "The button isn't there" is not a bug report, and
 * turning it into one over the phone costs both sides ten minutes. Opening the
 * same screen the customer is on answers it immediately.
 *
 * HOW IT WORKS, AND WHY THIS WAY. Every read on the lender's screens goes through
 * `userClient()`, which runs as `authenticated` with RLS applied — so the
 * database, not the application, decides what that person may see. To show a
 * customer's screen truthfully we therefore have to make those same queries run
 * as them. There are only two ways to do that:
 *
 *   1. Open a real session as the customer, using the admin key to mint one.
 *   2. Mint a short-lived token here, server-side, and use it for reads.
 *
 * (1) is what most products do and it is worse. It is a genuine sign-in: it
 * writes to the customer's auth record, appears in their sign-in history as
 * something they did not do, and invalidates any login link sitting in their
 * inbox — which is very often the exact thing the support call is about. It also
 * puts a live customer session cookie in a staff browser.
 *
 * So (2). The token below never leaves the server, expires in minutes, and the
 * customer's account is not touched in any way. It is the same bargain the
 * signing links make: a narrow, short-lived capability minted for one purpose.
 *
 * WHY IT CANNOT WRITE. Three independent reasons, none of which relies on
 * remembering to check:
 *
 *   1. Postgres. Constraint 2: no evidence table has any write policy, and the
 *      lender tables' draft-stage policies are not what the application uses. A
 *      token with `role: authenticated` cannot write the agreement graph at all.
 *   2. `requireActor()` in lib/agreements/access.ts throws while an emulation is
 *      live, so every lender route handler refuses before it reaches the service
 *      client — which is the only thing that CAN write.
 *   3. The middleware refuses any non-GET request while the cookie is present,
 *      so the refusal happens before a handler is even entered.
 *
 * Constraint 13, in other words: staff can look, they cannot rewrite history.
 * This module is the looking, and `staff_emulations` is the record of it.
 */

/**
 * Re-exported so callers have one import for the feature. The values themselves
 * live in emulation-shared.ts because the middleware needs them and cannot
 * import this module.
 *
 * On the window being short: long enough for a support call and too short to
 * become a way of working. An operator who leaves it running is looking at
 * somebody else's data with nobody on the phone, and the failure mode of a
 * generous timeout is that nobody notices.
 */
export { EMULATION_COOKIE, EMULATION_MINUTES };

export type Emulation = {
  id: string;
  staffUserId: string | null;
  staffEmail: string;
  staffRole: StaffRole;
  targetUserId: string;
  targetLabel: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
};

type Row = {
  id: string;
  staff_user_id: string | null;
  staff_email: string;
  staff_role: StaffRole;
  target_user_id: string | null;
  target_label: string;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
};

function toEmulation(row: Row): Emulation | null {
  // A row whose target profile was deleted mid-session is not an emulation of
  // anybody. Refuse rather than fall back to something.
  if (!row.target_user_id) return null;
  return {
    id: row.id,
    staffUserId: row.staff_user_id,
    staffEmail: row.staff_email,
    staffRole: row.staff_role,
    targetUserId: row.target_user_id,
    targetLabel: row.target_label,
    reason: row.reason,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
  };
}

/**
 * The live emulation for this request, or null.
 *
 * Deduplicated per request for the same reason `currentUser` is: this is asked
 * once by the client factory, once by the banner, and once by anything checking
 * whether to refuse a write.
 *
 * A lapsed session is closed here rather than merely ignored. Leaving `ended_at`
 * null on something the server has stopped honouring would make the audit log
 * disagree with what actually happened, and "still open" is the wrong answer to
 * give somebody reading it later.
 */
export const activeEmulation = cache(async (): Promise<Emulation | null> => {
  const store = await cookies();
  const id = store.get(EMULATION_COOKIE)?.value;
  if (!id) return null;

  const db = serviceClient();
  const { data } = await db
    .from("staff_emulations")
    .select(
      "id, staff_user_id, staff_email, staff_role, target_user_id, target_label, reason, started_at, expires_at, ended_at",
    )
    .eq("id", id)
    .maybeSingle<Row>();

  if (!data || data.ended_at) return null;

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await endEmulation(db, data.id, "expired");
    return null;
  }

  return toEmulation(data);
});

/** Starts a session and returns the row id to put in the cookie. */
export async function startEmulation(
  db: SupabaseClient,
  input: {
    staffUserId: string;
    staffEmail: string;
    staffRole: StaffRole;
    targetUserId: string;
    targetLabel: string;
    reason: string;
  },
): Promise<string> {
  const expiresAt = new Date(Date.now() + EMULATION_MINUTES * 60_000);

  const { data, error } = await db
    .from("staff_emulations")
    .insert({
      staff_user_id: input.staffUserId,
      staff_email: input.staffEmail,
      staff_role: input.staffRole,
      target_user_id: input.targetUserId,
      target_label: input.targetLabel,
      reason: input.reason.trim(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not start the session.");
  }
  return data.id;
}

/** Ends a session. Idempotent: the trigger refuses a second ending, so guard. */
export async function endEmulation(
  db: SupabaseClient,
  id: string,
  reason: "operator" | "expired",
): Promise<void> {
  await db
    .from("staff_emulations")
    .update({ ended_at: new Date().toISOString(), ended_reason: reason })
    .eq("id", id)
    .is("ended_at", null);
}

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

/**
 * Whether emulation is configured at all.
 *
 * Signing a token needs the project's JWT secret, which is the one credential
 * this feature cannot derive from anything already present. Without it the
 * feature reports itself unavailable and the button is not offered — rather than
 * appearing to work and failing on the first read, which is how somebody ends up
 * believing they are looking at a customer's screen when they are not.
 */
export function emulationConfigured(): boolean {
  try {
    supabaseJwtSecret();
    return true;
  } catch {
    return false;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A short-lived `authenticated` token for one user.
 *
 * Signed with the project's JWT secret, which is what PostgREST and the Supabase
 * auth server verify against — so RLS sees exactly the same `auth.uid()` the
 * customer's own session would produce, and every policy applies unchanged. That
 * is the point: the fidelity comes from not special-casing anything.
 *
 * Two minutes. The token is minted per request and used immediately; anything
 * longer is a credential lying around for no reason. Note what is NOT in it: no
 * elevated role, no claim any policy treats specially. It is indistinguishable
 * from the customer's own token except for `iwaiver_emulated`, which exists so
 * that a token found in a log can be identified for what it was.
 */
export function mintViewerToken(userId: string): string {
  const secret = supabaseJwtSecret();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    iss: "iwaiver-support-emulation",
    iat: now,
    exp: now + 120,
    iwaiver_emulated: true,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = base64url(
    createHmac("sha256", secret).update(signingInput).digest(),
  );

  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// Who may be looked at
// ---------------------------------------------------------------------------

export type EmulatableAccount = {
  originator_id: string;
  lender_kind: "individual" | "organization";
  lender_name: string;
  user_id: string;
  account_name: string;
  account_role: string;
  home_state: string | null;
};

/**
 * Every account a super admin may view the product as.
 *
 * Read from `platform_emulatable_accounts`, which already excludes staff — see
 * the view's comment for why that matters. The route checks it again, because a
 * list is presentation and this is authorisation.
 */
export async function emulatableAccounts(
  db: SupabaseClient,
): Promise<EmulatableAccount[]> {
  const { data } = await db
    .from("platform_emulatable_accounts")
    .select(
      "originator_id, lender_kind, lender_name, user_id, account_name, account_role, home_state",
    )
    .order("lender_name");
  return (data ?? []) as EmulatableAccount[];
}

/** Whether this user holds a live staff grant. Refused as an emulation target. */
export async function isStaffAccount(
  db: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await db
    .from("platform_staff")
    .select("id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  return Boolean(data);
}
