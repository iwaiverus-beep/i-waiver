"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/app-ui";
import { formatDate } from "@/lib/format";
import {
  DEFAULT_PARAMS,
  listParamsToQuery,
  SHELF_LABELS,
  SORT_LABELS,
  STATUS_FILTER_LABELS,
  type AgreementListRow,
  type AgreementPage,
  type ListParams,
  type ListSignerRow,
  type Shelf,
  type SortKey,
  type StatusFilter,
} from "@/lib/agreements/list-types";

/**
 * The lender's agreement list: search, sort, filter, file away, page.
 *
 * The first page arrives rendered from the server, so a lender opening the
 * dashboard sees their agreements rather than a spinner and a fetch. Everything
 * after that — a search, a filter change, the next twenty-five — comes from
 * /api/agreements, which runs the same query with the same parameters. That is
 * why the shape is stated once in `list-types.ts` and imported by both ends: a
 * twenty-sixth row sorted differently from the twenty-fifth is a list that has
 * quietly stopped being a list.
 *
 * On filing: archiving hides a row here and nowhere else. Nothing on this screen
 * deletes anything, which is why the word on the button is "File away" and not
 * "Remove" — the second one would be a promise the product does not keep, in
 * either direction.
 */

const CONTROL =
  "rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none focus:border-accent";

type Counts = { active: number; drafts: number; awaiting: number; archived: number };

