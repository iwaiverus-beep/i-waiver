import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { jsonError, readJson, text } from "@/lib/http";
import { parseDollarsToCents } from "@/lib/format";

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
};

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("assets")
      .select("id, asset_class, description, identifier, declared_value_cents, year, make, model")
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
    const { data, error } = await supabase
      .from("assets")
      .insert({
        owner_user_id: user.id,
        asset_class: ASSET_CLASSES.includes(assetClass) ? assetClass : "other",
        description,
        identifier: text(body.identifier, 60),
        declared_value_cents: declaredValue,
        year: Number.isInteger(yearValue) && yearValue > 1900 ? yearValue : null,
        make: text(body.make, 60),
        model: text(body.model, 60),
      })
      .select("id, asset_class, description, identifier, declared_value_cents, year, make, model")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ asset: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
