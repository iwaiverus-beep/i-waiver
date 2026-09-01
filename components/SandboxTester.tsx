"use client";

import { useState } from "react";
import { send } from "@/lib/client/request";
import { US_STATES } from "@/lib/jurisdictions";

/**
 * Fire a real call at the coverage API with the partner's own sandbox key and
 * show both halves.
 *
 * The key is typed in rather than remembered. It has to be — we hold a hash, not
 * a key — and the component does not put it in localStorage either, because a
 * credential cached in a browser to save four seconds of typing is a bad trade
 * that nobody asked for.
 */

type Half = { request: unknown; status: number; body: unknown } | null;

export function SandboxTester() {
  const [apiKey, setApiKey] = useState("");
  const [state, setState] = useState("FL");
  const [bind, setBind] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Half>(null);
  const [bound, setBound] = useState<Half>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setQuote(null);
    setBound(null);
    setNote(null);

    const result = await send<{ quote: Half; bind: Half; note?: string }>(
      "/api/partners/sandbox-test",
      { body: { api_key: apiKey, jurisdiction: state, bind } },
    );

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuote(result.data.quote);
    setBound(result.data.bind);
    setNote(result.data.note ?? null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <label
              htmlFor="sandbox-key"
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
            >
              Sandbox key
            </label>
            <input
              id="sandbox-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value.trim())}
              placeholder="iwk_sk_…"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 font-mono text-[12px] outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor="sandbox-state"
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
            >
              State
            </label>
            <select
              id="sandbox-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            >
              {US_STATES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={run}
              disabled={busy || !apiKey}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Calling…" : "Run"}
            </button>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2.5 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={bind}
            onChange={(e) => setBind(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Bind the first option too
        </label>

        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          Sandbox keys only. The key is used for this one call and is not stored
          anywhere — not in your browser, and not by us.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}

      {note && <p className="text-sm text-ink-muted">{note}</p>}

      {quote && <Exchange title="Quote" half={quote} />}
      {bound && <Exchange title="Bind" half={bound} />}
    </div>
  );
}

function Exchange({ title, half }: { title: string; half: Half }) {
  if (!half) return null;
  const ok = half.status < 400;

  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span
          className={`rounded-full border px-3 py-0.5 font-mono text-[11px] font-semibold ${
            ok
              ? "border-accent/30 bg-accent-soft text-accent"
              : "border-flag/30 bg-flag/[0.08] text-flag"
          }`}
        >
          {half.status}
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <Body label="Request" value={half.request} />
        <div className="border-t border-line md:border-l md:border-t-0">
          <Body label="Response" value={half.body} />
        </div>
      </div>
    </div>
  );
}

function Body({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="p-5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <pre className="overflow-x-auto rounded-lg bg-surface p-4 font-mono text-[11px] leading-relaxed text-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
