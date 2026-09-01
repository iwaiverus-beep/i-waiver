import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { coverageInternalKey } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/service";
import type { Caller } from "@/lib/coverage/service";

/**
 * Who is calling the coverage service.
 *
 * One credential header, two kinds of holder. The first-party agreements app
 * presents an internal key; a partner presents an API key matched against
 * `partner_integrations.api_key_hash`. Neither gets a privilege the other lacks
 * beyond the jurisdictions their integration is enabled for — which is the whole
 * point of making the first party use the front door.
 *
 * Since 20260901000012 a partner key also carries an ENVIRONMENT. It is resolved
 * here, from the row, and never from anything the caller sends: a request header
 * or a body field saying "this is a test" would be a way to write sandbox rows
 * with a live key, or worse. The key is the environment.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * How stale a `last_used_at` may be before it is worth a write.
 *
 * A write per request to record a read is a bad trade, and "used in the last
 * hour" answers every question this column exists for: is this key still in use,
 * and did anything happen on it after we revoked the one before it.
 */
const LAST_USED_STALE_MS = 60 * 60 * 1000;

export async function resolveCaller(request: Request): Promise<Caller | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  // The first party is always live. The carrier being a mock for this milestone
  // is a separate fact and must not be confused with this one — the day a real
  // carrier is wired in, a signed agreement's coverage must already be sitting in
  // the live half of the data.
  if (constantTimeEquals(token, coverageInternalKey())) {
    return { source: "first_party", environment: "live" };
  }

  // Partners are looked up by hash, so the raw key exists only in their config.
  const hash = createHash("sha256").update(token).digest("hex");
  const db = serviceClient();

  const { data } = await db
    .from("partner_integrations")
    .select(
      "id, partner_id, environment, allowed_jurisdictions, revoked_at, last_used_at, partners(disabled_at)",
    )
    .eq("api_key_hash", hash)
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
    source: "partner",
    partnerId: data.partner_id,
    integrationId: data.id,
    environment: data.environment as "sandbox" | "live",
    allowedJurisdictions: data.allowed_jurisdictions ?? [],
  };
}
