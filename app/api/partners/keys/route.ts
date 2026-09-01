import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import {
  membershipFor,
  requirePartnerActor,
  resolvePartnerId,
} from "@/lib/partners/access";
import {
  INTEGRATION_KINDS,
  issueKey,
  type IntegrationKind,
} from "@/lib/partners/integrations";

export const runtime = "nodejs";

/**
 * POST /api/partners/keys — mint a SANDBOX key.
 *
 * There is no parameter on this route that produces a live key, and adding one
 * would be the wrong fix for whatever asked for it. Going live is a decision made
 * on our side against a checklist (see lib/partners/onboarding.ts) and carried
 * out through /api/admin/partners/[id]/keys, which requires `partners.key.live`.
 *
 * The raw key is in the response and nowhere else. It is not stored, not logged,
 * and there is no endpoint that will show it again — losing it means minting
 * another and revoking this one, which takes about four seconds and is the
 * correct amount of friction for a credential.
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePartnerActor();
    const body = await readJson<Record<string, unknown>>(request);
    const partnerId = resolvePartnerId(actor, text(body.partner_id, 40));
    membershipFor(actor, partnerId, "keys.create");

    const kindValue = text(body.integration_kind, 20) ?? "api";
    const kind: IntegrationKind = (INTEGRATION_KINDS as string[]).includes(kindValue)
      ? (kindValue as IntegrationKind)
      : "api";

    const origins = Array.isArray(body.allowed_origins)
      ? body.allowed_origins
          .map((value) => text(value, 200))
          .filter((value): value is string => value !== null)
          .slice(0, 20)
      : [];

    const issued = await issueKey(actor.db, {
      partnerId,
      environment: "sandbox",
      kind,
      label: text(body.label, 80),
      createdBy: actor.userId,
      allowedOrigins: origins,
    });

    return NextResponse.json(
      {
        key: issued.raw,
        integration: issued.integration,
        notice:
          "Copy this now. It is not shown again, and nothing here can recover it.",
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
