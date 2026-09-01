import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import {
  NotPartner,
  membershipFor,
  requirePartnerActor,
} from "@/lib/partners/access";
import { setWebhook } from "@/lib/partners/integrations";

export const runtime = "nodejs";

/**
 * POST /api/partners/webhook — set the callback endpoint for one integration.
 *
 * The signing secret is returned once, here, and rotates whenever the URL
 * changes. See the note in lib/partners/integrations.ts: a secret that survives a
 * change of endpoint has been shared with whatever used to be at the old one.
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePartnerActor();
    const body = await readJson<Record<string, unknown>>(request);

    const integrationId = text(body.integration_id, 40);
    if (!integrationId) {
      return NextResponse.json({ error: "Which key?" }, { status: 400 });
    }

    const { data: integration } = await actor.db
      .from("partner_integrations")
      .select("id, partner_id")
      .eq("id", integrationId)
      .maybeSingle();

    if (!integration) throw new NotPartner();
    membershipFor(actor, integration.partner_id, "webhook.manage");

    const url = text(body.webhook_url, 400);

    try {
      const result = await setWebhook(actor.db, {
        integrationId,
        partnerId: integration.partner_id,
        url,
      });

      return NextResponse.json({
        ok: true,
        secret: result.secret,
        notice: result.secret
          ? "Copy this signing secret now. It is not shown again, and changing the URL replaces it."
          : "Webhook removed.",
      });
    } catch (cause) {
      // setWebhook throws plain Errors for the two things a partner can get wrong
      // — a malformed URL and an http one — and both deserve their own words
      // rather than a 500.
      return NextResponse.json({ error: (cause as Error).message }, { status: 400 });
    }
  } catch (error) {
    return jsonError(error);
  }
}
