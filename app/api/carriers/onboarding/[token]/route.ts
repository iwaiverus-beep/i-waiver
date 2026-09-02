import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { partnerNotificationEmail } from "@/lib/env";
import { carrierSubmissionNotice } from "@/lib/coverage/emails";
import {
  resolveOnboardingLink,
  submitCarrierDetails,
} from "@/lib/coverage/onboarding";

export const runtime = "nodejs";

/**
 * POST /api/carriers/onboarding/[token]
 *
 * A carrier filling in their own details. Unauthenticated by design — a carrier
 * has no account here and never will — so the token in the path is the whole of
 * the authorisation, and every field is validated in this file because nothing
 * downstream will.
 *
 * Worth being clear about what this endpoint can and cannot do, because it is on
 * the open internet: it writes one row to `carrier_submissions` and touches
 * nothing else. It cannot change a carrier, cannot create one, cannot read
 * another carrier's answers, and cannot make anything quotable. The worst a
 * stolen token achieves is a piece of text appearing in a review panel for a
 * member of staff to reject.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const db = serviceClient();

    const resolved = await resolveOnboardingLink(db, token);
    if (!resolved.ok) {
      return NextResponse.json(
        {
          error:
            resolved.reason === "expired"
              ? "That link has expired. Ask us for a new one."
              : resolved.reason === "revoked"
                ? "That link was replaced by a newer one. Check for a more recent email from us."
                : "That link is not valid.",
        },
        { status: 410 },
      );
    }

    const body = await readJson<Record<string, unknown>>(request);

    const contactEmail = text(body.contact_email, 320)?.toLowerCase() ?? null;
    if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
      return NextResponse.json(
        { error: "That email address does not look right." },
        { status: 400 },
      );
    }

    // Normalised the same way the application form does it, so a carrier typing
    // "api.example.com" gets a link the console can open rather than a string
    // that turns into a relative URL when somebody clicks it.
    const url = (value: unknown) => {
      const raw = text(value, 300);
      if (!raw) return null;
      return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    };

    const states = Array.isArray(body.states)
      ? body.states.map((v) => text(v, 2) ?? "").filter(Boolean)
      : [];

    const { submissionId } = await submitCarrierDetails(db, {
      linkId: resolved.link.linkId,
      carrierId: resolved.link.carrier.id,
      details: {
        legalName: text(body.legal_name, 200),
        naicCode: text(body.naic_code, 20),
        amBestRating: text(body.am_best_rating, 20),
        contactName: text(body.contact_name, 120),
        contactEmail,
        contactPhone: text(body.contact_phone, 40),
        states,
        apiBaseUrl: url(body.api_base_url),
        apiDocsUrl: url(body.api_docs_url),
        products: text(body.products, 4000),
        notes: text(body.notes, 4000),
      },
    });

    // The same address that hears about a new partner application. A submission
    // sitting in a panel nobody is told about is exactly the failure this module
    // was written to fix.
    const notify = partnerNotificationEmail();
    if (notify) {
      await carrierSubmissionNotice({
        to: notify,
        companyName: resolved.link.carrier.name,
        carrierId: resolved.link.carrier.id,
        states,
        contactEmail,
      });
    } else {
      console.warn(
        `carrier submission ${submissionId} recorded but PARTNER_NOTIFICATIONS_EMAIL is not set — nobody was told.`,
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
