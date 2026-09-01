"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { PasswordField } from "./PasswordField";
import { Field, Notice, inputClass, primaryButtonClass } from "./form-ui";

/**
 * The two credentials, changed on the browser client.
 *
 * NOT through a route handler, and the reason is worth writing down. Email and
 * password belong to Supabase Auth, not to the agreement graph — so the rule that
 * sends every other write to the service role does not apply, and following it
 * here would be actively worse: a service-role endpoint that sets a password is
 * an endpoint that can set ANYBODY'S password, guarded by nothing but its own
 * check. `updateUser` acts on the caller's own session and cannot reach past it,
 * and the confirmation mail for an address change is minted by Supabase with a
 * token this application never sees.
 */

const MIN_PASSWORD = 8;

export function EmailForm({ current }: { current: string | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (current && email.trim().toLowerCase() === current.toLowerCase()) {
      setBusy(false);
      return setError("That is already your address.");
    }

    const supabase = browserClient();
    const { error } = await supabase.auth.updateUser(
      { email: email.trim() },
      // Back to this screen once the link is opened, rather than to the
      // dashboard, so somebody who was in the middle of setting things up lands
      // where they left off.
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/account` },
    );

    setBusy(false);
    if (error) return setError(error.message);

    setEmail("");
    setNotice(
      "Confirmation links are on their way. Open the one at the new address — and if a link also arrives at your current one, open that too. Nothing changes until then, so keep signing in with your current address in the meantime.",
    );
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-5">
      <p className="text-sm text-ink-soft">
        You sign in with{" "}
        <span className="font-semibold text-ink">{current ?? "—"}</span>. It is also
        the address a borrower sees the agreement come from.
      </p>

      <Field label="New email address">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>

      {error && <Notice tone="bad">{error}</Notice>}
      {notice && <Notice tone="good">{notice}</Notice>}

      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Sending…" : "Send the confirmation"}
      </button>
    </form>
  );
}

export function PasswordForm() {
  /**
   * Whether this account has a password at all.
   *
   * Somebody who arrived through Google has an account, a session, and no
   * password identity — asking them for their current password is asking for
   * something that does not exist, and they would be stuck on this panel forever.
   * `identities` says which is which, so the form asks the right question.
   */
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setEmail(data.user?.email ?? null);
        setHasPassword(
          (data.user?.identities ?? []).some((identity) => identity.provider === "email"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (next.length < MIN_PASSWORD) {
      setBusy(false);
      return setError(`Use at least ${MIN_PASSWORD} characters.`);
    }
    if (next !== confirm) {
      setBusy(false);
      return setError("The two new passwords do not match.");
    }

    const supabase = browserClient();

    // The current password, checked by using it.
    //
    // The session alone is enough for Supabase to accept a change, which means an
    // unattended laptop is enough. Signing in again with the old password is the
    // cheapest honest proof that the person at the keyboard is the account holder
    // — and it costs nothing, because it succeeds against the same account and
    // simply refreshes the session.
    if (hasPassword) {
      if (!email) {
        setBusy(false);
        return setError("We could not read your account. Reload and try again.");
      }
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (reauth) {
        setBusy(false);
        return setError("That is not your current password.");
      }
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return setError(error.message);

    setCurrent("");
    setNext("");
    setConfirm("");
    setHasPassword(true);
    setNotice(
      hasPassword
        ? "Password changed. It is the one to use next time you sign in."
        : "Password set. You can now sign in with your email address as well as the provider you used before.",
    );
  }

  if (hasPassword === null) {
    return <p className="text-sm text-ink-muted">One moment…</p>;
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-5">
      {!hasPassword && (
        <p className="text-sm leading-relaxed text-ink-soft">
          You sign in through a provider rather than with a password. Setting one here
          adds a second way in — it does not take the first one away.
        </p>
      )}

      {hasPassword && (
        <Field label="Current password">
          <PasswordField
            required
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            className={inputClass}
          />
        </Field>
      )}

      <Field label={hasPassword ? "New password" : "Password"}>
        <PasswordField
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          className={inputClass}
        />
      </Field>

      <Field label="Type it again">
        <PasswordField
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          className={inputClass}
        />
      </Field>

      {error && <Notice tone="bad">{error}</Notice>}
      {notice && <Notice tone="good">{notice}</Notice>}

      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Saving…" : hasPassword ? "Change password" : "Set a password"}
      </button>
    </form>
  );
}
