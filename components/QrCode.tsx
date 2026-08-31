"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * A signing link, as something a borrower can point a camera at.
 *
 * The in-person case is the common one and email is the awkward fit for it: two
 * people are standing next to a jet ski, one of them is about to hand over
 * fifteen thousand dollars of it, and asking the borrower to go and find an email
 * on a phone with one bar of signal is the moment the whole thing reverts to a
 * handshake. A code on the lender's screen closes that gap.
 *
 * RENDERED IN THE BROWSER, NEVER ON THE SERVER. The URL contains the signing
 * token itself — the capability. It is already in this page because the link was
 * just minted and displayed here; generating the image client-side means it is
 * not sent anywhere new, does not pass through a logging layer, and never lands
 * in a server-side image cache.
 *
 * Like the link it encodes, this is shown once. Nothing stores it, because only
 * the token's hash was ever written down.
 */
export function QrCode({ url, label }: { url: string; label?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, {
      type: "svg",
      // Quiet zone of 1 module rather than the default 4: the surrounding card
      // already provides the contrast a scanner needs, and the default wastes a
      // lot of a phone screen.
      margin: 1,
      // Medium recovers from about 15% damage — enough for a fingerprinted
      // screen at arm's length without inflating the code so the modules shrink.
      errorCorrectionLevel: "M",
      color: { dark: "#0B1622", light: "#FFFFFF" },
    })
      .then((generated) => {
        if (!cancelled) setSvg(generated);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <p className="text-sm text-flag">
        The code could not be drawn. Copy the link instead — it works the same way.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl border border-line bg-white p-4">
        {svg ? (
          // The SVG is produced locally by the library from a string we control,
          // so there is no untrusted markup here.
          <div
            className="h-52 w-52 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="h-52 w-52 animate-pulse rounded-xl bg-surface" />
        )}
      </div>
      <p className="mt-3 max-w-xs text-center text-xs leading-relaxed text-ink-muted">
        {label ??
          "Have them point their camera at this. It opens the agreement on their own phone — no app, no account."}
      </p>
    </div>
  );
}
