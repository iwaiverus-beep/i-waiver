import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie on every matched request, and keeps
 * unauthenticated visitors out of the lender area.
 *
 * `/sign/...`, `/start/...` and `/join/...` are intentionally not matched. A
 * borrower has no session, no account,
 * and no business acquiring either — their capability is the token in the URL, and
 * it is checked server-side in the route that uses it. `/join/...` is the same
 * bargain seen from the dock: the slug names a booking and grants nothing, and the
 * route it posts to does its own checking on the service client.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh. Let the request through
  // and allow the page to render its own "not configured" state.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of items) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLenderArea =
    path.startsWith("/dashboard") ||
    path.startsWith("/agreements") ||
    path.startsWith("/groups") ||
    path.startsWith("/assets") ||
    path.startsWith("/contacts") ||
    path.startsWith("/requests") ||
    path.startsWith("/codes") ||
    path.startsWith("/account") ||
    // Signed-in areas that are not the lender's. Being signed in is all this
    // checks; whether the account is a partner member or staff is decided by
    // lib/partners/access.ts and lib/platform/access.ts, on the service client,
    // where the answer can be trusted. Note what is NOT matched: /partners and
    // /partners/docs are the public pitch and the integration reference, and both
    // have to be readable by somebody deciding whether to apply.
    path.startsWith("/partners/console") ||
    path.startsWith("/admin");

  if (isLenderArea && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path);
    return redirectKeepingCookies(login, response);
  }

  if (path === "/login" && user) {
    // Honour ?next= for somebody who is already signed in. Without this, a
    // partner following the sign-in link in their approval email lands on the
    // lender dashboard, which is not theirs and does not explain itself. Only
    // relative paths, so a crafted value cannot bounce a live session off-site.
    //
    // /assets, the same place the login page and the OAuth callback default to.
    // This is the fourth door into the product and the three of them have to
    // agree, or where you end up depends on which one you happened to use.
    const next = request.nextUrl.searchParams.get("next");
    const destination = request.nextUrl.clone();
    destination.pathname =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/assets";
    destination.search = "";
    return redirectKeepingCookies(destination, response);
  }

  return response;
}

/**
 * A redirect that carries the cookies the session refresh just wrote.
 *
 * THE BUG THIS FIXES, because it is not obvious and it cost a real sign-in loop.
 *
 * `getUser()` above does not merely read the session — when the access token has
 * expired it refreshes it, and the refreshed tokens are handed back through the
 * `setAll` callback, which writes them onto `response`. Supabase rotates the
 * refresh token when it does this, so the one in the browser is now spent.
 *
 * `NextResponse.redirect()` builds a NEW response. Every cookie `setAll` just
 * wrote is on the old one, so returning a bare redirect throws the new session
 * away and leaves the browser holding a refresh token that has already been
 * used. The next request refreshes again from a spent token, fails, and bounces
 * to /login; a later request that happens not to redirect finally lands the
 * cookies and everything works. From outside that reads exactly as reported —
 * signing in loops a few times and then succeeds.
 *
 * So any response this file returns must carry the cookie writes forward. There
 * is no path here that may return a plain `NextResponse.redirect`.
 */
function redirectKeepingCookies(
  destination: URL,
  carrier: NextResponse,
): NextResponse {
  const redirect = NextResponse.redirect(destination);
  for (const cookie of carrier.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/agreements/:path*",
    "/groups/:path*",
    "/assets/:path*",
    "/contacts/:path*",
    "/requests/:path*",
    "/codes/:path*",
    "/account/:path*",
    "/partners/console/:path*",
    "/admin/:path*",
    "/login",
  ],
};
