import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import {
  NotPartner,
  membershipFor,
  requirePartnerActor,
} from "@/lib/partners/access";
import { revokeKey } from "@/lib/partners/integrations";

export const runtime = "nodejs";

/**
 * DELETE /api/partners/keys/[id]
 *
 * Revocation, not deletion. The row stays, holding its hash and the record of who
 * turned it off, and lib/coverage/auth.ts refuses it from the next request
 * onwards. Deleting it would lose the only evidence of what a leaked key was able
 * to do and when it stopped.
 *
 * Any partner role that can revoke may revoke ANY of the company's keys,
 * including a live one. Turning a credential off is the one action where being
 * able to act faster than you can find the right person is the point.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requirePartnerActor();

    // The key names its partner, so the partner is looked up from the key rather
    // than taken from the caller. A caller who supplied it could name their own
    // partner while revoking somebody else's key.
    const { data: integration } = await actor.db
      .from("partner_integrations")
      .select("id, partner_id")
      .eq("id", id)
      .maybeSingle();

    if (!integration) throw new NotPartner();

    membershipFor(actor, integration.partner_id, "keys.revoke");

    await revokeKey(actor.db, {
      integrationId: id,
      partnerId: integration.partner_id,
      revokedBy: actor.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
