import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { jsonError, readJson, text } from "@/lib/http";
import { parseDollarsToCents } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSET_CLASSES = ["pwc", "boat", "trailer", "vehicle", "equipment", "other"];

const COLUMNS =
  "id, asset_class, description, identifier, declared_value_cents, year, make, model";

/**
 * Edit one thing you lend.
 *
 * Safe to offer freely, and the reason is rule 4. What an agreement says the
 * asset was is `agreements.asset_snapshot`, frozen at send time — this row is
 * only the form's starting point. Correcting a misspelled model in September
 * cannot reach back into a June agreement and change what it says was lent.
 *
 * Runs on the caller's own client: the owner-scoped RLS policy from the initial
 * schema is the whole of the authorisation, and re-checking it here would imply
 * the policy could not be trusted.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(request);

    const patch: Record<string, unknown> = {};

    if (body.description !== undefined) {
      const description = text(body.description, 200);
      if (!description) {
        return NextResponse.json({ error: "Describe what it is." }, { status: 400 });
      }
      patch.description = description;
    }

    if (body.asset_class !== undefined) {
      const assetClass = text(body.asset_class, 20) ?? "other";
      patch.asset_class = ASSET_CLASSES.includes(assetClass) ? assetClass : "other";
    }

    if (body.identifier !== undefined) patch.identifier = text(body.identifier, 60);
    if (body.make !== undefined) patch.make = text(body.make, 60);
    if (body.model !== undefined) patch.model = text(body.model, 60);

    if (body.declared_value !== undefined) {
      const raw = body.declared_value;
      // An empty box means "I do not know what it is worth", which is a real
      // answer and stores as null. A typo like "12,5o0" is not, and is refused
      // rather than quietly becoming null — the declared value is what the
      // damage clause and the premium both point at.
      if (typeof raw === "number") {
        patch.declared_value_cents = Math.round(raw * 100);
      } else if (typeof raw === "string" && raw.trim()) {
        const cents = parseDollarsToCents(raw);
        if (cents === null) {
          return NextResponse.json(
            { error: "That is not an amount — try something like 12500." },
            { status: 400 },
          );
        }
        patch.declared_value_cents = cents;
      } else {
        patch.declared_value_cents = null;
      }
    }

    if (body.year !== undefined) {
      const year = Number(body.year);
      patch.year = Number.isInteger(year) && year > 1900 && year <= 2100 ? year : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("assets")
      .update(patch)
      .eq("id", id)
      .is("archived_at", null)
      .select(COLUMNS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

    return NextResponse.json({ asset: data });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Archives an asset. Never deletes one.
 *
 * The initial schema says it outright: "Never hard-delete — policies reference
 * these rows." A `restrict` foreign key from `agreements` would refuse the delete
 * anyway, which would surface to the user as a database error rather than as the
 * intended behaviour. Archiving hides it from the picker and leaves every
 * agreement that ever pointed at it intact.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const supabase = await userClient();

    const { error } = await supabase
      .from("assets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
