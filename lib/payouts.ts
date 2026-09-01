/**
 * Where an individual lender asks to be reimbursed.
 *
 * No `server-only`: the account screen renders this list and generates the QR in
 * the browser, the PDF renders the label, and both need the same names for the
 * same things.
 *
 * READ 20260901000032 BEFORE CHANGING ANYTHING HERE. Two of its decisions live in
 * this file:
 *
 *   1. WE NEVER ACCEPT AN UPLOADED QR IMAGE. A QR code is an arbitrary
 *      destination in a form nobody can read by looking at it, and we render this
 *      into email that goes out under our name. So the lender types the handle,
 *      the handle is constrained to a character set that cannot express a URL,
 *      and the code is GENERATED from it here. A lender who pastes their Venmo QR
 *      into this product should get their own handle back, not a forwarded image.
 *
 *   2. WE NEVER CALL ANY OF THESE. There is no Venmo integration behind this and
 *      no transfer we can see. It is a handle we relay and a code we draw, and
 *      the copy on every screen has to keep saying so.
 */

export const PAYOUT_PROVIDERS = ["venmo", "cashapp", "zelle", "paypal", "other"] as const;

export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];

/**
 * The named providers only.
 *
 * The `other` value is deliberately absent, and callers read this with a
 * fallback. The rendered instrument says "asked to be paid by Venmo at @dave"
 * when it knows the provider and "asked to be paid at dave@example.com" when it
 * does not, which is the honest sentence — "asked to be paid by Something
 * Else" is not.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  zelle: "Zelle",
  paypal: "PayPal",
};

/** The same names as a menu needs them, with the honest fallback for `other`. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? "Something else";
}

/** What the field is called on the provider's own screen, so nobody has to translate. */
export const PROVIDER_FIELD_LABELS: Record<PayoutProvider, string> = {
  venmo: "Venmo username",
  cashapp: "Cashtag",
  zelle: "Zelle email or phone",
  paypal: "PayPal.Me name",
  other: "Handle",
};

export const PROVIDER_PLACEHOLDERS: Record<PayoutProvider, string> = {
  venmo: "@Dave-Okafor",
  cashapp: "$daveokafor",
  zelle: "dave@example.com",
  paypal: "daveokafor",
  other: "dave@example.com",
};

/**
 * Byte-for-byte the check constraint `payout_handle_is_a_handle`.
 *
 * Repeated here rather than left to the database so a typo comes back as a
 * sentence instead of a Postgres violation — but the database is still the one
 * that decides, and if these two ever disagree the constraint wins.
 */
export const HANDLE_PATTERN = /^[A-Za-z0-9@._+-]{2,64}$/;

export function isPayoutProvider(value: unknown): value is PayoutProvider {
  return typeof value === "string" && (PAYOUT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * What people actually type, turned into what the column will hold.
 *
 * Venmo shows handles with an @ and Cash App shows them with a $, so both get
 * typed in that way — and `$` is not in the permitted character set at all, which
 * would otherwise reject every cashtag copied off the app. The sigil is
 * decoration; it is stripped here and put back at display time.
 */
export function normaliseHandle(provider: PayoutProvider, raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (provider === "cashapp") return trimmed.replace(/^\$+/, "");
  if (provider === "venmo" || provider === "paypal") return trimmed.replace(/^@+/, "");
  return trimmed;
}

/** The handle as its own app writes it. */
export function displayHandle(provider: string, handle: string): string {
  if (provider === "cashapp") return `$${handle}`;
  if (provider === "venmo") return `@${handle}`;
  return handle;
}

/**
 * The link the generated code points at, or null where there honestly isn't one.
 *
 * Zelle has no public profile URL — it is reached through the sending bank — and
 * "something else" is by definition unknown. Encoding the bare handle as text
 * would produce a code that scans to a string a phone can do nothing with, which
 * looks like a payment code and is not one. Better to draw no code and show the
 * handle, which is the thing that works.
 */
export function payoutUrl(provider: string, handle: string): string | null {
  switch (provider) {
    case "venmo":
      return `https://venmo.com/u/${encodeURIComponent(handle)}`;
    case "cashapp":
      return `https://cash.app/$${encodeURIComponent(handle)}`;
    case "paypal":
      return `https://paypal.me/${encodeURIComponent(handle)}`;
    default:
      return null;
  }
}
