import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { currentUser } from "@/lib/supabase/server";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { detectMapping, looksLikeHeader } from "@/lib/contacts/import";
import { dropEmptyRows, parseDelimited } from "@/lib/import/delimited";
import { isLegacyXls, NotASpreadsheet, parseXlsx } from "@/lib/import/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/contacts/import/parse — a file in, a grid out.
 *
 * READS NOTHING AND WRITES NOTHING. It turns bytes into rows and hands them
 * straight back for the person to look at; the import itself is a second,
 * separate request they make after seeing the preview. Splitting it that way is
 * the point of the whole feature — a spreadsheet from some other system is
 * never shaped like our table, and an importer that acts on its own guess about
 * which column is the phone number is an importer that sends an agreement to a
 * postcode.
 *
 * Pasted text does not come here. The browser parses that with the same
 * functions, so a preview appears as fast as somebody can hit paste and nothing
 * leaves their machine until they choose to import.
 *
 * Signed in, because everything downstream is scoped to an owner and there is no
 * reason to spend the box's CPU inflating a stranger's ZIP.
 */

/** A contact list is small. This is far past any real one and well short of a bomb. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      throw new TransitionRefused("Choose a file to import.");
    }
    if (file.size === 0) {
      throw new TransitionRefused("That file is empty.");
    }
    if (file.size > MAX_BYTES) {
      throw new TransitionRefused(
        "That file is over 4MB. A contact list should be a long way under that — if it is a whole database export, cut it down to the people you actually lend to first.",
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();

    if (isLegacyXls(bytes)) {
      throw new TransitionRefused(
        "That is the older .xls format, which we cannot read. Open it and use Save As to make a .xlsx or a CSV — it takes a moment and nothing is lost.",
      );
    }

    // The ZIP signature rather than the extension. A .xlsx renamed to .csv is
    // still a spreadsheet, and somebody who renamed it is precisely the person
    // who will not understand why it imported as one column of mojibake.
    const isZip = bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
    const grid = dropEmptyRows(
      isZip || name.endsWith(".xlsx") ? parseXlsx(bytes) : parseDelimited(decode(bytes)),
    );

    if (grid.length === 0) {
      throw new TransitionRefused("There are no rows in that file.");
    }

    const hasHeader = looksLikeHeader(grid[0]);

    return NextResponse.json({
      grid,
      hasHeader,
      mapping: detectMapping(grid, hasHeader),
    });
  } catch (error) {
    if (error instanceof NotASpreadsheet) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return jsonError(error);
  }
}

/**
 * Bytes to text, without assuming the world is UTF-8.
 *
 * It mostly is, and Excel's "CSV UTF-8" export is. But plain "CSV" from Excel on
 * Windows is code page 1252, and decoding that as UTF-8 turns every apostrophe
 * and accented letter into a replacement character — so an import of a list of
 * European names silently mangles half of them and there is nothing on screen to
 * say why.
 *
 * Detected rather than configured: decode as UTF-8, and if the result contains
 * replacement characters the input was not UTF-8, so decode again as
 * Windows-1252. A file that genuinely contains a U+FFFD is not a thing anybody
 * has ever exported.
 */
function decode(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;

  // Node's `latin1` is ISO-8859-1, which differs from Windows-1252 only in the
  // 0x80-0x9F range — where 1252 keeps the curly quotes, dashes and ellipsis that
  // Word and Excel put into text. Those are exactly the characters a contact list
  // picks up from having been pasted out of a document, so they are mapped
  // explicitly; a byte with no 1252 meaning is left as it decoded.
  return bytes
    .toString("latin1")
    .replace(/[\u0080-\u009f]/g, (char) => CP1252[char.charCodeAt(0) - 0x80] ?? char);
}

/** Windows-1252's additions to ISO-8859-1. `undefined` where 1252 defines nothing. */
const CP1252: (string | undefined)[] = [
  "€", undefined, "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "Š", "‹", "Œ", undefined, "Ž", undefined,
  undefined, "‘", "’", "“", "”", "•", "–", "—",
  "˜", "™", "š", "›", "œ", undefined, "ž", "Ÿ",
];
