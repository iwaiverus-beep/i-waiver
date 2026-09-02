import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { PageHeading } from "@/components/PageHeading";
import { Empty } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { BarChart, LineChart, StatTile } from "@/components/charts";
import { compact, money } from "@/lib/format";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  humanDuration,
  platformTrends,
  sumLast,
  sumPrevious,
} from "@/lib/platform/reporting";
import { listActivityClasses, activityLabel } from "@/lib/activities";

export const metadata: Metadata = { title: "Trends" };
export const dynamic = "force-dynamic";

/**
 * Which way things are moving.
 *
 * SEPARATE FROM OVERVIEW, WHICH HOLDS THE COUNTS. A number says where things
 * stand; it says nothing about direction, and a screen that tried to do both ends
 * up restating every figure twice — once as a tile and once as the right-hand end
 * of a line. So Overview keeps the standing totals and this page keeps the
 * ninety-day series, the funnel and the volume split. Nothing is repeated between
 * them except the four deltas at the top, which are movements rather than counts
 * and belong here.
 *
 * NOTHING IS A DUAL-AXIS CHART. Where two measures have different scales —
 * policies against premium, say — they get two charts side by side. Aligning two
 * y-scales on one plot is arbitrary and invents correlations that are not in the
 * data.
 *
 * THE TWO HALVES ARE STILL TWO REPORTS. Agreement series and coverage series come
 * from views that never join (CLAUDE.md constraint 9). Reading both on one screen
 * is a person reading two reports; a number mixing them would be one nobody could
 * defend.
 */
