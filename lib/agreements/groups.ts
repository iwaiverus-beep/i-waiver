import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent, type RequestContext } from "@/lib/audit";
import { NotAuthorised } from "@/lib/agreements/access";
import { createDraftAgreement } from "@/lib/agreements/create";
import { sendAgreement, TransitionRefused } from "@/lib/agreements/lifecycle";
import { siteOrigin } from "@/lib/env";

/**
 * Bookings — one thing, several households.
 *
 * THE ONE DECISION THIS FILE RESTS ON: a booking is a grouping of agreements, not
 * an agreement with more people on it.
 *
 * The tempting shape is a single release with twelve signers. It does not work,
 * for three reasons that are all expensive to discover late. A release is personal
 * to the releasor, so one adult signing cannot discharge another adult's claims —
 * twelve names on one document would leave the lender protected against whoever
 * held the pen. A signature is bound to the exact bytes of one document, so twelve
 * people signing one instrument at different moments have either signed different
 * things or been made to wait for each other. And a document struck down takes
 * everything on it, which is precisely why the four instruments are kept as
 * separate clause records rather than one block of text.
 *
 * So: one `rental` agreement for whoever took the thing, and one `participant`
 * agreement per other adult, each a real two-party instrument between the same
 * lender and that one person. Everything below the group is unchanged — the same
 * create path, the same compliance gate, the same snapshotting, the same hash, the
 * same evidence chain, the same coverage quote per signer.
 *
 * What the group adds is the ONLY thing the database could not already say: that
 * these releases belong to one afternoon on one boat, and that the shop can see at
 * a glance whether everybody has signed before anybody boards.
 */

export type RentalGroup = {
  id: string;
  originator_id: string;
  label: string;
  closed_at: string | null;
  created_at: string;
};

export type GroupMember = {
  agreementId: string;
  role: "rental" | "participant";
  status: string;
  displayName: string;
  email: string | null;
  signedAt: string | null;
  declinedAt: string | null;
};

export type GroupBoard = {
  group: RentalGroup;
  members: GroupMember[];
  /** Everyone the booking is still waiting on, including the lender's own side. */
  outstanding: number;
  /** The live check-in code, if there is one. */
  link: { slug: string; url: string; expiresAt: string; uses: number; maxUses: number } | null;
};

/** Hours a dock code stays live. A booking is an afternoon, not a fortnight. */
export const GROUP_LINK_TTL_HOURS = 12;

/**
 * Slug alphabet and length are borrowed wholesale from `lib/intake/links.ts`, for
 * the same reasons: about 80 bits so the space cannot be walked, and no 0/1/l/o so
 * somebody at a counter can read it aloud when a camera will not focus.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newSlug(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Loads a booking only if this actor's originator owns it. */
export async function groupForActor(
  db: SupabaseClient,
  originatorIds: string[],
  groupId: string,
): Promise<RentalGroup> {
  if (originatorIds.length === 0) throw new NotAuthorised();

  const { data } = await db
    .from("rental_groups")
    .select("id, originator_id, label, closed_at, created_at")
    .eq("id", groupId)
    .in("originator_id", originatorIds)
    .maybeSingle();

  if (!data) throw new NotAuthorised();
  return data;
}

/**
 * Everything the booking screen shows.
 *
 * Assembled from the agreements themselves rather than from anything cached on the
 * group. "Nine of twelve have signed" is a fact about nine signatures, and a
 * counter kept alongside them is a second answer that can disagree with the first
 * — on the one screen where somebody is deciding whether to let people board.
 */
