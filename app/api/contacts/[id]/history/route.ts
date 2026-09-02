import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything this person has borrowed from you.
 *
 * MATCHED, NOT JOINED. There is no contact_id on `signers` and 20260831000009
 * says at length why there must never be one: a contact is an input to the form,
 * so the borrower's name and email are COPIED onto the agreement at creation. The
 * price of that is that "their history" cannot be a foreign key lookup — it has
 * to be worked out from what was copied.
 *
 * So it is done in two passes. The wide one runs in the database against
 * `agreement_list.search_text`, which is what the dashboard's own search uses, to
 * narrow a lender's whole history down to plausible rows without reading it all
 * into Node. The narrow one runs here, over the `signers` on those rows, and
 * keeps only the ones where a signer's EMAIL matches this contact's or their name
 * matches it exactly. That second pass is what stops "Bob" from returning every
 * agreement with a Bobby on it.
 *
 * Read as the signed-in user against a security_invoker view, so the
 * participation policies decide what comes back — this is a different shape for
 * what the caller could already see on their dashboard, not a new way to see
 * anything.
 */

const COLUMNS =
  "id, status, jurisdiction, activity_class, starts_at, ends_at, created_at, executed_at, archived_at, item_count, signers";

/** Enough to cover any real address book entry; a cap so a probe cannot page us. */
const CANDIDATE_LIMIT = 100;
const RETURN_LIMIT = 50;

type SignerRow = { display_name: string | null; email: string | null };
type CandidateRow = {
  id: string;
  status: string;
  jurisdiction: string;
  activity_class: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  executed_at: string | null;
  archived_at: string | null;
  item_count: number;
  signers: SignerRow[] | null;
};

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The same stripping the dashboard search does: somebody is a name, not a
 * pattern, and a stray `%` that matched everything would look like a bug.
 */
function tokens(value: string): string[] {
  return normalise(value)
    .split(" ")
    .map((token) => token.replace(/[%_,().*\\"']/g, ""))
    .filter(Boolean)
    .slice(0, 6);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const supabase = await userClient();

    // No owner filter — RLS scopes contacts to the caller, and a second check
    // here would imply the policy could not be trusted.
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, display_name, email")
      .eq("id", id)
      .maybeSingle();

    if (!contact) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const email = contact.email ? normalise(contact.email) : null;
    const name = normalise(contact.display_name ?? "");
    const nameTokens = tokens(contact.display_name ?? "");

    // Archived rows are included on purpose. Filing an agreement away is filing,
    // not deleting, and "have I lent to them before?" is exactly the question an
    // old one answers.
    const base = () =>
      supabase
        .from("agreement_list")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(CANDIDATE_LIMIT);

    const searches = [];
    if (email) searches.push(base().like("search_text", `%${email}%`));
    if (nameTokens.length > 0) {
      let byName = base();
      for (const token of nameTokens) {
        byName = byName.like("search_text", `%${token}%`);
      }
      searches.push(byName);
    }

    const results = await Promise.all(searches);
    for (const result of results) {
      if (result.error) throw new Error(result.error.message);
    }

    const candidates = new Map<string, CandidateRow>();
    for (const result of results) {
      for (const row of (result.data ?? []) as unknown as CandidateRow[]) {
        candidates.set(row.id, row);
      }
    }

    const agreements = [...candidates.values()]
      .filter((row) =>
        (row.signers ?? []).some((signer) => {
          if (email && signer.email && normalise(signer.email) === email) return true;
          return name.length > 0 && normalise(signer.display_name ?? "") === name;
        }),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, RETURN_LIMIT)
      .map(({ signers: _signers, ...row }) => row);

    return NextResponse.json({ agreements });
  } catch (error) {
    return jsonError(error);
  }
}
