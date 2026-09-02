"use client";

import { useEffect, useState } from "react";
import { send } from "@/lib/client/request";
import {
  PAYOUT_PROVIDERS,
  PROVIDER_FIELD_LABELS,
  PROVIDER_PLACEHOLDERS,
  displayHandle,
  normaliseHandle,
  payoutUrl,
  providerLabel,
  type PayoutProvider,
} from "@/lib/payouts";
import { QrCode } from "./QrCode";
import { Field, Notice, inputClass, primaryButtonClass, quietButtonClass } from "./form-ui";

/**
 * How you would like to be paid back.
 *
 * THE QR CODE IS DRAWN, NOT UPLOADED, and that is the whole design rather than a
 * shortcut. 20260901000032 has no column for an image on purpose: this handle is
 * rendered into email that goes out under our name and onto the instrument
 * itself, and a QR code is an arbitrary destination in a form no human can read
 * by looking at it. Forwarding one on a lender's word would make us the delivery
 * mechanism for whatever it points at. So the lender types their username, the
 * column refuses anything shaped like a URL, and the code below is generated from
 * the validated handle — in the browser, by the same component that draws a
 * signing link.
 *
 * The practical effect is that this is LESS work than uploading: nobody has to go
 * and screenshot their Venmo code. They type @their-name and the code appears.
 *
 * And nothing here is an integration. We never call Venmo, never see the
 * transfer, and are owed nothing from it — the copy on this screen says so
 * because a lender is entitled to know what we do and do not know about their
 * money.
 */

type Handle = {
  id: string;
  provider: string;
  handle: string;
  display_name: string | null;
  confirmed_at: string | null;
};

export function PayoutHandles() {
  const [handles, setHandles] = useState<Handle[] | null>(null);
  const [provider, setProvider] = useState<PayoutProvider>("venmo");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const result = await send<{ handles: Handle[] }>("/api/payout-handles", {
      method: "GET",
    });
    setHandles(result.ok ? result.data.handles : []);
  }

  useEffect(() => {
    void load();
  }, []);

  const existing = handles?.find((h) => h.provider === provider) ?? null;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await send<{ handle: Handle }>("/api/payout-handles", {
      body: { provider, handle: raw },
    });

    setBusy(false);
    if (!result.ok) return setError(result.error);

    setRaw("");
    setNotice(
      existing
        ? `Replaced your ${providerLabel(provider)} ${PROVIDER_FIELD_LABELS[provider].toLowerCase()}.`
        : `Saved. ${providerLabel(provider)} is on your account.`,
    );
    await load();
  }

  async function remove(handle: Handle) {
    const confirmed = window.confirm(
      `Take ${displayHandle(handle.provider, handle.handle)} off your account?\n\n` +
        "Agreements you have already sent keep the handle that was on them — this only changes what goes on the next one.",
    );
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    const result = await send(`/api/payout-handles/${handle.id}`, { method: "DELETE" });
    if (!result.ok) return setError(result.error);
    await load();
  }

  return (
    <div className="space-y-8">
      <p className="max-w-prose text-sm leading-relaxed text-ink-soft">
        If you ask a borrower to cover fuel or a launch fee, this is where they are told
        to send it. We put the handle on the agreement and draw the code from it — we
        never contact {providerLabel(provider)}, never see the transfer, and take
        nothing from it.
      </p>

      {handles === null ? (
        <p className="text-sm text-ink-muted">One moment…</p>
      ) : handles.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing on file yet.</p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2">
          {handles.map((handle) => (
            <li
              key={handle.id}
              className="flex flex-col items-center gap-4 rounded-2xl border border-line px-5 py-6"
            >
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  {providerLabel(handle.provider)}
                </p>
                <p className="mt-1 break-all font-semibold text-ink">
                  {displayHandle(handle.provider, handle.handle)}
                </p>
              </div>

              <PayoutCode provider={handle.provider} handle={handle.handle} />

              <button
                type="button"
                onClick={() => remove(handle)}
                className={quietButtonClass}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="max-w-md space-y-5 border-t border-line pt-8">
        <Field label="Paid through">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as PayoutProvider);
              setNotice(null);
              setError(null);
            }}
            className={inputClass}
          >
            {PAYOUT_PROVIDERS.map((option) => (
              <option key={option} value={option}>
                {providerLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={PROVIDER_FIELD_LABELS[provider]}>
          <input
            type="text"
            required
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              // "Saved." belongs to the handle that is now on the card above.
              // Leaving it up while somebody types the next one attaches last
              // time's outcome to this time's typing.
              setNotice(null);
              setError(null);
            }}
            placeholder={PROVIDER_PLACEHOLDERS[provider]}
            className={inputClass}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Just the handle — not a link, and not a screenshot of your code. We draw the
            code for you.
          </p>
        </Field>

        {/*
          The code, before it is saved. Somebody is about to put this on a legal
          document; letting them scan it with their own phone first is the only
          check we can offer, since we cannot ask the provider whether the account
          exists and must never imply that we did.
        */}
        {raw.trim().length >= 2 && (
          <div className="rounded-2xl border border-line bg-surface px-5 py-6">
            <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Scan it yourself first
            </p>
            <PayoutCode provider={provider} handle={normaliseHandle(provider, raw)} />
          </div>
        )}

        {/*
          Only once there is something typed to replace it with.

          This is a warning about what the button is ABOUT to do, and with an
          empty box the button does nothing — the input is `required`. Showing it
          anyway meant it appeared the moment a first handle saved: the reload
          put the new row in `handles`, `existing` went truthy, and a lender who
          had just added their only Venmo account was told they already had one
          on file, directly above "Saved. Venmo is on your account."

          Nothing was wrong and nothing was overwritten. It read as a collision
          because it sat where an error sits, at the end of an action, saying a
          thing had happened rather than that a thing would. Tied to the field it
          describes, it says the useful version instead: you are typing a new
          handle, and here is the one it will stand in for.
        */}
        {existing && raw.trim().length > 0 && (
          <Notice tone="good">
            You already have {providerLabel(provider)} on file as{" "}
            {displayHandle(existing.provider, existing.handle)}. Saving replaces it.
          </Notice>
        )}

        {error && <Notice tone="bad">{error}</Notice>}
        {notice && <Notice tone="good">{notice}</Notice>}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Saving…" : existing ? "Replace it" : "Save"}
        </button>
      </form>
    </div>
  );
}

/**
 * The code itself, or the honest absence of one.
 *
 * Zelle is reached through the sending bank and has no public profile URL, and
 * "something else" is by definition unknown. A QR encoding the bare handle as
 * text would scan to a string a phone can do nothing with — a thing that looks
 * like a payment code and is not one — so those two show the handle instead.
 */
function PayoutCode({ provider, handle }: { provider: string; handle: string }) {
  const url = payoutUrl(provider, handle);

  if (!url) {
    return (
      <p className="max-w-xs text-center text-xs leading-relaxed text-ink-muted">
        {providerLabel(provider)} has no scannable code — it is reached from inside the
        sender's own bank or app. The agreement carries the handle in writing instead.
      </p>
    );
  }

  return (
    <QrCode
      url={url}
      label={`Points at ${displayHandle(provider, handle)} on ${providerLabel(provider)}. Generated from what you typed — check it opens the right profile.`}
    />
  );
}
