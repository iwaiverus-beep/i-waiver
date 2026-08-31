import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
