/*
 * Service worker — deliberately, aggressively unambitious.
 *
 * A service worker exists here for one reason: a browser will not offer to
 * install a site without one. It is NOT here to make the app fast, and it is not
 * here to work offline in any meaningful sense.
 *
 * WHY SO LITTLE. A caching service worker that gets this wrong serves people
 * yesterday's data and survives a hard refresh, which makes it invisible to
 * every normal debugging instinct — you reload, it looks stale, you reload
 * harder, it stays stale, and the only way to see the truth is a private window.
 * That has already cost this team real hours on another product. The cost of
 * being wrong here is far higher than the benefit of being clever.
 *
 * So the rules are:
 *
 *   1. NOTHING is cached except the offline page and the icons. No HTML from the
 *      app, no API responses, no signing pages.
 *   2. Every request goes to the network first, every time.
 *   3. The cache is only ever consulted when the network has actually failed.
 *
 * Anything holding a capability or personal data is excluded outright rather
 * than relying on rule 1 — a signing link in a cache on a shared phone is a
 * different and worse problem than staleness.
 */

const VERSION = "iwaiver-v1";
const SHELL = [
  "/offline",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, so one 404 does not abandon the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      // Take over immediately rather than waiting for every tab to close. An
      // old worker lingering is exactly how stale behaviour outlives a fix.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Paths that must never touch the cache, whatever else changes here. */
function isPrivate(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/sign/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/home") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/agreements") ||
    url.pathname.startsWith("/contacts") ||
    url.pathname.startsWith("/assets") ||
    url.search !== ""
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Someone else's origin is not ours to mediate.
  if (url.origin !== self.location.origin) return;

  // Only GET is ever safe to replay from a cache; a POST must reach the server
  // or fail visibly.
  if (request.method !== "GET") return;

  if (isPrivate(url)) {
    // Straight through. Not even an offline fallback: a borrower who cannot
    // reach the network needs to know that, not to see a cached shell of a
    // document they are about to be bound by.
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only the shell is ever written back, and only if it was already
        // listed. Opportunistic caching is how caches grow things nobody
        // intended them to hold.
        if (response.ok && SHELL.includes(url.pathname)) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const offline = await caches.match("/offline");
          if (offline) return offline;
        }
        return new Response("You are offline.", {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }),
  );
});
