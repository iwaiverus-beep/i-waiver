import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revokes a passkey.
 *
 * Marked revoked rather than deleted: the row is the only record that a device
 * was ever trusted on this account, and someone reviewing a compromise wants to
 * see that it existed and when it stopped.
 *
 * Runs under the service role because `user_passkeys` has no client write
 * policy, so the owner check is made here explicitly.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const db = serviceClient();

    const { data, error } = await db
      .from("user_passkeys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
