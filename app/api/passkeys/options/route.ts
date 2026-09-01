import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { passkeyRegistrationOptions } from "@/lib/passkeys";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Options for adding a passkey. Signed-in only — you cannot register one onto an account you are not holding. */
export async function POST() {
  try {
    const user = await currentUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    const options = await passkeyRegistrationOptions(serviceClient(), {
      id: user.id,
      email: user.email,
    });
    return NextResponse.json(options);
  } catch (error) {
    return jsonError(error);
  }
}
