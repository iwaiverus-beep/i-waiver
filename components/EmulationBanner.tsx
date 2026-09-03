"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The bar that says you are not looking at your own account.
 *
 * NOT DISMISSIBLE, and not subtle. The whole hazard of a feature like this is
 * forgetting it is on: an operator who believes they are in their own account
 * reads every screen as evidence about the product rather than about one
 * customer, and the mistakes that follow are the confident kind. So it sits
 * above the header on every page, it says whose account this is, and it counts
 * down — because a session that ends without warning looks like being signed
 * out, which is its own support call.
 *
 * Amber rather than the brand's green. This is not a feature working correctly,
 * it is a state to get out of, and it should not look like the rest of the
 * product.
 */
export function EmulationBanner({
  label,
  expiresAt,
}: {
  label: string;
  /** ISO instant the server stops honouring the session. */
  expiresAt: string;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt));

  useEffect(() => {
    const tick = setInterval(() => setRemaining(msLeft(expiresAt)), 1000);
    return () => clearInterval(tick);
  }, [expiresAt]);

  // When the clock runs out the server has already stopped honouring the
  // session, so the page on screen is stale. Refreshing puts the operator back
  // in their own account rather than leaving them reading a snapshot of somebody
  // else's — which is exactly the confusion the countdown exists to prevent.
  useEffect(() => {
    if (remaining > 0) return;
    router.refresh();
  }, [remaining, router]);

  async function stop() {
    setLeaving(true);
    try {
      await fetch("/api/admin/emulation", { method: "DELETE" });
      // Back to the console rather than to this page. Whatever the operator was
      // looking at belongs to the customer, and re-rendering it as themselves
      // would either 404 or quietly show their own data in the same layout.
      window.location.href = "/admin/lenders";
    } catch {
      setLeaving(false);
    }
  }

  return (
    <div className="sticky top-0 z-[60] border-b border-flag/40 bg-flag/10 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-sm leading-snug text-ink">
          <span className="font-semibold">Viewing as {label}.</span>{" "}
          <span className="text-ink-soft">
            Read-only — nothing you do here can change their account.
          </span>
        </p>

        <div className="flex shrink-0 items-center gap-3">
          <span
            className="font-mono text-xs text-ink-muted"
            // The countdown changes every second; announcing each tick would
            // make a screen reader unusable. The label above already says the
            // state, which is the part that matters.
            aria-hidden="true"
          >
            {formatRemaining(remaining)}
          </span>
          <button
            type="button"
            onClick={stop}
            disabled={leaving}
            className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 disabled:opacity-60"
          >
            {leaving ? "Leaving…" : "Return to your account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function msLeft(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} left`;
}
