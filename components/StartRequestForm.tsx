"use client";

import { useState } from "react";

/**
 * The borrower's side, filled in on their own phone.
 *
 * Asks for as little as it can. A name, one way to be reached, and when they want
 * the thing — nothing else is knowable at this point and nothing else is needed to
 * put a request in front of a lender. In particular it does not ask for the
 * declared value, the state, or what the item is, even on an originator-level
 * code: those are the lender's to state, and a stranger setting the declared value
 * would be pricing their own liability.
 *
 * There is no confirmation to poll and no status to come back to. Once it is
 * filed, the next thing this person hears is the lender getting in touch, which is
 * the same shape as walking up to a counter and being told someone will be with
 * them.
 */

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-ink/40";

export function StartRequestForm({ slug, lender }: { slug: string; lender: string }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="mt-8 rounded-2xl border border-line bg-surface/50 p-6">
        <h2 className="text-lg font-semibold text-ink">That is with them</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          {lender} has your request. If they take it up, the agreement arrives by
          email or text for you to read and sign. Nothing is signed yet and you have
          not agreed to anything.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          You can close this page.
        </p>
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/intake/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          borrower_name: form.get("borrower_name"),
          borrower_email: form.get("borrower_email"),
          borrower_phone: form.get("borrower_phone"),
          starts_at: form.get("starts_at") || null,
          ends_at: form.get("ends_at") || null,
          note: form.get("note") || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "That did not go through.");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not go through.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Your name
        </span>
        <input name="borrower_name" required maxLength={120} className={input} />
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Email
          </span>
          <input name="borrower_email" type="email" maxLength={200} className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Or phone
          </span>
          <input name="borrower_phone" type="tel" maxLength={30} className={input} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-ink-muted">
        One of the two is enough. It is how the agreement reaches you.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
            From
          </span>
          <input name="starts_at" type="datetime-local" className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Until
          </span>
          <input name="ends_at" type="datetime-local" className={input} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Anything they should know
        </span>
        <textarea name="note" rows={3} maxLength={500} className={input} />
      </label>

      {error && <p className="text-sm text-flag">{error}</p>}

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-opacity disabled:opacity-50"
      >
        {sending ? "Sending…" : "Send this to them"}
      </button>
    </form>
  );
}
