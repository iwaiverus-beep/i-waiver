import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { siteOrigin, supportEmail } from "@/lib/env";
import { BRAND } from "@/lib/brand";

/**
 * Support tickets.
 *
 * One module for both sides of the conversation, because the alternative — a
 * partner-facing reader and a staff-facing reader, written separately — is how an
 * internal note ends up on a customer's screen. There is exactly one function
 * that returns messages to a customer and it filters `internal` unconditionally;
 * there is no boolean parameter that turns the filter off.
 */

// The names live in ./labels, which carries no server-only marker so the console
// components can render them. Re-exported here so server callers keep one import.
export {
  CATEGORY_LABELS,
  PRIORITIES,
  STATUS_LABELS,
  SUPPORT_CATEGORIES,
} from "@/lib/support/labels";
export type { SupportCategory, SupportStatus } from "@/lib/support/labels";

import type { SupportCategory, SupportStatus } from "@/lib/support/labels";

export type Ticket = {
  id: string;
  reference: string;
  partner_id: string | null;
  opened_by: string | null;
  opener_email: string;
  opener_name: string | null;
  subject: string;
  category: SupportCategory;
  priority: "low" | "normal" | "high" | "urgent";
  status: SupportStatus;
  assigned_to: string | null;
  first_reply_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  author_email: string;
  author_kind: "partner" | "lender" | "staff" | "system";
  body: string;
  internal: boolean;
  created_at: string;
};

export class TicketRefused extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export async function openTicket(
  db: SupabaseClient,
  input: {
    partnerId?: string | null;
    openedBy?: string | null;
    openerEmail: string;
    openerName?: string | null;
    subject: string;
    category: SupportCategory;
    body: string;
    authorKind: "partner" | "lender";
  },
): Promise<Ticket> {
  const { data: ticket, error } = await db
    .from("support_tickets")
    .insert({
      partner_id: input.partnerId ?? null,
      opened_by: input.openedBy ?? null,
      opener_email: input.openerEmail.toLowerCase(),
      opener_name: input.openerName ?? null,
      subject: input.subject,
      category: input.category,
    })
    .select("*")
    .single();

  if (error || !ticket) {
    throw new TicketRefused(`Could not open the ticket: ${error?.message}`, 500);
  }

  await db.from("support_messages").insert({
    ticket_id: ticket.id,
    author_id: input.openedBy ?? null,
    author_email: input.openerEmail.toLowerCase(),
    author_kind: input.authorKind,
    body: input.body,
  });

  await notify({
    to: input.openerEmail,
    subject: `[${ticket.reference}] ${input.subject}`,
    lines: [
      "Thanks — we have this.",
      "",
      `Your reference is ${ticket.reference}. Quote it if you write to us again about the same thing.`,
      "",
      "You can follow it here:",
      `${siteOrigin()}/partners/console/support`,
    ],
  });

  return ticket as Ticket;
}

/**
 * The customer's view of a thread. Internal notes are filtered here and nowhere
 * else, which is why there is no parameter to skip it.
 */
export async function customerMessages(
  db: SupabaseClient,
  ticketId: string,
): Promise<Message[]> {
  const { data } = await db
    .from("support_messages")
    .select("id, author_email, author_kind, body, internal, created_at")
    .eq("ticket_id", ticketId)
    .eq("internal", false)
    .order("created_at");

  return (data ?? []) as Message[];
}

/** The staff view: everything, notes included. */
export async function allMessages(
  db: SupabaseClient,
  ticketId: string,
): Promise<Message[]> {
  const { data } = await db
    .from("support_messages")
    .select("id, author_email, author_kind, body, internal, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at");

  return (data ?? []) as Message[];
}

export async function addMessage(
  db: SupabaseClient,
  input: {
    ticketId: string;
    authorId: string | null;
    authorEmail: string;
    authorKind: "partner" | "lender" | "staff" | "system";
    body: string;
    internal?: boolean;
  },
): Promise<void> {
  const internal = input.internal ?? false;
  if (internal && input.authorKind !== "staff") {
    // The database enforces this too. Checking it here as well means the failure
    // is a sentence rather than a constraint-violation stack trace.
    throw new TicketRefused("Only staff can leave an internal note.", 403);
  }

  const { error } = await db.from("support_messages").insert({
    ticket_id: input.ticketId,
    author_id: input.authorId,
    author_email: input.authorEmail.toLowerCase(),
    author_kind: input.authorKind,
    body: input.body,
    internal,
  });

  if (error) throw new TicketRefused(`Could not post the reply: ${error.message}`, 500);

  // An internal note changes nothing about whose turn it is, and must not reset
  // the first-response clock — a note to a colleague is not a reply to a customer.
  if (internal) return;

  const { data: ticket } = await db
    .from("support_tickets")
    .select("id, reference, subject, opener_email, first_reply_at, status")
    .eq("id", input.ticketId)
    .maybeSingle();

  const staffReplied = input.authorKind === "staff";

  await db
    .from("support_tickets")
    .update({
      updated_at: new Date().toISOString(),
      status: staffReplied ? "pending_customer" : "pending_us",
      first_reply_at:
        staffReplied && !ticket?.first_reply_at
          ? new Date().toISOString()
          : (ticket?.first_reply_at ?? null),
    })
    .eq("id", input.ticketId);

  if (staffReplied && ticket) {
    await notify({
      to: ticket.opener_email,
      subject: `[${ticket.reference}] ${ticket.subject}`,
      lines: [
        input.body,
        "",
        "———",
        "Reply here, or from the console:",
        `${siteOrigin()}/partners/console/support`,
      ],
    });
  }
}

export async function setStatus(
  db: SupabaseClient,
  ticketId: string,
  status: SupportStatus,
): Promise<void> {
  await db
    .from("support_tickets")
    .update({
      status,
      updated_at: new Date().toISOString(),
      resolved_at:
        status === "resolved" || status === "closed"
          ? new Date().toISOString()
          : null,
    })
    .eq("id", ticketId);
}

async function notify(message: { to: string; subject: string; lines: string[] }) {
  try {
    await sendEmail({
      to: message.to,
      subject: message.subject,
      text: [
        ...message.lines,
        "",
        `— ${BRAND.name} support · ${supportEmail()}`,
      ].join("\n"),
    });
  } catch (error) {
    // A ticket that was created is created. Losing the acknowledgement email is
    // worth a log line, not a failed request.
    console.error(`support email to ${message.to} failed:`, (error as Error).message);
  }
}
