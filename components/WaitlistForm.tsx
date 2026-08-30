"use client";

import { useState } from "react";

type State = "idle" | "sending" | "done" | "error";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

export function WaitlistForm() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          full_name: form.get("full_name"),
          party_type: form.get("party_type"),
          state: form.get("state"),
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState("error");
        setMessage(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      setState("done");
    } catch {
      setState("error");
      setMessage("Could not reach the server. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-2xl border border-accent/25 bg-accent-soft p-8">
        <p className="font-serif text-2xl tracking-tight text-ink">
          You&rsquo;re on the list.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          We&rsquo;ll be in touch as states come online. We won&rsquo;t send you
          anything else.
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
        <Field label="Name" htmlFor="full_name">
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            className={inputClass}
          />
        </Field>

        <Field label="Email" htmlFor="email" required>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
          />
        </Field>

        <Field label="I'm lending as" htmlFor="party_type">
          <select id="party_type" name="party_type" className={inputClass} defaultValue="individual">
            <option value="individual">An individual</option>
            <option value="business">A business</option>
          </select>
        </Field>

        <Field label="State of activity" htmlFor="state">
          <select id="state" name="state" className={inputClass} defaultValue="">
            <option value="">Select a state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-7 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
      >
        {state === "sending" ? "Sending…" : "Request early access"}
      </button>

      {state === "error" && (
        <p role="alert" className="mt-4 text-sm text-flag">
          {message}
        </p>
      )}

      <p className="mt-5 text-xs leading-relaxed text-ink-muted">
        We ask for your state because the rules that govern these agreements are
        state law, and availability differs. We use your details to contact you
        about early access, nothing else.
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
