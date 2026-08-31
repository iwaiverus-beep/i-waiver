"use client";

import { useState } from "react";
import { QrCode } from "./QrCode";

/**
 * Issues a fresh signing link for one of the parties.
 *
 * The link is shown once, right here, and is not recoverable afterwards — only its
 * hash was stored. Asking again mints a new one, which is a visible event rather
 * than a silent lookup.
 */
export function SigningLinks({
  agreementId,
  lenderSigned,
  borrowerSigned,
  borrowerName,
}: {
  agreementId: string;
  lenderSigned: boolean;
  borrowerSigned: boolean;
  borrowerName: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ role: string; url: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue(
    role: "lender" | "borrower",
    deliver: boolean,
    busyKey: string = role,
  ) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    setLink(null);

    const response = await fetch(`/api/agreements/${agreementId}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, deliver }),
    });

    const body = await response.json().catch(() => ({}));
    setBusy(null);

    if (!response.ok) {
      setError(body.error ?? "Could not create a link.");
      return;
    }

    if (deliver) {
      setNotice(
        body.delivered
          ? `A new link is on its way to ${borrowerName}.`
          : `A new link was created, but no email provider is configured so nothing was sent. Copy it below.`,
      );
    }
    setLink({ role, url: body.url });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {!lenderSigned && (
          <button
            onClick={() => issue("lender", false)}
            disabled={busy !== null}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "lender" ? "One moment…" : "Sign it yourself"}
          </button>
        )}

        {!borrowerSigned && (
          <button
            onClick={() => issue("borrower", false, "borrower-qr")}
            disabled={busy !== null}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            {busy === "borrower-qr" ? "One moment…" : "They are here — show a QR code"}
          </button>
        )}

        {!borrowerSigned && (
          <button
            onClick={() => issue("borrower", true)}
            disabled={busy !== null}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
          >
            {busy === "borrower" ? "Sending…" : `Send ${borrowerName} a fresh link`}
          </button>
        )}
      </div>

      {notice && <p className="text-sm text-ink-soft">{notice}</p>}
      {error && <p className="text-sm text-flag">{error}</p>}

      {link && (
        <div className="rounded-xl border border-line bg-surface px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {link.role === "lender" ? "Your link" : `${borrowerName}'s link`}
          </p>
          <a
            href={link.url}
            className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-accent underline underline-offset-4"
          >
            {link.url}
          </a>
          <p className="mt-2 text-xs text-ink-muted">
            Good for 48 hours, usable once. It is not stored anywhere you can read it
            again — if you lose it, ask for another.
          </p>

          {/* The same capability, in the form that works when both people are
              standing next to the thing being lent. */}
          <div className="mt-6 border-t border-line pt-6">
            <QrCode
              url={link.url}
              label={
                link.role === "lender"
                  ? "Point your own phone at this to sign on it instead."
                  : `Have ${borrowerName} point their camera at this. It opens the agreement on their own phone — no app, no account.`
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
