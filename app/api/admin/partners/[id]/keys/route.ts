import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, NotStaff, requireStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  INTEGRATION_KINDS,
  issueKey,
  type IntegrationKind,
} from "@/lib/partners/integrations";
import { blockersFor, onboardingFor } from "@/lib/partners/onboarding";
import { partnerWentLive } from "@/lib/partners/emails";
import { isStateCode } from "@/lib/jurisdictions";

export const runtime = "nodejs";

/**
 * POST /api/admin/partners/[id]/keys — issue a key on a partner's behalf.
 *
 * This is the only route in the product that can produce a LIVE key, and the
 * three things guarding it are all here rather than spread around:
 *
 *   1. the capability. `partners.key.live` belongs to super_admin alone.
 *   2. the checklist. Every onboarding step marked `blocksGoLive` must be
 *      complete. Not advisory — the request is refused and names what is missing,
 *      so "we'll do the compliance review after launch" is not something that can
 *      be arranged by clicking.
 *   3. the states. A live key is enabled for the states passed in, which somebody
 *      has checked against the carrier's filings. There is no "all states"
 *      shortcut and the database will not accept an empty list.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: partnerId } = await params;
    const body = await readJson<Record<string, unknown>>(request);
    const wantsLive = text(body.environment, 10) === "live";

    const staff = await requireStaff(
      wantsLive ? "partners.key.live" : "partners.key.sandbox",
    );

    // Belt and braces: requireStaff already refused, but a future edit that
    // widened the capability above should not silently widen this.
    if (wantsLive && !staffCan(staff.role, "partners.key.live")) {
      throw new NotStaff("You do not have permission to do that.");
    }

    const { data: partner } = await staff.db
      .from("partners")
      .select("id, name, contact_email, disabled_at")
      .eq("id", partnerId)
      .maybeSingle();

    if (!partner) throw new NotStaff("No such partner.");
    if (partner.disabled_at) {
      return NextResponse.json(
        { error: "That partner is disabled. Re-enable it before issuing a key." },
        { status: 409 },
      );
    }

    const kindValue = text(body.integration_kind, 20) ?? "api";
    const kind: IntegrationKind = (INTEGRATION_KINDS as string[]).includes(kindValue)
      ? (kindValue as IntegrationKind)
      : "api";

    const jurisdictions = Array.isArray(body.jurisdictions)
      ? [
          ...new Set(
            body.jurisdictions
              .map((value) => (text(value, 2) ?? "").toUpperCase())
              .filter(isStateCode),
          ),
        ]
      : [];

    if (wantsLive) {
      const progress = await onboardingFor(staff.db, partnerId);
      const blockers = blockersFor(progress);

      if (blockers.length > 0) {
        return NextResponse.json(
          {
            error: "That partner is not ready to go live.",
            outstanding: blockers.map((step) => step.title),
          },
          { status: 409 },
        );
      }

      if (jurisdictions.length === 0) {
        return NextResponse.json(
          { error: "Name the states this live key may quote in." },
          { status: 400 },
        );
      }
    }

    const origins = Array.isArray(body.allowed_origins)
      ? body.allowed_origins
          .map((value) => text(value, 200))
          .filter((value): value is string => value !== null)
          .slice(0, 20)
      : [];

    const issued = await issueKey(staff.db, {
      partnerId,
      environment: wantsLive ? "live" : "sandbox",
      kind,
      label: text(body.label, 80),
      createdBy: staff.userId,
      jurisdictions,
      allowedOrigins: origins,
    });

    await logStaffAction(staff, {
      action: wantsLive ? "partner.key.live_issued" : "partner.key.sandbox_issued",
      subjectType: "partner_integration",
      subjectId: issued.integration.id,
      detail: {
        partner_id: partnerId,
        kind,
        // The prefix, never the key. This log is read by people who should be
        // able to see that a credential was issued and not to use it.
        key_prefix: issued.integration.key_prefix,
        jurisdictions: issued.integration.allowed_jurisdictions,
      },
    });

    if (wantsLive && partner.contact_email) {
      await partnerWentLive({
        to: partner.contact_email,
        companyName: partner.name,
        jurisdictions: issued.integration.allowed_jurisdictions,
      });
    }

    return NextResponse.json(
      {
        key: issued.raw,
        integration: issued.integration,
        notice:
          "Copy this now and give it to the partner over a channel you trust. It is not shown again.",
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
