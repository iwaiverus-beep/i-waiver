import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/coverage/auth";
import { CoverageRejection, createQuote } from "@/lib/coverage/service";
import type { QuoteRequest } from "@/lib/coverage/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/coverage/v1/quote
 *
 * The coverage service's front door. The first-party agreements app and a partner
 * platform reach the same handler with the same payload and get the same answer;
 * only the credential differs. Nothing about this route knows what an agreement is.
 */
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: QuoteRequest;
  try {
    body = (await request.json()) as QuoteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    return NextResponse.json(await createQuote(body, caller));
  } catch (error) {
    if (error instanceof CoverageRejection) {
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: error.status },
      );
    }
    console.error("coverage quote failed:", error);
    return NextResponse.json({ error: "Could not produce a quote." }, { status: 500 });
  }
}
