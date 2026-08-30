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
 */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function resolveCaller(request: Request): Promise<Caller | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  if (constantTimeEquals(token, coverageInternalKey())) {
    return { source: "first_party" };
  }

  // Partners are looked up by hash, so the raw key exists only in their config.
  const hash = createHash("sha256").update(token).digest("hex");
  const db = serviceClient();

  const { data } = await db
    .from("partner_integrations")
    .select("id, partner_id, allowed_jurisdictions, partners(disabled_at)")
    .eq("api_key_hash", hash)
    .maybeSingle();

  if (!data) return null;

  const partner = (Array.isArray(data.partners) ? data.partners[0] : data.partners) as
    | { disabled_at: string | null }
    | null;

  if (partner?.disabled_at) return null;

  return {
    source: "partner",
    partnerId: data.partner_id,
    allowedJurisdictions: data.allowed_jurisdictions ?? [],
  };
}
