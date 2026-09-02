import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Note, Panel, Stat } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { NewProspectForm, ProspectList } from "@/components/ProspectTools";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { listProspects } from "@/lib/partners/prospects";
import { PARTNER_KIND_LABELS, type PartnerKind } from "@/lib/partners/vocabulary";

export const metadata: Metadata = { title: "Partners" };
export const dynamic = "force-dynamic";

/**
 * The channel, in one place: who we supply, and who we would like to.
 *
 * TWO LISTS, AND THEY ARE NOT THE SAME LIST. A partner has said yes — an account,
 * an owner who can sign in, a key. A prospect is a name on a target list that has
 * never heard of us. Showing them together under one heading would let a screen
 * full of intentions read as a book of business, which is the specific way this
 * kind of page misleads the person who built it.
 *
 * CARRIERS ARE NOT HERE. They are the other direction — we call them, holding
 * their credential (CLAUDE.md constraint 11) — and they have their own tab. The
 * two named insurance targets, Allianz and Lockton, sit there as carriers in
 * `prospect` status rather than in the list below.
 */
export default async function PartnersPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const canManage = staffCan(staff.role, "partners.manage");

  const [partnersResult, prospects, applicationsResult] = await Promise.all([
    staff.db
      .from("partners")
      .select("id, name, slug, kind, website, contact_email, approved_at, disabled_at")
      .order("name"),
    listProspects(staff.db),
    staff.db
      .from("partner_applications")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "in_review"]),
  ]);

  const partners = partnersResult.data ?? [];
  const live = partners.filter((p) => !p.disabled_at);
  const open = prospects.filter((p) => !["won", "lost"].includes(p.status));

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Partners</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        The platforms that put our cover in front of their customers, and the ones
        we want next. Insurers are on the{" "}
        <Link href="/admin/carriers" className="font-semibold text-accent underline">
          Carriers
        </Link>{" "}
        tab — they are the other side of the trade.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Partners" value={live.length} hint="Approved and not disabled." />
        <Stat
          label="In the pipeline"
          value={open.length}
          hint="Identified, contacted or talking."
        />
        <Stat
          label="Waiting on us"
          value={applicationsResult.count ?? 0}
          hint="Applications needing a decision."
        />
        <Stat
          label="Won"
          value={prospects.filter((p) => p.status === "won").length}
          hint={`${prospects.filter((p) => p.status === "lost").length} lost`}
        />
      </div>

      <div className="mt-10 space-y-8">
        <Panel
          title="Partners"
          description="Everyone we have said yes to. Open one for keys, onboarding and branding."
        >
          {partners.length === 0 ? (
            <Empty>
              Nobody yet. A partner is created by approving an application, never
              by hand.
            </Empty>
          ) : (
            <ul className="divide-y divide-line/60">
              {partners.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/partners/${row.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:text-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {row.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {PARTNER_KIND_LABELS[row.kind as PartnerKind] ?? row.kind}
                        {row.contact_email ? ` · ${row.contact_email}` : ""}
                      </span>
                    </span>
                    <span className="text-xs text-ink-muted">
                      {row.disabled_at ? (
                        <span className="font-semibold text-flag">disabled</span>
                      ) : row.approved_at ? (
                        `since ${new Date(row.approved_at).toLocaleDateString()}`
                      ) : (
                        ""
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Prospects"
          description="Platforms we want to supply. Not accounts — nobody here has a key or a way in."
        >
          {prospects.length === 0 ? (
            <Empty>Nothing on the list.</Empty>
          ) : (
            <ProspectList
              prospects={prospects}
              partners={partners.map((p) => ({ id: p.id, name: p.name }))}
              canManage={canManage}
            />
          )}
        </Panel>

        {canManage && (
          <Panel
            title="Add a prospect"
            description="A company we want to talk to. It starts at ‘identified’ — nobody has written to them yet."
          >
            <NewProspectForm />
          </Panel>
        )}

        <Note>
          A prospect who applies comes through the public form like anybody else
          and lands in the application queue on{" "}
          <Link href="/admin" className="font-semibold underline">
            Queues
          </Link>
          . Approving it is what creates the partner account — this list never
          does, which is what guarantees every partner has an owner who can
          actually sign in.
        </Note>
      </div>
    </Container>
  );
}
