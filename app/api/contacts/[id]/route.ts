import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edit or archive one contact.
 *
 * DELETE archives rather than removing. Someone looking at a two-year-old
 * agreement and wondering where a borrower's email came from should be able to
 * find the entry it was copied from — and a row that vanishes cannot answer that.
 * The agreement itself is unaffected either way: signer details were copied at
 * creation, never referenced.
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
    if (body.display_name !== undefined) patch.display_name = text(body.display_name, 120);
    if (body.email !== undefined) patch.email = text(body.email, 320)?.toLowerCase() ?? null;
    if (body.phone !== undefined) patch.phone = text(body.phone, 40);
    if (body.notes !== undefined) patch.notes = text(body.notes, 500);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const supabase = await userClient();
    // No owner filter needed — the RLS policy scopes this to the caller, and
    // adding one here would imply the policy could not be trusted.
    const { data, error } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", id)
      .select("id, display_name, email, phone, notes")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

    return NextResponse.json({ contact: data });
  } catch (error) {
    return jsonError(error);
  }
}

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
      .from("contacts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
