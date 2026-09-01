"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QrCode } from "./QrCode";

export type BoardMember = {
  agreementId: string;
  role: "rental" | "participant";
  status: string;
  displayName: string;
  email: string | null;
  signedAt: string | null;
  declinedAt: string | null;
};

export type BoardLink = {
  slug: string;
  url: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
};

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-ink/40";

/**
 * The booking, as the person at the counter uses it.
 *
 * One question is being asked of this screen and it is asked with a boat waiting:
 * can these people get on yet. So the count leads, in words, and everything else
 * is arranged underneath it. A list of twelve rows with a status column would make
 * somebody count green ticks with a queue behind them.
 *
 * Both ways of adding a person are here together, because a shop uses both within
 * the same five minutes: the code goes up on the counter for whoever is standing
 * there, and the typed form is for the family who are still parking.
 */
export function GroupBoard({
  groupId,
  label,
  closed,
  members,
  link,
}: {
  groupId: string;
  label: string;
  closed: boolean;
  members: BoardMember[];
  link: BoardLink | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const done = members.filter((m) => m.status === "executed").length;
  const waiting = members.filter(
    (m) => m.status !== "executed" && m.status !== "voided",
  );
  const everyoneIn = waiting.length === 0 && members.length > 0;

  async function call(url: string, init: RequestInit) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");
      router.refresh();
      return payload;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const result = await call(`/api/groups/${groupId}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        email: data.get("email"),
      }),
    });

    if (result) {
      form.reset();
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Where the booking stands ------------------------------------ */}
      <div className="rounded-2xl border border-line bg-surface/50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </p>
        <p className="mt-2 text-2xl font-semibold text-ink">
          {members.length === 0
            ? "Nobody on this booking yet"
            : everyoneIn
              ? `All ${members.length} have signed`
              : `${done} of ${members.length} have signed`}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {everyoneIn
            ? "Everybody aboard has their own signed release. You are clear to go."
            : waiting.length === 1
              ? `Still waiting on ${waiting[0].displayName}.`
              : `Still waiting on ${waiting.length} people. Nobody should board until their own release is signed — one person's signature does not cover anybody else.`}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-flag/40 bg-flag/5 px-4 py-3 text-sm text-ink">
          {error}
        </div>
      )}

      {/* ---- The people -------------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-line">
        <ul className="divide-y divide-line">
          {members.map((member) => (
            <li
              key={member.agreementId}
              className="flex flex-wrap items-center justify-between gap-3 bg-paper px-5 py-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/agreements/${member.agreementId}`}
                  className="text-sm font-semibold text-ink hover:underline"
                >
                  {member.displayName}
                </Link>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {member.role === "rental"
                    ? "Took the boat — damage and return are theirs"
                    : "Riding along — release only"}
                  {member.email ? ` · ${member.email}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  member.status === "executed"
                    ? "bg-ink text-paper"
                    : member.declinedAt
                      ? "bg-flag/10 text-ink"
                      : "bg-surface text-ink-soft"
                }`}
              >
                {member.status === "executed"
                  ? "Signed"
                  : member.declinedAt
                    ? "Declined"
                    : member.status === "draft"
                      ? "Not sent"
                      : "Waiting"}
              </span>
            </li>
          ))}

          {members.length === 0 && (
            <li className="bg-paper px-5 py-6 text-sm text-ink-soft">
              Nobody yet. Add the other households below.
            </li>
          )}
        </ul>
      </div>

      {/* ---- Adding people ----------------------------------------------- */}
      {!closed && (
        <div className="rounded-2xl border border-line bg-paper p-6">
          <h2 className="text-base font-semibold text-ink">Add the others</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Every adult coming signs their own release. It says nothing about
            returning the boat — that stays with whoever took it.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {/* The code. */}
            <div className="rounded-xl border border-line bg-surface/40 p-5">
              <p className="text-sm font-semibold text-ink">A code on the counter</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                Each adult taps it and signs on their own phone. Nothing to type at
                your end.
              </p>

              {link ? (
                <div className="mt-4 space-y-3">
                  {showCode && (
                    <div className="rounded-lg bg-paper p-3">
                      <QrCode url={link.url} label="Check in here" />
                    </div>
                  )}
                  <p className="break-all font-mono text-xs text-ink-soft">
                    {link.url}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {link.maxUses - link.uses} of {link.maxUses} left · expires{" "}
                    {new Date(link.expiresAt).toLocaleString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCode((v) => !v)}
                      className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper"
                    >
                      {showCode ? "Hide the code" : "Show the code"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        call(`/api/groups/${groupId}/link`, { method: "DELETE" })
                      }
                      className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink-soft disabled:opacity-50"
                    >
                      Withdraw it
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    call(`/api/groups/${groupId}/link`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({}),
                    })
                  }
                  className="mt-4 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-50"
                >
                  Make a check-in code
                </button>
              )}
            </div>

            {/* By hand. */}
            <div className="rounded-xl border border-line bg-surface/40 p-5">
              <p className="text-sm font-semibold text-ink">Or email it to them</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                For anyone not standing in front of you. Their release goes straight
                to their inbox.
              </p>

              {adding ? (
                <form onSubmit={addPerson} className="mt-4 space-y-3">
                  <input
                    name="name"
                    placeholder="Their name"
                    required
                    maxLength={120}
                    className={input}
                  />
                  <input
                    name="email"
                    type="email"
                    placeholder="Their email"
                    required
                    maxLength={320}
                    className={input}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-50"
                    >
                      {busy ? "Sending…" : "Send their release"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink-soft"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-4 rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
                >
                  Add someone
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Closing ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-6 py-5">
        <p className="text-sm text-ink-soft">
          {closed
            ? "This booking is closed. Nobody else can join, and the check-in code has been withdrawn."
            : "Closing stops anyone else joining. It changes nothing anybody has already signed."}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            call(`/api/groups/${groupId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ closed: !closed }),
            })
          }
          className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {closed ? "Reopen it" : "Close the booking"}
        </button>
      </div>
    </div>
  );
}
