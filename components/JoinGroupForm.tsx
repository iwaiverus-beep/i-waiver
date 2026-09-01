"use client";

import { useState } from "react";

/**
 * Checking in, on your own phone, standing on a dock.
 *
 * Two fields and a button. Everything else about the document — whose boat, which
 * boat, which hours, which state, which wording — is already fixed by the booking
 * and is not this person's to set. That is not a simplification for the sake of a
 * short form; it is the reason a stranger holding this link cannot do any harm
 * with it.
 *
 * On success it goes straight to the signing page rather than saying "check your
 * email". The whole point of a code on a counter is that the person is here now,
 * and sending them to an inbox on marina wifi is how a boat leaves with somebody
 * unsigned aboard. The email still arrives — it is their copy — but it is not the
 * path.
 */

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-ink/40";

export function JoinGroupForm({ slug, lender }: { slug: string; lender: string }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/join/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "That did not go through.");

      // A full navigation, not a router push: the signing page is the end of this
      // one, and leaving the check-in form in the history means a back button that
      // offers to create a second release for the same person.
      window.location.href = payload.url as string;
    } catch (cause) {
      setError((cause as Error).message);
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="name" className="text-sm font-semibold text-ink">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          placeholder="As it should appear on the document"
          className={`${input} mt-2`}
        />
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-semibold text-ink">
          Your email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          placeholder="Where your signed copy goes"
          className={`${input} mt-2`}
        />
      </div>

      {error && (
        <p className="rounded-xl border border-flag/40 bg-flag/5 px-4 py-3 text-sm text-ink">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-full bg-ink px-6 py-4 text-base font-semibold text-paper disabled:opacity-50"
      >
        {sending ? "One moment…" : "Read and sign my release"}
      </button>

      <p className="text-xs leading-relaxed text-ink-muted">
        You are signing for yourself only. Nobody else in your party is covered by
        your signature, and yours does not cover them — each adult taps this code
        and signs their own. You do not need an account, and {lender} will not ask
        you to make one.
      </p>
    </form>
  );
}
