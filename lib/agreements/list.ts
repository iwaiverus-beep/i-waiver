import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PAGE_SIZE,
  SORTS,
  STATUS_FILTERS,
  type AgreementListRow,
  type AgreementPage,
  type ListParams,
} from "@/lib/agreements/list-types";

/**
 * Reading the lender's agreement list: search, sort, filter, page.
 *
 * Everything here runs against the `agreement_list` view (20260901000024) as the
 * SIGNED-IN USER, not as the service role. That is the choice the dashboard has
 * always made for this read and it is worth keeping: the view is
 * `security_invoker`, so `agreements_select_participant` decides what comes back,
 * and a lender who could not see a row through the table cannot see it through
 * the view. Nothing on this path needs the service client, so nothing on it gets
 * one.
 *
 * Writes are the other way round — archiving goes through a route handler on the
 * service client, per constraint 2. See `lib/agreements/archive.ts`.
 */

const COLUMNS =
  "id, status, jurisdiction, activity_class, starts_at, ends_at, created_at, sent_at, executed_at, voided_at, archived_at, legal_hold_at, last_activity_at, signers, borrower_name, item_count";

/**
 * What a typed search actually looks for.
 *
 * Split into words, and all of them have to match: "marcus ski" means the one
 * where both are true, not every agreement mentioning either. LIKE wildcards and
 * the characters PostgREST reads as filter syntax are stripped rather than
 * escaped — somebody is typing a name, not a pattern, and a stray `%` that
 * matched everything would look like search being broken.
 */
function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[%_,().*\\"']/g, ""))
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * One page of the list. `db` must be the user client — see the note above.
 *
 * `limit` is the page size, and the home screen is the only caller that changes
 * it: it shows the five most recent and says how many more there are, which is
 * the same query with a shorter `range`.
 */
export async function fetchAgreementPage(
  db: SupabaseClient,
  params: ListParams,
  limit: number = PAGE_SIZE,
): Promise<AgreementPage> {
  let query = db.from("agreement_list").select(COLUMNS, { count: "exact" });

  if (params.shelf === "active") query = query.is("archived_at", null);
  if (params.shelf === "archived") query = query.not("archived_at", "is", null);

  const statuses = STATUS_FILTERS[params.status];
  if (statuses) query = query.in("status", [...statuses]);

  for (const token of searchTokens(params.query)) {
    // `search_text` is lowercased by the view, so `like` is enough and does not
    // pay for the case folding an `ilike` would do on every row.
    query = query.like("search_text", `%${token}%`);
  }

  const sort = SORTS[params.sort];
  const { data, count, error } = await query
    .order(sort.column, { ascending: sort.ascending })
    // Ties are common — a shop setting up a morning's bookings in one go shares a
    // second. Without a second key those rows swap places between requests, and
    // the same agreement turns up on two pages while another turns up on none.
    .order("id", { ascending: true })
    .range(params.offset, params.offset + limit - 1);

  if (error) throw new Error(`Could not read the agreement list: ${error.message}`);

  const rows = (data ?? []) as unknown as AgreementListRow[];
  const total = count ?? rows.length;
  const nextOffset = params.offset + rows.length;

  return { rows, total, hasMore: nextOffset < total, nextOffset };
}

/**
 * The agreements this reader is personally holding up.
 *
 * A separate read rather than a filter over the page above, because the two ask
 * different questions. The list is "what has happened lately"; this is "what is
 * stuck on me", and an agreement sent three weeks ago and never signed is the
 * likeliest thing in the product to be both forgotten and blocking. Filtering
 * the recent five would have quietly hidden exactly that one.
 *
 * Matched on the signed-in address against the signer rows, not on being the
 * lender: what makes it urgent is that the signature nobody else can supply is
 * missing, and the row that says so is the signer's own.
 *
 * Capped, because it feeds a dialog. Somebody with more than a dozen unsigned
 * agreements has a housekeeping problem the home screen cannot solve in a modal,
 * and the dashboard counts them all.
 */
export async function fetchAwaitingMySignature(
  db: SupabaseClient,
  viewerEmail: string | null,
  limit = 12,
): Promise<AgreementListRow[]> {
  if (!viewerEmail) return [];
  const mine = viewerEmail.toLowerCase();

  const { data, error } = await db
    .from("agreement_list")
    .select(COLUMNS)
    .is("archived_at", null)
    .in("status", ["sent", "partially_signed"])
    .order("last_activity_at", { ascending: false })
    .limit(limit);

  // Silence rather than a broken home screen: this is a nudge on top of a page
  // that is complete without it.
  if (error) return [];

  return ((data ?? []) as unknown as AgreementListRow[]).filter((row) =>
    (row.signers ?? []).some(
      (signer) => !signer.signed_at && signer.email?.toLowerCase() === mine,
    ),
  );
}

export type ListSummary = {
  /** Everything on the working list, archived rows excluded. */
  active: number;
  drafts: number;
  awaiting: number;
  archived: number;
};

/**
 * The counts in the line under the heading.
 *
 * Deliberately about the whole working list rather than the current filter: they
 * are what tells a lender there is something to go and look at, so they have to
 * mean the same thing whichever filter happens to be on. Four head requests,
 * which return a count and no rows.
 */
export async function fetchListSummary(db: SupabaseClient): Promise<ListSummary> {
  const counted = () =>
    db.from("agreement_list").select("id", { count: "exact", head: true });

  const [active, drafts, awaiting, archived] = await Promise.all([
    counted().is("archived_at", null),
    counted().is("archived_at", null).eq("status", "draft"),
    counted().is("archived_at", null).in("status", ["sent", "partially_signed"]),
    counted().not("archived_at", "is", null),
  ]);

  return {
    active: active.count ?? 0,
    drafts: drafts.count ?? 0,
    awaiting: awaiting.count ?? 0,
    archived: archived.count ?? 0,
  };
}
