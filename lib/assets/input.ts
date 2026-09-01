import "server-only";

import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { parseDollarsToCents } from "@/lib/format";
import { text } from "@/lib/http";
import type { RateUnit } from "@/lib/assets/fields";

/**
 * Reading the merchandising half of a saved item off a request body.
 *
 * Shared by POST and PATCH because they diverge in exactly one way — an absent
 * key means "not given" on a create and "leave it alone" on an edit — and every
 * other rule about these fields is identical. Two copies of this drifted apart in
 * the identifying half already: the create route silently coerces an unparseable
 * declared value to null while the edit route refuses it.
 */

const RATE_UNITS: RateUnit[] = ["hour", "half_day", "day", "week", "flat"];

/** Dollars in, cents out. An empty box is a real answer and means null. */
function money(raw: unknown, field: string): number | null {
  if (typeof raw === "number") return Math.round(raw * 100);
  if (typeof raw !== "string" || !raw.trim()) return null;
  const cents = parseDollarsToCents(raw);
  if (cents === null) {
    throw new TransitionRefused(`${field} is not an amount — try something like 45.`);
  }
  return cents;
}

export type MerchandisingPatch = Record<string, unknown>;

/**
 * Builds the patch for whichever of these fields the caller sent.
 *
 * Keys absent from the body are absent from the result, which is what makes this
 * usable for PATCH. A create route passes the same body and simply gets fewer
 * keys back when the form left them empty.
 */
export function readMerchandising(body: Record<string, unknown>): MerchandisingPatch {
  const patch: MerchandisingPatch = {};

  if (body.headline !== undefined) patch.headline = text(body.headline, 120);

  // Roomy, but bounded. This renders on a stranger's phone and the page has to
  // stay a listing rather than becoming a brochure nobody scrolls.
  if (body.details_md !== undefined) patch.details_md = text(body.details_md, 4000);

  if (body.deposit !== undefined) patch.deposit_cents = money(body.deposit, "The deposit");

  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    // Zero is not "none of them" — it is a lender saying they have none, which is
    // what archiving is for. Anything unreadable falls back to one rather than
    // refusing, because a quantity is the least consequential field here.
    patch.quantity = Number.isInteger(quantity) && quantity >= 1 ? quantity : 1;
  }

  if (body.is_offerable !== undefined) patch.is_offerable = body.is_offerable === true;

  // Rate and unit move together or the page says "$75" with nothing after it,
  // which reads as a total and is not one. Both null is "price on request".
  if (body.rate !== undefined || body.rate_unit !== undefined) {
    const cents = money(body.rate, "The price");
    const unit = text(body.rate_unit, 20);

    if (cents !== null && (!unit || !RATE_UNITS.includes(unit as RateUnit))) {
      throw new TransitionRefused("Say what the price is per — an hour, a day, or a one-off.");
    }

    patch.rate_cents = cents;
    patch.rate_unit = cents === null ? null : unit;
  }

  return patch;
}

/**
 * Turns the database's commercial-use refusal into something a lender can act on.
 *
 * The trigger in 20260901000028 already says the right thing in its `hint`, but a
 * Postgres error reaches the route as one opaque string and the hint is the half
 * that tells somebody what to do instead. Recognised by its wording rather than
 * by an error code, because `check_violation` is also what a dozen ordinary
 * constraints raise and misreporting one of those as an insurance problem would
 * be worse than a generic message.
 */
export function asCommercialUseRefusal(message: string): TransitionRefused | null {
  if (!message.includes("makes it a rental")) return null;
  return new TransitionRefused(
    "Charging by the hour, day or week makes this a rental, and an individual's own " +
      "insurance will not cover it. Leave the price blank, or use a one-off amount for " +
      "what you are out of pocket — delivery, fuel, cleaning. Renting things out for a " +
      "fee needs a business account.",
  );
}
