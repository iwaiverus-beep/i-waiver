"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  SUPPORT_CATEGORIES,
} from "@/lib/support/labels";

/**
 * The customer half of support: raise a ticket, read the thread, reply.
 *
 * Threads are server-rendered and passed in rather than fetched, because the page
 * already has a database connection and adding a GET endpoint would mean writing
 * the "is this yours" check a second time. Internal notes are filtered on the
 * server by `customerMessages`, which is the only reader that returns anything to
 * this component.
 */

export type ThreadMessage = {
  id: string;
  author_kind: string;
  author_email: string;
  body: string;
  created_at: string;
};

export type Thread = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  created_at: string;
  messages: ThreadMessage[];
};

export function SupportPanel({
  partnerId,
  threads,
  canWrite,
}: {
  partnerId: string | null;
  threads: Thread[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(threads.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(threads[0]?.id ?? null);
  const [reply, setReply] = useState("");

  async function openTicket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await send("/api/support/tickets", {
      body: {
        partner_id: partnerId,
        subject: form.get("subject"),
        category: form.get("category"),
        body: form.get("body"),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setComposing(false);
    router.refresh();
  }

  async function postReply(ticketId: string) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/support/tickets/${ticketId}/messages`, {
      body: { body: reply },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReply("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canWrite && !composing && (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
        >
          Ask us something
        </button>
      )}

      {composing && canWrite && (
        <form onSubmit={openTicket} className="rounded-xl border border-line p-5">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div>
              <label
                htmlFor="ticket-subject"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
              >
                Subject
              </label>
              <input
                id="ticket-subject"
                name="subject"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="ticket-category"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
              >
                About
              </label>
              <select
                id="ticket-category"
                name="category"
                defaultValue="integration"
                className={inputClass}
              >
                {SUPPORT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label
              htmlFor="ticket-body"
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
            >
              What is happening
            </label>
            <textarea
              id="ticket-body"
              name="body"
              rows={5}
              required
              placeholder="What you called, what came back, and what you expected. Paste the request and response if you have them — never paste a key."
              className={inputClass}
            />
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send"}
            </button>
            {threads.length > 0 && (
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {threads.map((thread) => {
        const isOpen = open === thread.id;
        return (
          <div key={thread.id} className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : thread.id)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {thread.subject}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                  {thread.reference} ·{" "}
                  {CATEGORY_LABELS[thread.category as keyof typeof CATEGORY_LABELS] ??
                    thread.category}
                </span>
              </span>
              <span className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-ink-soft">
                {STATUS_LABELS[thread.status as keyof typeof STATUS_LABELS] ??
                  thread.status}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-line px-5 py-5">
                <ul className="space-y-4">
                  {thread.messages.map((message) => (
                    <li key={message.id}>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                        {message.author_kind === "staff"
                          ? "I-Waiver"
                          : message.author_email}{" "}
                        · {new Date(message.created_at).toLocaleString()}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                        {message.body}
                      </p>
                    </li>
                  ))}
                </ul>

                {canWrite && thread.status !== "closed" && (
                  <div className="mt-5">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={3}
                      placeholder="Reply…"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => postReply(thread.id)}
                      disabled={busy || !reply.trim()}
                      className="mt-3 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
                    >
                      {busy ? "Sending…" : "Reply"}
                    </button>
                  </div>
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

const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent";
