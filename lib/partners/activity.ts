import "server-only";

import { serviceClient } from "@/lib/supabase/service";
import { completeStep } from "@/lib/partners/onboarding";
import type { Caller } from "@/lib/coverage/service";

/**
 * Onboarding ticks that come from a partner actually using the API.
 *
 * WHY THIS IS NOT IN lib/coverage/service.ts. Onboarding is a fact about the
 * commercial relationship, not about coverage, and the coverage service is a
 * bounded context that knows nothing about the partner lifecycle. It knows a
 * partner_id because a quote has to be attributed to somebody; it should not know
 * that there is a checklist somewhere with "first sandbox quote" on it.
 *
 * So the tick happens in the route handler, which is the composition point — it
 * already holds both the caller and the result — and this module is the only
 * thing that joins the two ideas.
 *
 * Nothing here throws. A partner's successful quote is successful whether or not
 * a checkbox was recorded, and a 500 caused by bookkeeping would be a worse bug
 * than the missing tick.
 */
export async function notePartnerApiCall(
  caller: Caller,
  call: "quote" | "bind",
): Promise<void> {
  if (caller.source !== "partner") return;
  // Only sandbox activity is an onboarding milestone. A live call means they
  // finished onboarding some time ago.
  if (caller.environment !== "sandbox") return;

  try {
    await completeStep(serviceClient(), {
      partnerId: caller.partnerId,
      step: call === "quote" ? "sandbox_quote_ok" : "sandbox_bind_ok",
      note: `Observed on integration ${caller.integrationId}.`,
    });
  } catch (error) {
    console.error("onboarding tick failed:", (error as Error).message);
  }
}