export async function groupBoard(
  db: SupabaseClient,
  group: RentalGroup,
): Promise<GroupBoard> {
  const { data: agreements } = await db
    .from("agreements")
    .select("id, status, group_role, created_at")
    .eq("group_id", group.id)
    .order("created_at");

  const rows = agreements ?? [];

  const { data: signers } = await db
    .from("signers")
    .select("agreement_id, role, display_name, email, signed_at, declined_at")
    .in(
      "agreement_id",
      rows.map((a) => a.id),
    );

  const members: GroupMember[] = rows.map((agreement) => {
    // The counterparty, never the lender: the lender's name is the same on every
    // row of the booking and listing it twelve times says nothing.
    const signer = (signers ?? []).find(
      (s) =>
        s.agreement_id === agreement.id &&
        (s.role === "borrower" || s.role === "participant"),
    );

    return {
      agreementId: agreement.id,
      role: agreement.group_role as "rental" | "participant",
      status: agreement.status,
      displayName: signer?.display_name ?? "—",
      email: signer?.email ?? null,
      signedAt: signer?.signed_at ?? null,
      declinedAt: signer?.declined_at ?? null,
    };
  });

  // Executed means every signature on that agreement landed. Anything short of it
  // is somebody the boat is still waiting on, which is the question being asked.
  const outstanding = members.filter(
    (m) => m.status !== "executed" && m.status !== "voided",
  ).length;

  const { data: link } = await db
    .from("group_links")
    .select("slug, expires_at, uses, max_uses")
    .eq("group_id", group.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    group,
    members,
    outstanding,
    link: link
      ? {
          slug: link.slug,
          url: `${siteOrigin()}/join/${link.slug}`,
          expiresAt: link.expires_at,
          uses: link.uses,
          maxUses: link.max_uses,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Creating the booking
// ---------------------------------------------------------------------------

/**
 * Turns an existing agreement into a booking.
 *
 * Deliberately not "create a booking and then an agreement inside it". The loan is
 * the thing that already exists and already works: somebody filled in the form,
 * picked the boat and named who is taking it. Adding other households to it is a
 * second thought, usually had at the counter, and modelling it as a second thought
 * means the ordinary two-party path never has to know bookings exist.
 *
 * The agreement may already be sent, signed or executed. That is on purpose — the
 * renter signs at nine and the other families turn up at ten, which is the actual
 * sequence — and it is safe because nothing here touches the loan itself. It gains
 * a `group_id` and nothing else: not its document, not its hash, not its clause
 * set, not its signature.
 */
export async function startGroupFromAgreement(
  db: SupabaseClient,
  input: {
    originatorId: string;
    agreementId: string;
    label: string;
    context: RequestContext;
  },
): Promise<RentalGroup> {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, originator_id, group_id, status")
    .eq("id", input.agreementId)
    .eq("originator_id", input.originatorId)
    .maybeSingle();

  if (!agreement) throw new NotAuthorised();

  if (agreement.group_id) {
    throw new TransitionRefused("This agreement is already part of a booking.");
  }
  if (agreement.status === "voided") {
    throw new TransitionRefused("That agreement has been voided.");
  }

  const label = input.label.trim().slice(0, 120);
  if (!label) throw new TransitionRefused("Give the booking a name.");

  const { data: group, error } = await db
    .from("rental_groups")
    .insert({ originator_id: input.originatorId, label })
    .select("id, originator_id, label, closed_at, created_at")
    .single();

  if (error || !group) {
    throw new TransitionRefused(`Could not start the booking: ${error?.message}`);
  }

  const { error: linkError } = await db
    .from("agreements")
    .update({ group_id: group.id, group_role: "rental" })
    .eq("id", agreement.id)
    .is("group_id", null);

  if (linkError) {
    // The group is empty and nothing has been signed against it, so removing it
    // destroys nothing. Leaving it would put a booking with no boat in it on the
    // lender's list.
    await db.from("rental_groups").delete().eq("id", group.id);
    throw new TransitionRefused(
      `Could not attach the agreement to the booking: ${linkError.message}`,
    );
  }

  await recordAuditEvent(db, {
    agreementId: agreement.id,
    type: "created",
    actor: "lender",
    payload: { group_id: group.id, group_role: "rental", group_label: label },
    context: input.context,
  });

  return group;
}

// ---------------------------------------------------------------------------
// Adding a person
// ---------------------------------------------------------------------------

export type AddedParticipant = {
  agreementId: string;
  /** The signing link, returned so a dock check-in can go straight to it. */
  url: string | null;
  delivered: boolean;
  warnings: string[];
};

/**
 * Adds one adult to a booking: their own agreement, their own release, their own
 * link.
 *
 * Every fact except the name and the address is copied from the booking's loan,
 * never taken from the caller. Same lender, same items in the same order, same
 * window, same state, same time zone. That is what makes the dock code safe to
 * hand to a stranger — there is nothing on it for them to set — and it is also
 * what makes the twelve releases comparable to each other afterwards.
 *
 * Items are read from the loan's SNAPSHOT where it has one, and from its live
 * schedule while it is still a draft. Reading the live list off a sent agreement
 * would let a participant's release describe a boat the renter's release does not,
 * which is constraint 4 with two documents instead of one.
 */
export async function addParticipant(
  db: SupabaseClient,
  input: {
    group: RentalGroup;
    name: string;
    email: string;
    phone?: string | null;
    /** Send the release immediately. False leaves it a draft for a lender to review. */
    send?: boolean;
    context: RequestContext;
    auditExtra?: Record<string, unknown>;
  },
): Promise<AddedParticipant> {
  if (input.group.closed_at) {
    throw new TransitionRefused("This booking is closed.");
  }

  const name = input.name.trim().slice(0, 120);
  if (!name) throw new TransitionRefused("Who is being added?");

  const { data: rental } = await db
    .from("agreements")
    .select(
      "id, originator_id, asset_id, jurisdiction, activity_class, starts_at, ends_at, time_zone, cover_requested, status",
    )
    .eq("group_id", input.group.id)
    .eq("group_role", "rental")
    .maybeSingle();

  if (!rental) {
    throw new TransitionRefused(
      "This booking has no loan on it yet, so there is nothing for a release to point at.",
    );
  }
  if (rental.status === "voided") {
    throw new TransitionRefused(
      "The loan on this booking has been voided. Nobody can be added to it.",
    );
  }
  if (new Date(rental.ends_at) <= new Date()) {
    throw new TransitionRefused("This booking has already ended.");
  }

  // The lender's own name and address, taken from the loan so that both documents
  // name the same party in the same words.
  const { data: rentalLender } = await db
    .from("signers")
    .select("user_id, display_name, email")
    .eq("agreement_id", rental.id)
    .eq("role", "lender")
    .maybeSingle();

  if (!rentalLender?.email) {
    throw new TransitionRefused("The loan on this booking has no lender on it.");
  }

  const { data: bundle } = await db
    .from("agreement_assets")
    .select("asset_id, order_index")
    .eq("agreement_id", rental.id)
    .order("order_index");

  const assetIds = (bundle ?? []).map((row) => row.asset_id);
  if (assetIds.length === 0 && rental.asset_id) assetIds.push(rental.asset_id);

  if (assetIds.length === 0) {
    throw new TransitionRefused("The loan on this booking describes nothing.");
  }

  // An originator is a person or a business; the participant instrument is
  // selected on that axis exactly as the loan is, and there is no fallback
  // between them.
  const { data: originator } = await db
    .from("originators")
    .select("kind")
    .eq("id", rental.originator_id)
    .maybeSingle();

  const { agreementId } = await createDraftAgreement(db, {
    originatorId: rental.originator_id,
    originatorKind: originator?.kind === "organization" ? "organization" : "individual",
    instrumentKind: "participant",
    groupId: input.group.id,
    assetIds,
    jurisdiction: rental.jurisdiction,
    activityClass: rental.activity_class,
    startsAt: rental.starts_at,
    endsAt: rental.ends_at,
    timeZone: rental.time_zone ?? undefined,
    coverRequested: rental.cover_requested,
    lender: {
      userId: rentalLender.user_id ?? null,
      name: rentalLender.display_name,
      email: rentalLender.email,
    },
    borrower: { name, email: input.email, phone: input.phone ?? null },
    context: input.context,
    auditExtra: {
      group_id: input.group.id,
      from_rental_agreement_id: rental.id,
      ...(input.auditExtra ?? {}),
    },
  });

  if (input.send === false) {
    return { agreementId, url: null, delivered: false, warnings: [] };
  }

  const sent = await sendAgreement(db, agreementId, input.context);
  const link = sent.links.find((l) => l.role === "participant");

  return {
    agreementId,
    url: link?.url ?? null,
    delivered: link?.delivered ?? false,
    warnings: sent.warnings,
  };
}

// ---------------------------------------------------------------------------
// The dock code
// ---------------------------------------------------------------------------

export async function issueGroupLink(
  db: SupabaseClient,
  input: { group: RentalGroup; maxUses?: number },
): Promise<{ slug: string; url: string; expiresAt: string; maxUses: number }> {
  if (input.group.closed_at) {
    throw new TransitionRefused("This booking is closed.");
  }

  const maxUses = Math.min(Math.max(Math.trunc(input.maxUses ?? 30), 1), 200);
  const expiresAt = new Date(
    Date.now() + GROUP_LINK_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  // A new row rather than an extension of the old one, for the reason
  // `issueSigningLink` gives: reissuing by moving an expiry destroys the record of
  // how many codes were handed out and when.
  const { data, error } = await db
    .from("group_links")
    .insert({
      group_id: input.group.id,
      slug: newSlug(),
      expires_at: expiresAt,
      max_uses: maxUses,
    })
    .select("slug, expires_at, max_uses")
    .single();

  if (error || !data) {
    throw new TransitionRefused(`Could not create the code: ${error?.message}`);
  }

  return {
    slug: data.slug,
    url: `${siteOrigin()}/join/${data.slug}`,
    expiresAt: data.expires_at,
    maxUses: data.max_uses,
  };
}

export async function revokeGroupLinks(
  db: SupabaseClient,
  groupId: string,
): Promise<void> {
  await db
    .from("group_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .is("revoked_at", null);
}

export type ResolvedGroupLink = {
  group: RentalGroup;
  lenderName: string | null;
  assetDescription: string;
  startsAt: string;
  endsAt: string;
  jurisdiction: string;
  activityClass: string;
  /** Why the code will not work, when it will not. */
  refusal: "revoked" | "expired" | "full" | "closed" | null;
};

/**
 * Resolves a scanned dock code for the public join page.
 *
 * Refusals resolve rather than 404 for the reason `resolveIntakeLink` gives: the
 * code is on a counter in front of somebody, and a blank page sends them looking
 * for a member of staff instead of telling them what happened.
 *
 * What comes back is bounded to what is already printed on the card in front of
 * them — who the lender is, what the thing is, when it runs. Nothing about who
 * else has checked in: a code left on a counter should not let a stranger read a
 * list of the families aboard.
 */
export async function resolveGroupLink(
  db: SupabaseClient,
  slug: string,
): Promise<ResolvedGroupLink | null> {
  const { data: link } = await db
    .from("group_links")
    .select("id, group_id, expires_at, revoked_at, uses, max_uses")
    .eq("slug", slug)
    .maybeSingle();

  if (!link) return null;

  const { data: group } = await db
    .from("rental_groups")
    .select("id, originator_id, label, closed_at, created_at")
    .eq("id", link.group_id)
    .maybeSingle();

  if (!group) return null;

  const { data: rental } = await db
    .from("agreements")
    .select("id, jurisdiction, activity_class, starts_at, ends_at, asset_snapshot, asset_id")
    .eq("group_id", group.id)
    .eq("group_role", "rental")
    .maybeSingle();

  if (!rental) return null;

  const refusal: ResolvedGroupLink["refusal"] = link.revoked_at
    ? "revoked"
    : group.closed_at
      ? "closed"
      : new Date(link.expires_at) < new Date()
        ? "expired"
        : link.uses >= link.max_uses
          ? "full"
          : null;

  // The snapshot where there is one, the live row while the loan is still a
  // draft. Same order of authority the renderer uses.
  let description = "the item";
  const snapshot = rental.asset_snapshot as { description?: string } | null;
  if (snapshot?.description) {
    description = snapshot.description;
  } else if (rental.asset_id) {
    const { data: asset } = await db
      .from("assets")
      .select("description")
      .eq("id", rental.asset_id)
      .maybeSingle();
    if (asset?.description) description = asset.description;
  }

  return {
    group,
    lenderName: await lenderNameForGroup(db, group.originator_id),
    assetDescription: description,
    startsAt: rental.starts_at,
    endsAt: rental.ends_at,
    jurisdiction: rental.jurisdiction,
    activityClass: rental.activity_class,
    refusal,
  };
}

/**
 * Claims one use of a dock code and adds the person to the booking.
 *
 * The claim is a single UPDATE carrying every condition, so the cap cannot be
 * raced past: two people tapping at once cannot both take use number thirty. It
 * happens BEFORE the agreement is created, which is the conservative order — a
 * claim with no release behind it costs one slot on a code, and a release with no
 * claim behind it is the cap not meaning anything.
 */
export async function joinGroupByLink(
  db: SupabaseClient,
  input: {
    slug: string;
    name: string;
    email: string;
    phone?: string | null;
    context: RequestContext;
  },
): Promise<{ url: string; agreementId: string }> {
  const now = new Date().toISOString();

  const { data: claimed } = await db
    .rpc("claim_group_link_use", { p_slug: input.slug, p_now: now })
    .maybeSingle();

  if (!claimed) {
    // Resolve it again to say WHY, rather than reporting "no" to somebody
    // standing at a counter with a phone in their hand.
    const resolved = await resolveGroupLink(db, input.slug);
    throw new TransitionRefused(
      resolved?.refusal === "full"
        ? "This check-in code has been used as many times as it allows. Ask whoever is running the booking."
        : resolved?.refusal === "expired"
          ? "This check-in code has expired."
          : resolved?.refusal === "revoked"
            ? "This check-in code is no longer in use."
            : resolved?.refusal === "closed"
              ? "This booking is closed."
              : "This check-in code is not valid.",
    );
  }

  const group = await groupById(db, (claimed as { group_id: string }).group_id);
  if (!group) throw new TransitionRefused("This check-in code is not valid.");

  const added = await addParticipant(db, {
    group,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    send: true,
    context: input.context,
    auditExtra: { joined_by: "group_link" },
  });

  if (!added.url) {
    throw new TransitionRefused(
      "Your release was created but no signing link came back. Ask whoever is running the booking.",
    );
  }

  return { url: added.url, agreementId: added.agreementId };
}

/** Unscoped read, for the paths that have already proved their right to the row. */
async function groupById(
  db: SupabaseClient,
  groupId: string,
): Promise<RentalGroup | null> {
  const { data } = await db
    .from("rental_groups")
    .select("id, originator_id, label, closed_at, created_at")
    .eq("id", groupId)
    .maybeSingle();
  return data ?? null;
}

/**
 * What to call the lender on a stranger's screen.
 *
 * Same shape as `lenderNameFor` in lib/intake/links.ts and kept separate from it
 * on purpose: that module is about a printed poster that creates a queue entry,
 * this one is about a booking that creates a release, and importing across would
 * tie two access stories together that must be free to diverge.
 */
async function lenderNameForGroup(
  db: SupabaseClient,
  originatorId: string,
): Promise<string | null> {
  const { data: originator } = await db
    .from("originators")
    .select("user_id, org_id")
    .eq("id", originatorId)
    .maybeSingle();

  if (!originator) return null;

  if (originator.org_id) {
    const { data: org } = await db
      .from("organizations")
      .select("legal_name, dba")
      .eq("id", originator.org_id)
      .maybeSingle();
    return org?.dba || org?.legal_name || null;
  }

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", originator.user_id)
    .maybeSingle();
  return profile?.full_name ?? null;
}
