"use client";

import { useEffect, useState } from "react";

/**
 * "You still have to sign this."
 *
 * WHY A DIALOG AND NOT A CARD ON THE PAGE. An agreement the lender has sent but
 * not signed is stuck: the borrower may have signed already, the loan may have
 * started, and nothing else happens until this one signature exists. It is the
 * only state in the product where the person looking at the screen is the
 * blocker, so it interrupts. Everything else on the home screen waits to be
 * scrolled to.
 *
 * Dismissal lasts the session, not forever. Closing it means "not now", and the
 * next visit asks again — an unsigned agreement does not stop mattering because
 * somebody pressed X. A NEW one always reopens the dialog, which is why the
 * dismissal is stored as ids rather than a flag.
 */

const DISMISSED_KEY = "iwaiver:signatures-dismissed";

export type PendingSignature = {
  id: string;
  borrowerName: string;
  summary: string;
  window: string;
  /** Whether the other side has already signed. It sharpens the nudge. */
  othersSigned: boolean;
};

export function SignatureReminder({ pending }: { pending: PendingSignature[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending.length === 0) return;

    // Anything not dismissed this session opens it. Storage can throw in a
    // locked-down browser, and a reminder that fails closed is a reminder that
    // does not work — so the fallback is to show it.
    let dismissed: string[] = [];
    try {
      dismissed = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
    } catch {
      dismissed = [];
    }

    const unseen = pending.some((item) => !dismissed.includes(item.id));
    setOpen(unseen);
  }, [pending]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // `close` is stable enough for this: it only reads `pending`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    try {
      sessionStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify(pending.map((item) => item.id)),
      );
    } catch {
      // A browser refusing storage means it asks again on the next page. That is
      // the safe direction to fail in.
    }
  }

  /**
   * Straight into signing, not to the agreement.
   *
   * The same two steps the detail screen's "Sign here now" takes: mint a link
   * for the lender, then walk through it. Their link is still single use and
   * still recorded — they simply never have to copy it to themselves.
   */
  async function sign(id: string) {
    setBusy(id);
    setError(null);

    const response = await fetch(`/api/agreements/${id}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "lender", deliver: false }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.url) {
      setBusy(null);
      setError(
        body.error ?? "Could not open that for signing. Open the agreement itself.",
      );
      return;
    }

    // Busy stays on through the navigation: a button that goes idle first
    // invites a second press and a second minted link.
    window.location.assign(body.url);
  }

  if (!open || pending.length === 0) return null;

  const many = pending.length > 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-reminder-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-paper p-6 shadow-xl shadow-ink/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="signature-reminder-title"
              className="font-serif text-xl tracking-tight"
            >
              {many
                ? `${pending.length} agreements are waiting on you`
                : "One agreement is waiting on you"}
            </h2>
            <p className="mt-1.5 text-sm text-ink-soft">
              {many
                ? "Nothing on these is finished until you sign. Pick one to sign it now."
                : "Nothing on this is finished until you sign it."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-2 -mt-1 shrink-0 rounded-full p-2 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-flag">{error}</p>}

        <div className="mt-5 space-y-3">
          {pending.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => sign(item.id)}
              disabled={busy !== null}
              className="block w-full rounded-2xl border border-line bg-surface/50 px-5 py-4 text-left transition-colors hover:border-ink/30 disabled:opacity-50"
            >
              <p className="text-sm font-semibold text-ink">{item.borrowerName}</p>
              <p className="mt-1 text-sm text-ink-soft">{item.summary}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{item.window}</p>
              <p className="mt-2 text-xs font-semibold text-accent">
                {busy === item.id
                  ? "Opening…"
                  : item.othersSigned
                    ? "They have signed · Sign it now →"
                    : "Sign it now →"}
              </p>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={close}
          className="mt-5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
