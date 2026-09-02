"use client";

import { useMemo, useState } from "react";
import { formatRate, orderedPhotos, photoUrl } from "@/lib/assets/fields";
import { formatCents } from "@/lib/format";
import { itemTitle, type ListingItem } from "@/components/ItemListing";
import { SMS_CONSENT_TEXT } from "@/lib/messaging/consent";

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

/** A datetime-local value as a UTC instant, or null when it was left blank. */
function asInstant(value: FormDataEntryValue | null): string | null {
  const wallClock = typeof value === "string" ? value.trim() : "";
  if (!wallClock) return null;
  const instant = new Date(wallClock);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** An add-on: one of the lender's other items, suggested alongside this one. */
export type Offer = ListingItem & { default_selected?: boolean };

export function StartRequestForm({
  slug,
  lender,
  offers = [],
}: {
  slug: string;
  lender: string;
  offers?: Offer[];
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Controlled only because the consent box has to react to them: it appears
  // when there is a number, and the line about what happens without it depends
  // on whether there is an email to fall back to.
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);

  // Ticked to start with only where the lender said so — the thing that genuinely
  // goes with it every time, like the trailer with the boat. Never as a way to
  // slip a charge past somebody.
  const [picked, setPicked] = useState<string[]>(() =>
    offers.filter((offer) => offer.default_selected).map((offer) => offer.id),
  );

  // Only ever a subtotal of what is being ASKED, and labelled as one. It excludes
  // the thing itself deliberately: adding a day rate to a flat delivery fee makes
  // a number that is not any real total, and a borrower who reads it as one has
  // been misled by arithmetic nobody checked.
  const extras = useMemo(
    () =>
      offers
        .filter((offer) => picked.includes(offer.id))
        .reduce((sum, offer) => sum + (offer.rate_cents ?? 0), 0),
    [offers, picked],
  );

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
          // The tick, and the sentence it was against. Sent together because the
          // server stores both, and stores the wording from the same constant
          // this form rendered rather than trusting the value in the body.
          sms_consent: smsConsent,
          // Sent as instants, not as the raw "2026-09-01T09:41" the input holds.
          // That string carries no zone, so Postgres reads it as UTC and a
          // borrower asking for 9am gets a request for 5am. Read here in the
          // borrower's own zone, which is the right one: they are standing at
          // the shop, in the state the activity happens in.
          starts_at: asInstant(form.get("starts_at")),
          ends_at: asInstant(form.get("ends_at")),
          note: form.get("note") || null,
          add_on_ids: picked,
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

  function toggle(offerId: string) {
    setPicked((current) =>
      current.includes(offerId)
        ? current.filter((id) => id !== offerId)
        : [...current, offerId],
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {offers.length > 0 && (
        <fieldset className="rounded-2xl border border-line bg-surface/50 p-5">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Anything else?
          </legend>

          <div className="mt-2 space-y-2">
            {offers.map((offer) => {
              const rate = formatRate(offer.rate_cents, offer.rate_unit);
              const photo = orderedPhotos(offer.asset_photos)[0];
              const chosen = picked.includes(offer.id);

              return (
                <label
                  key={offer.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                    chosen ? "border-ink bg-paper" : "border-line hover:border-ink/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={chosen}
                    onChange={() => toggle(offer.id)}
                    className="h-4 w-4 shrink-0 accent-ink"
                  />

                  {photo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={photoUrl(photo.storage_path)}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {itemTitle(offer)}
                    </span>
                    {offer.headline && (
                      <span className="block truncate text-xs text-ink-soft">
                        {offer.headline}
                      </span>
                    )}
                  </span>

                  {rate && (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {rate}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {extras > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              Extras{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatCents(extras)}
              </span>
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            Ticking these tells {lender} what you want. They confirm what is
            available and what it comes to when they send you the agreement.
          </p>
        </fieldset>
      )}

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
          <input
            name="borrower_email"
            type="email"
            maxLength={200}
            className={input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Or phone
          </span>
          <input
            name="borrower_phone"
            type="tel"
            maxLength={30}
            className={input}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-ink-muted">
        One of the two is enough. It is how the agreement reaches you.
      </p>

      {/*
        The opt-in, and the only one there is.

        Beside the field rather than under the button, because consent to be
        texted has to sit where the number is typed — that adjacency is what a
        carrier reviewing the registration is looking for in the screenshot, and
        it is also just honest. Unticked to start, always: a pre-ticked box is
        not consent, and it is the single thing most likely to fail review.

        It appears only once there is a number to consent about. An empty
        checkbox for a field nobody filled is noise on a form that is trying to
        ask for as little as possible, and ticking it would record permission to
        text nothing.
      */}
      {phone.trim() !== "" && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface/50 p-4">
          <input
            name="sms_consent"
            type="checkbox"
            checked={smsConsent}
            onChange={(event) => setSmsConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
          />
          <span className="text-xs leading-relaxed text-ink-soft">
            {SMS_CONSENT_TEXT}{" "}
            <a
              href="/legal/messaging"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              Text messages
            </a>{" "}
            and{" "}
            <a
              href="/legal/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              Privacy
            </a>
            .
          </span>
        </label>
      )}

      {/* Leaving it unticked is a real answer, not a mistake to nag about, so
          this says what will happen rather than asking again. It only appears
          when there is no email to fall back to — otherwise there is no
          consequence worth a sentence. */}
      {phone.trim() !== "" && !smsConsent && email.trim() === "" && (
        <p className="-mt-2 text-xs text-ink-muted">
          Without this we will not text you. Add an email address above, or{" "}
          {lender} will have to reach you another way.
        </p>
      )}

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
