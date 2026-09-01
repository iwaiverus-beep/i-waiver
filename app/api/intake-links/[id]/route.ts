import { NextResponse } from "next/server";
import { requireActor } from "@/lib/agreements/access";
import { revokeIntakeLink } from "@/lib/intake/links";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Withdraws a code. There is no delete.
 *
 * The card is already printed and stuck to a counter, so the row has to outlive
 * the decision: a scan of a withdrawn code says it is no longer in use, which is
 * something a person standing there can act on. Deleting it would give them a 404
 * and no idea whether they had the wrong code or the wrong shop.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    await revokeIntakeLink(db, originatorIds, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
