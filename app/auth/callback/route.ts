import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Google (or Apple, or Microsoft) sends someone back to.
 *
 * The provider returns a one-time `code`; exchanging it sets the session cookies.
 * This has to be a route handler rather than a page because that exchange writes
 * cookies, and a Server Component cannot.
 *
 * `next` is validated the same way the login page validates it. An open redirect
 * here would be worse than the usual kind: the victim arrives carrying a session
 * that was just minted, so a crafted link could hand a live login to whatever
 * host the attacker named.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next");

  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/assets";

  // The provider reports a refusal here rather than by failing the exchange —
  // someone who pressed Cancel on Google's consent screen lands with an error
  // and no code, which is not a fault worth an alarming page.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    const back = new URL("/login", url.origin);
    back.searchParams.set(
      "error",
      providerError === "access_denied"
        ? "Sign-in was cancelled."
        : "That provider could not sign you in.",
    );
    return NextResponse.redirect(back);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await userClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", "That sign-in link had already been used.");
    return NextResponse.redirect(back);
  }

  // Redirect to the origin this request actually arrived on, not to a configured
  // site URL: behind Vercel's preview deployments they differ, and sending
  // someone to production from a preview login is a confusing way to lose a session.
  return NextResponse.redirect(new URL(next, url.origin));
}
