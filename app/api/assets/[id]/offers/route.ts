import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What to suggest alongside this item.
 *
 * The lender's own merchandising, so it runs on their own client under
 * `asset_offers_owner_all` like the rest of app/api/assets. The rule that both
 * items belong to the same lender is not checked here at all: the trigger in
 * 20260901000029 enforces it, and an id arriving from a browser is not
 * self-authorising even when the caller can legitimately read the row it names.
 *
 * Nothing here can put an item on an agreement. An offer is a suggestion shown on
 * a public page; it becomes a line on Schedule A only when a borrower ticks it,
 * a lender accepts the request, and the ordinary draft form is submitted by a
 * person.
 */

type Body = {
  /** The whole set, in the order the borrower will see it. */
  offers?: unknown;
};

type Incoming = { asset_id: string; default_selected?: boolean };

function readOffers(raw: unknown): Incoming[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: Incoming[] = [];

  for (const entry of raw) {
    const assetId =
      typeof entry === "string"
        ? entry
        : typeof (entry as Incoming)?.asset_id === "string"
          ? (entry as Incoming).asset_id
          : null;
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    out.push({
      asset_id: assetId,
      default_selected: (entry as Incoming)?.default_selected === true,
    });
  }

  return out;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const supabase = await userClient();

    const { data, error } = await supabase
      .from("asset_offers")
      .select("offer_asset_id, order_index, default_selected")
      .eq("parent_asset_id", id)
      .order("order_index");

    if (error) throw new Error(error.message);
    return NextResponse.json({ offers: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Replaces the set wholesale.
 *
 * Not a diff: the screen this serves is a list of tick boxes, so the client
 * already knows the arrangement it is showing and sending it entire is the only
 * version that cannot drift from what the lender is looking at. Delete-then-insert
 * is safe here for the same reason it would be unacceptable in the agreement
 * graph — an offer is merchandising, nothing points at it, and losing the set
 * halfway through costs a lender one re-tick rather than a record.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const supabase = await userClient();

    // The parent has to be the caller's, and this is the only check worth doing
    // here: the policy would refuse the write anyway, but a silent no-op on
    // somebody else's item reads to the lender as "saved" and would not be.
    const { data: parent } = await supabase
      .from("assets")
      .select("id")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();

    if (!parent) throw new TransitionRefused("That item is not on your list.");

    const body = await readJson<Body>(request);
    const offers = readOffers(body.offers).filter((offer) => offer.asset_id !== id);

    const { error: cleared } = await supabase
      .from("asset_offers")
      .delete()
      .eq("parent_asset_id", id);

    if (cleared) throw new Error(cleared.message);

    if (offers.length > 0) {
      const { error } = await supabase.from("asset_offers").insert(
        offers.map((offer, index) => ({
          parent_asset_id: id,
          offer_asset_id: offer.asset_id,
          order_index: index,
          default_selected: offer.default_selected ?? false,
        })),
      );

      if (error) {
        // The trigger's message is already written for a person — it says an item
        // can only be offered alongside another of the same lender's items — so it
        // reaches them rather than being flattened into "could not save".
        if (error.message.includes("same lender")) {
          throw new TransitionRefused(
            "You can only suggest your own items alongside each other.",
          );
        }
        throw new Error(error.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
