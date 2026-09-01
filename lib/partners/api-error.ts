import { NextResponse } from "next/server";
import { NotAuthorisedApi } from "@/lib/partners/api-auth";
import { PartnerOriginationRefused } from "@/lib/agreements/partner-origination";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

/**
 * What a partner is told when a call to /api/agreements/v1 fails.
 *
 * Separate from lib/http.ts, which answers the first-party app and the browser.
 * The difference that matters is the audience: this one is read by somebody
 * else's code, so every failure carries a stable `detail` slug they can branch on
 * alongside a sentence a human can act on. Changing a `detail` value is a
 * breaking change to somebody's integration; changing the sentence is not.
 */
export function partnerApiError(error: unknown): NextResponse {
  if (error instanceof NotAuthorisedApi) {
    return NextResponse.json(
      { error: error.message, detail: error.detail },
      { status: error.status },
    );
  }

  if (error instanceof PartnerOriginationRefused) {
    return NextResponse.json(
      { error: error.message, detail: error.detail },
      { status: error.status },
    );
  }

  // A refusal from the lifecycle — the compliance gate, an unreviewed clause set,
  // a state with no template. The message is written for a lender reading a
  // screen, and it is the right message here too: the partner has to tell their
  // customer why nothing was sent.
  if (error instanceof TransitionRefused) {
    return NextResponse.json(
      { error: error.message, detail: "not_available", reasons: error.reasons },
      { status: 422 },
    );
  }

  console.error("partner agreements API failed:", error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
