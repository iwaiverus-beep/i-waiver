"use client";

import { useState } from "react";

type Verdict = {
  intact: boolean;
  events: number;
  first_break_at: number | null;
  checked_at: string;
};

/**
 * Re-derives the audit chain on demand.
 *
 * Deliberately a button rather than a badge rendered at page load. "Verified" is a
 * claim about this moment, and a stored flag saying so would be the first thing
 * anyone with write access would set.
 */
export function VerifyChain({ agreementId }: { agreementId: string }) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/agreements/${agreementId}/verify`);
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not verify.");
      return;
    }
    setVerdict(body);
  }

  return (
    <div className="space-y-3">
      <button
        onClick={verify}
        disabled={busy}
        className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Verify the chain"}
      </button>

      {error && <p className="text-sm text-flag">{error}</p>}

      {verdict && (
        <div
          className={`rounded-xl border px-5 py-4 text-sm leading-relaxed ${
            verdict.intact
              ? "border-accent/25 bg-accent-soft text-accent"
              : "border-flag/30 bg-flag/[0.06] text-flag"
          }`}
        >
          {verdict.intact ? (
            <>
              <strong className="font-semibold">Intact.</strong> All {verdict.events}{" "}
              entries hash to the values stored against them, and each one still names
              the entry before it. Nothing has been altered since it was written.
            </>
          ) : (
            <>
              <strong className="font-semibold">Broken at entry {verdict.first_break_at}.</strong>{" "}
              An entry no longer hashes to its own contents, or one has been removed.
              Treat this record as compromised and preserve the database as it stands.
            </>
          )}
          <p className="mt-2 text-xs opacity-70">
            Checked {new Date(verdict.checked_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
