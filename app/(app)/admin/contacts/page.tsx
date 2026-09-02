import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { CompanyList, InboundList } from "@/components/ContactsBrowser";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { companyContacts, inboundContacts } from "@/lib/platform/contacts";

export const metadata: Metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbound", label: "Inbound" },
  { key: "companies", label: "Carriers & partners" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/**
 * Everybody who is not a party to a document.
 *
 * WHY LENDERS AND BORROWERS ARE NOT HERE. They have their own screens, and the
 * separation is the point rather than an accident of layout. A lender and a
 * borrower signed a legal instrument; the people on this page raised a hand at a
 * marketing site or answered a cold email. Putting all four under one heading
 * called "contacts" invites somebody to mail the second group because the first
 * group was a mailing list — and `waitlist`'s own comment in the schema says it is
 * marketing data that never joins the agreement graph.
 *
 * So this page is the two groups nothing else covers: people who came to us, and
 * the named humans at the companies we work with.
 *
 * Tabs are links rather than client state, so each list is a URL somebody can
 * send to a colleague and an unopened tab costs nothing to load.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const staff = await currentStaff();
  if (!staff) notFound();

  const { tab: raw } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "inbound";

  // Seeing the console and reading every address we hold are different grants.
  // `read_only` has the first and not the second.
  if (!staffCan(staff.role, "reports.read")) {
    return (
      <Container className="py-14 sm:py-20">
        <AdminNav role={staff.role} email={staff.email} />
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Contacts</h1>
        <div className="mt-8">
          <Empty>
            Reading the contact lists is a separate grant from seeing the console.
            Ask a super admin if you need it.
          </Empty>
        </div>
      </Container>
    );
  }

  // Only the tab being looked at. Loading both lists to show one is how a staff
  // screen quietly becomes slow.
  const [inbound, companies] = await Promise.all([
    tab === "inbound" ? inboundContacts(staff.db) : Promise.resolve([]),
    tab === "companies" ? companyContacts(staff.db) : Promise.resolve([]),
  ]);

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Contacts</h1>
        <a
          href={`/api/admin/contacts/export?tab=${tab}`}
          className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface"
        >
          Export this list as CSV
        </a>
      </div>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        People who came to us, and the people at the companies we work with. The
        parties to actual agreements are on{" "}
        <Link href="/admin/lenders" className="text-accent underline">
          Lenders
        </Link>{" "}
        and{" "}
        <Link href="/admin/borrowers" className="text-accent underline">
          Borrowers
        </Link>
        , kept separate on purpose.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 border-b border-line pb-4">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/contacts?tab=${t.key}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key
                ? "bg-ink text-paper"
                : "text-ink-soft hover:bg-surface hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "inbound" ? (
          <Panel
            title="People who raised a hand"
            description="Waitlist signups, partner applications, prospects we approached, and anyone who wrote to support without an account behind them."
          >
            <InboundList rows={inbound} />
          </Panel>
        ) : (
          <Panel
            title="Carriers and partners"
            description="The named people at each company we work with. A partner row lists everyone invited, including invitations nobody has accepted — which is the thing worth chasing."
          >
            <CompanyList rows={companies} />
          </Panel>
        )}
      </div>
    </Container>
  );
}
