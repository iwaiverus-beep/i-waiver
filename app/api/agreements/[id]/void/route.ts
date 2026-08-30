import { NextResponse } from "next/server";
import { requestContext } from "@/lib/audit";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { TransitionRefused, voidAgreement } from "@/lib/agreements/lifecycle";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/[id]/void
 *
 * Nothing about an executed agreement is mutable, so a correction is a void plus a
 * fresh agreement pointing back at this one. A reason is mandatory: "voided" with
 * no explanation is the least useful row in the table.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    const agreement = await agreementForActor(actor, id);

    // Overrides all retention logic — and all convenience.
    if (agreement.legal_hold_at) {
      throw new TransitionRefused(
        "This agreement is under legal hold and cannot be changed.",
      );
    }

    const body = await readJson<{ reason?: unknown }>(request);
    const reason = text(body.reason, 500);
    if (!reason) throw new TransitionRefused("Say why it is being voided.");

    await voidAgreement(actor.db, id, reason, requestContext(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
