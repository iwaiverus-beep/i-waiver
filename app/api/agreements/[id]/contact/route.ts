import { NextResponse } from "next/server";

import { requestContext } from "@/lib/audit";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { updateSignerContact } from "@/lib/agreements/contact";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/[id]/contact — correct how a signer is reached.
 *
 * For the bounced address and the mistyped one. Every rule about when that is
 * allowed lives in `updateSignerContact`, which is where the reasoning is
 * written down; this route is the door and the authorisation.
 *
 * It does not send anything. Issuing a fresh link stays a separate, deliberate
 * act on `/links`, so "the address was corrected" and "a new capability to sign
 * was handed out" remain two entries in the trail rather than one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    await agreementForActor(actor, id);

    const body = await readJson<{
      signer_id?: unknown;
      email?: unknown;
      phone?: unknown;
    }>(request);

    const signerId = text(body.signer_id, 40);
    if (!signerId) throw new TransitionRefused("Which signer?");

    const result = await updateSignerContact(actor.db, {
      agreementId: id,
      signerId,
      email: text(body.email, 320),
      phone: text(body.phone, 40),
      context: requestContext(request),
    });

    return NextResponse.json({
      ok: true,
      email: result.email,
      phone: result.phone,
      links_revoked: result.linksRevoked,
    });
  } catch (error) {
    return jsonError(error);
  }
}
