"use client";

import { useMemo, useState } from "react";
import type { EmulatableAccount } from "@/lib/platform/emulation";

/**
 * Choosing a customer to view the product as.
 *
 * A search box rather than a dropdown, because the list is one row per PERSON
 * per lender: a business with four staff offers four different views of the same
 * account, and picking the wrong one shows a screen with the wrong permissions
 * on it — which is worse than useless when the whole point is diagnosing what
 * somebody can see.
 *
 * Nothing is listed until something is typed. A scrollable list of every
 * customer on the platform is an invitation to browse, and browsing is precisely
 * what this feature is not for. Support opens the account of the person they are
 * on the phone with.
 *
 * The reason field is not optional and not a formality — see the route. It is
 * the only part of the audit row that says why, and it is asked here because
 * this is the only moment anybody knows the answer.
 */
export function ViewAsCustomer({
  accounts,
  configured,
}: {
  accounts: EmulatableAccount[];
  /** False when SUPABASE_JWT_SECRET is missing on this deployment. */
  configured: boolean;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<EmulatableAccount | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return accounts
      .filter(
        (a) =>
          a.account_name.toLowerCase().includes(needle) ||
          a.lender_name.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [accounts, query]);

  async function open() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/emulation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: chosen.user_id, reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Could not open that account.");
        setBusy(false);
        return;
      }
      // A full navigation, not router.push. The emulation changes who the server
      // thinks we are for every subsequent request, and the client router holds
      // a cache of pages rendered as the operator — reusing any of it would show
      // the wrong person's screen under the new banner.
      window.location.href = "/home";
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        Viewing as a customer needs{" "}
        <code className="font-mono text-xs">SUPABASE_JWT_SECRET</code> set on
        this deployment. It is the Supabase project&rsquo;s JWT secret, from
        Project Settings → API. Until it is set, this is switched off rather than
        half working — a screen that silently showed your own data under a
        customer&rsquo;s name would be worse than no feature at all.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="view-as-search"
          className="block text-xs font-semibold uppercase tracking-wider text-ink-muted"
        >
          Who is on the phone
        </label>
        <input
          id="view-as-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(null);
          }}
          placeholder="Their name, or their company"
          autoComplete="off"
          className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-ink/40"
        />
        <p className="mt-1.5 text-xs text-ink-muted">
          {accounts.length} account{accounts.length === 1 ? "" : "s"} can be
          viewed. Staff accounts are not among them.
        </p>
      </div>

      {chosen === null && matches.length > 0 && (
        <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line">
          {matches.map((account) => (
            <li key={`${account.originator_id}-${account.user_id}`}>
              <button
                type="button"
                onClick={() => setChosen(account)}
                className="flex w-full items-baseline justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-surface"
              >
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {account.account_name}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {account.lender_kind === "organization"
                      ? `${account.lender_name} · ${account.account_role}`
                      : "Individual"}
                    {account.home_state ? ` · ${account.home_state}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-accent">
                  Choose
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen === null && query.trim().length >= 2 && matches.length === 0 && (
        <p className="text-sm text-ink-muted">
          Nobody by that name. A customer who has never signed in has no account
          to view.
        </p>
      )}

      {chosen && (
        <div className="rounded-xl border border-line bg-surface/60 p-4">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-semibold text-ink">
              {chosen.account_name}
              {chosen.lender_kind === "organization" && (
                <span className="font-normal text-ink-muted">
                  {" "}
                  at {chosen.lender_name}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="shrink-0 text-xs font-semibold text-ink-muted hover:text-ink"
            >
              Change
            </button>
          </div>

          <label
            htmlFor="view-as-reason"
            className="mt-4 block text-xs font-semibold uppercase tracking-wider text-ink-muted"
          >
            Why you are opening it
          </label>
          <input
            id="view-as-reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Support call — says the Send button is missing"
            className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-ink/40"
          />
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Recorded against your name, permanently, alongside whose account you
            opened. The session is read-only and ends by itself.
          </p>

          {error && <p className="mt-3 text-sm text-flag">{error}</p>}

          <button
            type="button"
            onClick={open}
            disabled={busy || reason.trim().length < 3}
            className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Opening…" : "Open their account"}
          </button>
        </div>
      )}
    </div>
  );
}
