import { NextResponse } from "next/server";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { verifyAuditChain } from "@/lib/audit";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agreements/[id]/verify
 *
 * Recomputes the hash chain and reports whether it still holds. This is the claim
 * the whole evidence model rests on, so it is a live check against the database —
 * never a stored "verified" flag, which would be the one thing an attacker with
 * write access would set.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    await agreementForActor(actor, id);

    const verdict = await verifyAuditChain(actor.db, id);

    return NextResponse.json({
      intact: verdict.intact,
      events: verdict.events,
      first_break_at: verdict.firstBreakAt,
      checked_at: new Date().toISOString(),
      entries: verdict.rows.map((row) => ({
        event_id: row.event_id,
        occurred_at: row.occurred_at,
        event_type: row.event_type,
        link_ok: row.link_ok,
        hash_ok: row.hash_ok,
        hash: row.stored_hash,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
