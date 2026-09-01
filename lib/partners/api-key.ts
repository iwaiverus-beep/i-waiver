import "server-only";

import { createHash } from "node:crypto";
import { serviceClient } from "@/lib/supabase/service";

/**
 * Resolving a partner API key. One implementation, both APIs.
 *
 * There are two doors now — `/api/coverage/v1/*` and `/api/agreements/v1/*` — and
 * they authenticate against the same `partner_integrations` row. Writing the hash
 * comparison, the revocation check and the disabled-partner check twice is
 * exactly the kind of duplication that drifts: one copy gets the `revoked_at`
 * filter and the other does not, and nobody notices until a revoked key still
 * works somewhere.
 *
 * So this module owns the credential, and each side maps the row onto whatever
 * caller shape it needs. It deliberately knows nothing about coverage or
 * agreements — no jurisdictions logic, no scope opinion — and returns the row.
 *
 * ON `lib/coverage/` IMPORTING THIS. `partner_integrations` is the credential
 * store for the service boundary itself, and both sides of that boundary present
 * against it. This file names no agreement, no signer and no quote; it is
 * infrastructure for the door, not a path through it. CLAUDE.md constraint 9 is
 * about coverage not reading the agreement graph, and nothing here does.
 */

export type IntegrationRow = {
  id: string;
  partnerId: string;
  environment: "sandbox" | "live";
  allowedJurisdictions: string[];
  scopes: string[];
};

/** Must stay identical to the hash lib/partners/keys.ts computes at mint time. */
export function hashPresentedKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The bearer token, or empty. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * How stale a `last_used_at` may be before it is worth a write.
 *
 * A write per request to record a read is a bad trade, and "used in the last
 * hour" answers every question this column exists for: is this key still in use,
 * and did anything happen on it after we revoked the one before it.
 */
const LAST_USED_STALE_MS = 60 * 60 * 1000;

/**
 * The integration behind a presented token, or null.
 *
 * Null covers every reason equally — unknown, revoked, partner disabled — because
 * the caller is told "unauthorised" in all three cases and distinguishing them in
 * a response would tell somebody holding a stolen key which of those it is.
 */
export async function resolveIntegration(
  token: string,
): Promise<IntegrationRow | null> {
  if (!token) return null;

  const db = serviceClient();

  const { data } = await db
    .from("partner_integrations")
    .select(
      "id, partner_id, environment, allowed_jurisdictions, scopes, revoked_at, last_used_at, partners(disabled_at)",
    )
    .eq("api_key_hash", hashPresentedKey(token))
    .maybeSingle();

  if (!data) return null;

  // A revoked key is not a key. This is the only lever that ends access, because
  // — see lib/partners/keys.ts — there is no pepper to rotate.
  if (data.revoked_at) return null;

  const partner = (Array.isArray(data.partners) ? data.partners[0] : data.partners) as
    | { disabled_at: string | null }
    | null;

  if (partner?.disabled_at) return null;

  const now = Date.now();
  const seen = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (now - seen > LAST_USED_STALE_MS) {
    const { error } = await db
      .from("partner_integrations")
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("id", data.id);
    // Failing to record that a key was used is not a reason to refuse the call.
    if (error) console.error("last_used_at not stamped:", error.message);
  }

  return {
    id: data.id,
    partnerId: data.partner_id,
    environment: data.environment as "sandbox" | "live",
    allowedJurisdictions: data.allowed_jurisdictions ?? [],
    scopes: (data.scopes ?? []) as string[],
  };
}
