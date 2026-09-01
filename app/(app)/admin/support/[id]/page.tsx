import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Panel, Row } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { AdminTicket } from "@/components/AdminTicket";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { allMessages, CATEGORY_LABELS, STATUS_LABELS } from "@/lib/support/tickets";

export const metadata: Metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

export default async function AdminTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const staff = await currentStaff();
  if (!staff) notFound();

  const { data: ticket } = await staff.db
    .from("support_tickets")
    .select(
      "id, reference, subject, category, status, priority, opener_email, opener_name, created_at, first_reply_at, partner_id, partners(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!ticket) notFound();

  const messages = await allMessages(staff.db, id);
  const partner = Array.isArray(ticket.partners) ? ticket.partners[0] : ticket.partners;

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <Link href="/admin/support" className="text-xs text-ink-muted hover:text-ink">
        ← Support
      </Link>

      <h1 className="mt-4 font-serif text-3xl tracking-tight sm:text-4xl">
        {ticket.subject}
      </h1>
      <p className="mt-2 font-mono text-xs text-ink-muted">{ticket.reference}</p>

      <div className="mt-10 space-y-8">
        <Panel title="Who and what">
          <dl>
            <Row
              label="From"
              value={
                <>
                  {ticket.opener_name ? `${ticket.opener_name} · ` : ""}
                  <a
                    href={`mailto:${ticket.opener_email}`}
                    className="text-accent underline"
                  >
                    {ticket.opener_email}
                  </a>
                </>
              }
            />
            <Row
              label="Partner"
              value={
                partner && ticket.partner_id ? (
                  <Link
                    href={`/admin/partners/${ticket.partner_id}`}
                    className="text-accent underline"
                  >
                    {partner.name}
                  </Link>
                ) : (
                  "Not a partner ticket"
                )
              }
            />
            <Row
              label="About"
              value={
                CATEGORY_LABELS[ticket.category as keyof typeof CATEGORY_LABELS] ??
                ticket.category
              }
            />
            <Row
              label="Status"
              value={`${
                STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS] ??
                ticket.status
              } · ${ticket.priority}`}
            />
            <Row
              label="First reply"
              value={
                ticket.first_reply_at
                  ? new Date(ticket.first_reply_at).toLocaleString()
                  : "Not yet"
              }
            />
          </dl>
        </Panel>

        <Panel title="Thread" description="Internal notes are marked and never sent.">
          <ul className="space-y-5">
            {messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.internal
                    ? "rounded-xl border border-flag/30 bg-flag/[0.04] px-4 py-3"
                    : ""
                }
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  {message.internal && (
                    <span className="mr-2 text-flag">internal note</span>
                  )}
                  {message.author_email} ·{" "}
                  {new Date(message.created_at).toLocaleString()}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {message.body}
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Answer it">
          <AdminTicket
            ticketId={id}
            status={ticket.status}
            priority={ticket.priority}
            canRespond={staffCan(staff.role, "support.respond")}
            canTriage={staffCan(staff.role, "support.triage")}
          />
        </Panel>
      </div>
    </Container>
  );
}
