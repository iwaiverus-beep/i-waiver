import { NextResponse } from "next/server";
import { requireActor } from "@/lib/agreements/access";
import { archiveAgreement, restoreAgreement } from "@/lib/agreements/archive";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agreements/[id]/archive
 *
 * Files one agreement away, or puts it back. Both directions on one route
 * because they are the same decision made twice, and a lender who archived the
 * wrong row should get it back by pressing the thing they just pressed.
 *
 * Nothing is deleted here and nothing can be — see lib/agreements/archive.ts.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    const body = await readJson<{ archived?: unknown }>(request);

    // Explicit, not toggled from whatever the row says right now. Two taps on a
    // slow connection should end up archived, not back where they started.
    if (body.archived === false) {
      await restoreAgreement(actor, id);
      return NextResponse.json({ archived: false });
    }

    await archiveAgreement(actor, id);
    return NextResponse.json({ archived: true });
  } catch (error) {
    return jsonError(error);
  }
}
