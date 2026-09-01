"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { browserClient } from "@/lib/supabase/browser";

/**
 * Sign in with a passkey — which is to say, with Face ID, a fingerprint, or a
 * device PIN.
 *
 * Those are not alternatives to a passkey; they are how a passkey is unlocked.
 * The button says "Face ID or fingerprint" because that is what the person
 * experiences, while "passkey" is the name of the machinery underneath.
 *
 * No email is typed first. The credential is discoverable, so the authenticator
 * knows which account it belongs to and says so. That also means this page never
 * has to ask "does this address have an account", which is a question worth not
 * being able to answer.
 */
export function PasskeySignIn({ next }: { next: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof window.PublicKeyCredential !== "undefined",
    );
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const optionsResponse = await fetch("/api/passkeys/authenticate/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) throw new Error("Could not start sign-in.");
      const options = await optionsResponse.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyResponse = await fetch("/api/passkeys/authenticate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const body = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) throw new Error(body.error ?? "That did not work.");

      // The server only produces this after verifying the assertion. Redeeming
      // it here is what actually sets the session cookies.
      const supabase = browserClient();
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash: body.token_hash,
        type: "magiclink",
      });
      if (otpError) throw new Error(otpError.message);

      router.push(next);
      router.refresh();
    } catch (caught) {
      const message = (caught as Error).message ?? "";
      setError(
        /NotAllowed|abort/i.test(message)
          ? "Cancelled."
          : /not recognised/i.test(message)
            ? "No passkey on this device matches an account here. Sign in another way, then add one."
            : message || "That did not work.",
      );
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-paper px-5 py-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
      >
        <KeyMark />
        {busy ? "Waiting for your device…" : "Sign in with Face ID or fingerprint"}
      </button>
      {error && <p className="mt-2 text-sm text-flag">{error}</p>}
    </div>
  );
}

function KeyMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 12h9M18 12v3M15 12v2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
