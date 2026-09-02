"use client";

import { ReportTable, type Column } from "./ReportTable";
import type { LenderRow } from "@/lib/platform/reports";

/**
 * The lender report's columns, on the client side of the boundary.
 *
 * WHY THIS FILE EXISTS. A `Column` carries `render` and `value` — functions —
 * and `ReportTable` is a client component. Building the array in the page, which
 * is a server component, meant handing React a function to serialise across the
 * RSC boundary, which it cannot do: the page died at request time with
 * "Application error: a server-side exception has occurred" and nothing in
 * `next build` caught it, because /admin pages are `force-dynamic` and are never
 * rendered during a build.
 *
 * So the page fetches rows and passes data; everything that is a function lives
 * here. That is the rule the boundary actually imposes, and the same reason
 * `charts.tsx` takes a format NAME rather than a formatter.
 */
export function LenderTable({ rows }: { rows: LenderRow[] }) {
  const columns: Column<LenderRow>[] = [
    {
      key: "name",
      label: "Lender",
      value: (r) => r.display_name,
      render: (r) => (
        <>
          <span className="block font-semibold text-ink">{r.display_name}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            {r.lender_kind === "organization" ? "Business" : "Individual"}
            {r.trading_name ? ` · trading as ${r.trading_name}` : ""}
            {r.home_state ? ` · ${r.home_state}` : ""}
            {r.channel === "partner"
              ? ` · via ${r.managed_by_partner_name ?? "a partner"}`
              : ""}
          </span>
        </>
      ),
    },
    {
      key: "contact",
      label: "Contact",
      value: (r) => r.contact_email,
      secondary: true,
      render: (r) => (
        <span className="text-ink-soft">
          {r.contact_email ?? <span className="text-ink-muted">—</span>}
          {r.contact_phone && (
            <span className="mt-0.5 block text-xs text-ink-muted">
              {r.contact_phone}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "agreements",
      label: "Agreements",
      align: "right",
      value: (r) => r.agreements_total,
      render: (r) => r.agreements_total,
    },
    {
      key: "executed",
      label: "Signed",
      align: "right",
      value: (r) => r.agreements_executed,
      render: (r) => (
        <span
          className={
            r.agreements_executed > 0 ? "font-semibold text-ink" : "text-ink-muted"
          }
        >
          {r.agreements_executed}
        </span>
      ),
    },
    {
      key: "open",
      label: "Out",
      align: "right",
      secondary: true,
      value: (r) => r.agreements_open,
      render: (r) => r.agreements_open,
    },
    {
      key: "borrowers",
      label: "Borrowers",
      align: "right",
      secondary: true,
      value: (r) => r.distinct_borrowers,
      render: (r) => r.distinct_borrowers,
    },
    {
      key: "last",
      label: "Last agreement",
      align: "right",
      // Sorted on the raw timestamp, shown as a date. Sorting on the rendered
      // string would order 1 April before 1 March.
      value: (r) => r.last_agreement_at,
      render: (r) =>
        r.last_agreement_at ? (
          new Date(r.last_agreement_at).toLocaleDateString()
        ) : (
          <span className="text-ink-muted">never</span>
        ),
    },
    {
      key: "joined",
      label: "Joined",
      align: "right",
      secondary: true,
      value: (r) => r.created_at,
      render: (r) => new Date(r.created_at).toLocaleDateString(),
    },
  ];

  return (
    <ReportTable
      rows={rows}
      columns={columns}
      initialSort={{ key: "last", ascending: false }}
      searchable={(r) => [
        r.display_name,
        r.trading_name,
        r.contact_email,
        r.home_state,
        r.managed_by_partner_name,
        r.partner_external_ref,
      ]}
      exportHref="/api/admin/reports/lenders"
      empty="No lender matches that."
    />
  );
}
