import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { isStateCode } from "@/lib/jurisdictions";
import { EMAIL_PATTERN, jsonError, text } from "@/lib/http";
import {
  PARTNER_KINDS,
  VOLUME_BANDS,
  submitApplication,
  type PartnerKind,
} from "@/lib/partners/applications";

export const runtime = "nodejs";

/**
 * POST /api/partners/apply
 *
 * The public front door for a waiver platform or a carrier. Same shape as the
 * waitlist route it is modelled on: unauthenticated, service role, and every
 * field validated here because nothing downstream will.
 *
 * Deliberately says the same thing whether the application is new or a duplicate
 * of one already open. Confirming that a company has already applied would leak
 * a fact about somebody else's business to anyone who can guess an address.
 */

type Payload = Record<string, unknown>;

export async function POST(request: Request) {
  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const companyName = text(body.company_name, 160);
  const contactName = text(body.contact_name, 120);
  const contactEmail = text(body.contact_email, 320)?.toLowerCase() ?? null;

  if (!companyName) {
    return NextResponse.json({ error: "What is the company called?" }, { status: 400 });
  }
  if (!contactName) {
    return NextResponse.json({ error: "Who should we reply to?" }, { status: 400 });
  }
  if (!contactEmail || !EMAIL_PATTERN.test(contactEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const kindValue = text(body.partner_kind, 40) ?? "other";
  const partnerKind: PartnerKind = (PARTNER_KINDS as readonly string[]).includes(
    kindValue,
  )
    ? (kindValue as PartnerKind)
    : "other";

  const interestValue = text(body.integration_interest, 20);
  const integrationInterest =
    interestValue === "widget" || interestValue === "api" || interestValue === "redirect"
      ? interestValue
      : null;

  const volumeValue = text(body.volume_band, 20);
  const volumeBand = (VOLUME_BANDS as readonly string[]).includes(volumeValue ?? "")
    ? volumeValue
    : null;

  // Checked against the actual list of states, not against /^[A-Z]{2}$/. The
  // shape test passes "ZZ", and a jurisdiction that is not a jurisdiction is
  // worse than a missing one: it reads as a real answer on the review screen and
  // could be copied straight onto a live key.
  //
  // Capped rather than rejected. Someone pasting all fifty is telling us
  // something true; someone posting ten thousand is not, and the cap is cheaper
  // than an error message nobody reads.
  const jurisdictions = Array.isArray(body.jurisdictions)
    ? [
        ...new Set(
          body.jurisdictions
            .map((value) => text(value, 2)?.toUpperCase() ?? "")
            .filter(isStateCode),
        ),
      ].slice(0, 60)
    : [];

  // A website is asked for but not required: some of the people worth talking to
  // are a programme manager with a slide deck, not a product with a marketing
  // site. It is normalised so the review screen can link it without guessing.
  const rawSite = text(body.website, 200);
  const website = rawSite
    ? /^https?:\/\//i.test(rawSite)
      ? rawSite
      : `https://${rawSite}`
    : null;

  try {
    const result = await submitApplication(serviceClient(), {
      companyName,
      website,
      partnerKind,
      contactName,
      contactEmail,
      contactPhone: text(body.contact_phone, 40),
      integrationInterest,
      jurisdictions,
      volumeBand,
      notes: text(body.notes, 4000),
      source: "public-site",
      userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    });

    return NextResponse.json({ ok: true }, { status: result.status === "recorded" ? 201 : 200 });
  } catch (error) {
    console.error("partner application failed:", error);
    return jsonError(error);
  }
}
