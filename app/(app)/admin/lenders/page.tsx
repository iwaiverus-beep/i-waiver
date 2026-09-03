import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { PageIntro } from "@/components/PageIntro";
import { Panel, Stat } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { LenderTable } from "@/components/LenderTable";
import { ViewAsCustomer } from "@/components/ViewAsCustomer";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { agreementStats, listLenders } from "@/lib/platform/reports";
import {
  EMULATION_MINUTES,
  emulatableAccounts,
  emulationConfigured,
} from "@/lib/platform/emulation";

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

  // The picker lives on this screen rather than on one of its own. This is
  // already "every lender on the platform", which is the list you are choosing
  // from — and the admin console's rule is one screen per question, so a second
  // page listing the same people to answer nearly the same question is exactly
  // the duplication that has bitten this console before.
  const canEmulate = staffCan(staff.role, "users.emulate");

  const [rows, stats, accounts] = await Promise.all([
    listLenders(staff.db),
    agreementStats(staff.db),
    canEmulate ? emulatableAccounts(staff.db) : Promise.resolve([]),
  ]);

  const dormant = rows.filter((r) => r.agreements_total === 0).length;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <PageIntro title="Lenders" defaultOpen>
        Everyone who creates agreements — a person or a business, and (once a
        platform is integrated) their customers too. One row each, however many
        accounts they hold.
      </PageIntro>

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

      <div className="mt-8 space-y-8">
        {canEmulate && (
          <Panel
            title="View as a customer"
            description={`Opens their screens exactly as they see them, read-only, for ${EMULATION_MINUTES} minutes. Logged against your name.`}
          >
            <ViewAsCustomer
              accounts={accounts}
              configured={emulationConfigured()}
            />
          </Panel>
        )}

        <Panel title="Everyone" description="Search on a name, an email or a state.">
          <LenderTable rows={rows} />
        </Panel>
      </div>
    </Container>
  );
}
