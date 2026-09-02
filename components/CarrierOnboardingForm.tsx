"use client";

import { useState } from "react";
import { send } from "@/lib/client/request";
import { US_STATES } from "@/lib/jurisdictions";

/**
 * What a carrier fills in about themselves.
 *
 * Pre-filled from whatever we already hold and, on a second visit, from what they
 * last sent — a correction should be an edit of their own answers rather than a
 * blank page they have to retype. The states are the same picker the partner
 * application uses, for the same reason: a fifty-row list of checkboxes is a
 * fifty-row list of chances to miss one.
 */

type Carrier = {
  id: string;
  name: string;
  naic_code: string | null;
  am_best_rating: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

type Previous = {
  legal_name: string | null;
  naic_code: string | null;
  am_best_rating: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  states: string[];
  api_base_url: string | null;
  api_docs_url: string | null;
  products: string | null;
  notes: string | null;
  status: "pending" | "accepted" | "rejected";
};

export function CarrierOnboardingForm({
  token,
  carrier,
  previous,
  contactEmail,
}: {
  token: string;
  carrier: Carrier;
  previous: Previous | null;
  contactEmail: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<string[]>(previous?.states ?? []);

  const allStatesSelected = states.length === US_STATES.length;

  function toggleState(code: string) {
    setStates((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code],
    );
  }

  function toggleAllStates() {
    setStates(allStatesSelected ? [] : [...US_STATES]);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const raw = form.get(name);
      return typeof raw === "string" && raw.trim() ? raw.trim() : null;
    };

    const result = await send(`/api/carriers/onboarding/${token}`, {
      body: {
        legal_name: value("legal_name"),
        naic_code: value("naic_code"),
        am_best_rating: value("am_best_rating"),
        contact_name: value("contact_name"),
        contact_email: value("contact_email"),
        contact_phone: value("contact_phone"),
        states,
        api_base_url: value("api_base_url"),
        api_docs_url: value("api_docs_url"),
        products: value("products"),
        notes: value("notes"),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-10 rounded-2xl border border-accent/25 bg-accent-soft p-8">
        <p className="font-serif text-2xl tracking-tight text-ink">
          We have it. Thank you.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          It goes to a person here, not into your record directly. If anything
          needs clarifying we will write to you; otherwise the next thing you hear
          from us is about the contract.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Spotted a mistake? Reopen this same link and send it again — the newer
          answers replace these.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-10 rounded-2xl border border-line bg-paper p-7 sm:p-8"
    >
      {previous?.status === "pending" && (
        <p className="mb-7 rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
          You have already sent this to us and it is waiting to be read. Anything
          you send now replaces it.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Legal entity name" htmlFor="legal_name">
          <input
            id="legal_name"
            name="legal_name"
            defaultValue={previous?.legal_name ?? carrier.name}
            className={inputClass}
          />
        </Field>

        <Field label="NAIC code" htmlFor="naic_code">
          <input
            id="naic_code"
            name="naic_code"
            inputMode="numeric"
            defaultValue={previous?.naic_code ?? carrier.naic_code ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="AM Best rating" htmlFor="am_best_rating">
          <input
            id="am_best_rating"
            name="am_best_rating"
            placeholder="A- or better"
            defaultValue={previous?.am_best_rating ?? carrier.am_best_rating ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Who we should talk to" htmlFor="contact_name">
          <input
            id="contact_name"
            name="contact_name"
            defaultValue={previous?.contact_name ?? carrier.contact_name ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Their email" htmlFor="contact_email">
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            defaultValue={previous?.contact_email ?? carrier.contact_email ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Their phone" htmlFor="contact_phone">
          <input
            id="contact_phone"
            name="contact_phone"
            type="tel"
            defaultValue={previous?.contact_phone ?? carrier.contact_phone ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset className="mt-7">
        <legend className="mb-2 flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
            States you are admitted and filed in
          </span>
          <span className="flex items-baseline gap-3 text-xs">
            <span className="text-ink-muted">{states.length} selected</span>
            <button
              type="button"
              onClick={toggleAllStates}
              className="font-semibold text-accent underline-offset-4 hover:underline"
            >
              {allStatesSelected ? "Clear all" : "Select all"}
            </button>
          </span>
        </legend>
        <p className="mb-3 text-xs leading-relaxed text-ink-muted">
          Your answer here is a starting point for the conversation, not the
          record. We record filings ourselves, product by product, before anything
          quotes in a state.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {US_STATES.map((code) => {
            const on = states.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggleState(code)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                  on
                    ? "border-accent bg-accent text-paper"
                    : "border-line text-ink-soft hover:border-ink/40"
                }`}
              >
                {code}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <Field label="Sandbox API base URL" htmlFor="api_base_url">
          <input
            id="api_base_url"
            name="api_base_url"
            placeholder="sandbox.api.yourcompany.com"
            defaultValue={previous?.api_base_url ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="API documentation" htmlFor="api_docs_url">
          <input
            id="api_docs_url"
            name="api_docs_url"
            placeholder="developer.yourcompany.com"
            defaultValue={previous?.api_docs_url ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-5">
        <Field label="Products you would put behind this" htmlFor="products">
          <textarea
            id="products"
            name="products"
            rows={4}
            placeholder="Which programme, what it covers, limits and deductibles you are comfortable with, and anything that only works in certain states."
            defaultValue={previous?.products ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-5">
        <Field label="Anything else" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={previous?.notes ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-7 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Sending…" : "Send this to i-Waiver"}
      </button>

      {error && (
        <p role="alert" className="mt-4 text-sm text-flag">
          {error}
        </p>
      )}

      <p className="mt-5 text-xs leading-relaxed text-ink-muted">
        Do not send credentials or secrets through this form — we exchange those
        separately once the contract is signed. Anything unclear, write to{" "}
        <a
          className="font-semibold text-accent underline-offset-4 hover:underline"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        .
      </p>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
