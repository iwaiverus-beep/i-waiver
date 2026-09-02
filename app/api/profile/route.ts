import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { cleanPhone } from "@/lib/agreements/contact";
import { jsonError, readJson, text } from "@/lib/http";
import { isStateCode } from "@/lib/jurisdictions";
import { asIanaZone } from "@/lib/format";
import { PROFILE_COLUMNS, avatarUrl, readProfile, type Profile } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your own record.
 *
 * The header menu reads this on every page once somebody is signed in, which is
 * the reason it is a route rather than a server-rendered value: resolving the
 * session in the root layout would opt every marketing page out of static
 * rendering to decide what one badge says. See components/AccountMenu.tsx.
 *
 * Email and password are NOT here. Those are Supabase auth's, they are changed on
 * the browser client so the confirmation and re-authentication flows behave the
 * way Supabase intends, and routing them through a service-role handler would
 * mean this endpoint could set anybody's password.
 */

export async function GET() {
  try {
    const profile = await readProfile();
    if (!profile) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    return NextResponse.json({ profile });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const body = await readJson<Record<string, unknown>>(request);

    const fullName = text(body.full_name, 120);
    if (!fullName) {
      // Not a nicety. `lib/agreements/create.ts` puts this string on the
      // instrument as the lender's legal name, so an account with no name on it
      // cannot send anything.
      throw new TransitionRefused("Your name goes on every agreement you send, so it cannot be blank.");
    }

    const homeState = text(body.home_state, 2);
    if (homeState && !isStateCode(homeState)) {
      throw new TransitionRefused(`${homeState} is not a state we recognise.`);
    }

    // Validated against Intl, not against a list of our own: the tz database is
    // revised several times a year, and the runtime's copy is the one that has to
    // be able to format with this name later. An unknown zone accepted here would
    // be a value that throws inside a date formatter months from now.
    const rawZone = text(body.time_zone, 64);
    const timeZone = rawZone ? asIanaZone(rawZone) : null;
    if (rawZone && !timeZone) {
      throw new TransitionRefused(`${rawZone} is not a time zone we recognise.`);
    }

    const phone = cleanPhone(text(body.phone, 40));

    const db = serviceClient();

    const { data: existing } = await db
      .from("profiles")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();

    const update: Record<string, unknown> = {
      full_name: fullName,
      phone,
      home_state: homeState,
      time_zone: timeZone,
    };

    // A number that changed is a number nobody has confirmed. Leaving the old
    // verification alongside a new number would say we checked something we
    // never saw — and `phone_verified_at` exists precisely so that claim is
    // tracked separately from the digits.
    if ((existing?.phone ?? null) !== phone) update.phone_verified_at = null;

    const { data, error } = await db
      .from("profiles")
      .update(update)
      .eq("id", user.id)
      .select(PROFILE_COLUMNS)
      .single();

    if (error) throw new TransitionRefused(`Could not save: ${error.message}`);

    const profile = data as Profile;
    return NextResponse.json({
      profile: {
        ...profile,
        email: user.email ?? null,
        avatar_url: await avatarUrl(db, profile.avatar_path),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
