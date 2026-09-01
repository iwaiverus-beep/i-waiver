import { NextResponse } from "next/server";
import { EMAIL_PATTERN, text } from "@/lib/http";
import { requestContext } from "@/lib/audit";
import { requireApiCaller } from "@/lib/partners/api-auth";
import { partnerApiError } from "@/lib/partners/api-error";
import { createPartnerAgreement } from "@/lib/agreements/partner-origination";
import { isStateCode } from "@/lib/jurisdictions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/v1/agreements — create an agreement for one of this
 * partner's lenders, and send it.
 *
 * Created and sent in one call. A partner has no screen on which to review a
 * draft — that review happened in their product, before they called us — so a
 * two-step API would only leave them with a queue of half-made agreements they
 * cannot see.
 *
 * The response carries the signing links. Read the note in
 * lib/agreements/partner-origination.ts before assuming that is harmless: a
 * signing link is the borrower's entire authorisation, so the partner is holding
 * a bearer credential for their customer's signature. It is returned because the
 * borrower is usually standing at their counter, and the email goes out as well
 * so an unused link still reaches the person it belongs to.
 */
export async function POST(request: Request) {
  try {
    const caller = await requireApiCaller(request);
    const context = requestContext(request);

    let body: Record<string, any>;
    try {
      body = (await request.json()) as Record<string, any>;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const bad = (message: string) =>
      NextResponse.json({ error: message, detail: "invalid_request" }, { status: 400 });

    const lenderSignerName = text(body.lender_signer?.name, 120);
    const lenderSignerEmail =
      text(body.lender_signer?.email, 320)?.toLowerCase() ?? null;

    if (!lenderSignerName || !lenderSignerEmail) {
      return bad(
        "lender_signer.name and lender_signer.email are required — somebody at the lender signs, not the company.",
      );
    }
    if (!EMAIL_PATTERN.test(lenderSignerEmail)) {
      return bad("lender_signer.email is not an email address.");
    }

    const borrowerName = text(body.borrower?.name, 120);
    const borrowerEmail = text(body.borrower?.email, 320)?.toLowerCase() ?? null;

    if (!borrowerName) return bad("borrower.name is required.");
    if (!borrowerEmail || !EMAIL_PATTERN.test(borrowerEmail)) {
      return bad("borrower.email is required and must be an email address.");
    }

    const description = text(body.asset?.description, 200);
    if (!description) return bad("asset.description is required.");

    const jurisdiction = text(body.jurisdiction, 2)?.toUpperCase() ?? null;
    if (!jurisdiction || !isStateCode(jurisdiction)) {
      return bad("jurisdiction must be the state where the activity happens.");
    }

    const startsAt = text(body.starts_at, 40);
    const endsAt = text(body.ends_at, 40);
    if (!startsAt || !endsAt) return bad("starts_at and ends_at are required.");
    if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) {
      return bad("starts_at and ends_at must be ISO 8601 timestamps.");
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      return bad("ends_at must be after starts_at.");
    }

    const cents = (value: unknown): number | null => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      return Math.round(value);
    };

    const year = Number(body.asset?.year);

    const result = await createPartnerAgreement(caller, {
      lenderId: text(body.lender_id, 40),
      lenderExternalRef: text(body.lender_external_ref, 200),
      lenderSigner: { name: lenderSignerName, email: lenderSignerEmail },
      borrower: {
        name: borrowerName,
        email: borrowerEmail,
        phone: text(body.borrower?.phone, 20),
      },
      asset: {
        assetClass: text(body.asset?.asset_class, 20) ?? "other",
        description,
        // Cents, never dollars. Money is integer cents everywhere in this schema,
        // and a float here would round somebody's declared value.
        declaredValueCents: cents(body.asset?.declared_value_cents),
        identifier: text(body.asset?.identifier, 60),
        year: Number.isInteger(year) && year > 1900 ? year : null,
        make: text(body.asset?.make, 60),
        model: text(body.asset?.model, 60),
      },
      jurisdiction,
      activityClass: text(body.activity_class, 60) ?? "personal_watercraft",
      startsAt,
      endsAt,
      // Defaults to true, like the first-party form. The offer is still made on
      // our signing page; this only says whether to make it.
      coverRequested: body.cover_requested !== false,
      externalRef: text(body.external_ref, 200),
      context,
    });

    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return partnerApiError(error);
  }
}
