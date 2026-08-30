"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client, anon key only.
 *
 * Used for one thing: signing in and out. Every other operation the lender
 * performs goes to a route handler, because the agreement graph has no
 * client-writable surface by design.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
