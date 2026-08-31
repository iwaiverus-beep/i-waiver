"use client";

import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

/**
 * Sign in with an account people already have.
 *
 * Almost every lender arrives with a Gmail address, and a password they invent
 * for a jet-ski waiver in August is a password they will not remember next
 * summer. Reusing an existing identity removes both the invention and the
 * forgetting — and removes our dependence on transactional email at the exact
 * moment someone is trying to get in, which matters while the sending domain is
 * new and confirmation mail is rate limited to two per hour.
 *
 * WHICH PROVIDERS APPEAR is driven by NEXT_PUBLIC_OAUTH_PROVIDERS rather than
 * discovered. Asking Supabase which are enabled needs a management credential
 * that has no business being in a deployed app, and rendering a button for a
 * provider nobody configured produces a dead end that reads as a broken product.
 * Unset means no buttons: password sign-in still works, and nothing is promised
 * that does not exist.
 *
 * Borrowers never see this. They sign from a tokenised link and are offered an
 * account afterwards, never before — "signer, not user" is the standing decision
 * and OAuth being convenient is not a reason to revisit it.
 */

type Provider = "google" | "azure" | "apple";

const PROVIDERS: Record<Provider, { label: string; scopes?: string; mark: () => React.ReactNode }> = {
  google: { label: "Continue with Google", mark: GoogleMark },
  azure: { label: "Continue with Microsoft", scopes: "email", mark: MicrosoftMark },
  apple: { label: "Continue with Apple", mark: AppleMark },
};

export function OAuthButtons({ next }: { next: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is Provider => p in PROVIDERS);

  if (enabled.length === 0) return null;

  async function start(provider: Provider) {
    setBusy(provider);
    setError(null);

    const supabase = browserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        // Built from the live origin so a preview deployment returns to itself.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        scopes: PROVIDERS[provider].scopes,
      },
    });

    if (error) {
      setError(error.message);
      setBusy(null);
    }
    // On success the browser has already left for the provider; there is nothing
    // to reset, and clearing `busy` here would flash the button back to normal.
  }

  return (
    <div className="space-y-3">
      {enabled.map((provider) => {
        const Mark = PROVIDERS[provider].mark;
        return (
          <button
            key={provider}
            type="button"
            onClick={() => start(provider)}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-paper px-5 py-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
          >
            <Mark />
            {busy === provider ? "Taking you there…" : PROVIDERS[provider].label}
          </button>
        );
      })}

      {error && <p className="text-sm text-flag">{error}</p>}

      <div className="flex items-center gap-4 pt-2">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs uppercase tracking-wider text-ink-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
      <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
      <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
      <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.15-2.8.85-3.5.85-.7 0-1.85-.83-3.05-.8-1.55.02-3 .9-3.8 2.3-1.6 2.8-.4 7 1.15 9.3.77 1.13 1.7 2.4 2.9 2.35 1.16-.05 1.6-.75 3-.75s1.8.75 3.05.73c1.26-.02 2.06-1.15 2.83-2.28.9-1.3 1.26-2.57 1.28-2.63-.03-.01-2.46-.94-2.48-3.75ZM14.2 5.1c.63-.77 1.06-1.83.94-2.9-.9.04-2 .6-2.66 1.36-.58.68-1.1 1.77-.96 2.8 1.01.08 2.04-.5 2.68-1.26Z" />
    </svg>
  );
}
