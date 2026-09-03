import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container, PAGE_PADDING } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { Empty } from "@/components/app-ui";
import { PageIntro } from "@/components/PageIntro";
import {
  AssetsManager,
  type Asset,
  type AssetOfferRow,
} from "@/components/AssetsManager";
import { userClient } from "@/lib/supabase/server";
import { staffFor } from "@/lib/platform/access";
import { ASSET_COLUMNS_WITH_PHOTOS } from "@/lib/assets/fields";

export const metadata: Metadata = { title: "Things you lend" };
export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/assets");

  // Staff land in the console, not here. Signing in now arrives on this
  // screen, so the redirect /dashboard has always carried has to be on this
  // one too - otherwise somebody who works here signs in and lands on their
  // own, probably empty, list of things to lend. The `as=lender` parameter is
  // the way back, exactly as it is there.
  const { as } = await searchParams;
  if (as !== "lender" && (await staffFor(user))) redirect("/admin");

  // The lender's own offers ride along, so the "suggest with…" picker opens
  // knowing what is already linked rather than fetching per item.
  const [{ data }, { data: offerRows }] = await Promise.all([
    supabase
      .from("assets")
      .select(ASSET_COLUMNS_WITH_PHOTOS)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("asset_offers")
      .select("parent_asset_id, offer_asset_id, order_index, default_selected")
      .order("order_index"),
  ]);

  const assets = (data ?? []) as unknown as Asset[];
  const offers = (offerRows ?? []) as AssetOfferRow[];

  // Which of this lender's originators are businesses, because that decides which
  // rate units each ITEM may use. An individual charging by the day is a bailment
  // for hire their own policy will not cover, and the database refuses it — so the
  // form should not present the choice in the first place.
  //
  // Per item, not per person: somebody can work at a rental shop and still lend
  // their own jet ski to a neighbour, and those two items answer differently.
  const { data: originators } = await supabase
    .from("originators")
    .select("id, kind")
    .eq("kind", "organization");

  const orgOriginatorIds = (originators ?? []).map((row) => row.id as string);

  return (
    <Container className={PAGE_PADDING}>
      <AppNav />
      {/* Open when the list is empty. The sentence is furniture to somebody who
          has read it and has forty things saved; it is the whole screen to
          somebody who has none and is deciding whether to start. */}
      <PageIntro title="Things you lend" defaultOpen={assets.length === 0}>
        Save what you lend once and pick it from a list each time. Details are
        frozen onto an agreement when you send it, so changing a value here later
        never alters an agreement already signed.
      </PageIntro>

      {assets.length === 0 && (
        <div className="mt-8">
          <Empty>Nothing saved yet. Add the first thing you lend out.</Empty>
        </div>
      )}

      <AssetsManager
        initial={assets}
        initialOffers={offers}
        orgOriginatorIds={orgOriginatorIds}
      />
    </Container>
  );
}
