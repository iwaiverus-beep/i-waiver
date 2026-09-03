"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { send } from "@/lib/client/request";
import { CATEGORY_LABELS, HELP_TOPICS } from "@/lib/support/labels";

/**
 * The triage half of the email listener.
 *
 * One message expanded at a time, with the whole body on screen when it is. The
 * decision this screen exists to support — is this a customer who needs an
 * answer, or is it a newsletter — cannot be made from a subject line, and a
 * console that shows a preview and asks for the decision anyway trains people to
 * guess.
 *
 * The category selector defaults to "Something else" and is deliberately not
 * required. Getting the mail into the queue is the urgent part; a wrong category
 * is fixable from the ticket, whereas mail sitting untriaged because somebody was
 * unsure which topic it was is not.
 */

export type InboxMessage = {
  id: string;
  mailbox: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body: string;
  received_at: string;
};

export function AdminInbox({
  messages,
  canTriage,
}: {
  messages: InboxMessage[];
  canTriage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(messages[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("other");

  async function act(id: string, action: "ticket" | "ignore") {
    setBusy(id);
    setError(null);

    const result = await send(`/api/admin/support/inbox/${id}`, {
      body: action === "ticket" ? { action, category } : { action },
    });

    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Back to the top of what is left, rather than leaving a closed message
    // expanded. The queue is worked oldest first and this keeps that true.
    setOpen(null);
    setCategory("other");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => {
        const isOpen = open === message.id;
        return (
          <div key={message.id} className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : message.id)}
              className="flex w-full flex-wrap items-start justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {message.subject || "(no subject)"}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-muted">
                  {message.from_name ? `${message.from_name} · ` : ""}
                  {message.from_email} → {message.mailbox}
                </span>
              </span>
              <span className="shrink-0 text-xs text-ink-muted">
                {new Date(message.received_at).toLocaleString()}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-line px-5 py-5">
                <p className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {message.body}
                </p>

                {canTriage ? (
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <select
                      aria-label="What this is about"
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
                    >
                      {HELP_TOPICS.map((value) => (
                        <option key={value} value={value}>
                          {CATEGORY_LABELS[value]}
                        </option>
                      ))}
                      <option value="idea">{CATEGORY_LABELS.idea}</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => act(message.id, "ticket")}
                      disabled={busy === message.id}
                      className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
                    >
                      {busy === message.id ? "Working…" : "Open a ticket"}
                    </button>

                    <button
                      type="button"
                      onClick={() => act(message.id, "ignore")}
                      disabled={busy === message.id}
                      className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink disabled:opacity-60"
                    >
                      Not support
                    </button>

                    <a
                      href={`mailto:${message.from_email}`}
                      className="text-xs text-ink-muted underline transition-colors hover:text-ink"
                    >
                      Reply by email instead
                    </a>
                  </div>
                ) : (
                  <p className="mt-5 text-xs text-ink-muted">
                    Your role can read the mailbox but not act on it. Ask someone
                    with support triage to open a ticket from this.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What became of everything already dealt with.
 *
 * Server-rendered elsewhere and read-only here, so it is a plain list rather
 * than part of the component above. It is on the same screen because the first
 * question anybody asks of a listener is not "what is waiting" but "did it get
 * the thing I sent it" — and a triage queue that empties itself into nowhere
 * visible cannot answer that.
 */
export function HandledList({
  rows,
}: {
  rows: {
    id: string;
    from_email: string;
    subject: string | null;
    received_at: string;
    status: string;
    ticket_id: string | null;
    support_tickets: { reference: string; subject: string } | null;
  }[];
}) {
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink">
              {row.subject || "(no subject)"}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-muted">
              {row.from_email} · {new Date(row.received_at).toLocaleString()}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-3 text-xs">
            {row.ticket_id && row.support_tickets ? (
              <Link
                href={`/admin/support/${row.ticket_id}`}
                className="font-mono text-accent underline"
              >
                {row.support_tickets.reference}
              </Link>
            ) : null}
            <span className="text-ink-muted">{OUTCOMES[row.status] ?? row.status}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The words for what happened, which are not the enum's words.
 *
 * 'linked' and 'ticketed' are a distinction about who did it, and it is worth
 * keeping in the data — but on the screen the useful reading is whether a human
 * had to look at it, so that is what these say.
 */
const OUTCOMES: Record<string, string> = {
  linked: "Matched to a thread",
  ticketed: "Ticket opened",
  ignored: "Not support",
};
