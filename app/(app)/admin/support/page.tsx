import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { SupportNav } from "@/components/SupportNav";
import { currentStaff } from "@/lib/platform/access";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/support/tickets";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

/**
 * The support queue.
 *
 * Two lists, not a filter dropdown: what is waiting on us, and everything else.
 * The distinction is the only one that changes what somebody does next, and a
 * dropdown that defaults to "all" hides it.
 */
export default async function AdminSupportPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const { data: tickets } = await staff.db
    .from("support_tickets")
    .select(
      "id, reference, subject, category, status, priority, opener_email, created_at, first_reply_at, partners(name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // Only the count, so the listener tab can carry it. The messages themselves
  // are read by /admin/support/inbox; this screen has no use for them.
  const { count: untriaged } = await staff.db
    .from("support_inbound_emails")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  const rows = tickets ?? [];
  const waiting = rows.filter((t) => t.status === "open" || t.status === "pending_us");
  const rest = rows.filter((t) => t.status !== "open" && t.status !== "pending_us");

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
        Customer Support
      </h1>

      <div className="mt-8">
        <SupportNav untriaged={untriaged ?? 0} />
      </div>

      <div className="space-y-8">
        <Panel title="Waiting on us" description="Oldest first.">
          {waiting.length === 0 ? <Empty>Inbox clear.</Empty> : <List rows={waiting} />}
        </Panel>

        <Panel title="Everything else">
          {rest.length === 0 ? <Empty>Nothing.</Empty> : <List rows={rest} />}
        </Panel>
      </div>
    </Container>
  );
}

type TicketRow = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  opener_email: string;
  created_at: string;
  first_reply_at: string | null;
  partners: { name: string } | { name: string }[] | null;
};

function List({ rows }: { rows: TicketRow[] }) {
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((row) => {
        const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
        return (
          <li key={row.id}>
            <Link
              href={`/admin/support/${row.id}`}
              className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:text-accent"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {row.subject}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  <span className="font-mono">{row.reference}</span> ·{" "}
                  {partner?.name ?? row.opener_email} ·{" "}
                  {CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS] ??
                    row.category}
                </span>
              </span>
              <span className="flex items-center gap-3 text-xs text-ink-muted">
                {row.priority !== "normal" && (
                  <span className="font-semibold uppercase text-flag">
                    {row.priority}
                  </span>
                )}
                {!row.first_reply_at && (
                  <span className="rounded-full border border-flag/30 bg-flag/[0.06] px-2.5 py-0.5 font-semibold text-flag">
                    no reply yet
                  </span>
                )}
                <span>
                  {STATUS_LABELS[row.status as keyof typeof STATUS_LABELS] ??
                    row.status}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
