/**
 * CSV and TSV, parsed properly.
 *
 * NO `server-only` MARKER: the paste box parses in the browser, so a person who
 * copies forty rows out of Google Sheets sees the preview before anything leaves
 * their machine. The file upload runs the same function on the server. One
 * parser, so a pasted list and an uploaded one cannot disagree about what a
 * quoted comma means.
 *
 * WHY NOT `text.split(",")`. Because the very first real-world list breaks it. A
 * contact list contains "Okafor, Marcus" and addresses with commas in the
 * display name, and a naive split turns one person into two half-people, silently
 * — the import "succeeds" and the damage is discovered by whoever gets sent an
 * agreement addressed to nobody. RFC 4180 quoting is nine lines of state machine
 * and it is not optional.
 */

/** Rows exactly as the file had them: no header interpretation, no trimming of empties. */
export type Grid = string[][];

export type Delimiter = "," | "\t" | ";" | "|";

/**
 * Work out what separates the columns.
 *
 * Counted only OUTSIDE quotes, over the first few lines, because a file full of
 * "Last, First" names contains more commas inside quotes than delimiters between
 * them and a naive count picks the comma every time — including for a tab-
 * separated file, which then parses as one very wide column.
 *
 * Semicolon matters more than it looks: Excel on a machine with a European
 * locale writes semicolon-separated files and still calls them .csv. Pipe is
 * there because exports from older systems use it and it costs one character.
 */
export function sniffDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [",", "\t", ";", "|"];
  const sample = text.slice(0, 64 * 1024);

  let best: Delimiter = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;

    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i];
      if (char === '"') {
        // A doubled quote inside a quoted field is an escaped quote, not a close.
        if (quoted && sample[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted && char === candidate) count += 1;
    }

    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}

/**
 * Parse delimited text into a grid.
 *
 * Handles what actual exports contain: quoted fields, doubled quotes inside them,
 * newlines inside quoted fields, and all three line endings — a file written by
 * Excel on Windows is CRLF, one from a Mac may be bare CR, and a file that has
 * been through a text editor is anything.
 *
 * `maxRows` is a guard, not a preference. This runs on bytes somebody uploaded,
 * and an unbounded parse of an untrusted file is a way to spend all the memory
 * on the box.
 */
export function parseDelimited(
  text: string,
  options: { delimiter?: Delimiter; maxRows?: number } = {},
): Grid {
  // A byte-order mark survives every round trip through Excel and, left in
  // place, attaches itself to the first header — so the column called "Name"
  // does not match the string "Name" and the mapping silently finds nothing.
  const source = text.replace(/^﻿/, "");
  const delimiter = options.delimiter ?? sniffDelimiter(source);
  const maxRows = options.maxRows ?? 5000;

  const grid: Grid = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      // Only opens a quoted field at the start of one. A stray quote mid-field
      // — `5" pipe` — is a character, and treating it as an opening quote
      // swallows the rest of the file into one field.
      quoted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n") {
      endRow();
      if (grid.length >= maxRows) return grid;
    } else if (char === "\r") {
      // CRLF, or a bare CR from an old Mac export. Either way one row ends.
      if (source[i + 1] === "\n") i += 1;
      endRow();
      if (grid.length >= maxRows) return grid;
    } else {
      field += char;
    }
  }

  // A file that does not end in a newline still has a last row.
  if (field !== "" || row.length > 0) endRow();

  return grid;
}

/**
 * Drop rows that are entirely empty.
 *
 * Trailing blank lines are what a spreadsheet produces when somebody has ever
 * clicked in a cell below their data, which is always. Left in, they become
 * "47 rows could not be imported" and the person reasonably concludes the import
 * is broken.
 */
export function dropEmptyRows(grid: Grid): Grid {
  return grid.filter((row) => row.some((cell) => cell.trim() !== ""));
}
