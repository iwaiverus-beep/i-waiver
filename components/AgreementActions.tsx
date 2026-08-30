"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Send, void, and download.
 *
 * Send is the moment the agreement stops being editable, so it says so before it
 * happens rather than after. A blocking compliance failure comes back as a list
 * and is shown verbatim — the lender is the person who can fix it.
 */
export function AgreementActions({
  agreementId,
  status,
  underLegalHold,
}: {
  agreementId: string;
  status: string;
  underLegalHold: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [voiding, setVoiding] = useState(false);

  async function send() {
    setBusy("send");
    setError(null);
    setReasons([]);
    setWarnings([]);

    const response = await fetch(`/api/agreements/${agreementId}/send`, {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(body.error ?? "Could not send.");
      setReasons(body.reasons ?? []);
      setBusy(null);
      return;
    }

    setWarnings(body.warnings ?? []);
    setBusy(null);
    router.refresh();
  }

  async function voidIt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    setBusy("void");
    setError(null);

    const response = await fetch(`/api/agreements/${agreementId}/void`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not void.");
      setBusy(null);
      return;
    }

    setBusy(null);
    setVoiding(false);
    router.refresh();
  }

  const canSend = status === "draft";
  const canVoid = !["voided"].includes(status) && !underLegalHold;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {canSend && (
          <button
            onClick={send}
            disabled={busy !== null}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Send for signature"}
          </button>
        )}

        {status === "executed" && <DownloadDocument agreementId={agreementId} />}

        {canVoid && (
          <button
            onClick={() => setVoiding((v) => !v)}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
          >
            Void
          </button>
        )}
      </div>

      {canSend && (
        <p className="text-xs leading-relaxed text-ink-muted">
          Sending freezes the asset details onto this agreement and creates the links.
          After that the wording cannot change — a correction means voiding this one and
          starting another.
        </p>
      )}

      {voiding && (
        <form
          onSubmit={voidIt}
          className="space-y-3 rounded-xl border border-flag/30 bg-flag/[0.05] px-5 py-4"
        >
          <label className="block text-sm font-semibold text-flag">
            Why is it being voided?
          </label>
          <input
            name="reason"
            required
            placeholder="Wrong dates — replacing with a new agreement"
            className="w-full rounded-lg border border-line bg-paper px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <p className="text-xs leading-relaxed text-flag">
            Nothing is deleted. The agreement stays, marked voided with this reason, and
            every outstanding link stops working.
          </p>
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-full bg-flag px-5 py-2 text-sm font-semibold text-paper disabled:opacity-50"
          >
            {busy === "void" ? "Voiding…" : "Confirm void"}
          </button>
        </form>
      )}

      {error && (
        <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
          <p className="text-sm font-semibold text-flag">{error}</p>
          {reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-flag">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
          <ul className="space-y-1 text-sm text-flag">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DownloadDocument({ agreementId }: { agreementId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/agreements/${agreementId}/document`);
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not open the document.");
      return;
    }
    // The URL is signed and short-lived, so it is fetched at the moment of the
    // click rather than baked into the page.
    window.open(body.url, "_blank", "noopener");
  }

  return (
    <>
      <button
        onClick={open}
        disabled={busy}
        className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
      >
        {busy ? "Opening…" : "Download the signed PDF"}
      </button>
      {error && <span className="text-sm text-flag">{error}</span>}
    </>
  );
}
