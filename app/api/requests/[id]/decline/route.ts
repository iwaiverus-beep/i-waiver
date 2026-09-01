import { NextResponse } from "next/server";
import { requireActor } from "@/lib/agreements/access";
import { declineRequest } from "@/lib/intake/requests";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turns a request down. Terminal, and silent to the borrower.
 *
 * There is no matching accept endpoint, deliberately. Accepting happens by
 * creating a draft through `/api/agreements`, which closes the request as its last
 * step — so there is exactly one way an agreement comes into existence, and this
 * feature did not add a second.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    await declineRequest(db, originatorIds, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
