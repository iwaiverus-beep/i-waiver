import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";
import { activeEmulation, mintViewerToken } from "@/lib/platform/emulation";

/**
 * The session client, running as `authenticated` with RLS applied.
 *
 * Reads go through here so the policies in 20260829000002 do the participation
 * check for us. Writes do not: they go through a route handler on the service
 * client, which then has to make that check itself.
 */
async function sessionClient() {
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
 * A client that reads as one specific user, from a token minted here.
 *
 * No cookies, no session, nothing persisted: the token goes out on the one
 * request and is never seen again. Used only by support emulation — see the
 * header of lib/platform/emulation.ts for why this is the mechanism and not a
 * real sign-in as the customer.
 */
function impersonatingClient(userId: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${mintViewerToken(userId)}`,
        // So a request in a log can be told apart from the customer's own.
        "x-iwaiver-actor": "emulation",
      },
    },
  });
}

/**
 * The client every lender-facing read should use.
 *
 * Normally the signed-in person's own. While a support emulation is live it reads
 * as the customer instead — which is the entire trick, and the reason no page
 * needed changing to support this: RLS is what scopes these screens, so pointing
 * it at a different `auth.uid()` produces that person's view exactly, including
 * the parts we would have got wrong by reimplementing the scoping ourselves.
 */
export async function userClient() {
  const emulation = await activeEmulation();
  if (emulation) return impersonatingClient(emulation.targetUserId);
  return sessionClient();
}

/**
 * The actual signed-in user, ignoring any emulation. Or null.
 *
 * Use this to answer "who is really operating this browser" — which is what
 * ending an emulation and writing an audit row both need. Everything that
 * decides what to SHOW should use `currentUser` instead.
 *
 * Deduplicated per request. `auth.getUser()` is a network round trip to the auth
 * server — it verifies the token rather than trusting the cookie, which is the
 * behaviour we want — and several things ask this question during one render.
 * `/api/profile` is the sharp case: the header fetches it on every page in the
 * product, and it resolves the session for the profile and again for the staff
 * check. `cache()` makes the second and third calls free for the life of the
 * request, and changes nothing about what is returned.
 */
export const realUser = cache(async () => {
  const supabase = await sessionClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/**
 * The user the product should behave as, or null.
 *
 * The same thing as `realUser` except during a support emulation, when it is the
 * customer. Every screen, every nav decision and every "is this person staff"
 * check reads this, so an operator emulating a customer sees the customer's
 * product — including not being staff, which is why the admin console closes
 * itself while an emulation is live.
 *
 * The identity is taken from the `staff_emulations` row rather than from the auth
 * server, because there is no session for that person to ask about. Only the id
 * is trustworthy here; anything wanting the customer's name or email should read
 * `profiles`, as the rest of the product already does.
 */
export const currentUser = cache(async () => {
  const emulation = await activeEmulation();
  if (!emulation) return realUser();

  const real = await realUser();
  // No live session at all means no emulation either: the cookie is not a
  // credential on its own, and must never become one.
  if (!real) return null;

  return {
    ...real,
    id: emulation.targetUserId,
    email: undefined,
    // Kept so anything that logs the user object says what it is looking at.
    app_metadata: { ...real.app_metadata, iwaiver_emulated: true },
  } as typeof real;
});
