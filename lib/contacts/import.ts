import type { Grid } from "@/lib/import/delimited";

/**
 * Turning somebody's spreadsheet into contacts.
 *
 * No `server-only`: the paste box runs this in the browser so the preview appears
 * without a round trip, and the upload route runs the same functions on the
 * server. The rules about what counts as a usable row therefore cannot drift
 * between the two ways in.
 *
 * THE SHAPE OF THE PROBLEM. Nobody's list looks like our table. It has a column
 * called "Mobile" or "Cell" or "Ph.", the name is in one column or in two, and
 * somewhere in it are three rows that are a section heading, a blank, and a total.
 * So this guesses, shows its guess, and lets it be corrected — it never imports
 * on a guess alone. Everything here is reversible except sending an agreement to
 * the wrong person, which is exactly what a silent mis-mapping causes.
 */

/** The fields a column can be mapped to. `skip` is a real answer, not an absence. */
export type Field = "name" | "first" | "last" | "email" | "phone" | "notes" | "skip";

/** Which source column feeds which field. Indexes into the grid's columns. */
export type Mapping = Partial<Record<Exclude<Field, "skip">, number>>;

export type Candidate = {
  /** 1-based line in the source, so the preview can say which row was dropped. */
  line: number;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** `ready` goes in. Everything else is shown with its reason and not sent. */
  status: "ready" | "duplicate" | "existing" | "skipped";
  reason?: string;
};

/**
 * Deliberately the same expression as EMAIL_PATTERN in lib/http.ts, repeated
 * rather than imported: that module pulls in `next/server` and the whole error
 * taxonomy, and this one is imported by a client component. A shared constants
 * file for one regex would be worse than the four lines.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------------------------------------------------------------------
// Working out what the columns are
// ---------------------------------------------------------------------------

/**
 * Header spellings seen in the wild, lower-cased and stripped of punctuation.
 *
 * Ordered within each field from most to least specific, and checked as whole
 * strings before substrings — "email" must not win a column headed "email
 * verified", and "name" must not swallow "company name" while a plain "name"
 * column sits beside it.
 */
const SYNONYMS: Record<Exclude<Field, "skip">, string[]> = {
  name: ["display name", "full name", "contact name", "name", "contact", "person"],
  first: ["first name", "given name", "forename", "fname", "first"],
  last: ["last name", "family name", "surname", "lname", "last"],
  email: ["email address", "e mail address", "email", "e mail", "mail"],
  phone: [
    "mobile number",
    "phone number",
    "mobile phone",
    "cell phone",
    "telephone",
    "mobile",
    "phone",
    "cell",
    "tel",
  ],
  notes: ["notes", "note", "comments", "comment", "description"],
};

const normalise = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Does the first row name the columns, or is it already data?
 *
 * A pasted block often has no header at all. The test is deliberately not "does
 * it match a synonym" alone: a list of first names has a first row reading
 * "Marcus", and a header row essentially never contains an email address. So a
 * row holding something that parses as an email is data, whatever it says.
 */
