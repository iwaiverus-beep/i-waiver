import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { currentUser } from "@/lib/supabase/server";
import {
  partnerCan,
  type PartnerCapability,
  type PartnerRole,
} from "@/lib/partners/roles";

/**
 * Authorisation for the partner console.
 *
 * Third instance of the same pattern (see lib/agreements/access.ts and
 * lib/platform/access.ts): the service client bypasses RLS, so the route handler
 * checks the lock itself, every time.
 *
 * The rule this file exists to enforce is narrower than it looks. A partner
 * member is authorised for THEIR partner and for nothing else — not for another
 * partner, and not for anything in the agreement graph. There is no function here
 * that returns an agreement, a signer or a document, and there should never be
 * one. If a partner needs to know something about coverage they sold, they ask
 * the coverage API with their key, like any other caller.
 */

export class NotPartner extends Error {
  constructor(message = "Not found.") {
    super(message);
  }
}

export type Membership = {
  memberId: string;
  partnerId: string;
  partnerName: string;
  partnerSlug: string;
  partnerKind: string;
  disabled: boolean;
  role: PartnerRole;
};

export type PartnerActor = {
  userId: string;
  email: string;
  memberships: Membership[];
  db: SupabaseClient;
};

/**
 * Claim any invitation addressed to this person.
 *
 * The invitation is the email address. Somebody at the partner (or a member of
 * our staff, when approving the application) writes a row with an email and no
 * user_id; the first time that person signs in, this binds it to their account.
 * There is no token in an email to intercept, expire, or forward to the wrong
 * colleague.
 *
 * The whole safety of that rests on ONE check: `email_confirmed_at`. Supabase
 * sets it for a magic link, an OAuth sign-in and a confirmed password signup.
 * Without it, anyone could sign up claiming a colleague's address and inherit
 * their access, so an unconfirmed account claims nothing and is not told why.
 */
async function claimInvitations(
  db: SupabaseClient,
  userId: string,
  email: string,
): Promise<void> {
  const { data: pending } = await db
    .from("partner_members")
    .select("id")
    .is("user_id", null)
    .is("revoked_at", null)
    .ilike("email", email);

  if (!pending?.length) return;

  for (const row of pending) {
    // One at a time, and tolerant of failure: the partial unique index on
    // (partner_id, user_id) makes a double-claim a no-op rather than an error
    // worth surfacing to someone who was only trying to open a page.
    const { error } = await db
      .from("partner_members")
      .update({ user_id: userId, accepted_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("user_id", null);

    if (error) {
      console.error(`partner invitation claim failed for ${row.id}:`, error.message);
    }
  }
}

/** Everything this person may act as, or null if they are not a partner at all. */
export async function currentPartnerActor(): Promise<PartnerActor | null> {
  const user = await currentUser();
  if (!user?.email) return null;

  const db = serviceClient();
  const email = user.email.toLowerCase();

  if (user.email_confirmed_at) {
    await claimInvitations(db, user.id, email);
  }

  const { data } = await db
    .from("partner_members")
    .select(
      "id, role, partner_id, partners(id, name, slug, kind, disabled_at)",
    )
    .eq("user_id", user.id)
    .is("revoked_at", null);

  const memberships: Membership[] = (data ?? []).flatMap((row) => {
    const partner = (Array.isArray(row.partners) ? row.partners[0] : row.partners) as
      | { id: string; name: string; slug: string; kind: string; disabled_at: string | null }
      | null;
    if (!partner) return [];
    return [
      {
        memberId: row.id,
        partnerId: partner.id,
        partnerName: partner.name,
        partnerSlug: partner.slug,
        partnerKind: partner.kind,
        disabled: partner.disabled_at !== null,
        role: row.role as PartnerRole,
      },
    ];
  });

  if (memberships.length === 0) return null;

  return { userId: user.id, email, memberships, db };
}

export async function requirePartnerActor(): Promise<PartnerActor> {
  const actor = await currentPartnerActor();
  if (!actor) throw new NotPartner();
  return actor;
}

/**
 * The membership for one partner, checked for a capability.
 *
 * A disabled partner is refused here rather than in each handler. Switching a
 * partner off has to mean the console stops working, not just that their keys do,
 * or the two facts drift and somebody keeps configuring an integration that will
 * never authenticate.
 */
export function membershipFor(
  actor: PartnerActor,
  partnerId: string,
  capability: PartnerCapability,
): Membership {
  const membership = actor.memberships.find((m) => m.partnerId === partnerId);
  if (!membership) throw new NotPartner();
  if (membership.disabled) {
    throw new NotPartner("This partner account is not active. Contact support.");
  }
  if (!partnerCan(membership.role, capability)) {
    throw new NotPartner("You do not have permission to do that.");
  }
  return membership;
}

/**
 * Resolve the partner a request is about.
 *
 * Almost every partner works for exactly one company, so the console does not
 * make them pick. Where somebody genuinely belongs to two, the request has to say
 * which — silently defaulting to the first would eventually mint a key for the
 * wrong company.
 */
export function resolvePartnerId(
  actor: PartnerActor,
  requested: string | null | undefined,
): string {
  if (requested) return requested;
  if (actor.memberships.length === 1) return actor.memberships[0].partnerId;
  throw new NotPartner("Which partner account is this for?");
}