export default async function TrendsPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  if (!staffCan(staff.role, "reports.read")) {
    return (
      <Container className="py-14 sm:py-20">
        <AdminNav role={staff.role} email={staff.email} />
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Trends</h1>
        <div className="mt-8">
          <Empty>
            Your role does not include reading the reports. Ask a super admin if you
            need them.
          </Empty>
        </div>
      </Container>
    );
  }

  const [trends, activities] = await Promise.all([
    platformTrends(staff.db),
    listActivityClasses(staff.db),
  ]);

  const { agreementDaily, lenderDaily, coverageDaily, funnel } = trends;

  // Thirty days against the thirty before them. Both windows come off a dense
  // daily series, so a quiet month compares as a quiet month rather than being
  // stretched backwards to find thirty rows with something in them.
  const created30 = sumLast(agreementDaily, 30, (d) => d.created);
  const executed30 = sumLast(agreementDaily, 30, (d) => d.executed);
  const lenders30 = sumLast(lenderDaily, 30, (d) => d.lenders);
  const premium30 = sumLast(coverageDaily, 30, (d) => d.bound_premium_cents);

  const delta = (now: number, before: number) => now - before;

  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const agreementPoints = agreementDaily.map((d) => ({
    label: day(d.day),
    values: { created: d.created, sent: d.sent, executed: d.executed },
  }));

  const lenderPoints = lenderDaily.map((d) => ({
    label: day(d.day),
    values: { lenders: d.lenders },
  }));

  const coveragePoints = coverageDaily.map((d) => ({
    label: day(d.day),
    values: { quotes: d.quotes, policies: d.policies },
  }));

  const premiumPoints = coverageDaily.map((d) => ({
    label: day(d.day),
    values: { bound: d.bound_premium_cents, collected: d.collected_premium_cents },
  }));

  const volumeRows = trends.byStateActivity.slice(0, 12).map((row) => ({
    label: `${row.state} · ${activityLabel(row.activity_class, activities)}`,
    value: row.agreements,
    note: row.executed > 0 ? `${row.executed} signed` : undefined,
  }));

  const signRate =
    funnel && funnel.links_issued > 0
      ? Math.round((funnel.signed / funnel.links_issued) * 100)
      : null;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <PageHeading title="Trends">
        Ninety days, bucketed by UTC day. The standing totals are on{" "}
        <Link href="/admin/overview" className="text-accent underline">
          Overview
        </Link>
        ; this page is movement. A quiet day is a zero rather than a missing point,
        so a flat stretch reads as a flat stretch.
      </PageHeading>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Agreements created"
          value={compact(created30)}
          delta={{
            value: delta(created30, sumPrevious(agreementDaily, 30, (d) => d.created)),
            period: "vs the 30 before",
          }}
          hint="Last 30 days"
        />
        <StatTile
          label="Signed by both parties"
          value={compact(executed30)}
          delta={{
            value: delta(executed30, sumPrevious(agreementDaily, 30, (d) => d.executed)),
            period: "vs the 30 before",
          }}
          hint="Last 30 days. Executed only"
        />
        <StatTile
          label="New lenders"
          value={compact(lenders30)}
          delta={{
            value: delta(lenders30, sumPrevious(lenderDaily, 30, (d) => d.lenders)),
            period: "vs the 30 before",
          }}
          hint="Counted the day they first lend, not the day they sign up"
        />
        <StatTile
          label="Premium bound"
          value={money(premium30)}
          delta={{
            value: delta(
              premium30,
              sumPrevious(coverageDaily, 30, (d) => d.bound_premium_cents),
            ),
            period: "cents vs the 30 before",
          }}
          hint="Last 30 days, live only"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Agreements
      </h2>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <LineChart
          title="Created, sent, signed"
          description="One agreement appears in more than one line: created on Monday and signed on Wednesday counts in both."
          points={agreementPoints}
          series={[
            { key: "created", label: "Created", color: 0 },
            { key: "sent", label: "Sent", color: 1 },
            { key: "executed", label: "Signed", color: 2 },
          ]}
        />
        <LineChart
          title="New lenders"
          description="An originator is written the first time somebody actually lends something, so an account that has never lent anything is not on this line."
          points={lenderPoints}
          series={[{ key: "lenders", label: "New lenders", color: 0 }]}
        />
      </div>

      <div className="mt-5">
        <BarChart
          title="Where the agreements are"
          description="By state and activity, most first. This is the demand side of the readiness matrix on Configuration — the combinations with volume and gaps are the roadmap."
          rows={volumeRows}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Signing
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
        What happened to the links that were actually sent. Drafts are left out —
        an agreement nobody sent has not failed to be signed.
      </p>

      {funnel && funnel.links_issued > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Links sent" value={compact(funnel.links_issued)} />
          <StatTile
            label="Signed"
            value={signRate === null ? "—" : `${signRate}%`}
            hint={`${compact(funnel.signed)} of ${compact(funnel.links_issued)}`}
          />
          <StatTile
            label="Still outstanding"
            value={compact(funnel.outstanding)}
            hint={`${compact(funnel.declined)} declined outright`}
          />
          <StatTile
            label="Typical time to sign"
            value={humanDuration(funnel.median_seconds_to_sign)}
            hint="Median — one borrower who took three weeks should not move it"
          />
        </div>
      ) : (
        <div className="mt-4">
          <Empty>Nothing has been sent yet.</Empty>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Insurance
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
        Live environment only. Sandbox quotes exist so partners can build against
        us before a filing lands, and drawing them on these lines would make every
        one of them fiction.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <LineChart
          title="Quotes and binds"
          description="Counts. The money is the chart beside this one — two scales on one plot would invent a relationship between them."
          points={coveragePoints}
          series={[
            { key: "quotes", label: "Quoted", color: 0 },
            { key: "policies", label: "Bound", color: 1 },
          ]}
        />
        <LineChart
          title="Premium"
          description="Bound is what was priced, read off the quote each policy came from. Collected is what actually arrived."
          points={premiumPoints}
          series={[
            { key: "bound", label: "Bound", color: 0 },
            { key: "collected", label: "Collected", color: 1 },
          ]}
          format="money"
        />
      </div>
    </Container>
  );
}
