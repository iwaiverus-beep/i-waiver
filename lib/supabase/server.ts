import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * The signed-in lender's own client, running as `authenticated` with RLS applied.
 *
 * Reads go through here so the policies in 20260829000002 do the participation
 * check for us. Writes do not: they go through a route handler on the service
 * client, which then has to make that check itself.
 */
export async function userClient() {
  const store = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of items) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session on every request, so losing the
          // write here is harmless.
        }
      },
    },
  });
}

/** The signed-in user, or null. */
export async function currentUser() {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
