import { NextResponse } from "next/server";
import { requireActor } from "@/lib/agreements/access";
import {
  groupForActor,
  issueGroupLink,
  revokeGroupLinks,
} from "@/lib/agreements/groups";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { max_uses?: unknown };

/** POST — mint the check-in code for the counter. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    const body = await readJson<Body>(request).catch(() => ({}) as Body);

    const group = await groupForActor(db, originatorIds, id);

    // A new code supersedes the old one. Two live codes for one booking would
    // mean two caps, which is one cap that does not hold.
    await revokeGroupLinks(db, group.id);

    const maxUses =
      typeof body.max_uses === "number" ? body.max_uses : undefined;

    return NextResponse.json(await issueGroupLink(db, { group, maxUses }), {
      status: 201,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * DELETE — withdraw it.
 *
 * Revoked, never deleted. The code may already be a QR on a counter card, and a
 * scan of a withdrawn code should say it is no longer in use rather than 404 at
 * somebody standing in front of it.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    const group = await groupForActor(db, originatorIds, id);

    await revokeGroupLinks(db, group.id);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return jsonError(error);
  }
}
