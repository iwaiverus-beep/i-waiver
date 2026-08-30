import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

/**
 * The service-role client. Bypasses RLS entirely.
 *
 * CLAUDE.md constraint 2: all writes to the agreement graph go through server-side
 * route handlers using this client. There are deliberately no INSERT/UPDATE/DELETE
 * policies for `authenticated`, so this is not one way in among several — it is the
 * only one.
 *
 * The `server-only` import above is the enforcement: importing this module from a
 * client component is a build error, not a code-review catch.
 *
 * Every caller is responsible for its own authorisation, because the database will
 * not do it here. For a lender that means checking the session against
 * `originators`; for a borrower it means validating the signing-link token first.
 */
export function serviceClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-iwaiver-actor": "service" } },
  });
}
