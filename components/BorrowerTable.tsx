"use client";

import { ReportTable, type Column } from "./ReportTable";
import type { BorrowerRow } from "@/lib/platform/reports";

/**
 * The borrower report's columns, on the client side of the boundary.
 *
 * Same reason as LenderTable: `render`, `value` and `searchable` are functions,
 * `ReportTable` is a client component, and a function cannot be serialised across
 * the RSC boundary. Built in the page, they crashed it at request time with a
 * message that named no file — and `next build` stayed silent, because a
 * `force-dynamic` page is never rendered during a build.
 */
export function BorrowerTable({ rows }: { rows: BorrowerRow[] }) {
  const columns: Column<BorrowerRow>[] = [
    {
      key: "name",
      label: "Borrower",
      value: (r) => r.display_name ?? r.email,
      render: (r) => (
        <>
          <span className="block font-semibold text-ink">
            {r.display_name ?? "Unnamed"}
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">{r.email}</span>
        </>
      ),
    },
    {
      key: "phone",
      label: "Phone",
      secondary: true,
      value: (r) => r.phone,
      render: (r) => r.phone ?? <span className="text-ink-muted">—</span>,
    },
    {
      key: "borrower",
      label: "As borrower",
      align: "right",
      value: (r) => r.as_borrower,
      render: (r) => r.as_borrower,
    },
    {
      key: "participant",
      label: "As participant",
      align: "right",
      secondary: true,
      value: (r) => r.as_participant,
      render: (r) =>
        r.as_participant > 0 ? (
          r.as_participant
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "signed",
      label: "Signed",
      align: "right",
      value: (r) => r.signed,
      render: (r) => (
        <span className={r.signed > 0 ? "font-semibold text-ink" : "text-ink-muted"}>
          {r.signed}
        </span>
      ),
    },
    {
      key: "lenders",
      label: "Lenders",
      align: "right",
      secondary: true,
      value: (r) => r.lenders_used,
      render: (r) => r.lenders_used,
    },
    {
      key: "states",
      label: "States",
      secondary: true,
      value: (r) => (r.states ?? []).join(" "),
      render: (r) => (
        <span className="font-mono text-[11px] text-ink-soft">
          {(r.states ?? []).join(" ") || "—"}
        </span>
      ),
    },
    {
      key: "last",
      label: "Last signed",
      align: "right",
      value: (r) => r.last_signed_at,
      render: (r) =>
        r.last_signed_at ? (
          new Date(r.last_signed_at).toLocaleDateString()
        ) : (
          <span className="text-ink-muted">never</span>
        ),
    },
  ];

  return (
    <ReportTable
      rows={rows}
      columns={columns}
      initialSort={{ key: "last", ascending: false }}
      searchable={(r) => [
        r.display_name,
        r.email,
        r.phone,
        (r.states ?? []).join(" "),
      ]}
      exportHref="/api/admin/reports/borrowers"
      empty="No borrower matches that."
    />
  );
}
