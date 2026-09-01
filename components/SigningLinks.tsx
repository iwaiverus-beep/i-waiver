"use client";

import { useState } from "react";
import { QrCode } from "./QrCode";

/**
 * Issues a fresh signing link for one of the parties.
 *
 * The link is shown once, right here, and is not recoverable afterwards — only its
 * hash was stored. Asking again mints a new one, which is a visible event rather
 * than a silent lookup.
 *
 * The lender is the exception, and deliberately so: they are already here, looking
 * at this screen. Handing them a link to click is a detour that reads like the
 * signing itself, so "Sign it now" mints the link and walks straight through it.
 * Their link still exists and is still single-use — they simply do not have to
 * copy it to themselves. Signing on a phone instead stays one button along.
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
    // Walk through the link rather than print it. Only ever for the lender: a
    // borrower's link belongs on the borrower's device, not this browser.
    follow = false,
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

    if (!response.ok) {
      setBusy(null);
      setError(body.error ?? "Could not create a link.");
      return;
    }

    if (follow && body.url) {
      // Busy stays on: this navigates away, and a button that goes idle first
      // invites a second click and a second minted link.
      window.location.assign(body.url);
      return;
    }

    setBusy(null);

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
    <div className="space-y-6">
      {/* Grouped by person rather than by delivery method. The heading carries
          who is signing, so each button only has to say where. That is what
          stops "sign on this device" and a future "hand them this device" from
          reading as the same action while sitting side by side. */}
      {!lenderSigned && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            You (the lender)
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={() => issue("lender", false, "lender", true)}
              disabled={busy !== null}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "lender" ? "Opening…" : "Sign here now"}
            </button>

            <button
              onClick={() => issue("lender", false, "lender-qr")}
              disabled={busy !== null}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
            >
              {busy === "lender-qr" ? "One moment…" : "Sign on my phone"}
            </button>
          </div>
        </div>
      )}

      {/* Their name, not "Borrower". The person is standing right there, and a
          name is something staff can check against the face in front of them. */}
      {!borrowerSigned && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {borrowerName}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={() => issue("borrower", false, "borrower-qr")}
              disabled={busy !== null}
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
            >
              {busy === "borrower-qr" ? "One moment…" : "Show a QR code"}
            </button>

            <button
              onClick={() => issue("borrower", true)}
              disabled={busy !== null}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
            >
              {busy === "borrower" ? "Sending…" : "Email a link"}
            </button>
          </div>
        </div>
      )}

      {notice && <p className="text-sm text-ink-soft">{notice}</p>}
      {error && <p className="text-sm text-flag">{error}</p>}

      {/* Both parties' links land in this one panel, which is the whole reason
          every line in it names WHOSE DEVICE it belongs on. A link and a QR code
          look identical whoever they are for, and "Your link" above a large QR
          code reads, reasonably, as the one you hold out to the other person.
          Getting that wrong is not cosmetic: the lender's link signs as the
          lender. */}
      {link && (
        <div className="rounded-xl border border-line bg-surface px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {link.role === "lender"
              ? "Your link — for your device"
              : `${borrowerName}'s link — for their device`}
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
          {link.role === "lender" && (
            <p className="mt-2 text-xs font-medium text-flag">
              This one signs as you. Do not hand it to {borrowerName} — send them
              their own link instead.
            </p>
          )}

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
