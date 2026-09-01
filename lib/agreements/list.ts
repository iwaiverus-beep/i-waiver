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

/** One page of the list. `db` must be the user client — see the note above. */
export async function fetchAgreementPage(
  db: SupabaseClient,
  params: ListParams,
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
    .range(params.offset, params.offset + PAGE_SIZE - 1);

  if (error) throw new Error(`Could not read the agreement list: ${error.message}`);

  const rows = (data ?? []) as unknown as AgreementListRow[];
  const total = count ?? rows.length;
  const nextOffset = params.offset + rows.length;

  return { rows, total, hasMore: nextOffset < total, nextOffset };
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
