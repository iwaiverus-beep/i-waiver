import "server-only";

import { inflateRawSync } from "node:zlib";

import type { Grid } from "@/lib/import/delimited";

/**
 * Reading a .xlsx, without a dependency.
 *
 * WHY THIS IS HERE AND NOT `npm i xlsx`. The obvious library is SheetJS, whose
 * npm package is no longer the maintained distribution and whose published
 * versions carry open prototype-pollution and ReDoS advisories. Pulling a
 * known-vulnerable parser into the one code path whose entire job is chewing on
 * files that strangers uploaded is the wrong trade, and the alternatives are
 * heavy in a repository that has ten dependencies on purpose.
 *
 * What this does NOT do, deliberately: formulas, styles, dates, merged cells,
 * charts, or anything about a second sheet. It reads the text of the cells on
 * one worksheet, which is the whole of what importing a contact list needs. A
 * date column would arrive as an Excel serial number, and rather than half-
 * implement the 1900 leap-year bug this simply has no business reading dates.
 *
 * A .xlsx is a ZIP of XML. So: a small ZIP reader, then two XML parts —
 * `sharedStrings.xml`, where Excel puts most text exactly once, and the
 * worksheet, whose cells mostly point into it by index.
 */

/** Bytes, rows and columns are all capped. This parses hostile input. */
const MAX_ROWS = 5000;
const MAX_COLUMNS = 64;

export class NotASpreadsheet extends Error {}

// ---------------------------------------------------------------------------
// The ZIP half
// ---------------------------------------------------------------------------

type Entry = { name: string; data: Buffer };

/**
 * Read every file out of a ZIP archive.
 *
 * Driven from the central directory at the end rather than by walking local
 * headers from the front. The central directory is the archive's own index and
 * is what every real unzipper trusts; scanning forward for local-header
 * signatures finds them inside compressed data too.
 */
function readZip(bytes: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record is last, but may be followed by up to
  // 64KB of comment, so it is found by scanning backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new NotASpreadsheet("That file is not a spreadsheet.");

  const count = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);

  // ZIP64 announces itself with saturated fields. Refused rather than
  // misparsed: a 4GB contact list is not a thing, so this is a corrupt or
  // hostile file and reading it as a normal archive would read nonsense.
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new NotASpreadsheet("That spreadsheet is in a format we cannot read.");
  }

  const files = new Map<string, Buffer>();
  let cursor = directoryOffset;

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new NotASpreadsheet("That spreadsheet appears to be damaged.");
    }

    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    cursor += 46 + nameLength + extraLength + commentLength;

    // Only the four parts below are ever read, so everything else — images,
    // themes, printer settings — is skipped without being decompressed at all.
    if (!WANTED.test(name)) continue;

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      continue;
    }

    // The local header repeats the name and extra lengths, and its extra field
    // is frequently a DIFFERENT length from the central directory's. Reading
    // the central one here is the classic way to land a few bytes into the data.
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);

    try {
      files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    } catch {
      // One unreadable part is not necessarily fatal — a missing
      // sharedStrings only matters if the sheet refers to it.
      continue;
    }
  }

  return files;
}

const WANTED =
  /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/.+\.xml)$/;

// ---------------------------------------------------------------------------
// The XML half
// ---------------------------------------------------------------------------

/**
 * The five predefined entities plus numeric references.
 *
 * `&amp;` is last on purpose. Decoding it first would turn `&amp;lt;` — which is
 * a literal "&lt;" somebody typed — into a "<", which is how an escaped string
 * becomes markup.
 */
function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function codePoint(value: number): string {
  return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "";
}

/**
 * The shared string table: Excel stores most text once and points at it.
 *
 * An entry can be a single `<t>`, or several `<r>` runs each with their own
 * `<t>` where the formatting changes mid-cell. Bold half a name and it becomes
 * two runs, so the runs are concatenated — taking only the first would import
 * half of somebody's name and look, on screen, like they had simply typed it
 * that way.
 */
function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];

  const items: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    const inner = match[1] ?? "";
    let text = "";
    for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    items.push(decodeXml(text));
  }
  return items;
}

/** `BC` -> 54. Column letters are base-26 with no zero. */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Turn one worksheet into a grid.
 *
 * Cells are positioned by their own `r="B7"` reference rather than by counting,
 * because a row omits its empty cells entirely. Counting shifts every value after
 * a gap one column to the left — which in a contact list quietly files everybody's
 * phone number in the email column.
 */
function readSheet(xml: string, shared: string[]): Grid {
  const grid: Grid = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (grid.length >= MAX_ROWS) break;

    const cells: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(
      /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attributes = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";

      const reference = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const at = reference ? columnIndex(reference) : cells.length;
      if (at >= MAX_COLUMNS) continue;

      let value = "";
      if (type === "inlineStr") {
        for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += t[1];
        value = decodeXml(value);
      } else {
        const raw = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (type === "s") {
          value = shared[Number(raw)] ?? "";
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          // Numbers and formula results (`str`) alike, as written. A phone
          // number Excel decided was a number arrives here as its digits, which
          // is the best available answer — the leading zero it ate is gone from
          // the file, not lost here.
          value = decodeXml(raw);
        }
      }

      while (cells.length < at) cells.push("");
      cells[at] = value;
    }

    grid.push(cells);
  }

  return grid;
}

/**
 * The first worksheet in TAB ORDER, which is not the same as `sheet1.xml`.
 *
 * `workbook.xml` lists sheets in the order the tabs appear and refers to each by
 * relationship id; the rels part maps that id to a file. Reordering tabs in
 * Excel changes the order here without renaming the files, so reaching straight
 * for sheet1.xml imports whichever sheet happens to have been created first —
 * usually, but not always, the one the person is looking at.
 */
function firstSheetPath(files: Map<string, Buffer>): string | null {
  const workbook = files.get("xl/workbook.xml")?.toString("utf8");
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8");

  if (workbook && rels) {
    const sheet = workbook.match(/<sheet\b[^>]*\/>/)?.[0];
    const id = sheet?.match(/r:id="([^"]+)"/)?.[1];

    if (id) {
      const relationship = rels
        .match(/<Relationship\b[^>]*\/>/g)
        ?.find((entry) => entry.includes(`Id="${id}"`));
      const target = relationship?.match(/Target="([^"]+)"/)?.[1];

      if (target) {
        const path = target.replace(/^\/?(xl\/)?/, "xl/");
        if (files.has(path)) return path;
      }
    }
  }

  // No usable workbook part. Fall back to the lowest-numbered worksheet, which
  // is right far more often than it is wrong and beats refusing the file.
  const sheets = [...files.keys()]
    .filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"))
    .sort();
  return sheets[0] ?? null;
}

/** Read the first worksheet of a .xlsx into a grid of cell text. */
export function parseXlsx(bytes: Buffer): Grid {
  const files = readZip(bytes);
  const path = firstSheetPath(files);
  if (!path) throw new NotASpreadsheet("There is no worksheet in that file.");

  const sheet = files.get(path)?.toString("utf8");
  if (!sheet) throw new NotASpreadsheet("That worksheet could not be read.");

  return readSheet(sheet, readSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8")));
}

/**
 * Is this the old binary .xls?
 *
 * Worth its own answer. A 1997 .xls is a completely different format — an OLE2
 * compound document, not a ZIP — and everything above would report it as
 * damaged, which sends somebody looking for a corrupt file that is fine. Told
 * plainly what it is, they re-save it in ten seconds.
 */
export function isLegacyXls(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0xd0cf11e0 &&
    bytes.readUInt32BE(4) === 0xa1b11ae1
  );
}
