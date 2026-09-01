import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { verifyPasskeyAuthentication } from "@/lib/passkeys";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turns a verified passkey into a session.
 *
 * THIS ROUTE MINTS LOGINS, so read the order carefully. Nothing below the
 * verification call may run unless the assertion checked out: the signature had
 * to be made by the private key matching a stored public key, over a challenge
 * this server issued, marked consumed before it was even examined, with the
 * authenticator asserting it verified the user.
 *
 * Supabase Auth has no passkey provider, so the session comes from a magic-link
 * token generated with the service role and handed to the client to redeem. That
 * is a legitimate custom-auth flow, and it is also a loaded gun: `generateLink`
 * will happily produce a session for ANY email address it is given. The single
 * thing that makes it safe is that the address is never taken from the request —
 * it comes back from `verifyPasskeyAuthentication`, which read it from the
 * account the credential belongs to. If a future edit ever passes a
 * caller-supplied email into that call, it becomes an unauthenticated login
 * oracle for every account on the system.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson<{ response?: unknown }>(request);
    if (!body.response) {
      return NextResponse.json({ error: "Nothing to verify." }, { status: 400 });
    }

    const db = serviceClient();

    // Everything rests on this line.
    const { email } = await verifyPasskeyAuthentication(db, body.response as never);

    const { data, error } = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (error || !data?.properties?.hashed_token) {
      throw new Error(`could not start a session: ${error?.message ?? "no token"}`);
    }

    // The client redeems this with verifyOtp, which is what actually sets the
    // cookies. It is single use and short lived, and it is only ever produced on
    // the far side of a verified assertion.
    return NextResponse.json({ token_hash: data.properties.hashed_token });
  } catch (error) {
    return jsonError(error);
  }
}
