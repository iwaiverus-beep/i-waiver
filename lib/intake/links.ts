import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotAuthorised } from "@/lib/agreements/access";

/**
 * Static intake links — the printed QR code.
 *
 * A deliberate inversion of `signing_links`, and it is worth being precise about
 * why the two do not share a table. A signing link is a capability: it carries the
 * right to bind somebody to an instrument, so it is hashed at rest, single-use, and
 * measured in hours. An intake link carries no right at all. It says "this lender,
 * and optionally this thing", it is printed on a counter card that will outlive
 * several borrowers, and the worst a stranger can do with it is join a queue.
 *
 * That is the whole security argument for storing the slug in the clear, and it
 * only holds while the link stays incapable of doing anything else. Nothing here
 * should ever grow the ability to sign, to read an agreement, or to see who else
 * has scanned it.
 */

export type IntakeLink = {
  id: string;
  originator_id: string;
  asset_id: string | null;
  slug: string;
  label: string | null;
  activity_class: string;
  jurisdiction: string;
  revoked_at: string | null;
  created_at: string;
};

/**
 * Slugs are 16 lowercase base32 characters from a CSPRNG.
 *
 * Not a secret, but not guessable either: enumerable slugs would let someone walk
 * the space and file requests against lenders who never showed them a code. 16
 * characters of this alphabet is about 80 bits, which is far past the point where
 * guessing beats simply photographing a poster.
 *
 * The alphabet omits 0/1/l/o so a slug can be read aloud or typed from a printed
 * card when a camera will not focus.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newSlug(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Resolves a scanned slug, or returns null.
 *
 * Runs on the service client because the scanner is a stranger with no session.
 * Revoked links resolve, deliberately: the caller needs to tell the difference
 * between "this code was withdrawn" and "this code never existed", because a
 * printed code outlives the decision to stop honouring it and a bare 404 sends
 * somebody standing at a counter to find a member of staff.
 */
export async function resolveIntakeLink(
  db: SupabaseClient,
  slug: string,
): Promise<
  | { link: IntakeLink; asset: AssetFacts | null; lenderName: string | null }
  | null
> {
  const { data: link } = await db
    .from("intake_links")
    .select(
      "id, originator_id, asset_id, slug, label, activity_class, jurisdiction, revoked_at, created_at",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!link) return null;

  // The asset's facts come from here and only from here. The person scanning
  // never supplies them: the declared value drives both the damage clause and the
  // premium, so a stranger typing it would be setting the terms of their own
  // liability and the price of the cover at once.
  let asset: AssetFacts | null = null;
  if (link.asset_id) {
    const { data } = await db
      .from("assets")
      .select("id, description, asset_class, declared_value_cents, year, make, model")
      .eq("id", link.asset_id)
      .is("archived_at", null)
      .maybeSingle();
    asset = data ?? null;
  }

  return { link, asset, lenderName: await lenderNameFor(db, link.originator_id) };
}

export type AssetFacts = {
  id: string;
  description: string;
  asset_class: string;
  declared_value_cents: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
};

/**
 * What to call the lender on the borrower's screen.
 *
 * Someone who has just scanned a sticker needs to see who they are dealing with
 * before they type their name and their phone number into it. An organisation is
 * named by its trading name; an individual by the name on their profile.
 */
export async function lenderNameFor(
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

/** Creates a code for this lender. Asset-level when `assetId` is given. */
export async function createIntakeLink(
  db: SupabaseClient,
  input: {
    originatorId: string;
    assetId?: string | null;
    label?: string | null;
    activityClass: string;
    jurisdiction: string;
  },
): Promise<IntakeLink> {
  // An asset-level code may only point at something this lender actually owns.
  // Checked here rather than trusted from the form, because the id arrives from a
  // browser and `assets` is readable by every colleague in an organisation.
  if (input.assetId) {
    const { data: owned } = await db
      .from("assets")
      .select("id")
      .eq("id", input.assetId)
      .eq("owner_originator_id", input.originatorId)
      .is("archived_at", null)
      .maybeSingle();
    if (!owned) throw new NotAuthorised("That item is not yours.");
  }

  const { data, error } = await db
    .from("intake_links")
    .insert({
      originator_id: input.originatorId,
      asset_id: input.assetId ?? null,
      slug: newSlug(),
      label: input.label ?? null,
      activity_class: input.activityClass,
      jurisdiction: input.jurisdiction,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`could not create the code: ${error?.message}`);
  return data;
}

/**
 * Withdraws a code. Never deletes it.
 *
 * The card is already printed and on somebody's counter. Deleting the row would
 * turn every future scan into a dead end; revoking it lets the page say the code
 * is no longer in use, and keeps the requests it already produced attached to
 * something.
 */
export async function revokeIntakeLink(
  db: SupabaseClient,
  originatorIds: string[],
  linkId: string,
): Promise<void> {
  const { data } = await db
    .from("intake_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .in("originator_id", originatorIds)
    .select("id")
    .maybeSingle();

  if (!data) throw new NotAuthorised();
}
