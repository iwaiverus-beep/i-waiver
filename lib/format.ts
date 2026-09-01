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
/*
 * All 51 jurisdictions, because `state_availability` carries all 51 and they are
 * opened one at a time. The old nine-state table returned Eastern for everything
 * else, so a Washington loan rendered three hours off with nothing to show for it.
 *
 * Twelve states straddle a zone boundary. Each is mapped to the side holding most
 * of its population, which is a guess the writer can override — the agreement
 * stores its own zone rather than deriving one at render time, so correcting a
 * Florida-panhandle loan to Central is a per-agreement fact, not a code change.
 */
const STATE_TIME_ZONES: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix", // no DST
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DC: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York", // panhandle west of the Apalachicola is Central
  GA: "America/New_York",
  HI: "Pacific/Honolulu", // no DST
  IA: "America/Chicago",
  ID: "America/Boise", // north of the Salmon River is Pacific
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis", // NW and SW corners are Central
  KS: "America/Chicago", // four western counties are Mountain
  KY: "America/New_York", // western third is Central
  LA: "America/Chicago",
  MA: "America/New_York",
  MD: "America/New_York",
  ME: "America/New_York",
  MI: "America/Detroit", // four western UP counties are Central
  MN: "America/Chicago",
  MO: "America/Chicago",
  MS: "America/Chicago",
  MT: "America/Denver",
  NC: "America/New_York",
  ND: "America/Chicago", // southwest corner is Mountain
  NE: "America/Chicago", // panhandle is Mountain
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NV: "America/Los_Angeles", // West Wendover is Mountain
  NY: "America/New_York",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles", // most of Malheur County is Mountain
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago", // western half is Mountain
  TN: "America/Chicago", // the eastern third, Knoxville and Chattanooga, is Eastern
  TX: "America/Chicago", // El Paso and Hudspeth are Mountain
  UT: "America/Denver",
  VA: "America/New_York",
  VT: "America/New_York",
  WA: "America/Los_Angeles",
  WI: "America/Chicago",
  WV: "America/New_York",
  WY: "America/Denver",
};

export function timeZoneFor(state: string): string {
  return STATE_TIME_ZONES[state] ?? "America/New_York";
}

/**
 * How far `timeZone` is from UTC at `instant`, in milliseconds.
 *
 * Formatting an instant into a zone and reading it back as though it were UTC
 * gives the offset. Done this way rather than with a table because the offset
 * depends on the date — the same zone is -05:00 in January and -04:00 in July.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl reports midnight as hour 24 in some ICU versions.
  const hour = at("hour") % 24;

  return (
    Date.UTC(at("year"), at("month") - 1, at("day"), hour, at("minute"), at("second")) -
    instant.getTime()
  );
}

/**
 * A `datetime-local` value read as a wall clock in `timeZone`, as a UTC instant.
 *
 * "2026-09-01T09:41" carries no zone, so the browser would read it as the clock on
 * the desk it was typed at. The window belongs to the state the activity happens
 * in, so it has to be read there instead — otherwise a lender in Kansas City books
 * a Florida jet ski for an hour later than the waiver goes on to say.
 *
 * The offset is applied twice because the first guess uses the offset at the wrong
 * instant, which lands on the wrong side of a DST change for windows within an
 * hour of one.
 *
 * The two hours a year that are not one-to-one resolve without complaint: a time
 * in the hour daylight saving skips lands on the instant an hour earlier (02:30
 * becomes 01:30, since 02:30 never happens), and a time in the hour it repeats
 * takes the first pass. Both are checked in the loan window's own zone, so what
 * the writer sees on the confirmation screen is what the document will say.
 */
export function zonedInputToUtc(wallClock: string, timeZone: string): Date {
  const asIfUtc = new Date(`${wallClock}:00Z`);
  if (Number.isNaN(asIfUtc.getTime())) return new Date(NaN);

  const firstGuess = new Date(asIfUtc.getTime() - zoneOffsetMs(asIfUtc, timeZone));
  return new Date(asIfUtc.getTime() - zoneOffsetMs(firstGuess, timeZone));
}

/** The inverse: an instant as the wall clock a `datetime-local` input wants. */
export function utcToZonedInput(instant: Date, timeZone: string): string {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * A zone name if the runtime knows it, otherwise null.
 *
 * Asked of Intl rather than checked against a list, because the list is the
 * runtime's and it moves: zones are added and renamed by IANA between Node
 * releases. A name this returns is one `formatInstant` can definitely render.
 */
export function asIanaZone(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** "EDT", "CST" — for labelling a field with the clock it is asking for. */
export function zoneAbbreviation(timeZone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/**
 * "1 September 2026 at 2:00 PM EDT" — unambiguous to a human, zone included.
 *
 * Takes the zone rather than the state: an agreement carries its own, so a
 * Florida-panhandle loan can say CDT without every other Florida loan following
 * it. Callers with only a state can pass `timeZoneFor(state)`.
 */
export function formatInstant(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
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
