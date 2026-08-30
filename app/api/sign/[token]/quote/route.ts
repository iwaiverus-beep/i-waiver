import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { requestContext, recordAuditEvent } from "@/lib/audit";
import { resolveSigningSession } from "@/lib/agreements/signing";
import { requestQuote } from "@/lib/coverage/client";
import { CoverageUnavailable } from "@/lib/coverage/client";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sign/[token]/quote
 *
 * Prices cover for the person about to sign. Note what crosses the boundary: an
 * activity, a state, a window, described parties and a described asset. No
 * agreement id in the payload body, no signer row, no join. The coverage service
 * is given the same picture a partner platform would give it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const db = serviceClient();
    const context = requestContext(request);
    const session = await resolveSigningSession(db, token);

    const { document } = session;

    const response = await requestQuote({
      context: {
        activity_class: document.agreement.activity_class,
        jurisdiction: document.agreement.jurisdiction,
        starts_at: document.agreement.starts_at,
        ends_at: document.agreement.ends_at,
        parties: document.signers.map((signer) => ({
          external_ref: signer.id,
          name: signer.display_name,
          role: signer.role as "lender" | "borrower",
          email: signer.email,
          phone: signer.phone,
          identity_verified: false,
        })),
        asset: {
          asset_class: document.asset.asset_class,
          description: document.asset.description,
          declared_value_cents: document.asset.declared_value_cents,
          identifier: document.asset.identifier,
          year: document.asset.year,
        },
        supplemental: {
          waiver_efficacy: document.waiverEfficacy,
          specimen_clause_set: document.specimen,
        },
        originating_reference: document.agreement.id,
      },
      beneficiary_external_ref: session.signerId,
    });

    await recordAuditEvent(db, {
      agreementId: session.agreementId,
      signerId: session.signerId,
      type: "quoted",
      actor: "carrier",
      payload: {
        coverage_context_id: response.coverage_context_id,
        options: response.options.map((o) => ({
          quote_id: o.quote_id,
          coverage_kind: o.coverage_kind,
          premium_cents: o.premium_cents,
        })),
      },
      context,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof CoverageUnavailable) {
      // A quote that cannot be produced must never stop someone signing. The
      // agreement is the thing they came for; the cover is an offer.
      return NextResponse.json(
        { coverage_context_id: null, options: [], unavailable: error.message },
        { status: 200 },
      );
    }
    return jsonError(error);
  }
}
