import { NextResponse } from "next/server";
import { requestContext } from "@/lib/audit";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { startGroupFromAgreement } from "@/lib/agreements/groups";
import { jsonError, readJson, text } from "@/lib/http";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  agreement_id?: unknown;
  label?: unknown;
};

/**
 * POST /api/groups — turn an existing loan into a booking.
 *
 * The loan comes first and the booking is added to it, never the other way round.
 * Somebody has already said what is being lent, to whom and when; a booking is the
 * second thought they have at the counter when three more families arrive.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await readJson<Body>(request);

    const agreementId = text(body.agreement_id, 40);
    const label = text(body.label, 120);

    if (!agreementId) throw new TransitionRefused("Which agreement is this for?");
    if (!label) throw new TransitionRefused("Give the booking a name.");

    // Throws NotAuthorised — a 404 — if this is not the caller's agreement. Which
    // also settles which originator to open the booking under: the one that
    // already owns the loan, rather than whichever of the caller's happens to be
    // first.
    const agreement = await agreementForActor(actor, agreementId);

    const group = await startGroupFromAgreement(actor.db, {
      originatorId: agreement.originator_id,
      agreementId,
      label,
      context: requestContext(request),
    });

    return NextResponse.json({ id: group.id, label: group.label }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
