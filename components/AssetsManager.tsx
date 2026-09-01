"use client";

import { useMemo, useState } from "react";
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

/** The line that names a thing in a list: "2021 Yamaha VX Cruiser". */
function title(asset: Asset): string {
  return (
    [asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
    asset.description
  );
}

/**
 * The things you lend, saved once and reused.
 *
 * Rows arrive here two ways: added deliberately on this screen, or created on
 * the way through lending something — describing a new jet ski on the agreement
 * form saves it here, so the second loan is a dropdown rather than retyping.
 *
 * Editing is offered without hesitation because of rule 4. An agreement freezes
 * the asset into `agreements.asset_snapshot` when it is sent; this row is only
 * the starting point for a form. Correcting a serial number here cannot alter
 * what a signed agreement says was lent.
 *
 * The declared value earns its own prominence: it is what the damage clause
 * refers to and what physical-damage cover is priced against. An asset saved
 * without one produces an agreement that cannot answer "how much is it worth",
 * so the form nudges rather than treating it as optional detail.
 */
export function AssetsManager({ initial }: { initial: Asset[] }) {
  const [assets, setAssets] = useState(initial);
  const [adding, setAdding] = useState(initial.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // A filter box on four rows is clutter. On thirty it is the only way to find
  // the trailer.
  const searchable = assets.length > 5;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter((asset) =>
      [
        asset.description,
        asset.make,
        asset.model,
        asset.identifier,
        String(asset.year ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [assets, query]);

  async function archive(asset: Asset) {
    const confirmed = window.confirm(
      `Remove ${title(asset)} from your list?\n\n` +
        "Agreements that already use it are not affected.",
    );
    if (!confirmed) return;

    setAssets((current) => current.filter((a) => a.id !== asset.id));
    if (editingId === asset.id) setEditingId(null);
    await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-10">
      {!adding && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setAdding(true)}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
          >
            Add something
          </button>
          {searchable && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your things"
              type="search"
              aria-label="Search your things"
              className="w-full max-w-xs rounded-full border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
          )}
        </div>
      )}

      {adding && (
        <AssetForm
          heading="Add something you lend"
          submitLabel="Save"
          cancellable={assets.length > 0}
          onCancel={() => setAdding(false)}
          onSaved={(asset) => {
            setAssets((current) => [asset, ...current]);
            setAdding(false);
          }}
        />
      )}

      <div className="mt-8 space-y-3">
        {visible.map((asset) =>
          editingId === asset.id ? (
            <AssetForm
              key={asset.id}
              asset={asset}
              heading={`Edit ${title(asset)}`}
              submitLabel="Save changes"
              cancellable
              onCancel={() => setEditingId(null)}
              onSaved={(updated) => {
                setAssets((current) =>
                  current.map((a) => (a.id === updated.id ? updated : a)),
                );
                setEditingId(null);
              }}
            />
          ) : (
            <div
              key={asset.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{title(asset)}</p>
                <p className="truncate text-sm text-ink-soft">
                  {asset.description}
                  {asset.identifier ? ` · ${asset.identifier}` : ""}
                  {" · "}
                  {formatCents(asset.declared_value_cents)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setAdding(false);
                    setEditingId(asset.id);
                  }}
                  className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                >
                  Edit
                </button>
                <button
                  onClick={() => archive(asset)}
                  className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
                >
                  Remove
                </button>
              </div>
            </div>
          ),
        )}

        {searchable && visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
            Nothing matches that.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One field set, used both to add and to edit.
 *
 * Deliberately a single component: two near-identical forms drift apart, and the
 * one that drifts is always the one that stops asking for the declared value.
 */
function AssetForm({
  asset,
  heading,
  submitLabel,
  cancellable,
  onSaved,
  onCancel,
}: {
  asset?: Asset;
  heading: string;
  submitLabel: string;
  cancellable: boolean;
  onSaved: (asset: Asset) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      asset_class: form.get("asset_class"),
      description: form.get("description"),
      identifier: form.get("identifier"),
      declared_value: form.get("declared_value"),
      year: form.get("year"),
      make: form.get("make"),
      model: form.get("model"),
    };

    const response = await fetch(
      asset ? `/api/assets/${asset.id}` : "/api/assets",
      {
        method: asset ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not save it.");
      return;
    }

    onSaved(body.asset as Asset);
  }

  const dollars =
    asset?.declared_value_cents === null || asset?.declared_value_cents === undefined
      ? ""
      : String(asset.declared_value_cents / 100);

  return (
    <form onSubmit={save} className="rounded-2xl border border-line bg-surface/50 p-6">
      <h2 className="text-base font-semibold text-ink">{heading}</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <select
          name="asset_class"
          defaultValue={asset?.asset_class ?? "pwc"}
          className={input}
        >
          {CLASSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="description"
          required
          defaultValue={asset?.description ?? ""}
          placeholder="What it is — e.g. Yamaha WaveRunner"
          className={input}
        />
        <input
          name="year"
          defaultValue={asset?.year ?? ""}
          placeholder="Year"
          inputMode="numeric"
          className={input}
        />
        <input
          name="make"
          defaultValue={asset?.make ?? ""}
          placeholder="Make"
          className={input}
        />
        <input
          name="model"
          defaultValue={asset?.model ?? ""}
          placeholder="Model"
          className={input}
        />
        <input
          name="identifier"
          defaultValue={asset?.identifier ?? ""}
          placeholder="HIN / VIN / serial"
          className={input}
        />
      </div>

      <div className="mt-3">
        <input
          name="declared_value"
          defaultValue={dollars}
          placeholder="What it is worth — e.g. 12,500"
          inputMode="decimal"
          className={input}
        />
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          This is the figure the damage clause points at, and what cover for the
          loan is priced against. Worth getting roughly right.
          {asset
            ? " Changing it affects the next agreement you write, never one already signed."
            : ""}
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-flag">{error}</p>}

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {cancellable && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
