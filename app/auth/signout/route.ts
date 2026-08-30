import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST only: a sign-out that a link prefetch can trigger is a bug. */
export async function POST() {
  const supabase = await userClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${siteOrigin()}/`, { status: 303 });
}
