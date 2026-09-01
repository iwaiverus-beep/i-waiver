"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";

/**
 * Approve or decline a partner application.
 *
 * Declining requires a reason because the reason is emailed to the applicant, and
 * "we are not able to take this forward" with nothing after it is the kind of
 * answer that generates three more emails.
 *
 * Approving does not require one: the note is internal, and approving is not the
 * decision anyone needs to justify to the person on the other end.
 */
export function ApplicationDecision({
  applicationId,
  status,
  canDecide,
}: {
  applicationId: string;
  status: string;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"approve" | "decline" | null>(null);

  if (!canDecide) {
    return (
      <p className="text-sm text-ink-muted">
        Your role can read applications but not decide them.
      </p>
    );
  }

  if (status === "approved" || status === "declined" || status === "withdrawn") {
    return (
      <p className="text-sm text-ink-muted">
        Already {status}. Changing that is a conversation, not a button.
      </p>
    );
  }

  async function act(action: "approve" | "decline" | "in_review") {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/applications/${applicationId}`, {
      body: { action, note: note || null },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="decision-note"
          className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
        >
          Note
        </label>
        <textarea
          id="decision-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="On an approval this is internal. On a decline it is emailed to them, so write it to them."
          className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {confirming === "approve" ? (
          <>
            <button
              type="button"
              onClick={() => act("approve")}
              disabled={busy}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
            >
              {busy ? "Working…" : "Yes — create the partner"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft"
            >
              Cancel
            </button>
          </>
        ) : confirming === "decline" ? (
          <>
            <button
              type="button"
              onClick={() => act("decline")}
              disabled={busy || !note.trim()}
              className="rounded-full bg-flag px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
            >
              {busy ? "Working…" : "Yes — decline and email them"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft"
            >
              Cancel
            </button>
            {!note.trim() && (
              <p className="w-full text-xs text-flag">
                Write a reason first — they read it.
              </p>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirming("approve")}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setConfirming("decline")}
              className="rounded-full border border-flag/40 px-5 py-2.5 text-sm font-semibold text-flag transition-colors hover:bg-flag/[0.08]"
            >
              Decline
            </button>
            {status === "new" && (
              <button
                type="button"
                onClick={() => act("in_review")}
                disabled={busy}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft disabled:opacity-60"
              >
                Claim for review
              </button>
            )}
          </>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        Approving creates the partner, makes the contact an owner, and emails them
        a sign-in link. It does not issue any key — they mint their own sandbox
        key, and a live key comes later, from the partner page.
      </p>

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}
