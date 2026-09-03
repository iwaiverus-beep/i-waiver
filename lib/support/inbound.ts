import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { emailFrom, inboundEmailSecret, partnerTeamEmail, supportEmail } from "@/lib/env";
import {
  addMessage,
  openTicket,
  TicketRefused,
  type AuthorKind,
  type SupportCategory,
} from "@/lib/support/tickets";

/**
 * The email listener.
 *
 * A relay in front of the support mailbox posts each message to
 * /api/webhooks/inbound-email; this module is what happens next. Two jobs, in a
 * fixed order that matters:
 *
 *   1. Record that the message arrived. Always, first, before anything is
 *      decided about it. If classification throws, the mail is still on the
 *      screen — a listener whose record depends on its own cleverness is a
 *      listener that loses mail on the day the cleverness is wrong.
 *   2. Classify it, and only in the one case where there is nothing to decide.
 *      A reply carrying a reference we issued is a reply; it goes onto that
 *      thread. Everything else waits for a human.
 *
 * WHY THAT LINE AND NOT A CLEVERER ONE. It is tempting to match on the sender's
 * address, or on the subject, and open a ticket for anything that looks like a
 * question. Mailboxes do not receive questions — they receive bounces,
 * out-of-office replies, delivery reports, newsletters somebody subscribed the
 * address to years ago, and spam, in roughly that order by volume. Every one of
 * those would become a ticket, and a queue that is nine tenths noise gets
 * abandoned in a week. Two clicks per real message is the cheaper end of that
 * trade.
 */

/** True when a relay could actually reach us. Shown on the console as it is. */
export const listenerWired = () => inboundEmailSecret() !== null;

export type InboundEmail = {
  /** The address it was sent to. */
  mailbox: string;
  fromEmail: string;
  fromName?: string | null;
  subject?: string | null;
  body: string;
  /** The provider's Message-ID, if it sent one. Used only for deduplication. */
  messageId?: string | null;
  receivedAt?: string | null;
};

export type InboundStatus = "new" | "linked" | "ticketed" | "ignored";

export type InboundRow = {
  id: string;
  mailbox: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body: string;
  received_at: string;
  status: InboundStatus;
  ticket_id: string | null;
  handled_at: string | null;
  support_tickets: { reference: string; subject: string } | null;
};

/**
 * A reference we issued: IW-1001, as support_tickets.reference mints them.
 *
 * Anchored on word boundaries and requiring at least three digits, because the
 * sequence starts at 1001 and a bare "IW-1" in a stranger's signature is not a
 * reference. Read from the subject first and the body second: a mail client
 * carries the subject through Re: and quoting untouched, whereas a body may
 * quote an older thread and hand back a reference to the wrong conversation.
 */
const REFERENCE = /\bIW-(\d{3,})\b/;

export function referenceIn(subject: string | null, body: string): string | null {
  return (subject?.match(REFERENCE) ?? body.match(REFERENCE))?.[0] ?? null;
}

/**
 * Mail this deployment sent itself.
 *
 * Not an edge case — it is the normal case, and forgetting it is a loop. Opening
 * a ticket emails the desk at support@, that address is the mailbox the listener
 * watches, so the announcement of a ticket arrives carrying that ticket's own
 * reference. Without this check the listener would faithfully append our own
 * notification to the thread it announces, and every thread in the product would
 * end up carrying a copy of itself.
 *
 * Compared by address, lower-cased, after stripping any "Name <addr>" wrapper —
 * emailFrom() is a display-name form and the other two are bare.
 */
