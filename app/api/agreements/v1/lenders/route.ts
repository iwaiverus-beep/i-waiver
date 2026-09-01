import { NextResponse } from "next/server";
import { EMAIL_PATTERN, text } from "@/lib/http";
import { requireApiCaller } from "@/lib/partners/api-auth";
import { partnerApiError } from "@/lib/partners/api-error";
import { upsertLender } from "@/lib/agreements/partner-origination";
import { isStateCode } from "@/lib/jurisdictions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/v1/lenders — register one of the platform's customers.
 *
 * The lender is the platform's customer, not the platform. This creates an
 * organization and an originator that the partner administers, keyed by their own
 * `external_ref` so they never have to store our uuid.
 *
 * Idempotent. Calling it twice with the same reference returns the same lender
 * with `created: false`, which is what makes it safe to POST a whole customer
 * list on every sync.
 */
export async function POST(request: Request) {
  try {
    const caller = await requireApiCaller(request);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const externalRef = text(body.external_ref, 200);
    const legalName = text(body.legal_name, 200);

    if (!externalRef) {
      return NextResponse.json(
        { error: "external_ref is required — it is your own id for this customer." },
        { status: 400 },
      );
    }
    if (!legalName) {
      return NextResponse.json(
        { error: "legal_name is required. It is the name that appears on the release." },
        { status: 400 },
      );
    }

    const state = text(body.primary_state, 2)?.toUpperCase() ?? null;
    if (state && !isStateCode(state)) {
      return NextResponse.json(
        { error: `${state} is not a state.` },
        { status: 400 },
      );
    }

    // Accepted and ignored if malformed rather than refused: a contact address on
    // the company record is convenience, and the address that matters is the one
    // on the signer, which the agreement call supplies.
    const contact = text(body.contact_email, 320)?.toLowerCase() ?? null;
    if (contact && !EMAIL_PATTERN.test(contact)) {
      return NextResponse.json(
        { error: "contact_email is not an email address." },
        { status: 400 },
      );
    }

    const lender = await upsertLender(caller, {
      externalRef,
      legalName,
      dba: text(body.dba, 200),
      primaryState: state,
    });

    return NextResponse.json(lender, { status: lender.created ? 201 : 200 });
  } catch (error) {
    return partnerApiError(error);
  }
}
