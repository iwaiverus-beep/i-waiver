import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { requestContext } from "@/lib/audit";
import { recordSignature } from "@/lib/agreements/signing";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  method?: unknown;
  typed_name?: unknown;
  drawn_png?: unknown;
  biometric?: unknown;
  consented?: unknown;
  is_adult?: unknown;
  holds_education_card?: unknown;
  education_card_ref?: unknown;
  quote_ids?: unknown;
};

/**
 * POST /api/sign/[token]
 *
 * The borrower's only write. Runs under the service role because there is no
 * account to write a policy against — the token was validated first, and it is
 * validated again inside `recordSignature` rather than trusted from the page that
 * rendered.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const body = await readJson<Body>(request);
    const db = serviceClient();

    const method =
      body.method === "drawn"
        ? "drawn"
        : body.method === "biometric"
          ? "biometric"
          : "typed";
    const drawn = typeof body.drawn_png === "string" ? body.drawn_png : null;

    const outcome = await recordSignature(db, {
      token,
      method,
      typedName: text(body.typed_name, 120),
      drawnPng: drawn && drawn.startsWith("data:image/png;base64,") ? drawn : null,
      // Passed through unvalidated on purpose: recordSignature verifies it
      // against the session's own document hash, which is the only check that
      // means anything. Shape-checking it here would imply a guarantee this
      // layer cannot give.
      biometric: body.biometric ?? null,
      consented: body.consented === true,
      attestations: {
        isAdult: body.is_adult === true,
        holdsEducationCard: body.holds_education_card === true,
        educationCardRef: text(body.education_card_ref, 60),
      },
      quoteIds: Array.isArray(body.quote_ids)
        ? body.quote_ids.filter((q): q is string => typeof q === "string").slice(0, 6)
        : [],
      context: requestContext(request),
    });

    return NextResponse.json(outcome);
  } catch (error) {
    return jsonError(error);
  }
}
