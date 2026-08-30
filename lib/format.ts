/**
 * Formatting helpers.
 *
 * Money is integer cents everywhere in the schema and everywhere in this codebase.
 * The only place a decimal point appears is here, on the way to a screen.
 */

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  // Round after scaling: 12.34 * 100 is 1233.9999999999998 in binary floating
  // point, and a declared value that is a cent light is a claim dispute later.
  return Math.round(Number(cleaned) * 100);
}

/**
 * The clock an agreement is written in.
 *
 * Timestamps are stored as timestamptz and are always UTC. A document, though, is
 * read by two people standing next to a jet ski, and telling them the loan ends at
 * "00:00 UTC" is a document that invites an argument. So the rendered text uses the
 * wall clock of the state where the activity happens — and the formatted string is
 * frozen into `documents.render_inputs`, which is what makes the rendering
 * reproducible years later regardless of what this table says by then.
 */
const STATE_TIME_ZONES: Record<string, string> = {
  FL: "America/New_York",
  GA: "America/New_York",
  NY: "America/New_York",
  TX: "America/Chicago",
  CA: "America/Los_Angeles",
  AZ: "America/Phoenix",
  CO: "America/Denver",
  HI: "Pacific/Honolulu",
  AK: "America/Anchorage",
};

export function timeZoneFor(state: string): string {
  return STATE_TIME_ZONES[state] ?? "America/New_York";
}

/** "1 September 2026 at 2:00 PM EDT" — unambiguous to a human, zone included. */
export function formatInstant(iso: string, state: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneFor(state),
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const parts = formatter.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return (
    `${get("day")} ${get("month")} ${get("year")} at ` +
    `${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`
  );
}

/** Short form for lists and tables. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** For a `datetime-local` input, which wants the browser's own wall clock. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}
