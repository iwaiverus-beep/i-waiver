"use client";

import { useState } from "react";
import { send } from "@/lib/client/request";
import { US_STATES } from "@/lib/jurisdictions";

/**
 * The partner application form.
 *
 * Long-ish, and deliberately so. Every field on it is something we would
 * otherwise have to ask in the first reply, and a form that takes four minutes
 * beats a fortnight of email. Only three fields are required — company, contact,
 * address — because the rest is genuinely optional information and marking it
 * required would only produce guesses.
 */

const KINDS = [
  { value: "waiver_platform", label: "Waiver platform" },
  { value: "booking_platform", label: "Booking or rental platform" },
  { value: "carrier", label: "Insurance carrier" },
  { value: "mga", label: "MGA or programme manager" },
  { value: "broker", label: "Broker or agency" },
  { value: "other", label: "Something else" },
];

const INTEGRATIONS = [
  {
    value: "widget",
    label: "Embedded widget",
    note: "Our surface, framed inside yours. We make the offer and handle consent and payment.",
  },
  {
    value: "api",
    label: "Direct API",
    note: "You call quote and bind yourself. Most control, most compliance weight on you.",
  },
  {
    value: "redirect",
    label: "Hosted redirect",
    note: "You send the signer to us and we send them back. Least code.",
  },
  { value: "", label: "Not sure yet", note: "Perfectly normal answer." },
];

const VOLUMES = [
  { value: "", label: "Rather not say" },
  { value: "under_10k", label: "Under 10,000 waivers a year" },
  { value: "10k_100k", label: "10,000 – 100,000" },
  { value: "100k_1m", label: "100,000 – 1 million" },
  { value: "over_1m", label: "Over 1 million" },
];

export function PartnerApplicationForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<string[]>([]);

  function toggleState(code: string) {
    setStates((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code],
    );
  }

  const allStatesSelected = states.length === US_STATES.length;

  function toggleAllStates() {
    setStates(allStatesSelected ? [] : [...US_STATES]);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await send("/api/partners/apply", {
      body: {
        company_name: form.get("company_name"),
        website: form.get("website"),
        partner_kind: form.get("partner_kind"),
        contact_name: form.get("contact_name"),
        contact_email: form.get("contact_email"),
        contact_phone: form.get("contact_phone"),
        integration_interest: form.get("integration_interest") || null,
        volume_band: form.get("volume_band") || null,
        notes: form.get("notes"),
        jurisdictions: states,
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
      <div className="rounded-2xl border border-accent/25 bg-accent-soft p-8">
        <p className="font-serif text-2xl tracking-tight text-ink">
          We have it. Thank you.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          A person reads every one of these, so expect a few working days rather
          than a few minutes. If we take it forward, the next email has a link to
          sign in and a sandbox to build against.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-line bg-paper p-7 sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company" htmlFor="company_name" required>
          <input id="company_name" name="company_name" required className={inputClass} />
        </Field>

        <Field label="Website" htmlFor="website">
          <input
            id="website"
            name="website"
            placeholder="smartwaiver.com"
            className={inputClass}
          />
        </Field>

        <Field label="What you are" htmlFor="partner_kind">
          <select
            id="partner_kind"
            name="partner_kind"
            defaultValue="waiver_platform"
            className={inputClass}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Waivers a year" htmlFor="volume_band">
          <select id="volume_band" name="volume_band" defaultValue="" className={inputClass}>
            {VOLUMES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Your name" htmlFor="contact_name" required>
          <input
            id="contact_name"
            name="contact_name"
            required
            autoComplete="name"
            className={inputClass}
          />
        </Field>

        <Field label="Your email" htmlFor="contact_email" required>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
          />
        </Field>

        <Field label="Phone" htmlFor="contact_phone">
          <input
            id="contact_phone"
            name="contact_phone"
            type="tel"
            autoComplete="tel"
            className={inputClass}
          />
        </Field>

        <Field label="How you would integrate" htmlFor="integration_interest">
          <select
            id="integration_interest"
            name="integration_interest"
            defaultValue=""
            className={inputClass}
          >
            {INTEGRATIONS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="mt-7">
        <legend className="mb-2 flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
            States you operate in
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
          These agreements are governed by state law and coverage availability
          differs by state, so this is the first thing we look at. Pick as many as
          apply.
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

      <div className="mt-7">
        <Field label="Anything else" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="What you run, what your customers ask for, and anything you already know about how you would want this to work."
            className={inputClass}
          />
        </Field>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-7 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Sending…" : "Apply to partner"}
      </button>

      {error && (
        <p role="alert" className="mt-4 text-sm text-flag">
          {error}
        </p>
      )}

      <p className="mt-5 text-xs leading-relaxed text-ink-muted">
        We use these details to assess the partnership and nothing else. Applying
        is not an agreement, and nothing here is an offer to sell insurance.
      </p>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent";

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
      >
        {label}
        {required && <span className="text-accent"> *</span>}
      </label>
      {children}
    </div>
  );
}