export function AgreementsList({
  initialPage,
  initialParams,
  initialCounts,
  viewerEmail,
  sweep,
}: {
  initialPage: AgreementPage;
  initialParams: ListParams;
  initialCounts: Counts;
  viewerEmail: string | null;
  /** How many finished agreements are old enough to file, and from when. */
  sweep: { count: number; before: string };
}) {
  const [params, setParams] = useState<ListParams>(initialParams);
  const [page, setPage] = useState(initialPage);
  const [counts, setCounts] = useState(initialCounts);
  const [sweepCount, setSweepCount] = useState(sweep.count);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A typed search is a request per keystroke unless something holds it back, and
  // the query it settles on is the only one whose answer matters.
  const [typed, setTyped] = useState(initialParams.query);
  useEffect(() => {
    if (typed === params.query) return;
    const timer = setTimeout(() => {
      setParams((current) => ({ ...current, query: typed, offset: 0 }));
    }, 250);
    return () => clearTimeout(timer);
  }, [typed, params.query]);

  // The server already rendered the first page for the parameters we started
  // with, so the first pass of the effect below would repeat that request for
  // nothing. It skips once.
  const rendered = useRef(true);

  // Typing "mar" then "marcus" is two requests, and they do not necessarily come
  // back in that order. Only the newest one is allowed to write to the screen —
  // otherwise the list settles on the results for a word the reader has already
  // finished typing.
  const latest = useRef(0);

  const load = useCallback(async (next: ListParams) => {
    const ticket = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/agreements?${listParamsToQuery({ ...next, offset: 0 })}`,
      );
      if (!response.ok) throw new Error("list request failed");
      const body = (await response.json()) as AgreementPage;
      if (ticket === latest.current) setPage(body);
    } catch {
      if (ticket === latest.current) {
        setError("Could not load your agreements. Check your connection and try again.");
      }
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (rendered.current) {
      rendered.current = false;
      return;
    }

    // Kept on the URL so a refresh, a back button or a shared link lands on the
    // same list. replaceState rather than the router, because this is the same
    // page in a different state and re-running the server render to say so would
    // fetch everything twice.
    const query = listParamsToQuery(params);
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);

    void load(params);
  }, [params, load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || busy || !page.hasMore) return;
    const ticket = latest.current;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/agreements?${listParamsToQuery({ ...params, offset: page.nextOffset })}`,
      );
      if (!response.ok) throw new Error("page request failed");
      const next = (await response.json()) as AgreementPage;
      // A filter changed while this was in the air: page 2 of the old list has
      // nothing to do with page 1 of the new one.
      if (ticket !== latest.current) return;
      setPage((current) => ({
        ...next,
        // Appended rather than replaced, and de-duplicated: a row archived in
        // another tab shifts the offsets under us, and a repeated id would be a
        // React key collision rather than a cosmetic problem.
        rows: dedupe([...current.rows, ...next.rows]),
      }));
    } catch {
      setError("Could not load any more. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }, [busy, loadingMore, page.hasMore, page.nextOffset, params]);

  // Scrolling to the end asks for the next twenty-five. The button below stays
  // regardless: an observer that never fires — reduced motion, a tall window, a
  // browser that does not have one — must not be the only way down the list.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !page.hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, page.hasMore]);

  function update(patch: Partial<ListParams>) {
    setParams((current) => ({ ...current, ...patch, offset: 0 }));
  }

  async function setArchived(row: AgreementListRow, archived: boolean) {
    const response = await fetch(`/api/agreements/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not file that away.");
      return;
    }

    const stamp = archived ? new Date().toISOString() : null;
    setCounts((current) => ({
      ...current,
      active: current.active + (archived ? -1 : 1),
      archived: current.archived + (archived ? 1 : -1),
    }));

    // On "Everything" the row stays put and changes its label. On either of the
    // other two shelves it no longer belongs where it is, so it leaves.
    setPage((current) => {
      const belongs = params.shelf === "all";
      return {
        ...current,
        total: belongs ? current.total : Math.max(0, current.total - 1),
        rows: belongs
          ? current.rows.map((r) => (r.id === row.id ? { ...r, archived_at: stamp } : r))
          : current.rows.filter((r) => r.id !== row.id),
      };
    });
  }

  async function fileFinished() {
    const asked = window.confirm(
      `File away ${sweepCount} ${sweepCount === 1 ? "agreement" : "agreements"} whose loan ended before ${formatDate(sweep.before)}?\n\n` +
        "They stay in your records and you can find them under Archived. Nothing is deleted.",
    );
    if (!asked) return;

    setBusy(true);
    try {
      const response = await fetch("/api/agreements/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: sweep.before }),
      });
      if (!response.ok) throw new Error("sweep failed");
      const { archived } = (await response.json()) as { archived: number };
      setSweepCount(0);
      setCounts((current) => ({
        ...current,
        active: Math.max(0, current.active - archived),
        archived: current.archived + archived,
      }));
      await load(params);
    } catch {
      setError("Could not file those away. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const filtered =
    params.query !== "" ||
    params.status !== DEFAULT_PARAMS.status ||
    params.shelf !== DEFAULT_PARAMS.shelf;

  return (
    <div>
      <p className="mt-2 text-sm text-ink-soft">
        {counts.active === 0 && counts.archived === 0
          ? "Nothing here yet."
          : `${counts.active} on your list · ${counts.drafts} draft · ${counts.awaiting} waiting on a signature`}
        {counts.archived > 0 && ` · ${counts.archived} archived`}
      </p>

      {/* --- The controls ------------------------------------------------- */}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          type="search"
          placeholder="Search by name, email or item"
          aria-label="Search your agreements"
          className={`${CONTROL} min-w-[14rem] flex-1 rounded-full`}
        />

        <label className="sr-only" htmlFor="agreement-status">
          Filter by state
        </label>
        <select
          id="agreement-status"
          value={params.status}
          onChange={(event) => update({ status: event.target.value as StatusFilter })}
          className={CONTROL}
        >
          {Object.entries(STATUS_FILTER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="agreement-sort">
          Sort
        </label>
        <select
          id="agreement-sort"
          value={params.sort}
          onChange={(event) => update({ sort: event.target.value as SortKey })}
          className={CONTROL}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* The shelf. Chips rather than a fourth dropdown, because "where are my
          old ones?" is the question this screen is asked most and the answer
          should be visible rather than found. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(Object.keys(SHELF_LABELS) as Shelf[]).map((shelf) => {
          const active = params.shelf === shelf;
          const badge =
            shelf === "active"
              ? counts.active
              : shelf === "archived"
                ? counts.archived
                : counts.active + counts.archived;
          return (
            <button
              key={shelf}
              type="button"
              onClick={() => update({ shelf })}
              aria-pressed={active}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-surface hover:text-ink"
              }`}
            >
              {SHELF_LABELS[shelf]}{" "}
              <span className={active ? "text-paper/60" : "text-ink-muted"}>{badge}</span>
            </button>
          );
        })}
      </div>

      {/* --- The tidy-up -------------------------------------------------- */}

      {params.shelf === "active" && sweepCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
          <p className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">
              {sweepCount} {sweepCount === 1 ? "agreement has" : "agreements have"} run
              their course.
            </span>{" "}
            Loans that ended before {formatDate(sweep.before)}. Filing them away
            clears your list without touching the records.
          </p>
          <button
            type="button"
            onClick={fileFinished}
            disabled={busy}
            className="shrink-0 rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
          >
            File them away
          </button>
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4 text-sm text-flag">
          {error}
        </p>
      )}

      {/* --- The list ----------------------------------------------------- */}

      <div className="mt-6 space-y-3" aria-busy={busy}>
        {page.rows.length === 0 && !busy && (
          <div className="rounded-2xl border border-line bg-paper px-6 py-12 text-center">
            <p className="text-sm text-ink-muted">
              {filtered
                ? "Nothing matches that."
                : params.shelf === "archived"
                  ? "Nothing has been filed away yet."
                  : "Start by describing what you are lending, to whom, and for how long."}
            </p>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setTyped("");
                  setParams({ ...DEFAULT_PARAMS, sort: params.sort });
                }}
                className="mt-3 text-sm font-semibold text-accent hover:underline"
              >
                Clear the filters
              </button>
            )}
          </div>
        )}

        {page.rows.map((row) => (
          <AgreementRow
            key={row.id}
            row={row}
            viewerEmail={viewerEmail}
            onArchive={() => setArchived(row, row.archived_at === null)}
          />
        ))}
      </div>

      <div ref={sentinel} aria-hidden />

      {page.hasMore && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full border border-ink/20 px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
          >
            {loadingMore
              ? "Loading…"
              : `Show more (${page.total - page.rows.length} to go)`}
          </button>
        </div>
      )}
    </div>
  );
}

