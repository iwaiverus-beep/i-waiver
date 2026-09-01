"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Turning a request down.
 *
 * Quiet on purpose: the borrower is not told. A public code that reported back
 * would let anybody outside a shop test whether it is being watched, and "no" from
 * a business is a conversation had in person, not a notification.
 */
export function DeclineRequest({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/decline`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "That did not go through.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not go through.");
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        onClick={decline}
        disabled={busy}
        className="text-sm font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
      >
        {busy ? "…" : "Not this one"}
      </button>
      {error && <span className="text-xs text-flag">{error}</span>}
    </span>
  );
}
