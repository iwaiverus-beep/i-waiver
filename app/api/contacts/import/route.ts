import { NextResponse } from "next/server";

import { jsonError, readJson, text } from "@/lib/http";
import { currentUser, userClient } from "@/lib/supabase/server";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { contactKey } from "@/lib/contacts/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/contacts/import — save the rows the person just approved.
 *
 * Takes contacts, not a file. Whatever they uploaded or pasted has already been
 * parsed, mapped and shown to them by the time this is called, so this route has
 * one job and no opinions about spreadsheets.
 *
 * On the caller's own client under RLS, like the rest of /api/contacts and for
 * the reason given at the top of that route: an address book is not evidence, and
 * the owner-scoped policy on the table is the whole of the authorisation.
 *
 * WHY IT REPORTS RATHER THAN REFUSES. A part-succeeded import is the normal
 * outcome — somebody's list always contains a few rows that are already saved.
 * Failing the whole request on the first duplicate would mean the only way to
 * import 200 contacts is to first find the three that clash, which is the work
 * the import was meant to remove. So every row is attempted and the answer says
 * what happened to each kind.
 */

/** Past any real address book, and a bound on what one request can do. */
const MAX_ROWS = 2000;

/** Small enough that one clash re-tries little, large enough to be one trip. */
const CHUNK = 100;

type Incoming = {
  display_name?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
};

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const body = await readJson<{ contacts?: unknown }>(request);
    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      throw new TransitionRefused("There is nobody to import.");
    }
    if (body.contacts.length > MAX_ROWS) {
      throw new TransitionRefused(
        `That is ${body.contacts.length} people in one go. Import up to ${MAX_ROWS} at a time.`,
      );
    }

    // Re-validated here, not trusted from the preview. The preview is a courtesy
    // to the person; this is the boundary. The same two rules the table itself
    // enforces — a name, and some way to reach them — applied before the insert
    // so a bad row is a sentence rather than a constraint violation.
    const rows: { display_name: string; email: string | null; phone: string | null; notes: string | null }[] = [];

    for (const raw of body.contacts as Incoming[]) {
      const display_name = text(raw?.display_name, 120);
      const email = text(raw?.email, 320)?.toLowerCase() ?? null;
      const phone = text(raw?.phone, 40);
      if (!display_name || (!email && !phone)) continue;
      rows.push({ display_name, email, phone, notes: text(raw?.notes, 500) });
    }

    if (rows.length === 0) {
      throw new TransitionRefused("None of those rows had a name and a way to reach them.");
    }

    const supabase = await userClient();

    // Duplicates are filtered before the insert rather than being left to the
    // unique index. Not for correctness — the index is still the thing that
    // decides — but because a bulk insert aborts entirely on one conflict, and
    // pre-filtering means the common case is one clean round trip per chunk
    // instead of a chunk that fails and re-runs a hundred times row by row.
    const { data: existing } = await supabase
      .from("contacts")
      .select("display_name, email, phone")
      .is("archived_at", null);

    // Keyed by `contactKey`, which falls back to name-plus-number for a contact
    // with no email. The unique index does not cover that case, so without this
    // a second run of the same import silently duplicated everybody who had only
    // a phone number — see the note on contactKey.
    const held = new Set(
      (existing ?? []).map((row) =>
        contactKey({
          display_name: (row.display_name as string) ?? "",
          email: (row.email as string) ?? null,
          phone: (row.phone as string) ?? null,
        }),
      ),
    );

    const fresh: typeof rows = [];
    let duplicates = 0;

    for (const row of rows) {
      const key = contactKey(row);
      if (held.has(key)) {
        duplicates += 1;
        continue;
      }
      held.add(key);
      fresh.push(row);
    }

    let imported = 0;
    let failed = 0;

    for (let start = 0; start < fresh.length; start += CHUNK) {
      const chunk = fresh.slice(start, start + CHUNK).map((row) => ({
        ...row,
        owner_user_id: user.id,
        // Neither typed nor checked by a human — see migration 47. It is what
        // tells the list, later, how much to trust an address before an
        // agreement is sent to it.
        source: "import",
      }));

      const { error, count } = await supabase
        .from("contacts")
        .insert(chunk, { count: "exact" });

      if (!error) {
        imported += count ?? chunk.length;
        continue;
      }

      // Something in this chunk clashed after all — two browser tabs, or a row
      // that collided on a constraint the pre-filter does not model. Retry the
      // chunk one row at a time so the other ninety-nine still land.
      for (const one of chunk) {
        const { error: single } = await supabase.from("contacts").insert(one);
        if (!single) imported += 1;
        else if (single.code === "23505") duplicates += 1;
        else failed += 1;
      }
    }

    return NextResponse.json({ imported, duplicates, failed }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
