/**
 * The columns every screen reads off a saved item.
 *
 * Written out in four places before this existed — two routes, the list page and
 * the lend form — which was survivable while the row was six identifying facts
 * and stopped being so the moment it grew a second face. A merchandised item that
 * renders its price on one screen and not another is not a display bug; it is a
 * lender advertising two different things depending on where you look.
 *
 * `description` leads deliberately. It is the legal label, the text that reaches
 * Schedule A, and the one field here that an instrument ever sees — everything
 * after `model` is merchandising and is read by nothing in lib/render/.
 */
export const ASSET_COLUMNS =
  "id, owner_originator_id, asset_class, description, identifier, declared_value_cents, " +
  "year, make, model, " +
  "headline, details_md, rate_cents, rate_unit, deposit_cents, quantity, is_offerable";

/** The same list, plus the gallery. Anything showing an item to a borrower wants this. */
export const ASSET_COLUMNS_WITH_PHOTOS =
  `${ASSET_COLUMNS}, asset_photos (id, storage_path, alt, order_index)`;

export type AssetPhoto = {
  id: string;
  storage_path: string;
  alt: string | null;
  order_index: number;
};

/** The bucket photographs live in. Public, and deliberately the only public one. */
export const PHOTO_BUCKET = "asset-photos";

/**
 * Where a photograph is served from.
 *
 * Built here rather than asked of the Supabase client so a client component can
 * render a gallery without a round trip and without importing anything
 * server-only. `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time, which is the
 * whole reason this reads the variable directly instead of going through
 * lib/env.ts — that module pulls in node:crypto and cannot cross into the browser.
 */
export function photoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${storagePath}`;
}

/** Gallery order, with the lead photograph first. */
export function orderedPhotos(photos: AssetPhoto[] | null | undefined): AssetPhoto[] {
  return [...(photos ?? [])].sort((a, b) => a.order_index - b.order_index);
}

/** How a rate is quoted. Mirrors the `rate_unit` enum in 20260901000028. */
export type RateUnit = "hour" | "half_day" | "day" | "week" | "flat";

export const RATE_UNIT_LABELS: Record<RateUnit, string> = {
  hour: "an hour",
  half_day: "a half day",
  day: "a day",
  week: "a week",
  flat: "flat",
};

/**
 * A rate as a person reads it: "$45 a day", "$75 flat".
 *
 * Returns null rather than a placeholder when there is no price, because "price
 * on request" is a real answer a lender may intend and an em dash where a number
 * should be reads as a mistake.
 */
export function formatRate(
  cents: number | null | undefined,
  unit: RateUnit | null | undefined,
): string | null {
  if (cents === null || cents === undefined || !unit) return null;
  const amount = (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    // Whole dollars stay whole: "$45 a day" is a price, "$45.00 a day" is a receipt.
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${RATE_UNIT_LABELS[unit]}`;
}

/**
 * Which rate units may be used for an item owned by this kind of originator.
 *
 * The database refuses the rest — see `asset_rate_commercial_use_guard` — because
 * charging by the period for the use of a thing makes the loan a bailment for
 * hire, which an individual's own policy excludes. Repeated here so the form can
 * offer the honest set rather than letting somebody pick a day rate and meet an
 * error afterwards.
 *
 * Asked per ITEM rather than per person, deliberately. Someone can be a member of
 * a rental business and still lend their own jet ski to a neighbour, and the two
 * items are subject to different rules because they have different owners. A
 * lender-wide answer would let a day rate onto the personal one.
 */
export function allowedRateUnits(
  originatorKind: "individual" | "organization",
): RateUnit[] {
  return originatorKind === "organization"
    ? ["hour", "half_day", "day", "week", "flat"]
    : ["flat"];
}
