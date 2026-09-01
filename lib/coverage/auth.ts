import "server-only";

import { timingSafeEqual } from "node:crypto";
import { coverageInternalKey } from "@/lib/env";
import { bearerToken, resolveIntegration } from "@/lib/partners/api-key";
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
 * Since 20260901000012 a partner key also carries an ENVIRONMENT, and since
 * 20260901000019 a set of SCOPES. Both are resolved from the row and never from
 * anything the caller sends: a header or body field saying "this is a test" would
 * be a way to write sandbox rows with a live key, or worse.
 *
 * The credential itself is resolved by lib/partners/api-key.ts, which both this
 * door and the agreements door share so that a revocation check cannot exist in
 * one and not the other. See the note there on why coverage may import it.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function resolveCaller(request: Request): Promise<Caller | null> {
  const token = bearerToken(request);
  if (!token) return null;

  // The first party is always live. The carrier being a mock for this milestone
  // is a separate fact and must not be confused with this one — the day a real
  // carrier is wired in, a signed agreement's coverage must already be sitting in
  // the live half of the data.
  if (constantTimeEquals(token, coverageInternalKey())) {
    return { source: "first_party", environment: "live" };
  }

  const integration = await resolveIntegration(token);
  if (!integration) return null;

  // A key issued for agreements alone does not open this door. Scopes default to
  // `coverage`, so every key that worked before 20260901000019 still works.
  if (!integration.scopes.includes("coverage")) return null;

  return {
    source: "partner",
    partnerId: integration.partnerId,
    integrationId: integration.id,
    environment: integration.environment,
    allowedJurisdictions: integration.allowedJurisdictions,
  };
}
