import "server-only";

import { bearerToken, resolveIntegration } from "@/lib/partners/api-key";

/**
 * Who is calling the agreements API.
 *
 * The second door. Same credential store as the coverage door and the same
 * resolver, with one difference that matters: this one requires the `agreements`
 * scope, which is NOT granted by default.
 *
 * That asymmetry is deliberate. Pricing cover against a described risk is a
 * bounded thing — worst case somebody sees a premium they should not have. This
 * API creates a legal instrument in somebody else's name and puts it in front of
 * a signer, and a key that can do that is a key that can send a release with a
 * rental shop's name on it to anyone. So a platform gets it when they have asked
 * for it and somebody has said yes, not because they were issued a key.
 */

export class NotAuthorisedApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export type ApiCaller = {
  partnerId: string;
  integrationId: string;
  environment: "sandbox" | "live";
};

/**
 * Resolve a caller for the agreements API, or throw.
 *
 * SANDBOX IS REFUSED HERE, and this is the one place the two APIs disagree about
 * what sandbox means. A sandbox coverage call is harmless: it prices against a
 * mock carrier and writes rows that a purge deletes. There is no equivalent for
 * an agreement — a test agreement is a real document, hashed and stored
 * write-once, sent to a real email address, and there is no such thing as a
 * pretend signature that a court would treat as pretend. Rather than build a
 * shadow agreement graph that could drift from the real one, this door is live
 * only, and says so.
 */
export async function requireApiCaller(request: Request): Promise<ApiCaller> {
  const integration = await resolveIntegration(bearerToken(request));

  if (!integration) {
    throw new NotAuthorisedApi("Unauthorised.", 401);
  }

  if (!integration.scopes.includes("agreements")) {
    throw new NotAuthorisedApi(
      "This key is not enabled for the agreements API.",
      403,
      "scope_required",
    );
  }

  if (integration.environment !== "live") {
    throw new NotAuthorisedApi(
      "There is no sandbox for agreements. A document this API creates is a real document, signed by a real person — so this endpoint takes live keys only. Build against the coverage sandbox, and ask us for a test lender when you are ready to run the agreement flow end to end.",
      403,
      "sandbox_not_supported",
    );
  }

  return {
    partnerId: integration.partnerId,
    integrationId: integration.id,
    environment: integration.environment,
  };
}
