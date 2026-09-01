"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import { STATUS_LABELS, type SupportStatus } from "@/lib/support/labels";

/**
 * Reply to a ticket, and triage it.
 *
 * The internal-note toggle is a visible, coloured state rather than a quiet
 * checkbox, because the whole failure mode of this control is sending a note
 * meant for a colleague to the customer. The textarea changes colour, the button
 * changes label, and the note below says who will read it.
 */
export function AdminTicket({
  ticketId,
  status,
  priority,
  canRespond,
  canTriage,
}: {
  ticketId: string;
  status: string;
  priority: string;
  canRespond: boolean;
  canTriage: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reply() {
    setBusy(true);
    setError(null);
    const result = await send(`/api/support/tickets/${ticketId}/messages`, {
      body: { body, internal },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBody("");
    router.refresh();
  }

  async function triage(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/support/${ticketId}`, {
      method: "PATCH",
      body: patch,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canRespond && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setInternal(false)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                internal
                  ? "text-ink-muted hover:text-ink"
                  : "bg-accent text-paper"
              }`}
            >
              Reply to them
            </button>
            <button
              type="button"
              onClick={() => setInternal(true)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                internal
                  ? "bg-flag text-paper"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              Internal note
            </button>
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder={
              internal
                ? "Only staff will ever see this."
                : "This is emailed to them and shown in their console."
            }
            className={`w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors ${
              internal
                ? "border-flag/40 bg-flag/[0.04] focus:border-flag"
                : "border-line bg-paper focus:border-accent"
            }`}
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={reply}
              disabled={busy || !body.trim()}
              className={`rounded-full px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60 ${
                internal ? "bg-flag" : "bg-accent"
              }`}
            >
              {busy ? "Sending…" : internal ? "Save the note" : "Send the reply"}
            </button>
            <span className="text-xs text-ink-muted">
              {internal
                ? "Nobody outside i-Waiver sees this, and it does not start the response clock."
                : "Goes to their inbox and their console."}
            </span>
          </div>
        </div>
      )}

      {canTriage && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <select
            value={status}
            onChange={(e) => triage({ status: e.target.value as SupportStatus })}
            disabled={busy}
            className="rounded-lg border border-line bg-paper px-3.5 py-2 text-sm outline-none focus:border-accent"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={priority}
            onChange={(e) => triage({ priority: e.target.value })}
            disabled={busy}
            className="rounded-lg border border-line bg-paper px-3.5 py-2 text-sm outline-none focus:border-accent"
          >
            {["low", "normal", "high", "urgent"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => triage({ assign_to_me: true })}
            disabled={busy}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-ink/40 disabled:opacity-60"
          >
            Assign to me
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}
