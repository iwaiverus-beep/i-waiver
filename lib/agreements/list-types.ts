/**
 * The shape of the agreement list, and the vocabulary both ends use to ask for it.
 *
 * Separate from `list.ts` because the browser needs this half. That file is
 * `server-only` — it holds the query and must never be bundled — while the filter
 * names, the sort names and the page size have to be identical on the screen and
 * in the route handler. Two copies of "twenty-five" is two things to change.
 */

export type ListSignerRow = {
  role: string;
  display_name: string;
  email: string | null;
  signed_at: string | null;
};

export type AgreementListRow = {
  id: string;
  status: string;
  jurisdiction: string;
  activity_class: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  sent_at: string | null;
  executed_at: string | null;
  voided_at: string | null;
  archived_at: string | null;
  legal_hold_at: string | null;
  last_activity_at: string;
  signers: ListSignerRow[];
  borrower_name: string | null;
  item_count: number;
};

export type AgreementPage = {
  rows: AgreementListRow[];
  /** Rows matching the filters, not rows returned. */
  total: number;
  hasMore: boolean;
  nextOffset: number;
};

/**
 * Twenty-five rows a page.
 *
 * Small enough that the first screen is fast on a phone at a boat ramp, large
 * enough that a lender with forty agreements never pages at all.
 */
export const PAGE_SIZE = 25;

/**
 * Which shelf. `active` is the day-to-day list and the default everywhere.
 *
 * Archiving is filing, not deleting, so `all` exists: somebody searching for a
 * name two summers old should not have to guess which shelf it is on.
 */
export type Shelf = "active" | "archived" | "all";

export const SHELF_LABELS: Record<Shelf, string> = {
  active: "Current",
  archived: "Archived",
  all: "Everything",
};

/**
 * Status filters in the lender's words, not the enum's.
 *
 * Grouped rather than one per status, because the questions people actually ask
 * are "what needs signing?" and "what is done?" — `sent` and `partially_signed`
 * are the same answer to the first.
 */
export const STATUS_FILTERS = {
  all: null,
  draft: ["draft"],
  awaiting: ["sent", "partially_signed"],
  executed: ["executed"],
  closed: ["expired", "voided"],
} as const;

export type StatusFilter = keyof typeof STATUS_FILTERS;

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Any state",
  draft: "Drafts",
  awaiting: "Waiting for signatures",
  executed: "Signed by everyone",
  closed: "Expired or voided",
};

export const SORTS = {
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  activity: { column: "last_activity_at", ascending: false },
  window: { column: "starts_at", ascending: false },
} as const;

export type SortKey = keyof typeof SORTS;

export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  activity: "Recently updated",
  window: "Loan date",
};

export type ListParams = {
  query: string;
  status: StatusFilter;
  shelf: Shelf;
  sort: SortKey;
  offset: number;
};

export const DEFAULT_PARAMS: ListParams = {
  query: "",
  status: "all",
  shelf: "active",
  sort: "newest",
  offset: 0,
};

/** Reads whatever arrived on the URL, and trusts none of it. */
export function parseListParams(source: URLSearchParams): ListParams {
  const status = source.get("status") ?? "";
  const shelf = source.get("shelf") ?? "";
  const sort = source.get("sort") ?? "";
  const offset = Number(source.get("offset"));

  return {
    query: (source.get("q") ?? "").slice(0, 120),
    status: status in STATUS_FILTERS ? (status as StatusFilter) : "all",
    shelf:
      shelf === "archived" || shelf === "all" ? shelf : "active",
    sort: sort in SORTS ? (sort as SortKey) : "newest",
    // An offset past any plausible history is a bug or a probe, not a page
    // somebody scrolled to. Capped rather than refused: the answer is an empty
    // page, which is what it would have been anyway.
    offset: Number.isFinite(offset)
      ? Math.min(Math.max(0, Math.trunc(offset)), 100_000)
      : 0,
  };
}

/** The same parameters going the other way, for a fetch from the browser. */
export function listParamsToQuery(params: ListParams): string {
  const search = new URLSearchParams();
  if (params.query) search.set("q", params.query);
  if (params.status !== "all") search.set("status", params.status);
  if (params.shelf !== "active") search.set("shelf", params.shelf);
  if (params.sort !== "newest") search.set("sort", params.sort);
  if (params.offset) search.set("offset", String(params.offset));
  return search.toString();
}
