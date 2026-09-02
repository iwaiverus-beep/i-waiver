import "server-only";

import { cache } from "react";
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

/**
 * The signed-in user, or null.
 *
 * Deduplicated per request. `auth.getUser()` is a network round trip to the auth
 * server — it verifies the token rather than trusting the cookie, which is the
 * behaviour we want — and several things ask this question during one render.
 * `/api/profile` is the sharp case: the header fetches it on every page in the
 * product, and it resolves the session for the profile and again for the staff
 * check. `cache()` makes the second and third calls free for the life of the
 * request, and changes nothing about what is returned.
 */
export const currentUser = cache(async () => {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});
