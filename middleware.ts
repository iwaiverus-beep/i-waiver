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
    return NextResponse.redirect(login);
  }

  if (path === "/login" && user) {
    // Honour ?next= for somebody who is already signed in. Without this, a
    // partner following the sign-in link in their approval email lands on the
    // lender dashboard, which is not theirs and does not explain itself. Only
    // relative paths, so a crafted value cannot bounce a live session off-site.
    const next = request.nextUrl.searchParams.get("next");
    const destination = request.nextUrl.clone();
    destination.pathname =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  return response;
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
