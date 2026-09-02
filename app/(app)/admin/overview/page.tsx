import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { PageIntro } from "@/components/PageIntro";
import { Empty, Note, Panel, Stat } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { agreementStats } from "@/lib/platform/reports";
import {
  attachRate,
  coverageByProduct,
  coverageStats,
  money,
} from "@/lib/coverage/reporting";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/**
 * The platform, in numbers.
 *
 * SEPARATE FROM /admin, WHICH STAYS THE QUEUES. The two screens answer different
 * questions and the queues answer the more urgent one — what is waiting on a
 * decision this morning. Replacing that list with a wall of counts would trade a
 * screen somebody acts on for a screen somebody looks at.
 *
 * BOTH HALVES ARE READ INDEPENDENTLY. The agreement figures come from
 * lib/platform/reports.ts and the insurance figures from lib/coverage/reporting.ts;
 * neither module imports the other and no view underneath them joins across
 * (CLAUDE.md constraint 9). Putting the two sets of numbers on one page is a
 * person reading two reports side by side. That was always allowed. A single
 * query answering "executed agreements that also bought cover" would not be.
 *
 * EVERY INSURANCE FIGURE IS LIVE ONLY. Sandbox quotes are filtered out in SQL and
 * surfaced separately, because counting a partner's test traffic as business
 * would make this screen confidently wrong in the direction everybody wants to
 * believe.
 */
export default async function OverviewPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const [agreements, coverage, products] = await Promise.all([
    agreementStats(staff.db),
    coverageStats(staff.db),
    coverageByProduct(staff.db),
  ]);

  const canSeeReports = staffCan(staff.role, "reports.read");
  const attach = attachRate(coverage);
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <PageIntro title="Overview" defaultOpen>
        Everything on this page is the live platform. Sandbox traffic is counted
        separately and never folded in.
      </PageIntro>

      {/* ------------------------------------------------------------------ */}

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Who is here
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Lenders"
          value={agreements.lenders}
          hint={`${agreements.lenders_individual} individual · ${agreements.lenders_organization} business${
            agreements.lenders_partner_managed > 0
              ? ` · ${agreements.lenders_partner_managed} partner-managed`
              : ""
          }`}
        />
        <Stat
          label="Borrowers"
          value={agreements.borrowers}
          hint={
            <>
              {agreements.borrowers_signed} have signed at least once. Counted by
              email address — a borrower need never hold an account.
            </>
          }
        />
        <Stat
          label="Agreements signed"
          value={agreements.agreements_executed}
          tone="accent"
          hint={`of ${agreements.agreements} created · ${agreements.executed_30d} signed in the last 30 days`}
        />
        <Stat
          label="Out for signature"
          value={agreements.agreements_out}
          hint={`${agreements.agreements_draft} still in draft`}
        />
      </div>

      {/* ------------------------------------------------------------------ */}

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Insurance
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Quotes given"
          value={coverage.quotes}
          hint={
            <>
              {money(coverage.quoted_premium_cents)} of premium offered
              {coverage.quotes_partner > 0
                ? ` · ${coverage.quotes_partner} through a partner`
                : ""}
            </>
          }
        />
        <Stat
          label="Policies bought"
          value={coverage.policies}
          tone="accent"
          hint={`${coverage.policies_bound} bound · ${coverage.policies_active} active${
            coverage.policies_cancelled > 0
              ? ` · ${coverage.policies_cancelled} cancelled`
              : ""
          }`}
        />
        <Stat
          label="Take-up"
          value={attach === null ? "—" : percent(attach)}
          hint={
            attach === null
              ? "Nothing has been quoted yet."
              : "Policies as a share of quotes. Measured per quote, not per agreement — both parties may buy."
          }
        />
        <Stat
          label="Premium bound"
          value={money(coverage.bound_premium_cents)}
          hint={
            coverage.payments_paid > 0
              ? `${money(coverage.collected_premium_cents)} collected · ${money(
                  coverage.collected_fee_cents,
                )} platform fee`
              : "Nothing collected through us yet — premium is collected by the carrier by default."
          }
        />
      </div>

      {coverage.sandbox_quotes > 0 && (
        <p className="mt-4 text-xs text-ink-muted">
          A further {coverage.sandbox_quotes} sandbox quote
          {coverage.sandbox_quotes === 1 ? " exists" : "s exist"} and
          {coverage.sandbox_quotes === 1 ? " is" : " are"} excluded from every
          figure above.
        </p>
      )}

      <div className="mt-8">
        <Panel
          title="What was bought"
          description="Live quotes and binds per product."
        >
          {products.length === 0 ? (
            <Empty>Nothing has been quoted yet.</Empty>
          ) : (
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    <th className="py-2.5 text-left">Product</th>
                    <th className="py-2.5 text-left">Carrier</th>
                    <th className="py-2.5 text-right">Quoted</th>
                    <th className="py-2.5 text-right">Bought</th>
                    <th className="py-2.5 text-right">Premium bound</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((row) => (
                    <tr
                      key={row.product_code}
                      className="border-b border-line/50 last:border-0"
                    >
                      <td className="py-3">
                        <span className="block text-ink">
                          {row.display_name ?? row.product_code}
                        </span>
                        <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                          {row.product_code}
                        </span>
                      </td>
                      <td className="py-3 text-ink-soft">{row.carrier_name ?? "—"}</td>
                      <td className="py-3 text-right tabular-nums">{row.quotes}</td>
                      <td className="py-3 text-right tabular-nums">{row.policies}</td>
                      <td className="py-3 text-right tabular-nums">
                        {money(row.bound_premium_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------------------------ */}

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        The record
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Signatures captured" value={agreements.signatures} />
        <Stat
          label="Voided"
          value={agreements.agreements_voided}
          hint={`${agreements.agreements_expired} expired unsigned`}
        />
        <Stat
          label="Under legal hold"
          value={agreements.agreements_on_hold}
          hint="Exempt from retention until the hold is lifted."
        />
        <Stat
          label="Assets on file"
          value={agreements.assets_active}
          hint={`${agreements.agreements_30d} agreements created in the last 30 days`}
        />
      </div>

      {agreements.agreements_on_hold > 0 && (
        <div className="mt-6">
          <Note tone="warn">
            {agreements.agreements_on_hold} agreement
            {agreements.agreements_on_hold === 1 ? " is" : "s are"} under legal
            hold and will not be deleted by any retention job, whatever the policy
            says.
          </Note>
        </div>
      )}

      {canSeeReports && (
        <p className="mt-10 text-sm text-ink-soft">
          The detail behind these totals:{" "}
          <Link href="/admin/lenders" className="font-semibold text-accent underline">
            every lender
          </Link>{" "}
          and{" "}
          <Link href="/admin/borrowers" className="font-semibold text-accent underline">
            every borrower
          </Link>
          .
        </p>
      )}
    </Container>
  );
}