function AgreementRow({
  row,
  viewerEmail,
  onArchive,
}: {
  row: AgreementListRow;
  viewerEmail: string | null;
  onArchive: () => void;
}) {
  const signers = row.signers ?? [];
  const outstanding = signers.filter((signer) => !signer.signed_at);
  const archived = row.archived_at !== null;

  return (
    // The whole card is the link, and the filing button sits above it. A button
    // inside an anchor is not valid markup and behaves differently in every
    // browser, so the anchor covers the card from underneath instead.
    <div className="relative rounded-2xl border border-line bg-paper px-6 py-5 transition-colors hover:border-ink/25">
      <Link
        href={`/agreements/${row.id}`}
        className="absolute inset-0 z-10 rounded-2xl"
        aria-label={`Open the agreement with ${row.borrower_name ?? "no borrower yet"}`}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">
            {row.borrower_name ?? "No borrower yet"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {row.item_count > 1
              ? `${row.item_count} items`
              : row.activity_class.replace(/_/g, " ")}{" "}
            in {row.jurisdiction} · {formatDate(row.starts_at)} to{" "}
            {formatDate(row.ends_at)}
          </p>
          {outstanding.length > 0 && row.status !== "draft" && (
            <p className="mt-1.5 text-xs text-ink-muted">
              Waiting on {waitingOn(outstanding, signers, viewerEmail)}
            </p>
          )}
        </div>

        <div className="relative z-20 flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={row.status} />
          {row.legal_hold_at ? (
            <span className="text-xs font-semibold text-flag">Legal hold</span>
          ) : (
            <button
              type="button"
              onClick={onArchive}
              className="text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              {archived ? "Put back on the list" : "File away"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Names who is still to sign.
 *
 * Two things it has to get right. The signed-in lender is "you", not their own
 * name read back to them, because "waiting on John McElroy" is not an instruction
 * to John McElroy. And where two signers share a display name — which happens
 * whenever somebody lends to a relative, or tests their own product — the bare
 * name says nothing, so the role comes with it.
 */
function waitingOn(
  outstanding: ListSignerRow[],
  all: ListSignerRow[],
  viewerEmail: string | null,
) {
  return outstanding
    .map((signer) => {
      const isViewer =
        viewerEmail &&
        signer.email &&
        signer.email.toLowerCase() === viewerEmail.toLowerCase();
      if (isViewer) return "you";

      const nameIsAmbiguous = all.some(
        (other) => other !== signer && other.display_name === signer.display_name,
      );
      return nameIsAmbiguous
        ? `${signer.display_name} (the ${signer.role})`
        : signer.display_name;
    })
    .join(" and ");
}

/** Last one wins, order preserved. */
function dedupe(rows: AgreementListRow[]): AgreementListRow[] {
  const byId = new Map<string, AgreementListRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}
