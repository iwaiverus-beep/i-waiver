import { NextResponse } from "next/server";
import { requestContext } from "@/lib/audit";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { sendAgreement } from "@/lib/agreements/lifecycle";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/[id]/send
 *
 * Runs the gate, freezes the asset, renders, mints the links and mails the
 * borrower. Any blocking compliance failure returns 422 with the reasons, and
 * nothing has changed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    await agreementForActor(actor, id);

    const result = await sendAgreement(actor.db, id, requestContext(request));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
