"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { formatDate } from "@/lib/format";

export type Passkey = {
  id: string;
  device_label: string | null;
  backed_up: boolean | null;
  created_at: string;
  last_used_at: string | null;
};

/**
 * Adding and removing the devices that can sign in as you.
 *
 * `backed_up` is surfaced rather than hidden because it changes what happens
 * when a phone is lost. A synced passkey lives in the platform's keychain and
 * comes back on the replacement device; a device-bound one does not, and losing
 * it means losing that route in. Someone deciding whether they still need a
 * password deserves to know which kind they have.
 */
export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/passkeys");
    if (!response.ok) return setPasskeys([]);
    const body = await response.json();
    setPasskeys(body.passkeys ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const optionsResponse = await fetch("/api/passkeys/options", { method: "POST" });
      if (!optionsResponse.ok) throw new Error("Could not start.");
      const options = await optionsResponse.json();

      const registration = await startRegistration({ optionsJSON: options });

      // A label the person will recognise later. Guessed from the browser, and
      // theirs to ignore — it is only ever shown back to them.
      const label = guessDeviceLabel();

      const response = await fetch("/api/passkeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: registration, device_label: label }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That did not work.");

      setNotice(
        body.backed_up
          ? "Added. This passkey syncs with your other devices, so it survives losing this one."
          : "Added. This passkey lives only on this device — keep another way in.",
      );
      await load();
    } catch (caught) {
      const message = (caught as Error).message ?? "";
      setError(/NotAllowed|abort/i.test(message) ? "Cancelled." : message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(passkey: Passkey) {
    const confirmed = window.confirm(
      `Remove ${passkey.device_label ?? "this passkey"}?\n\n` +
        "That device will no longer be able to sign in.",
    );
    if (!confirmed) return;
    setPasskeys((current) => (current ?? []).filter((p) => p.id !== passkey.id));
    await fetch(`/api/passkeys/${passkey.id}`, { method: "DELETE" });
  }

  return (
    <div>
      <button
        onClick={add}
        disabled={busy}
        className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        {busy ? "Waiting for your device…" : "Add this device"}
      </button>

      {notice && <p className="mt-3 text-sm text-ink-soft">{notice}</p>}
      {error && <p className="mt-3 text-sm text-flag">{error}</p>}

      <div className="mt-6 space-y-3">
        {(passkeys ?? []).map((passkey) => (
          <div
            key={passkey.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {passkey.device_label ?? "Unnamed device"}
              </p>
              <p className="text-xs text-ink-muted">
                Added {formatDate(passkey.created_at)}
                {passkey.last_used_at
                  ? ` · last used ${formatDate(passkey.last_used_at)}`
                  : " · never used"}
                {passkey.backed_up === false ? " · this device only" : ""}
              </p>
            </div>
            <button
              onClick={() => revoke(passkey)}
              className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
            >
              Remove
            </button>
          </div>
        ))}

        {passkeys?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
            No passkeys yet. Adding one lets you sign in with Face ID, a
            fingerprint or your device PIN instead of a password.
          </p>
        )}
      </div>
    </div>
  );
}

/** Best effort, from the user agent. Wrong is survivable; it is only a label. */
function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}
