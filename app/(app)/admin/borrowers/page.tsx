import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Note, Panel, Stat } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { ReportTable, type Column } from "@/components/ReportTable";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { listBorrowers, type BorrowerRow } from "@/lib/platform/reports";

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
        r.as_participant > 0 ? r.as_participant : <span className="text-ink-muted">—</span>,
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
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Borrowers</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Everyone who has been asked to sign. Counted by email address, because a
        borrower signs from a link and mostly never holds an account.
      </p>

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
        </Panel>
      </div>
    </Container>
  );
}