function isOurOwnMail(fromEmail: string): boolean {
  const address = (value: string) =>
    (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();

  const ours = new Set([emailFrom(), supportEmail(), partnerTeamEmail()].map(address));
  return ours.has(address(fromEmail));
}

/**
 * Record an arriving message, and link it if there is nothing to decide.
 *
 * Idempotent on messageId. Providers retry a webhook that does not answer 2xx,
 * so this is reached more than once for the same mail as a matter of routine; the
 * second call returns the first call's row rather than queueing a duplicate for a
 * human to notice and clear.
 */
export async function recordInbound(
  db: SupabaseClient,
  email: InboundEmail,
): Promise<{ id: string; status: InboundStatus; ticketId: string | null }> {
  if (email.messageId) {
    const { data: seen } = await db
      .from("support_inbound_emails")
      .select("id, status, ticket_id")
      .eq("message_id", email.messageId)
      .maybeSingle();

    if (seen) {
      return { id: seen.id, status: seen.status, ticketId: seen.ticket_id };
    }
  }

  const { data: row, error } = await db
    .from("support_inbound_emails")
    .insert({
      mailbox: email.mailbox.toLowerCase(),
      from_email: email.fromEmail.toLowerCase(),
      from_name: email.fromName ?? null,
      subject: email.subject ?? null,
      body: email.body,
      message_id: email.messageId ?? null,
      received_at: email.receivedAt ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !row) {
    // A unique violation here is the race the check above cannot close: two
    // retries in flight at once. Both carry the same message, so treating the
    // loser as a success is correct — and re-reading is cheaper than a lock.
    if (error?.code === "23505" && email.messageId) {
      const { data: winner } = await db
        .from("support_inbound_emails")
        .select("id, status, ticket_id")
        .eq("message_id", email.messageId)
        .maybeSingle();
      if (winner) {
        return { id: winner.id, status: winner.status, ticketId: winner.ticket_id };
      }
    }
    throw new TicketRefused(`Could not record the message: ${error?.message}`, 500);
  }

  // --- Our own mail, coming home. -------------------------------------------
  if (isOurOwnMail(email.fromEmail)) {
    await db
      .from("support_inbound_emails")
      .update({ status: "ignored", handled_at: new Date().toISOString() })
      .eq("id", row.id);
    return { id: row.id, status: "ignored", ticketId: null };
  }

  // --- A reply to a thread we opened. ---------------------------------------
  const reference = referenceIn(email.subject ?? null, email.body);
  if (reference) {
    const { data: ticket } = await db
      .from("support_tickets")
      .select("id, opener_email, opened_by, partner_id")
      .eq("reference", reference)
      .maybeSingle();

    if (ticket) {
      await addMessage(db, {
        ticketId: ticket.id,
        authorId: null,
        authorEmail: email.fromEmail,
        authorKind: kindOfSender(email.fromEmail, ticket),
        body: email.body,
      });

      await db
        .from("support_inbound_emails")
        .update({
          status: "linked",
          ticket_id: ticket.id,
          // No handled_by. Nobody handled it — the listener did, and null is the
          // honest answer rather than attributing it to whoever looks next.
          handled_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      return { id: row.id, status: "linked", ticketId: ticket.id };
    }
    // A reference we do not hold. Falls through to triage rather than being
    // dropped: a stale reference from a purged ticket is still somebody writing
    // in, and what they sent is still worth reading.
  }

  return { id: row.id, status: "new", ticketId: null };
}

/**
 * What to call an emailed reply's author.
 *
 * Derived, never guessed. If the address is not the one that opened the thread,
 * we know nothing about them beyond the fact that they wrote in, and 'public' is
 * exactly that. If it is, the ticket already records whether they came in as a
 * partner or as a signed-in lender, so this says what the thread's first message
 * said.
 */
function kindOfSender(
  fromEmail: string,
  ticket: { opener_email: string; opened_by: string | null; partner_id: string | null },
): AuthorKind {
  if (fromEmail.toLowerCase() !== ticket.opener_email.toLowerCase()) return "public";
  if (ticket.partner_id) return "partner";
  return ticket.opened_by ? "lender" : "public";
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

const ROW_COLUMNS =
  "id, mailbox, from_email, from_name, subject, body, received_at, status, ticket_id, handled_at, support_tickets(reference, subject)";

/** Untriaged mail, oldest first — the order it should be worked in. */
export async function triageQueue(db: SupabaseClient, limit = 100): Promise<InboundRow[]> {
  const { data } = await db
    .from("support_inbound_emails")
    .select(ROW_COLUMNS)
    .eq("status", "new")
    .order("received_at", { ascending: true })
    .limit(limit);

  return normalise(data);
}

/** Everything already dealt with, newest first. The audit half of the screen. */
export async function handledMail(db: SupabaseClient, limit = 60): Promise<InboundRow[]> {
  const { data } = await db
    .from("support_inbound_emails")
    .select(ROW_COLUMNS)
    .neq("status", "new")
    .order("received_at", { ascending: false })
    .limit(limit);

  return normalise(data);
}

/**
 * PostgREST hands an embedded row back as an object or as a one-element array
 * depending on how it reads the relationship. Flattened here rather than at both
 * call sites.
 */
function normalise(data: unknown): InboundRow[] {
  type Raw = Omit<InboundRow, "support_tickets"> & {
    support_tickets: InboundRow["support_tickets"] | InboundRow["support_tickets"][];
  };

  return ((data ?? []) as Raw[]).map((row) => ({
    ...row,
    support_tickets: Array.isArray(row.support_tickets)
      ? (row.support_tickets[0] ?? null)
      : row.support_tickets,
  }));
}

/**
 * Turn a message into a ticket.
 *
 * The thread's first message is the mail verbatim, and the sender becomes the
 * opener — so the acknowledgement openTicket sends goes to the person who
 * actually wrote, carrying the reference that will match their next reply. That
 * is the whole reason this is a button rather than a member of staff retyping it:
 * a ticket typed out of a mailbox by hand leaves no reference in the customer's
 * inbox, so their reply arrives untriaged all over again.
 */
export async function ticketFromInbound(
  db: SupabaseClient,
  input: { id: string; staffId: string; category: SupportCategory },
): Promise<{ ticketId: string; reference: string }> {
  const row = await claim(db, input.id);

  const ticket = await openTicket(db, {
    openerEmail: row.from_email,
    openerName: row.from_name,
    // Re: and Fwd: are about the mail, not about the question. Stripped so the
    // queue reads as a list of subjects rather than a list of forwards.
    subject: row.subject?.replace(/^\s*(re|fwd?)\s*:\s*/i, "").trim() || "Emailed in",
    category: input.category,
    body: row.body,
    // They wrote to a mailbox. Whatever account they may or may not hold, that
    // is all this thread knows about them.
    authorKind: "public",
  });

  await db
    .from("support_inbound_emails")
    .update({
      status: "ticketed",
      ticket_id: ticket.id,
      handled_by: input.staffId,
      handled_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return { ticketId: ticket.id, reference: ticket.reference };
}

/** Read, and not support. Recorded as a decision, never removed. */
export async function ignoreInbound(
  db: SupabaseClient,
  input: { id: string; staffId: string },
): Promise<void> {
  const row = await claim(db, input.id);

  await db
    .from("support_inbound_emails")
    .update({
      status: "ignored",
      handled_by: input.staffId,
      handled_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

/**
 * Fetch a message and refuse it if somebody has already dealt with it.
 *
 * Two people working the same queue is the normal way this screen gets used, and
 * without this the second click opens a second ticket for one customer — who
 * then holds two acknowledgements with two references and quotes whichever comes
 * to hand.
 */
async function claim(
  db: SupabaseClient,
  id: string,
): Promise<{
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body: string;
}> {
  const { data: row } = await db
    .from("support_inbound_emails")
    .select("id, from_email, from_name, subject, body, status")
    .eq("id", id)
    .maybeSingle();

  if (!row) throw new TicketRefused("That message is not here.", 404);
  if (row.status !== "new") {
    throw new TicketRefused(
      "Somebody has already dealt with that one. Reload the queue.",
      409,
    );
  }

  return row;
}
