"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";

export type Asset = {
  id: string;
  asset_class: string;
  description: string;
  identifier: string | null;
  declared_value_cents: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
};

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-accent";

const CLASSES: [string, string][] = [
  ["pwc", "Jet ski / PWC"],
  ["boat", "Boat"],
  ["trailer", "Trailer"],
  ["vehicle", "Vehicle"],
  ["equipment", "Equipment"],
  ["other", "Something else"],
];

/**
 * The things you lend, saved once and reused.
 *
 * The declared value earns its own prominence: it is what the damage clause
 * refers to and what physical-damage cover is priced against. An asset saved
 * without one produces an agreement that cannot answer "how much is it worth",
 * so the form nudges rather than treating it as optional detail.
 */
export function AssetsManager({ initial }: { initial: Asset[] }) {
  const [assets, setAssets] = useState(initial);
  const [open, setOpen] = useState(initial.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asset_class: form.get("asset_class"),
        description: form.get("description"),
        identifier: form.get("identifier"),
        declared_value: form.get("declared_value"),
        year: form.get("year"),
        make: form.get("make"),
        model: form.get("model"),
      }),
    });

    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not save it.");
      return;
    }

    setAssets((current) => [body.asset, ...current]);
    setOpen(false);
    (event.target as HTMLFormElement).reset();
  }

  async function archive(id: string) {
    setAssets((current) => current.filter((a) => a.id !== id));
    await fetch(`/api/assets/${id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-10">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
        >
          Add something
        </button>
      )}

      {open && (
        <form onSubmit={save} className="rounded-2xl border border-line bg-surface/50 p-6">
          <h2 className="text-base font-semibold text-ink">Add something you lend</h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select name="asset_class" defaultValue="pwc" className={input}>
              {CLASSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              name="description"
              required
              placeholder="What it is — e.g. Yamaha WaveRunner"
              className={input}
            />
            <input name="year" placeholder="Year" inputMode="numeric" className={input} />
            <input name="make" placeholder="Make" className={input} />
            <input name="model" placeholder="Model" className={input} />
            <input
              name="identifier"
              placeholder="HIN / VIN / serial"
              className={input}
            />
          </div>

          <div className="mt-3">
            <input
              name="declared_value"
              placeholder="What it is worth — e.g. 12,500"
              inputMode="decimal"
              className={input}
            />
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              This is the figure the damage clause points at, and what cover for
              the loan is priced against. Worth getting roughly right.
            </p>
          </div>

          {error && <p className="mt-3 text-sm text-flag">{error}</p>}

          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {assets.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="mt-8 space-y-3">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {[asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
                  asset.description}
              </p>
              <p className="truncate text-sm text-ink-soft">
                {asset.description}
                {asset.identifier ? ` · ${asset.identifier}` : ""}
                {" · "}
                {formatCents(asset.declared_value_cents)}
              </p>
            </div>
            <button
              onClick={() => archive(asset.id)}
              className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
