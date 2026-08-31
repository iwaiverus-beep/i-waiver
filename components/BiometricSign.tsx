"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

/**
 * Signing with the device's own biometrics.
 *
 * The gesture is Face ID / Touch ID / the device passcode. The biometric never
 * leaves the phone's secure enclave — it unlocks a key held there, and what
 * reaches us is a signature over a challenge. There is nothing here that could
 * store a fingerprint even if someone tried.
 *
 * The challenge is the document's own sha256, so the resulting assertion is bound
 * to the exact wording on screen. That is what makes this stronger evidence than
 * a typed name: a typed name proves someone could type, while this proves a
 * specific device, with its owner's biometric, was present for these exact bytes.
 *
 * Availability is checked rather than assumed. Platform authenticators are
 * absent on plenty of desktops and on older phones, so this offers itself only
 * when the browser confirms one exists; typed and drawn remain first-class.
 */
export function BiometricSign({
  documentHash,
  signerName,
  disabled,
  onSigned,
}: {
  /** 64 hex characters. Becomes the WebAuthn challenge. */
  documentHash: string;
  signerName: string;
  disabled?: boolean;
  onSigned: (response: unknown) => void | Promise<void>;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (
          typeof window === "undefined" ||
          !window.PublicKeyCredential ||
          !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
        ) {
          if (!cancelled) setAvailable(false);
          return;
        }
        const ok =
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!cancelled) setAvailable(ok);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      // The challenge is the document hash, base64url-encoded. The server
      // recomputes this from its own copy of the document and refuses anything
      // that does not match, so a signature cannot be moved between agreements.
      const challenge = base64UrlFromHex(documentHash);

      const response = await startRegistration({
        optionsJSON: {
          challenge,
          rp: { name: "I-Waiver", id: registrableDomain() },
          user: {
            // Not an account. A per-signature handle, so the platform has
            // something to label the credential with. It is never looked up.
            id: challenge.slice(0, 43),
            name: signerName || "Signer",
            displayName: signerName || "Signer",
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },   // ES256
            { type: "public-key", alg: -257 }, // RS256
          ],
          timeout: 120_000,
          attestation: "none",
          authenticatorSelection: {
            // The device's own authenticator, not a roaming security key.
            authenticatorAttachment: "platform",
            // The point of the exercise. Without this the platform may accept a
            // mere tap, which proves possession and nothing about who is holding it.
            userVerification: "required",
            residentKey: "discouraged",
          },
        },
      });

      await onSigned(response);
    } catch (caught) {
      const message = (caught as Error).message ?? "";
      // A cancelled prompt is not a failure worth shouting about — people tap
      // away by accident, and the other two methods are still right there.
      setError(
        /NotAllowed|abort/i.test(message)
          ? "Cancelled. You can try again, or type your name instead."
          : `Your device could not complete that: ${message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (available === null) return null;

  if (!available) {
    return (
      <p className="text-xs leading-relaxed text-ink-muted">
        This device does not offer Face ID, Touch ID or a fingerprint reader for
        websites. Type or draw your signature instead — both are equally valid.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={sign}
        disabled={busy || disabled}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-ink px-6 py-4 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
      >
        <FaceIdMark />
        {busy ? "Waiting for your device…" : "Sign with Face ID or Touch ID"}
      </button>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Your fingerprint or face never leaves your phone. It unlocks a key held on
        the device, which signs this exact document. We receive the signature, not
        the biometric — and we could not store one if we wanted to.
      </p>

      {error && (
        <p className="mt-3 text-xs leading-relaxed text-flag">{error}</p>
      )}
    </div>
  );
}

/** The hash is hex; WebAuthn wants base64url of the same bytes. */
function base64UrlFromHex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The relying party id must be the page's domain or a registrable suffix of it,
 * so a credential created on www. still verifies at the apex. Anything else and
 * the browser rejects the ceremony outright.
 */
function registrableDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost") return host;
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

function FaceIdMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9 10v1.5M15 10v1.5M9.5 15c.7.7 1.5 1 2.5 1s1.8-.3 2.5-1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
