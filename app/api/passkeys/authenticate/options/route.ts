import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { passkeyAuthenticationOptions } from "@/lib/passkeys";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Options for signing in. Unauthenticated by necessity.
 *
 * Returns no `allowCredentials`, so it says nothing about who has an account —
 * the browser matches a discoverable credential itself and tells us afterwards.
 */
export async function POST() {
  try {
    const options = await passkeyAuthenticationOptions(serviceClient());
    return NextResponse.json(options);
  } catch (error) {
    return jsonError(error);
  }
}
