import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { PageHeading } from "@/components/PageHeading";
import { Note, Panel, Stat } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { BorrowerTable } from "@/components/BorrowerTable";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { listBorrowers } from "@/lib/platform/reports";

export const metadata: Metadata = { title: "Borrowers" };
export const dynamic = "force-dynamic";

/**
 * Every borrower on the platform.
 *
 * THERE IS NO BORROWERS TABLE TO LIST. A signer is not a user (CLAUDE.md
 * constraint 1): a borrower arrives on a tokenised link, signs, and in most cases
 * never creates an account. Their identity is the address the link was sent to,
 * so this report groups on the email — three loans from the same person is one
 * borrower, not three.
 *
 * PARTICIPANTS ARE COUNTED SEPARATELY. Somebody who got on the boat is not
 * somebody who took custody of it, and folding the two together would overstate
 * the customer base on exactly the multi-household bookings where the difference
 * matters.
 */
export default async function BorrowersPage() {
  const staff = await currentStaff();
  if (!staff) notFound();
  if (!staffCan(staff.role, "reports.read")) notFound();

  const rows = await listBorrowers(staff.db);

  const signed = rows.filter((r) => r.signed > 0).length;
  const repeat = rows.filter((r) => r.as_borrower + r.as_participant > 1).length;
  const withAccount = rows.filter((r) => r.has_account).length;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <PageHeading title="Borrowers">
        Everyone who has been asked to sign. Counted by email address, because a
        borrower signs from a link and mostly never holds an account.
      </PageHeading>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Borrowers" value={rows.length} />
        <Stat
          label="Have signed"
          value={signed}
          hint={
            rows.length > 0
              ? `${Math.round((signed / rows.length) * 100)}% of everyone sent a document`
              : undefined
          }
        />
        <Stat label="Came back" value={repeat} hint="More than one agreement." />
        <Stat
          label="Opened an account"
          value={withAccount}
          hint="Offered after signing, never as a gate."
        />
      </div>

      <div className="mt-6">
        <Note>
          A borrower never signed up with us — they were sent a document. Treat
          this list as evidence of a relationship a lender has, not a marketing
          list of our own.
        </Note>
      </div>

      <div className="mt-8">
        <Panel title="Everyone" description="Search on a name, an email or a state.">
          <BorrowerTable rows={rows} />
        </Panel>
      </div>
    </Container>
  );
}
