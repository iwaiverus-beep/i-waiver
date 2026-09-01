import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { verifyPasskeyRegistration } from "@/lib/passkeys";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The passkeys on this account, for the screen that lists and removes them. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("user_passkeys")
      .select("id, device_label, backed_up, created_at, last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ passkeys: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

/** Finishes registration. The challenge is redeemed inside, once. */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const body = await readJson<{ response?: unknown; device_label?: unknown }>(request);
    if (!body.response) {
      return NextResponse.json({ error: "Nothing to verify." }, { status: 400 });
    }

    const result = await verifyPasskeyRegistration(serviceClient(), {
      userId: user.id,
      response: body.response as never,
      deviceLabel: text(body.device_label, 60),
    });

    return NextResponse.json({ ok: true, backed_up: result.backedUp }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
