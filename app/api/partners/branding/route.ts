import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import {
  membershipFor,
  requirePartnerActor,
  resolvePartnerId,
} from "@/lib/partners/access";

export const runtime = "nodejs";

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * POST /api/partners/branding — submit a logo and colours for review.
 *
 * SUBMIT, not publish. Saving here clears `approved_at`, so any change puts the
 * branding back in the queue and the widget goes on rendering the last approved
 * version until somebody looks at the new one. That is not bureaucracy: the
 * embedded surface makes an insurance offer in our name, and what appears
 * alongside that offer is a statement about who is speaking. See the long note in
 * migration 20260901000015.
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePartnerActor();
    const body = await readJson<Record<string, unknown>>(request);
    const partnerId = resolvePartnerId(actor, text(body.partner_id, 40));
    membershipFor(actor, partnerId, "branding.submit");

    const primary = text(body.primary_color, 7);
    const accent = text(body.accent_color, 7);

    for (const [name, value] of [
      ["primary colour", primary],
      ["accent colour", accent],
    ] as const) {
      if (value && !HEX.test(value)) {
        return NextResponse.json(
          { error: `The ${name} needs to be a six-digit hex value like #1B4332.` },
          { status: 400 },
        );
      }
    }

    const logo = text(body.logo_url, 500);
    if (logo && !/^https:\/\//i.test(logo)) {
      // The logo is rendered inside our surface. An http asset would make the
      // whole frame insecure and is the easiest possible thing to get right.
      return NextResponse.json(
        { error: "The logo has to be an https URL." },
        { status: 400 },
      );
    }

    const themeValue = text(body.theme, 10) ?? "auto";
    const theme = ["light", "dark", "auto"].includes(themeValue) ? themeValue : "auto";

    const { error } = await actor.db.from("partner_branding").upsert(
      {
        partner_id: partnerId,
        display_name: text(body.display_name, 120),
        logo_url: logo,
        primary_color: primary,
        accent_color: accent,
        theme,
        support_email: text(body.support_email, 320)?.toLowerCase() ?? null,
        support_url: text(body.support_url, 500),
        submitted_at: new Date().toISOString(),
        // Back into the queue. Approval is of a specific set of values, not of a
        // partner in general.
        approved_at: null,
        approved_by: null,
        review_note: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "partner_id" },
    );

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      notice: "Submitted for review. Your last approved version keeps rendering until then.",
    });
  } catch (error) {
    return jsonError(error);
  }
}
