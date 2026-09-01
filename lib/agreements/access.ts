import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { currentUser } from "@/lib/supabase/server";

/**
 * Authorisation for the lender-facing routes.
 *
 * The service client bypasses RLS, so nothing in the database will stop a route
 * handler reading someone else's agreement. Every handler therefore calls one of
 * these first. That is the trade constraint 2 makes: the server gets the only key,
 * and in exchange the server has to check the lock itself, every time.
 */

export class NotAuthorised extends Error {
  constructor(message = "Not found.") {
    super(message);
  }
}

export type Actor = {
  userId: string;
  originatorIds: string[];
  db: SupabaseClient;
};

/** Every originator the signed-in user can act as. */
export async function originatorIdsFor(
  db: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: own } = await db
    .from("originators")
    .select("id")
    .eq("user_id", userId);
  for (const row of own ?? []) ids.add(row.id);

  const { data: memberships } = await db
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .is("revoked_at", null);

  const orgIds = (memberships ?? []).map((m) => m.org_id);
  if (orgIds.length > 0) {
    const { data: orgOriginators } = await db
      .from("originators")
      .select("id")
      .in("org_id", orgIds);
    for (const row of orgOriginators ?? []) ids.add(row.id);
  }

  return [...ids];
}

/** Resolves the caller, or throws. Use at the top of every lender route. */
export async function requireActor(): Promise<Actor> {
  const user = await currentUser();
  if (!user) throw new NotAuthorised("You need to be signed in.");

  const db = serviceClient();
  return { userId: user.id, originatorIds: await originatorIdsFor(db, user.id), db };
}

/**
 * The individual originator for a P2P lender, created on first use.
 *
 * Lazily, because most people who make an account never send anything, and a row
 * that says "this person is a party that creates agreements" should mean it.
 */
export async function ensureIndividualOriginator(
  db: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: existing } = await db
    .from("originators")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await db
    .from("originators")
    .insert({ user_id: userId })
    .select("id")
    .single();

  if (error || !data) {
    // The partial unique index makes this a race, not a conflict: someone else's
    // request for the same user won. Read theirs.
    const { data: raced } = await db
      .from("originators")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (raced) return raced.id;
    throw new Error(`could not create originator: ${error?.message}`);
  }

  return data.id;
}

/**
 * Whether this originator is a person or a business.
 *
 * The third axis of template selection. Read rather than assumed, because the
 * agreement routes will not always be the individual-only path they are today, and
 * the failure mode of guessing is serving a private-loan release to a rental
 * customer — which is the whole reason the axis exists.
 */
export async function originatorKind(
  db: SupabaseClient,
  originatorId: string,
): Promise<"individual" | "organization"> {
  const { data } = await db
    .from("originators")
    .select("kind")
    .eq("id", originatorId)
    .maybeSingle();

  if (!data) throw new NotAuthorised();
  return data.kind === "organization" ? "organization" : "individual";
}

/** Loads an agreement only if this actor originated it. */
export async function agreementForActor(actor: Actor, agreementId: string) {
  if (actor.originatorIds.length === 0) throw new NotAuthorised();

  const { data } = await actor.db
    .from("agreements")
    .select("*")
    .eq("id", agreementId)
    .in("originator_id", actor.originatorIds)
    .maybeSingle();

  if (!data) throw new NotAuthorised();
  return data;
}
