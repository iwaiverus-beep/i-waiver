import { NextResponse } from "next/server";
import { requireApiCaller } from "@/lib/partners/api-auth";
import { partnerApiError } from "@/lib/partners/api-error";
import { partnerAgreement } from "@/lib/agreements/partner-origination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agreements/v1/agreements/[id] — where a transaction has got to.
 *
 * Names, dates and signing state. Deliberately not the document, not the audit
 * chain, and never a signing token: a partner is entitled to know where their
 * customer's transaction is, not to hold the evidence for it. The parties get the
 * executed PDF by email, and the lender's own copy is theirs.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const caller = await requireApiCaller(request);
    return NextResponse.json(await partnerAgreement(caller, id));
  } catch (error) {
    return partnerApiError(error);
  }
}
