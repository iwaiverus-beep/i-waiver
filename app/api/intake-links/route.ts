import { NextResponse } from "next/server";
import { requireActor, ensureIndividualOriginator } from "@/lib/agreements/access";
import { createIntakeLink } from "@/lib/intake/links";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minting a printable code.
 *
 * Two shapes, and the difference is the whole feature. Without an `asset_id` it is
 * an originator-level code — "start something with this lender" — and the borrower
 * can only say who they are and when. With one, it is asset-level, and the
 * borrower's side can be complete, because every fact about the thing already
 * exists in the lender's own record and none of it has to be typed by a stranger.
 *
 * Both are static and both are permanent until revoked, which is what makes them
 * printable and is also why they are kept as far from `signing_links` as the
 * schema allows.
 */

type Body = {
  asset_id?: unknown;
  label?: unknown;
  activity_class?: unknown;
  jurisdiction?: unknown;
};

export async function GET() {
  try {
    const { db, originatorIds } = await requireActor();
    if (originatorIds.length === 0) return NextResponse.json({ links: [] });

    const { data } = await db
      .from("intake_links")
      .select("id, asset_id, slug, label, activity_class, jurisdiction, created_at")
      .in("originator_id", originatorIds)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    return NextResponse.json({ links: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireActor();
    const body = await readJson<Body>(request);

    const jurisdiction = text(body.jurisdiction, 2);
    if (!jurisdiction) {
      return NextResponse.json(
        { error: "Say which state the activity happens in." },
        { status: 400 },
      );
    }

    const activityClass = text(body.activity_class, 40);
    if (!activityClass) {
      return NextResponse.json({ error: "Say what kind of activity this is." }, { status: 400 });
    }

    // A code is minted against the individual originator for now, the same row a
    // first send would make. When an organisation can originate, this is where it
    // learns to ask which of the lender's originators the code belongs to.
    const originatorId = await ensureIndividualOriginator(db, userId);

    const link = await createIntakeLink(db, {
      originatorId,
      assetId: text(body.asset_id, 40),
      label: text(body.label, 80),
      activityClass,
      jurisdiction,
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
