import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/coverage/auth";
import { bindQuotes, CoverageRejection } from "@/lib/coverage/service";
import { notePartnerApiCall } from "@/lib/partners/activity";
import type { BindRequest } from "@/lib/coverage/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/coverage/v1/bind
 *
 * Binding is idempotent per quote: a quote that already has a policy returns that
 * policy rather than creating a second one, because the common failure here is a
 * retried request, not a customer wanting two of the same cover.
 */
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: BindRequest;
  try {
    body = (await request.json()) as BindRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const response = await bindQuotes(body, caller);
    await notePartnerApiCall(caller, "bind");
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof CoverageRejection) {
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: error.status },
      );
    }
    console.error("coverage bind failed:", error);
    return NextResponse.json({ error: "Could not bind cover." }, { status: 500 });
  }
}
