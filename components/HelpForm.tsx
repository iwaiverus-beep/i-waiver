"use client";

import { useEffect, useState } from "react";

import { send } from "@/lib/client/request";
import { CATEGORY_LABELS, HELP_TOPICS } from "@/lib/support/labels";

/**
 * The form on the help page.
 *
 * TWO KINDS, ASKED FIRST. "I need help" and "I have an idea" are not two values
 * of a dropdown labelled About — they are two different conversations, they go to
 * different places in the queue, and the second one is a thing people only offer
 * if invited. A single subject box with a category selector gets ideas filed as
 * 'other' and read last, which is the same as not asking for them.
 *
 * The kind changes the wording of every field beneath it, deliberately. A form
 * that asks "what is happening" of somebody with a suggestion has misunderstood
 * them before they have typed anything.
 *
 * WHY THE EMAIL FIELD IS FILLED IN BUT NOT LOCKED. Signed in, /api/profile has
 * the address and typing it again is a chore. It is still an editable input
 * because a locked field with no explanation reads as a bug — but the server
 * ignores what is in it whenever there is a session, so editing it changes
 * nothing rather than letting an account file as somebody else.
 */

type Kind = "help" | "idea";

export function HelpForm() {
  const [kind, setKind] = useState<Kind>("help");
  const [email, setEmail] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  // Same bargain as AccountMenu: the page stays static and this asks afterwards.
  // A failure is silent on purpose — the form works perfectly well with an empty
  // email box, and a help page that opens with an error about loading the help
  // page is its own small insult.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled || !body?.profile?.email) return;
        setEmail(body.profile.email);
        setSignedIn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await send<{ reference: string | null }>("/api/help", {
      body: {
        kind,
        name: form.get("name"),
        email: form.get("email"),
        subject: form.get("subject"),
        category: form.get("category"),
        message: form.get("message"),
        website: form.get("website"),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReference(result.data.reference ?? "");
  }

  if (reference !== null) {
    return (
      <div className="rounded-2xl border border-accent/25 bg-accent-soft p-7">
        <p className="text-base font-semibold text-accent">
          {kind === "idea" ? "Thank you — we have it." : "We have this."}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          {reference ? (
            <>
              Your reference is <span className="font-mono">{reference}</span>. It
              is in the email we have just sent you, and quoting it keeps
              everything on one thread if you write again.
            </>
          ) : (
            <>There is a confirmation on its way to the address you gave us.</>
          )}
        </p>
        {kind === "help" && (
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Replying to that email reaches the same people. You do not need to
            come back to this page.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-paper p-7">
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
          What is this?
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          <KindButton
            active={kind === "help"}
            onClick={() => setKind("help")}
            label="I need help"
          />
          <KindButton
            active={kind === "idea"}
            onClick={() => setKind("idea")}
            label="I have an idea"
          />
        </div>
      </fieldset>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="help-name">
          <input id="help-name" name="name" autoComplete="name" className={inputClass} />
        </Field>

        <Field
          label="Your email"
          htmlFor="help-email"
          hint={signedIn ? "From your account." : "So we can reply."}
        >
          <input
            id="help-email"
            name="email"
            type="email"
            required={!signedIn}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field
          label={kind === "idea" ? "The idea, in a line" : "What you need help with"}
          htmlFor="help-subject"
        >
          <input
            id="help-subject"
            name="subject"
            required
            className={inputClass}
            placeholder={
              kind === "idea"
                ? "Let me send one agreement to a whole group"
                : "The signing link never arrived"
            }
          />
        </Field>

        {/*
          Only for a request for help. An idea has no topic to pick — it is
          already the answer to the question this select would be asking.
        */}
        {kind === "help" && (
          <Field label="About" htmlFor="help-category">
            <select
              id="help-category"
              name="category"
              defaultValue="other"
              className={inputClass}
            >
              {HELP_TOPICS.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="mt-4">
        <Field
          label={kind === "idea" ? "Tell us more" : "What is happening"}
          htmlFor="help-message"
        >
          <textarea
            id="help-message"
            name="message"
            rows={6}
            required
            className={inputClass}
            placeholder={
              kind === "idea"
                ? "What you are trying to do, and what gets in the way of doing it today."
                : "What you did, what happened, and what you expected instead. If it involves an agreement, the reference on it helps."
            }
          />
        </Field>
      </div>

      {/*
        The honeypot. Hidden from sight and from screen readers, unlabelled in the
        way a person would notice and irresistible to anything filling in every
        input on the page. `tabIndex={-1}` so a keyboard never lands in it.

        Not `type="hidden"`: a bot that reads the DOM skips those and fills the
        visible ones, which is the whole population this is meant to catch.
      */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="help-website">Website</label>
        <input id="help-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Sending…" : kind === "idea" ? "Send the idea" : "Send it"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-flag">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function KindButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-5 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-accent bg-accent text-paper"
          : "border-line text-ink-soft hover:border-ink/40 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"
      >
        {label}
        {hint && <span className="ml-2 font-normal normal-case tracking-normal text-ink-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent";
