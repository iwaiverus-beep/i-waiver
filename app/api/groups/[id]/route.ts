import { NextResponse } from "next/server";
import { requireActor } from "@/lib/agreements/access";
import {
  groupBoard,
  groupForActor,
  revokeGroupLinks,
} from "@/lib/agreements/groups";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { closed?: unknown };

/** GET — the board: who is on this booking and who has signed. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    const group = await groupForActor(db, originatorIds, id);
    return NextResponse.json(await groupBoard(db, group));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * PATCH — close the booking, or reopen it.
 *
 * Closing is about the booking and nothing else. It stops new people joining and
 * withdraws the dock code; it does not touch a single agreement, because a release
 * somebody signed is not the sort of thing an afternoon ending should change.
 * Reopening is allowed for the obvious reason: somebody arrives late.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    const group = await groupForActor(db, originatorIds, id);
    const body = await readJson<Body>(request);

    const closing = body.closed !== false;

    await db
      .from("rental_groups")
      .update({ closed_at: closing ? new Date().toISOString() : null })
      .eq("id", group.id);

    // A live code outliving the booking it belongs to is the one way a closed
    // booking could still grow.
    if (closing) await revokeGroupLinks(db, group.id);

    return NextResponse.json({ closed: closing });
  } catch (error) {
    return jsonError(error);
  }
}
