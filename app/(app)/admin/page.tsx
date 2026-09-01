import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { currentStaff } from "@/lib/platform/access";
import { PARTNER_KIND_LABELS, type PartnerKind } from "@/lib/partners/applications";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

/**
 * The admin home: three queues and nothing else.
 *
 * A dashboard of counts would be prettier and less useful. What somebody opening
 * this at nine in the morning needs is the list of things waiting on a decision,
 * in the order they arrived.
 *
 * `notFound()` rather than a "you are not staff" page. Whether an admin console
 * exists at this address is itself worth not confirming, and it is the same
 * answer the API routes give.
 */
export default async function AdminHome() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const [applications, partners, tickets] = await Promise.all([
    staff.db
      .from("partner_applications")
      .select("id, company_name, partner_kind, contact_name, status, jurisdictions, created_at")
      .in("status", ["new", "in_review"])
      .order("created_at"),
    staff.db
      .from("partners")
      .select("id, name, slug, kind, approved_at, disabled_at")
      .order("approved_at", { ascending: false, nullsFirst: false })
      .limit(50),
    staff.db
      .from("support_tickets")
      .select("id, reference, subject, status, priority, created_at, partner_id")
      .in("status", ["open", "pending_us"])
      .order("created_at")
      .limit(25),
  ]);

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      {staff.bootstrap && (
        <div className="mb-8 rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4 text-sm leading-relaxed text-flag">
          <strong className="font-semibold">
            Your access came from IWAIVER_BOOTSTRAP_ADMINS.
          </strong>{" "}
          A real grant has been written for you. Clear that variable once other
          super admins exist — an address left in it cannot be revoked from inside
          the product.
        </div>
      )}

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Queues</h1>

      <div className="mt-10 space-y-8">
        <Panel
          title="Partner applications"
          description="Waiting on a decision, oldest first."
        >
          {(applications.data ?? []).length === 0 ? (
            <Empty>Nothing waiting.</Empty>
          ) : (
            <ul className="divide-y divide-line/60">
              {(applications.data ?? []).map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/applications/${row.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:text-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {row.company_name}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {PARTNER_KIND_LABELS[row.partner_kind as PartnerKind] ??
                          row.partner_kind}{" "}
                        · {row.contact_name} ·{" "}
                        {row.jurisdictions?.length
                          ? `${row.jurisdictions.length} states`
                          : "no states given"}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-xs text-ink-muted">
                      {row.status === "in_review" && (
                        <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-semibold">
                          in review
                        </span>
                      )}
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Partners" description="Everyone we have said yes to.">
          {(partners.data ?? []).length === 0 ? (
            <Empty>No partners yet.</Empty>
          ) : (
            <ul className="divide-y divide-line/60">
              {(partners.data ?? []).map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/partners/${row.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:text-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {row.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                        {row.slug}
                      </span>
                    </span>
                    <span className="text-xs text-ink-muted">
                      {row.disabled_at ? (
                        <span className="font-semibold text-flag">disabled</span>
                      ) : (
                        PARTNER_KIND_LABELS[row.kind as PartnerKind] ?? row.kind
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Support"
          description="Open, and waiting on us."
          action={
            <Link href="/admin/support" className="text-xs font-semibold text-accent underline">
              All tickets →
            </Link>
          }
        >
          {(tickets.data ?? []).length === 0 ? (
            <Empty>Inbox clear.</Empty>
          ) : (
            <ul className="divide-y divide-line/60">
              {(tickets.data ?? []).map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/support/${row.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:text-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {row.subject}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                        {row.reference}
                      </span>
                    </span>
                    <span className="text-xs text-ink-muted">
                      {row.priority !== "normal" && (
                        <span className="mr-2 font-semibold uppercase text-flag">
                          {row.priority}
                        </span>
                      )}
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Container>
  );
}
