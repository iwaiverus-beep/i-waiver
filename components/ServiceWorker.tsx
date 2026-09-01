"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and cleans up after itself if it is ever removed.
 *
 * The unregister path matters more than it looks. A service worker that has been
 * deleted from the server keeps running in every browser that already has it —
 * it is not "gone" until each client tears it down. Shipping the escape hatch
 * alongside the thing it undoes is what makes that recoverable without asking
 * people to clear site data.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration is deferred until the page has settled: it competes with the
    // first render for bandwidth otherwise, and nothing here is urgent.
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Blocked by policy, or a private window. Not worth surfacing — the site
        // works identically without it, minus the install offer.
      });
    }, 2_000);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