export function looksLikeHeader(row: string[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  if (row.some((cell) => EMAIL.test(cell.trim()))) return false;

  // The same matcher the mapping itself uses, rather than a stricter exact-match
  // copy of it. "Account Name" and "Email Address" are headers; a test that only
  // recognised the bare words called that row data and guessed the columns from
  // content instead — which is how a column of account numbers became phone
  // numbers.
  return row.some((cell) => fieldForHeader(cell) !== null);
}

/** Match a header cell to a field, whole-string first, then as a substring. */
function fieldForHeader(header: string): Exclude<Field, "skip"> | null {
  const value = normalise(header);
  if (!value) return null;

  for (const [field, names] of Object.entries(SYNONYMS)) {
    if (names.includes(value)) return field as Exclude<Field, "skip">;
  }
  for (const [field, names] of Object.entries(SYNONYMS)) {
    if (names.some((name) => value.includes(name))) {
      return field as Exclude<Field, "skip">;
    }
  }
  return null;
}

/**
 * Could somebody dial this?
 *
 * Deliberately loose about punctuation — +1 (816) 555-0142 and 07700 900142 are
 * both here — and strict about two things that a looser test got wrong.
 *
 * It was tightened after a Google Forms export mapped its Timestamp column to
 * Phone: "45531.65689357639" starts with a digit, carries punctuation and has
 * plenty of digits, which was the whole of the old test. What separates a date
 * serial from a phone number is how MANY digits there are — E.164 caps at 15 and
 * nothing dialable has fewer than 7 — and the long run of them after a decimal
 * point, which no phone number has.
 */
function looksDialable(value: string): boolean {
  if (/\.\d{3,}/.test(value)) return false;
  if (!/^[+(]?\d/.test(value)) return false;
  if (/[^\d\s()+.-]/.test(value)) return false;

  const digits = value.match(/\d/g)?.length ?? 0;
  return digits >= 7 && digits <= 15;
}

/**
 * Guess the mapping from the content when there are no headers to read.
 *
 * Emails and phone numbers identify themselves; whatever is left that holds
 * letters is the name. Only ever a starting point — the UI shows it as a set of
 * dropdowns, because a guess presented as a decision is how a column of account
 * numbers gets imported as phone numbers.
 */
function guessFromContent(rows: Grid, columns: number): Mapping {
  const mapping: Mapping = {};
  const sample = rows.slice(0, 20);

  const share = (column: number, test: (value: string) => boolean) => {
    const values = sample.map((row) => (row[column] ?? "").trim()).filter(Boolean);
    if (values.length === 0) return 0;
    return values.filter(test).length / values.length;
  };

  for (let column = 0; column < columns; column += 1) {
    if (mapping.email === undefined && share(column, (v) => EMAIL.test(v)) > 0.6) {
      mapping.email = column;
      continue;
    }
    if (mapping.phone === undefined && share(column, looksDialable) > 0.6) {
      mapping.phone = column;
      continue;
    }
    if (mapping.name === undefined && share(column, (v) => /\p{L}/u.test(v)) > 0.6) {
      mapping.name = column;
    }
  }

  return mapping;
}

/** The opening guess: headers where there are any, content where there are not. */
export function detectMapping(grid: Grid, hasHeader: boolean): Mapping {
  const columns = grid.reduce((widest, row) => Math.max(widest, row.length), 0);

  if (!hasHeader) return guessFromContent(grid, columns);

  const mapping: Mapping = {};
  const headers = grid[0] ?? [];

  for (let column = 0; column < columns; column += 1) {
    const field = fieldForHeader(headers[column] ?? "");
    // First column to claim a field keeps it. A list with "Email" and "Email 2"
    // should import the first one rather than whichever came last.
    if (field && mapping[field] === undefined) mapping[field] = column;
  }

  // Headers that named nothing we recognise, in a file that clearly has headers.
  // Fall back to content for the fields still missing, so an "Addr." column of
  // emails is still found.
  const guessed = guessFromContent(grid.slice(1), columns);
  for (const [field, column] of Object.entries(guessed)) {
    const key = field as Exclude<Field, "skip">;
    if (mapping[key] === undefined && !Object.values(mapping).includes(column)) {
      mapping[key] = column;
    }
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Turning rows into candidates
// ---------------------------------------------------------------------------

/**
 * What makes two rows the same person.
 *
 * THE BUG THIS FIXES, because it is not obvious from the schema. The unique
 * index on `contacts` covers `(owner, lower(email)) where email is not null`, so
 * the database has no opinion whatsoever about a contact with only a phone
 * number. Importing the same spreadsheet twice therefore left one copy of
 * everybody who had an email address and TWO copies of everybody who had only a
 * phone — which is precisely the list of people most likely to be imported from
 * an old address book, and precisely the mistake somebody makes when they are
 * not sure the first import worked.
 *
 * So the email is the key where there is one, and name-plus-number where there
 * is not. The phone is reduced to its digits first: the same person is written
 * "+1 (816) 555-0142" in one export and "816-555-0142" in the next, and a key
 * that treats those as two people does not do the job it exists for.
 *
 * This is a convenience, not a constraint — the database still cannot enforce
 * the second form. That is the right split: a contact list is not evidence, and
 * a false match here costs one merged address book entry, whereas a unique index
 * that refused a genuinely different person would cost an import.
 */
export function contactKey(contact: {
  display_name: string;
  email: string | null;
  phone: string | null;
}): string {
  if (contact.email) return `email:${contact.email.trim().toLowerCase()}`;
  const name = contact.display_name.trim().toLowerCase();
  return `name-phone:${name}|${(contact.phone ?? "").replace(/\D/g, "")}`;
}

const cell = (row: string[], column: number | undefined) =>
  column === undefined ? "" : (row[column] ?? "").trim();

/**
 * Apply a mapping and say, row by row, what will happen.
 *
 * Nothing is silently dropped. Every row of the source comes back with a status,
 * so the preview can show "3 of these have no way to reach them" instead of
 * importing 47 of 50 and leaving somebody to work out which three.
 *
 * `existingEmails` are the addresses already in the list. Matching rows are
 * marked `existing` rather than `ready` — the database's unique index would
 * refuse them anyway, and saying so before the import is the difference between
 * a report and an error.
 */
export function buildCandidates(
  grid: Grid,
  mapping: Mapping,
  options: { hasHeader: boolean; existingKeys?: Set<string> } = { hasHeader: true },
): Candidate[] {
  const body = options.hasHeader ? grid.slice(1) : grid;
  const existing = options.existingKeys ?? new Set<string>();
  const seen = new Set<string>();

  return body.map((row, index) => {
    const line = index + 1 + (options.hasHeader ? 1 : 0);

    // One name column, or a first and a last. Both are common and neither is
    // more correct, so both are read and whichever is present wins.
    const whole = cell(row, mapping.name);
    const first = cell(row, mapping.first);
    const last = cell(row, mapping.last);
    const display_name = (whole || [first, last].filter(Boolean).join(" ")).trim();

    const rawEmail = cell(row, mapping.email).toLowerCase();
    const email = rawEmail || null;
    const phone = cell(row, mapping.phone).replace(/\s+/g, " ") || null;
    const notes = cell(row, mapping.notes) || null;

    const base = { line, display_name, email, phone, notes };

    if (!display_name) {
      return { ...base, status: "skipped" as const, reason: "No name in this row." };
    }
    if (email && !EMAIL.test(email)) {
      return {
        ...base,
        status: "skipped" as const,
        reason: `“${email}” is not an email address.`,
      };
    }
    if (!email && !phone) {
      // Mirrors the contact_is_reachable constraint. Caught here so the person
      // reads a sentence rather than a constraint violation.
      return {
        ...base,
        status: "skipped" as const,
        reason: "No email and no phone — there would be no way to send anything.",
      };
    }

    const key = contactKey({ display_name, email, phone });

    if (existing.has(key)) {
      return { ...base, status: "existing" as const, reason: "Already in your list." };
    }
    if (seen.has(key)) {
      return { ...base, status: "duplicate" as const, reason: "Appears earlier in this file." };
    }
    seen.add(key);

    return { ...base, status: "ready" as const };
  });
}

/** The one-line summary the preview leads with. */
export function summarise(candidates: Candidate[]) {
  return {
    ready: candidates.filter((c) => c.status === "ready").length,
    existing: candidates.filter((c) => c.status === "existing").length,
    duplicate: candidates.filter((c) => c.status === "duplicate").length,
    skipped: candidates.filter((c) => c.status === "skipped").length,
  };
}

export const FIELD_LABELS: Record<Field, string> = {
  name: "Name",
  first: "First name",
  last: "Last name",
  email: "Email",
  phone: "Phone",
  notes: "Notes",
  skip: "Do not import",
};
