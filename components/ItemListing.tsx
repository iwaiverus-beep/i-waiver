"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";
import { formatRate, orderedPhotos, photoUrl, type AssetPhoto, type RateUnit } from "@/lib/assets/fields";

/**
 * What a borrower sees before they are asked for anything.
 *
 * This is the one screen in the product that is trying to sell something, and it
 * is still bounded by the same rule as the rest of the intake side: everything on
 * it is the lender's own statement about their own item, read from their record.
 * The person looking at it types nothing that lands here.
 *
 * The price is an asking price and is labelled as one. Nothing is owed on it and
 * nothing is agreed by looking at it — what a borrower actually owes is stated on
 * the agreement, by a person, after this.
 */

export type ListingItem = {
  id: string;
  description: string;
  headline: string | null;
  details_md: string | null;
  rate_cents: number | null;
  rate_unit: RateUnit | null;
  deposit_cents: number | null;
  declared_value_cents: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  asset_photos: AssetPhoto[] | null;
};

/** The line that names a thing: "2021 Yamaha VX Cruiser", falling back to the label. */
export function itemTitle(item: ListingItem): string {
  return (
    [item.year, item.make, item.model].filter(Boolean).join(" ") || item.description
  );
}

/**
 * The gallery.
 *
 * One large photograph with thumbnails beneath, rather than a carousel that moves
 * on its own: somebody deciding whether a boat is the right boat wants to go back
 * to the second picture, and an auto-advancing hero takes it away from them.
 */
function Gallery({ item }: { item: ListingItem }) {
  const photos = orderedPhotos(item.asset_photos);
  const [active, setActive] = useState(0);

  if (photos.length === 0) return null;

  const lead = photos[Math.min(active, photos.length - 1)];

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element -- the bucket host is
            not in next.config images; a plain img avoids the optimiser entirely
            and these are already sized for a phone. */}
        <img
          src={photoUrl(lead.storage_path)}
          alt={lead.alt ?? itemTitle(item)}
          className="aspect-[4/3] w-full object-cover"
        />
      </div>

      {photos.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Photograph ${index + 1} of ${photos.length}`}
              aria-current={index === active}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border transition-colors ${
                index === active ? "border-ink" : "border-line hover:border-ink/40"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl(photo.storage_path)}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ItemListing({ item }: { item: ListingItem }) {
  const rate = formatRate(item.rate_cents, item.rate_unit);

  return (
    <div className="mt-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        What you are asking for
      </p>

      <h2 className="mt-1 text-xl font-semibold text-ink">{itemTitle(item)}</h2>

      {item.headline && (
        <p className="mt-1 text-base text-ink-soft">{item.headline}</p>
      )}

      <Gallery item={item} />

      <div className="mt-5 rounded-2xl border border-line bg-surface/50 p-5">
        <p className="text-sm text-ink-soft">{item.description}</p>

        {item.details_md && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
            {item.details_md}
          </p>
        )}

        {(rate || item.deposit_cents !== null) && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-line pt-4">
            {rate && (
              <p className="text-base font-semibold tabular-nums text-ink">{rate}</p>
            )}
            {item.deposit_cents !== null && (
              <p className="text-sm text-ink-soft">
                Deposit{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {formatCents(item.deposit_cents)}
                </span>
              </p>
            )}
          </div>
        )}

        {rate && (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            What they ask for it. Nothing is owed by asking — the amounts are set
            out on the agreement they send you, and you read it before you sign.
          </p>
        )}
      </div>
    </div>
  );
}
