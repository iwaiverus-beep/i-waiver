"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * The lender and borrower reports on screen.
 *
 * Filtering and sorting happen in the browser, on rows the server already sent.
 * That is a deliberate ceiling, not an oversight: at the scale where a round trip
 * per keystroke would be worth building, the rows should not all be on the page
 * either, and both problems get solved together rather than one of them twice.
 * The row count is shown so the ceiling is visible rather than assumed.
 *
 * The export is a plain link to the CSV route, not a button that assembles a file
 * here — the server has the whole report, this component has a page of it, and a
 * download that quietly exports only what is on screen is the kind of wrong that
 * nobody catches.
 */

export type Column<T> = {
  key: string;
  label: string;
  /** What to draw. */
  render: (row: T) => ReactNode;
  /** What to sort and search on. Numbers sort as numbers. */
  value?: (row: T) => string | number | null;
  align?: "right";
  /** Hidden below `sm`. For the columns that are context rather than the answer. */
  secondary?: boolean;
};

export function ReportTable<T>({
  rows,
  columns,
  searchable,
  initialSort,
  exportHref,
  exportLabel = "Download CSV",
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  /** Fields the search box looks in. */
  searchable: (row: T) => (string | null)[];
  initialSort?: { key: string; ascending: boolean };
  exportHref?: string;
  exportLabel?: string;
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(initialSort ?? { key: columns[0].key, ascending: true });

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) =>
          searchable(row).some((field) => field?.toLowerCase().includes(needle)),
        )
      : rows;

    const column = columns.find((c) => c.key === sort.key);
    if (!column?.value) return filtered;

    const read = column.value;
    return [...filtered].sort((a, b) => {
      const left = read(a);
      const right = read(b);
      // Nulls last whichever way the column is pointing. A row with no last
      // agreement is not the most recent one.
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return sort.ascending ? order : -order;
    });
  }, [rows, columns, query, sort, searchable]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="min-w-[14rem] flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
        />
        <div className="flex items-center gap-4 text-xs text-ink-muted">
          <span>
            {visible.length === rows.length
              ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}`
              : `${visible.length} of ${rows.length}`}
          </span>
          {exportHref && (
            <a
              href={exportHref}
              className="rounded-full border border-line px-4 py-1.5 font-semibold text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
            >
              {exportLabel}
            </a>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>
      ) : (
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-muted ${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${column.secondary ? "hidden sm:table-cell" : ""}`}
                  >
                    {column.value ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) =>
                            s.key === column.key
                              ? { key: column.key, ascending: !s.ascending }
                              : { key: column.key, ascending: true },
                          )
                        }
                        className="transition-colors hover:text-ink"
                      >
                        {column.label}
                        {sort.key === column.key && (sort.ascending ? " ↑" : " ↓")}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={index} className="border-b border-line/50 last:border-0">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`py-3 align-top ${
                        column.align === "right" ? "text-right tabular-nums" : "text-left"
                      } ${column.secondary ? "hidden sm:table-cell" : ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
