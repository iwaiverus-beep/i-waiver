"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client, anon key only.
 *
 * Used for the account itself: signing in and out, and changing the email
 * address or password on it. Those belong to Supabase Auth and act on the
 * caller's own session, which is why they are here rather than behind a
 * service-role route that could reach any account — see
 * components/AccountCredentials.tsx.
 *
 * Everything else the lender does goes to a route handler, because the agreement
 * graph has no client-writable surface by design.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
