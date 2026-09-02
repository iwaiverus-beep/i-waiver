import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PARTNER_KINDS, type PartnerKind } from "@/lib/partners/vocabulary";

/**
 * The statuses, labels and the row shape live in lib/partners/vocabulary.ts, so
 * the console can render them in the browser — this module is `server-only`.
 * Re-exported so a caller needs one import, not two.
 */
export {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  PROSPECT_STATUS_DESCRIPTIONS,
  type Prospect,
  type ProspectStatus,
} from "@/lib/partners/vocabulary";

import { PROSPECT_STATUSES, type Prospect, type ProspectStatus } from "@/lib/partners/vocabulary";

/**
 * The channel target list — who we want to supply, before they are partners.
 *
 * A prospect is not an account. It holds no key, has no members, no onboarding
 * record and no way in; `approveApplication` remains the only thing that creates
 * a `partners` row, which is what keeps every partner in possession of an owner
 * who can actually sign in. See the header of 20260901000038.
 *
 * Deliberately not a CRM. There is no activity feed, no task, no reminder and no
 * deal value. The list answers one question — who have we approached, and did
 * they answer — and every field beyond that is a field somebody has to keep true.
 */

export class ProspectRefused extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export async function listProspects(db: SupabaseClient): Promise<Prospect[]> {
  const { data, error } = await db
    .from("partner_prospects")
    .select("*")
    .order("status")
    .order("name");
  if (error) throw new Error(`partner_prospects: ${error.message}`);
  return (data ?? []) as Prospect[];
}

/**
 * A URL-safe handle, made unique by counting — the same scheme partners and
 * carriers use, so a prospect that becomes a partner keeps a recognisable name.
 */
async function uniqueSlug(db: SupabaseClient, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "prospect";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await db
      .from("partner_prospects")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new ProspectRefused("Could not find a free handle for that name.");
}

/**
 * Tidies a pasted address into something a link can use.
 *
 * People paste `smartwaiver.com`, and an href with no scheme is read as a
 * relative path — the link then goes to /admin/smartwaiver.com and looks broken
 * for a reason nobody guesses. Anything that is not http(s) after that is
 * refused rather than corrected: a `javascript:` URL rendering as a link in a
 * staff console is not a thing to be clever about.
 */
export function normaliseWebsite(value: string | null): string | null {
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ProspectRefused("That website address is not a http(s) URL.");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof ProspectRefused) throw error;
    throw new ProspectRefused("That does not look like a website address.");
  }
}

export async function createProspect(
  db: SupabaseClient,
  input: {
    name: string;
    website?: string | null;
    kind?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    notes?: string | null;
    createdBy: string;
  },
): Promise<Prospect> {
  const kind: PartnerKind = PARTNER_KINDS.includes(input.kind as PartnerKind)
    ? (input.kind as PartnerKind)
    : "waiver_platform";

  const { data, error } = await db
    .from("partner_prospects")
    .insert({
      name: input.name,
      slug: await uniqueSlug(db, input.name),
      website: normaliseWebsite(input.website ?? null),
      kind,
      // Always `identified`. Somebody adding a name to a list has not yet
      // contacted them, and a status the creator picks is a status that is
      // aspirational on the day it is typed.
      status: "identified",
      contact_name: input.contactName ?? null,
      contact_email: input.contactEmail ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (error) throw new ProspectRefused(`Could not add them: ${error.message}`);
  return data as Prospect;
}

export async function updateProspect(
  db: SupabaseClient,
  id: string,
  patch: {
    status?: string | null;
    website?: string | null;
    kind?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    notes?: string | null;
    lostReason?: string | null;
    partnerId?: string | null;
    ownerStaffId?: string | null;
  },
): Promise<Prospect> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.status !== undefined && patch.status !== null) {
    if (!PROSPECT_STATUSES.includes(patch.status as ProspectStatus)) {
      throw new ProspectRefused("That is not a status a prospect can be in.");
    }
    update.status = patch.status;

    // The database enforces both of these too. They are checked here as well so
    // the console can say what is missing, rather than surfacing a constraint
    // name to somebody who has no idea what `won_prospect_has_partner` is.
    if (patch.status === "won" && !patch.partnerId) {
      throw new ProspectRefused(
        "Say which partner they became. A prospect marked won with no partner is a claim nothing backs up.",
      );
    }
    if (patch.status === "lost" && !patch.lostReason) {
      throw new ProspectRefused(
        "Say why it was lost. In six months the reason is the only part of this row worth having.",
      );
    }
    // Moving off `identified` is the moment somebody actually wrote to them.
    if (patch.status === "contacted") {
      update.last_contacted_at = new Date().toISOString();
    }
  }

  if (patch.website !== undefined) update.website = normaliseWebsite(patch.website);
  if (patch.kind !== undefined && PARTNER_KINDS.includes(patch.kind as PartnerKind)) {
    update.kind = patch.kind;
  }
  if (patch.contactName !== undefined) update.contact_name = patch.contactName;
  if (patch.contactEmail !== undefined) update.contact_email = patch.contactEmail;
  if (patch.contactPhone !== undefined) update.contact_phone = patch.contactPhone;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.lostReason !== undefined) update.lost_reason = patch.lostReason;
  if (patch.partnerId !== undefined) update.partner_id = patch.partnerId;
  if (patch.ownerStaffId !== undefined) update.owner_staff_id = patch.ownerStaffId;

  const { data, error } = await db
    .from("partner_prospects")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new ProspectRefused(`Could not save that: ${error.message}`);
  if (!data) throw new ProspectRefused("That prospect is not there any more.", 404);
  return data as Prospect;
}

/**
 * Removes a name from the list.
 *
 * Allowed only while the row is still just a name. Once a prospect has applied or
 * become a partner it is provenance — how that relationship started — and a
 * console that can erase how a live partner arrived is a console that can make
 * the record disagree with what happened. Everything else is `lost`, which keeps
 * the row and the reason.
 */
export async function deleteProspect(db: SupabaseClient, id: string): Promise<Prospect> {
  const { data: existing } = await db
    .from("partner_prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!existing) throw new ProspectRefused("That prospect is not there any more.", 404);

  const row = existing as Prospect;
  if (row.application_id || row.partner_id) {
    throw new ProspectRefused(
      "They have already applied or become a partner. Mark them lost instead — this row is now the record of how that started.",
    );
  }

  const { error } = await db.from("partner_prospects").delete().eq("id", id);
  if (error) throw new ProspectRefused(`Could not remove them: ${error.message}`);
  return row;
}
