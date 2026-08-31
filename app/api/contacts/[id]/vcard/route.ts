import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saving a contact back to the phone's address book.
 *
 * There is no web API for writing to a device's contacts, and there is unlikely
 * ever to be one — it would be a gift to every advertising script on the web. A
 * vCard is the way this has always worked: the browser downloads it, the OS
 * recognises the type, and iOS and Android both open their own "Add Contact"
 * sheet. The user confirms. Nothing is written behind their back.
 *
 * That also makes it the one half of this feature that works everywhere. Reading
 * contacts (navigator.contacts) is Chrome-on-Android only; writing one out like
 * this works on every phone either of us will ever hand this to.
 */

/** RFC 6350 escaping: commas, semicolons and backslashes are structural. */
function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

/** Lines over 75 octets must be folded, or strict parsers reject the card. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await params;
  const supabase = await userClient();

  const { data: contact } = await supabase
    .from("contacts")
    .select("display_name, email, phone, notes")
    .eq("id", id)
    .maybeSingle();

  if (!contact) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const name = contact.display_name ?? "Contact";
  // vCard wants family;given;... — we only ever hold one display name, so it goes
  // in the given-name slot rather than being guessed apart at the space.
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    fold(`FN:${escapeValue(name)}`),
    fold(`N:;${escapeValue(name)};;;`),
    contact.email ? fold(`EMAIL;TYPE=INTERNET:${escapeValue(contact.email)}`) : null,
    contact.phone ? fold(`TEL;TYPE=CELL:${escapeValue(contact.phone)}`) : null,
    contact.notes ? fold(`NOTE:${escapeValue(contact.notes)}`) : null,
    "END:VCARD",
  ].filter(Boolean);

  // CRLF is required by the spec, and Android's importer is strict about it.
  const body = `${lines.join("\r\n")}\r\n`;
  const filename = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "contact";

  return new NextResponse(body, {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.vcf"`,
      "cache-control": "no-store",
    },
  });
}
