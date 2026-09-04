#!/usr/bin/env node
/**
 * Checks the contact importer's parsing and column detection.
 *
 * Run with:  npm run check:import
 *
 * WHY THIS EXISTS IN A REPOSITORY WITH NO TEST FRAMEWORK. Everything else here
 * is checked by the type system and by using it. This is not: a CSV parser is a
 * state machine whose failures are silent and plausible — a quoted comma splits
 * one person into two, a column of account numbers becomes phone numbers — and
 * the damage shows up later as an agreement sent to nobody. Every case below is
 * one that a real file actually produced.
 *
 * Plain Node, no dependency, no runner. `--conditions=react-server` is only so
 * the `server-only` marker resolves to its empty build outside Next.
 */
import { parseDelimited, sniffDelimiter, dropEmptyRows } from "../lib/import/delimited.ts";
import {
  buildCandidates,
  contactKey,
  detectMapping,
  looksLikeHeader,
  summarise,
} from "../lib/contacts/import.ts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

console.log("\n--- delimiter sniffing ---");
check("plain csv", sniffDelimiter("a,b,c\n1,2,3"), ",");
check("tsv from a clipboard", sniffDelimiter("a\tb\tc\n1\t2\t3"), "\t");
check("european semicolons", sniffDelimiter("a;b;c\n1;2;3"), ";");
check(
  "tabs win over commas that are inside quoted names",
  sniffDelimiter('"Okafor, Marcus"\tm@x.co\n"Duran, Cylinda"\tc@x.co'),
  "\t",
);

console.log("\n--- quoting and line endings ---");
check(
  "a comma inside a quoted field is not a delimiter",
  parseDelimited('Name,Email\n"Okafor, Marcus",m@x.co'),
  [["Name", "Email"], ["Okafor, Marcus", "m@x.co"]],
);
check(
  "a doubled quote is one quote",
  parseDelimited('Name\n"He said ""hi"""'),
  [["Name"], ['He said "hi"']],
);
check(
  "a newline inside a quoted field keeps one row",
  parseDelimited('Name,Notes\nMarcus,"line one\nline two"'),
  [["Name", "Notes"], ["Marcus", "line one\nline two"]],
);
check("CRLF from Excel on Windows", parseDelimited("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
check("bare CR from an old Mac export", parseDelimited("a,b\r1,2"), [["a", "b"], ["1", "2"]]);
check("no trailing newline still yields the last row", parseDelimited("a,b\n1,2"), [
  ["a", "b"],
  ["1", "2"],
]);
check(
  "a UTF-8 BOM does not stick to the first header",
  parseDelimited("﻿Name,Email\nMarcus,m@x.co")[0],
  ["Name", "Email"],
);
check(
  'a stray inch mark mid-field is a character, not a quote',
  parseDelimited('Item,Note\nPipe,5" bore'),
  [["Item", "Note"], ["Pipe", '5" bore']],
);
check(
  "empty trailing rows are dropped",
  dropEmptyRows(parseDelimited("a,b\n1,2\n,\n\n")),
  [["a", "b"], ["1", "2"]],
);

console.log("\n--- mapping and candidates ---");
const messy = dropEmptyRows(
  parseDelimited(
    [
      "Full Name,E-Mail Address,Mobile Number,Comments",
      '"Okafor, Marcus",MARCUS@Example.com,+1 (816) 555-0142,Kayak guy',
      "Cylinda Duran,cylinda@example.com,,",
      "No Contact Details,,,",
      ",orphan@example.com,,",
      "Repeat Person,marcus@example.com,,",
      "Bad Address,not-an-email,,",
      "Phone Only,,07700 900142,",
    ].join("\n"),
  ),
);

const header = looksLikeHeader(messy[0]);
const mapping = detectMapping(messy, header);
check("header row detected", header, true);
check("columns mapped by their real-world names", mapping, {
  name: 0,
  email: 1,
  phone: 2,
  notes: 3,
});

const candidates = buildCandidates(messy, mapping, {
  hasHeader: header,
  existingKeys: new Set([contactKey({ display_name: "", email: "cylinda@example.com", phone: null })]),
});

check("summary", summarise(candidates), {
  ready: 2,
  existing: 1,
  duplicate: 1,
  skipped: 3,
});
check("email is lower-cased", candidates[0].email, "marcus@example.com");
check("quoted comma survived into the name", candidates[0].display_name, "Okafor, Marcus");
check("already in the list is not re-imported", candidates[1].status, "existing");
check("a row with no name is skipped", candidates[3].status, "skipped");
check("repeat of an earlier address is a duplicate", candidates[4].status, "duplicate");
check("an unparseable address is skipped", candidates[5].status, "skipped");
check("phone alone is enough", candidates[6].status, "ready");

console.log("\n--- first and last name columns ---");
const split = parseDelimited("fname,lname,email\nMike,Morfeld,mike@x.co");
const splitMapping = detectMapping(split, true);
check("fname/lname recognised", splitMapping, { first: 0, last: 1, email: 2 });
check(
  "joined into one display name",
  buildCandidates(split, splitMapping, { hasHeader: true })[0].display_name,
  "Mike Morfeld",
);

console.log("\n--- pasted with no header at all ---");
const pasted = parseDelimited("Marcus Okafor\tmarcus@example.com\t816-555-0142");
check("no header detected", looksLikeHeader(pasted[0]), false);
check("columns guessed from content", detectMapping(pasted, false), {
  name: 0,
  email: 1,
  phone: 2,
});

console.log("\n--- re-importing the same list ---");
// The unique index covers email only, so a phone-only contact has to be caught
// here or a second run of the same file duplicates them. This is the case that
// an end-to-end run actually found.
const twice = parseDelimited("Name,Email,Mobile\nPhone Only,,07700 900142\nMailed,m@x.co,");
const twiceMapping = detectMapping(twice, true);
const firstRun = buildCandidates(twice, twiceMapping, { hasHeader: true });
check("first run imports both", summarise(firstRun).ready, 2);

const secondRun = buildCandidates(twice, twiceMapping, {
  hasHeader: true,
  existingKeys: new Set(firstRun.map(contactKey)),
});
check("second run imports neither", summarise(secondRun).ready, 0);
check("the phone-only contact is recognised, not re-added", secondRun[0].status, "existing");
check(
  "the same number written differently is still the same person",
  contactKey({ display_name: "Marcus", email: null, phone: "+1 (816) 555-0142" }) ===
    contactKey({ display_name: "marcus", email: null, phone: "1-816-555-0142" }),
  true,
);

console.log("\n--- a date serial is not a phone number ---");
const survey = parseDelimited("45531.65689357639,a@b.co\n45532.446478356476,c@d.co");
check("timestamp column not mapped to phone", detectMapping(survey, false).phone, undefined);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
