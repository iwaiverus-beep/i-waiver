/**
 * The two facts about support emulation that the edge needs to know.
 *
 * Separate from lib/platform/emulation.ts, which is `server-only` and reaches the
 * database — importing that into middleware.ts would pull the service client into
 * the edge runtime and fail the build. Same reason lib/partners/vocabulary.ts
 * exists: no imports, no `server-only`, so either side of the boundary may read
 * it.
 */

/**
 * Names the live `staff_emulations` row. An opaque id and nothing more: it
 * asserts no identity, and the server reads the row to decide anything at all.
 */
export const EMULATION_COOKIE = "iw_emulation";

/**
 * How long a session lasts.
 *
 * Also the cookie's own `maxAge`, deliberately. The browser then drops the cookie
 * at the moment the row expires, which keeps the middleware's write block —
 * which cannot afford a database read on every request — honest without it having
 * to know anything about the row. The row's `expires_at` remains the authority;
 * this just stops the two disagreeing.
 */
export const EMULATION_MINUTES = 30;

/**
 * The one path that must still accept a POST while an emulation is live.
 *
 * Getting out cannot require the thing being blocked. Everything else that
 * writes is refused; this ends the session and clears the cookie.
 */
export const EMULATION_EXIT_PATH = "/api/admin/emulation";
