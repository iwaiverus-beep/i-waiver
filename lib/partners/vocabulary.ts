/**
 * The words the partner pipeline uses, and the shapes it passes around.
 *
 * Same trade as lib/platform/roles.ts: deliberately free of imports and free of
 * `server-only`, because the console has to render these labels in the browser
 * and the routes have to validate against the same lists on the server. Two
 * copies of "waiver_platform" is two copies that drift, and the one that drifts
 * is always the one on screen.
 *
 * Nothing here reaches the database. lib/partners/applications.ts and
 * lib/partners/prospects.ts do that, and both re-export from here so existing
 * imports of these names keep working.
 */

export const PARTNER_KINDS = [
  "waiver_platform",
  "booking_platform",
  "carrier",
  "mga",
  "broker",
  "other",
] as const;

export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  waiver_platform: "Waiver platform",
  booking_platform: "Booking or rental platform",
  carrier: "Insurance carrier",
  mga: "MGA or programme manager",
  broker: "Broker or agency",
  other: "Something else",
};

export const VOLUME_BANDS = [
  "under_10k",
  "10k_100k",
  "100k_1m",
  "over_1m",
] as const;

export const VOLUME_BAND_LABELS: Record<string, string> = {
  under_10k: "Under 10,000 waivers a year",
  "10k_100k": "10,000 – 100,000",
  "100k_1m": "100,000 – 1 million",
  over_1m: "Over 1 million",
};

// ---------------------------------------------------------------------------
// Prospects — the target list, before anybody is a partner
// ---------------------------------------------------------------------------

export const PROSPECT_STATUSES = [
  "identified",
  "contacted",
  "in_conversation",
  "applied",
  "won",
  "lost",
] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  identified: "Identified",
  contacted: "Contacted",
  in_conversation: "In conversation",
  applied: "Applied",
  won: "Partner",
  lost: "Lost",
};

export const PROSPECT_STATUS_DESCRIPTIONS: Record<ProspectStatus, string> = {
  identified: "On the list. Nobody has written to them.",
  contacted: "We reached out and have not heard back.",
  in_conversation: "They answered. A conversation is running.",
  applied: "They filled in the public form — the application queue has it now.",
  won: "They became a partner.",
  lost: "They said no.",
};

export type Prospect = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  kind: PartnerKind;
  status: ProspectStatus;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  owner_staff_id: string | null;
  notes: string | null;
  lost_reason: string | null;
  application_id: string | null;
  partner_id: string | null;
  created_at: string;
  last_contacted_at: string | null;
  updated_at: string;
};
