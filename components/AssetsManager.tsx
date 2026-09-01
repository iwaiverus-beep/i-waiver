"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@/lib/format";
import {
  allowedRateUnits,
  formatRate,
  orderedPhotos,
  photoUrl,
  RATE_UNIT_LABELS,
  type AssetPhoto,
  type RateUnit,
} from "@/lib/assets/fields";

export type Asset = {
  id: string;
  owner_originator_id: string;
  asset_class: string;
  description: string;
  identifier: string | null;
  declared_value_cents: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  // The merchandising half. Read by the lender's public page and by nothing in
  // lib/render/ — see 20260901000028.
  headline: string | null;
  details_md: string | null;
  rate_cents: number | null;
  rate_unit: RateUnit | null;
  deposit_cents: number | null;
  quantity: number;
  is_offerable: boolean;
  asset_photos: AssetPhoto[] | null;
};

export type AssetOfferRow = {
  parent_asset_id: string;
  offer_asset_id: string;
  order_index: number;
  default_selected: boolean;
};

export type OriginatorKind = "individual" | "organization";

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-accent";

const label =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted";

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

/** Cents back to the string a text box wants. Empty stays empty. */
function dollarsFor(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : String(cents / 100);
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
 *
 * Since 20260901000028 a row has a second face — a headline, photographs, an
 * asking price — which is what a stranger scanning a printed code sees. The two
 * halves are kept visibly apart in the form for the reason the migration gives:
 * `description` is the legal label that prints on Schedule A, and `headline` is
 * sales copy that reaches no document at all.
 */
export function AssetsManager({
  initial,
  initialOffers = [],
  orgOriginatorIds = [],
}: {
  initial: Asset[];
  initialOffers?: AssetOfferRow[];
  /** This lender's business originators. An item owned by one may be priced per period. */
  orgOriginatorIds?: string[];
}) {
  // Per item, because a person can own things under both kinds of originator.
  // A new item is always individual-owned — `POST /api/assets` files it under
  // `ensureIndividualOriginator` — so the add form offers the individual set.
  const kindOf = (asset?: Asset): OriginatorKind =>
    asset && orgOriginatorIds.includes(asset.owner_originator_id)
      ? "organization"
      : "individual";

  const [assets, setAssets] = useState(initial);
  const [offers, setOffers] = useState(initialOffers);
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
        asset.headline,
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
    setOffers((current) =>
      current.filter(
        (offer) =>
          offer.parent_asset_id !== asset.id && offer.offer_asset_id !== asset.id,
      ),
    );
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
          originatorKind={kindOf()}
          onCancel={() => setAdding(false)}
          onSaved={(asset) => {
            setAssets((current) => [asset, ...current]);
            setAdding(false);
            // Straight into editing it, because photographs and suggestions both
            // need a row to hang off and a lender who has just described their
            // boat is the most likely person in the world to want to add a
            // picture of it.
            setEditingId(asset.id);
          }}
        />
      )}

      <div className="mt-8 space-y-3">
        {visible.map((asset) =>
          editingId === asset.id ? (
            <div key={asset.id} className="space-y-3">
              <AssetForm
                asset={asset}
                heading={`Edit ${title(asset)}`}
                submitLabel="Save changes"
                cancellable
                originatorKind={kindOf(asset)}
                onCancel={() => setEditingId(null)}
                onSaved={(updated) => {
                  setAssets((current) =>
                    current.map((a) => (a.id === updated.id ? updated : a)),
                  );
                  setEditingId(null);
                }}
              />
              <PhotoManager
                asset={asset}
                onChanged={(photos) =>
                  setAssets((current) =>
                    current.map((a) =>
                      a.id === asset.id ? { ...a, asset_photos: photos } : a,
                    ),
                  )
                }
              />
              <OffersPicker
                asset={asset}
                assets={assets}
                offers={offers}
                onSaved={(next) =>
                  setOffers((current) => [
                    ...current.filter((offer) => offer.parent_asset_id !== asset.id),
                    ...next,
                  ])
                }
              />
            </div>
          ) : (
            <AssetRow
              key={asset.id}
              asset={asset}
              offerCount={
                offers.filter((offer) => offer.parent_asset_id === asset.id).length
              }
              onEdit={() => {
                setAdding(false);
                setEditingId(asset.id);
              }}
              onRemove={() => archive(asset)}
            />
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

/** One row in the list. Shows enough of the listing to see it is set up. */
function AssetRow({
  asset,
  offerCount,
  onEdit,
  onRemove,
}: {
  asset: Asset;
  offerCount: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const lead = orderedPhotos(asset.asset_photos)[0];
  const rate = formatRate(asset.rate_cents, asset.rate_unit);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4">
      <div className="flex min-w-0 items-center gap-4">
        {lead ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photoUrl(lead.storage_path)}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-xl border border-dashed border-line" />
        )}

        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {title(asset)}
            {asset.is_offerable && (
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                On your page
              </span>
            )}
          </p>
          <p className="truncate text-sm text-ink-soft">
            {asset.description}
            {asset.identifier ? ` · ${asset.identifier}` : ""}
            {" · "}
            {formatCents(asset.declared_value_cents)}
            {rate ? ` · ${rate}` : ""}
            {offerCount > 0
              ? ` · suggests ${offerCount} ${offerCount === 1 ? "other" : "others"}`
              : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
        >
          Edit
        </button>
        <button
          onClick={onRemove}
          className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
        >
          Remove
        </button>
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
  originatorKind,
  onSaved,
  onCancel,
}: {
  asset?: Asset;
  heading: string;
  submitLabel: string;
  cancellable: boolean;
  originatorKind: OriginatorKind;
  onSaved: (asset: Asset) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerable, setOfferable] = useState(asset?.is_offerable ?? false);

  const units = allowedRateUnits(originatorKind);

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
      headline: form.get("headline"),
      details_md: form.get("details_md"),
      rate: form.get("rate"),
      rate_unit: form.get("rate_unit"),
      deposit: form.get("deposit"),
      quantity: form.get("quantity"),
      is_offerable: offerable,
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

  return (
    <form onSubmit={save} className="rounded-2xl border border-line bg-surface/50 p-6">
      <h2 className="text-base font-semibold text-ink">{heading}</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <select
          name="asset_class"
          defaultValue={asset?.asset_class ?? "pwc"}
          className={input}
        >
          {CLASSES.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
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
          defaultValue={dollarsFor(asset?.declared_value_cents)}
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

      {/* ---- the listing ---- */}

      <div className="mt-8 border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink">Its listing</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          What somebody sees when they scan your code. None of it goes on the
          agreement — that uses the plain description above.
        </p>

        <div className="mt-4 space-y-3">
          <input
            name="headline"
            defaultValue={asset?.headline ?? ""}
            placeholder="A line that sells it — e.g. Seats three, easy on fuel"
            maxLength={120}
            className={input}
          />

          <textarea
            name="details_md"
            defaultValue={asset?.details_md ?? ""}
            rows={4}
            maxLength={4000}
            placeholder="The longer description. What is included, what to bring, where to meet."
            className={input}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <span className={label}>Price</span>
              <input
                name="rate"
                defaultValue={dollarsFor(asset?.rate_cents)}
                placeholder="45"
                inputMode="decimal"
                className={input}
              />
            </div>
            <div>
              <span className={label}>Per</span>
              <select
                name="rate_unit"
                defaultValue={asset?.rate_unit ?? units[0]}
                className={input}
              >
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {RATE_UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className={label}>Deposit</span>
              <input
                name="deposit"
                defaultValue={dollarsFor(asset?.deposit_cents)}
                placeholder="Optional"
                inputMode="decimal"
                className={input}
              />
            </div>
          </div>

          {originatorKind === "individual" && (
            <p className="text-xs leading-relaxed text-ink-muted">
              As an individual you can put a one-off amount for what you are out of
              pocket — delivery, fuel, cleaning. Charging by the day for the use of
              the thing makes it a rental, which your own insurance will not cover.
              Renting things out for a fee needs a business account.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <span className={label}>How many</span>
              <input
                name="quantity"
                defaultValue={asset?.quantity ?? 1}
                inputMode="numeric"
                className={input}
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            How many you have, for the things there are several of. It is not a
            calendar — nothing here knows whether one is already out.
          </p>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper p-4">
            <input
              type="checkbox"
              checked={offerable}
              onChange={(e) => setOfferable(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">
                Show this on your public page
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                Off, a scanned code shows only the plain details. On, it shows the
                photographs, the description and the price.
              </span>
            </span>
          </label>
        </div>
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

/**
 * The gallery, managed one photograph at a time.
 *
 * Uploads go straight up on selection rather than waiting for the form to be
 * submitted, because they belong to the row rather than to the edit: a lender who
 * adds three pictures and then presses Cancel has still added three pictures, and
 * pretending otherwise would mean holding megabytes of image in the browser to
 * throw away.
 */
function PhotoManager({
  asset,
  onChanged,
}: {
  asset: Asset;
  onChanged: (photos: AssetPhoto[]) => void;
}) {
  const [photos, setPhotos] = useState(orderedPhotos(asset.asset_photos));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function commit(next: AssetPhoto[]) {
    setPhotos(next);
    onChanged(next);
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);

    // One at a time. The route counts what is already there before accepting
    // another, so six parallel uploads against a limit of six is a race that ends
    // with a confusing refusal on an arbitrary one of them.
    let next = photos;
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`/api/assets/${asset.id}/photos`, {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error ?? "That photograph did not upload.");
        break;
      }
      next = [...next, payload.photo as AssetPhoto];
      commit(next);
    }

    setBusy(false);
  }

  async function remove(photo: AssetPhoto) {
    const next = photos.filter((p) => p.id !== photo.id);
    commit(next);
    await fetch(`/api/assets/${asset.id}/photos?photo=${photo.id}`, {
      method: "DELETE",
    });
  }

  async function move(from: number, to: number) {
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next.map((photo, index) => ({ ...photo, order_index: index })));

    await fetch(`/api/assets/${asset.id}/photos`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: next.map((photo) => photo.id) }),
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface/50 p-6">
      <h3 className="text-sm font-semibold text-ink">Photographs</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Up to six. The first one is the one people see in a list.
      </p>

      {photos.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {photos.map((photo, index) => (
            <div key={photo.id} className="w-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl(photo.storage_path)}
                alt={photo.alt ?? ""}
                className="h-24 w-24 rounded-xl border border-line object-cover"
              />
              <div className="mt-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label="Move earlier"
                  className="px-1 text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  className="px-1 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === photos.length - 1}
                  aria-label="Move later"
                  className="px-1 text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {photos.length < 6 && (
        <label className="mt-4 inline-flex cursor-pointer items-center rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40">
          {busy ? "Uploading…" : "Add photographs"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      )}

      {error && <p className="mt-3 text-sm text-flag">{error}</p>}
    </div>
  );
}

/**
 * "When somebody asks for this, suggest these."
 *
 * A flat list of tick boxes over the lender's other items, saved wholesale. The
 * upsell in the product is exactly this and nothing more: what a borrower ticks
 * arrives as a note on their request, and turning it into a line on Schedule A
 * still happens on the ordinary draft form, with a person reading it.
 */
function OffersPicker({
  asset,
  assets,
  offers,
  onSaved,
}: {
  asset: Asset;
  assets: Asset[];
  offers: AssetOfferRow[];
  onSaved: (offers: AssetOfferRow[]) => void;
}) {
  const others = assets.filter((candidate) => candidate.id !== asset.id);
  const mine = offers.filter((offer) => offer.parent_asset_id === asset.id);

  const [picked, setPicked] = useState<string[]>(() =>
    [...mine].sort((a, b) => a.order_index - b.order_index).map((o) => o.offer_asset_id),
  );
  const [defaults, setDefaults] = useState<string[]>(() =>
    mine.filter((o) => o.default_selected).map((o) => o.offer_asset_id),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (others.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface/50 p-6">
        <h3 className="text-sm font-semibold text-ink">Suggest with it</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Add a second thing to your list — a cooler, a trailer, delivery — and you
          can offer it alongside this one.
        </p>
      </div>
    );
  }

  function toggle(id: string) {
    setSaved(false);
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/assets/${asset.id}/offers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        offers: picked.map((id) => ({
          asset_id: id,
          default_selected: defaults.includes(id),
        })),
      }),
    });

    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not save those.");
      return;
    }

    setSaved(true);
    onSaved(
      picked.map((id, index) => ({
        parent_asset_id: asset.id,
        offer_asset_id: id,
        order_index: index,
        default_selected: defaults.includes(id),
      })),
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface/50 p-6">
      <h3 className="text-sm font-semibold text-ink">Suggest with it</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Shown to somebody asking for {title(asset)}, to tick if they want them.
      </p>

      <div className="mt-4 space-y-2">
        {others.map((other) => {
          const chosen = picked.includes(other.id);
          const rate = formatRate(other.rate_cents, other.rate_unit);

          return (
            <div
              key={other.id}
              className={`rounded-xl border p-3 transition-colors ${
                chosen ? "border-ink bg-paper" : "border-line"
              }`}
            >
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={chosen}
                  onChange={() => toggle(other.id)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {title(other)}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">
                    {other.headline ?? other.description}
                  </span>
                </span>
                {rate && (
                  <span className="shrink-0 text-sm tabular-nums text-ink-soft">
                    {rate}
                  </span>
                )}
              </label>

              {chosen && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 pl-7 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={defaults.includes(other.id)}
                    onChange={() => {
                      setSaved(false);
                      setDefaults((current) =>
                        current.includes(other.id)
                          ? current.filter((x) => x !== other.id)
                          : [...current, other.id],
                      );
                    }}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  Ticked to begin with
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-flag">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="mt-4 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-40"
      >
        {busy ? "Saving…" : saved ? "Saved" : "Save suggestions"}
      </button>
    </div>
  );
}
