import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { ensureIndividualOriginator } from "@/lib/agreements/access";
import { jsonError, readJson, text } from "@/lib/http";
import { parseDollarsToCents } from "@/lib/format";
import { ASSET_COLUMNS_WITH_PHOTOS } from "@/lib/assets/fields";
import { asCommercialUseRefusal, readMerchandising } from "@/lib/assets/input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The things you lend.
 *
 * `assets` already carries an owner-scoped RLS policy from the initial schema, so
 * this runs on the caller's own client. That is a departure from the agreement
 * routes, and the reason is worth stating: an asset row on its own is not
 * evidence. What matters evidentially is `agreements.asset_snapshot`, frozen at
 * send time, and nothing here can reach back and alter that. Editing a jet ski's
 * declared value in September cannot change what a June agreement says it was.
 */

const ASSET_CLASSES = ["pwc", "boat", "trailer", "vehicle", "equipment", "other"];

type Body = {
  asset_class?: unknown;
  description?: unknown;
  identifier?: unknown;
  declared_value?: unknown;
  year?: unknown;
  make?: unknown;
  model?: unknown;
  // The merchandising half, read by readMerchandising rather than field by field
  // here — see lib/assets/input.ts for why the two halves are parsed apart.
  headline?: unknown;
  details_md?: unknown;
  rate?: unknown;
  rate_unit?: unknown;
  deposit?: unknown;
  quantity?: unknown;
  is_offerable?: unknown;
};

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("assets")
      .select(ASSET_COLUMNS_WITH_PHOTOS)
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ assets: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const body = await readJson<Body>(request);

    const description = text(body.description, 200);
    if (!description) {
      return NextResponse.json({ error: "Describe what it is." }, { status: 400 });
    }

    const assetClass = text(body.asset_class, 20) ?? "other";
    const declaredValue =
      typeof body.declared_value === "string"
        ? parseDollarsToCents(body.declared_value)
        : typeof body.declared_value === "number"
          ? Math.round(body.declared_value * 100)
          : null;

    const yearValue = Number(body.year);

    const supabase = await userClient();

    // An asset is owned by an originator, so saving your first jet ski is enough to
    // mint your individual originator — the same row a first send would have made.
    // This runs on the caller's own client like everything else in this route:
    // `originators_insert_self` lets someone create their own individual originator
    // and nobody else's, which is exactly the check we want here.
    const originatorId = await ensureIndividualOriginator(supabase, user.id);

    const { data, error } = await supabase
      .from("assets")
      .insert({
        owner_originator_id: originatorId,
        asset_class: ASSET_CLASSES.includes(assetClass) ? assetClass : "other",
        description,
        identifier: text(body.identifier, 60),
        declared_value_cents: declaredValue,
        year: Number.isInteger(yearValue) && yearValue > 1900 ? yearValue : null,
        make: text(body.make, 60),
        model: text(body.model, 60),
        ...readMerchandising(body as Record<string, unknown>),
      })
      .select(ASSET_COLUMNS_WITH_PHOTOS)
      .single();

    if (error) {
      // A per-period rate on an individual's item is refused by the database, and
      // that refusal is about their own insurance rather than about this form, so
      // it reaches them in full rather than as "could not save".
      const refusal = asCommercialUseRefusal(error.message);
      if (refusal) throw refusal;
      throw new Error(error.message);
    }
    return NextResponse.json({ asset: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
