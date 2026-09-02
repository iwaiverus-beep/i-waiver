import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Panel, Stat } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { ReportTable, type Column } from "@/components/ReportTable";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { agreementStats, listLenders, type LenderRow } from "@/lib/platform/reports";

export const metadata: Metadata = { title: "Lenders" };
export const dynamic = "force-dynamic";

/**
 * Every lender on the platform.
 *
 * A LENDER IS AN ORIGINATOR, not a profile. One row per party that creates
 * agreements — an individual or an organization, never both. Listing profiles
 * instead would count somebody who is also on a company's staff twice, and the
 * total at the top would disagree with the dashboard for a reason nobody could
 * find.
 *
 * `reports.read` rather than `console.read`. Seeing the console and taking a copy
 * of everyone's contact details off the platform are different acts; the
 * capability comment in lib/platform/roles.ts says why.
 */
export default async function LendersPage() {
  const staff = await currentStaff();
  if (!staff) notFound();
  if (!staffCan(staff.role, "reports.read")) notFound();

  const [rows, stats] = await Promise.all([
    listLenders(staff.db),
    agreementStats(staff.db),
  ]);

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
            <span className="mt-0.5 block text-xs text-ink-muted">{r.contact_phone}</span>
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
        <span className={r.agreements_executed > 0 ? "font-semibold text-ink" : "text-ink-muted"}>
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

  const dormant = rows.filter((r) => r.agreements_total === 0).length;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Lenders</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Everyone who creates agreements — a person or a business, and (once a
        platform is integrated) their customers too. One row each, however many
        accounts they hold.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lenders" value={stats.lenders} />
        <Stat
          label="Businesses"
          value={stats.lenders_organization}
          hint={`${stats.lenders_individual} individuals`}
        />
        <Stat
          label="Partner-managed"
          value={stats.lenders_partner_managed}
          hint="Accounts a platform administers over the API."
        />
        <Stat
          label="Never used it"
          value={dormant}
          hint="Signed up, no agreement yet."
        />
      </div>

      <div className="mt-8">
        <Panel title="Everyone" description="Search on a name, an email or a state.">
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
        </Panel>
      </div>
    </Container>
  );
}
