/**
 * Whether the product presents itself as live.
 *
 * Two things were holding the site in "not yet" and they are separate
 * mechanisms, which is why turning one off did not turn the other off:
 *
 *   1. The waitlist. Every primary call to action pointed at `/#waitlist`
 *      rather than at a way in, so somebody who wanted to use the thing could
 *      only leave their email address.
 *   2. The preview gate in components/PreviewGate.tsx, which hides the account
 *      strip — and with it the only sign-in link — until the logo is clicked
 *      five times.
 *
 * `LIVE` flips both together. When it is true the primary action is "Get
 * started" and goes to /login, which already handles sign-up as well as
 * sign-in; the waitlist section comes off the homepage; and the header shows
 * the account strip to everybody without the five-click ritual.
 *
 * NOTHING HERE IS ACCESS CONTROL, in either position. The preview gate never
 * was — its own file says so — and flipping this to false does not take a
 * running deployment private. The real protections are unchanged and elsewhere:
 * Supabase auth on the lender routes, tokenised links on the borrower route.
 *
 * Set to false to put the site back into preview. The waitlist form, its API
 * route and the gate all still exist and still work — this only decides which
 * face the marketing pages wear.
 */
export const LIVE = true;

/**
 * The primary call to action, in one place because five pages use it.
 *
 * The header, the homepage hero, and the closing panel on each of the four
 * marketing pages all rendered the same button with the same label, so changing
 * what it says meant finding all six and getting all six right.
 */
export const PRIMARY_CTA = LIVE
  ? { href: "/login", label: "Get started" }
  : { href: "/#waitlist", label: "Request early access" };
