import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { currentUser } from "@/lib/supabase/server";

/**
 * The account holder's own record — the one screen in the product that is about
 * the person rather than about a thing they lent.
 *
 * Read on the service client with an explicit `id = userId`, which is the posture
 * everything else in this codebase takes. `profiles` does carry
 * `profiles_select_own` and `profiles_update_own` from 20260829000002, but
 * CLAUDE.md constraint 2 is explicit that those are a second line of defence
 * rather than the supported path, and the avatar has to go through the service
 * client anyway — the bucket has no storage policies at all. One client, one
 * check, rather than two of each.
 */

export const AVATAR_BUCKET = "avatars";

/** How long a signed avatar URL lives. Long enough to browse, short enough to matter. */
const AVATAR_URL_TTL_SECONDS = 60 * 60;

export type Profile = {
  full_name: string | null;
  phone: string | null;
  phone_verified_at: string | null;
  home_state: string | null;
  avatar_path: string | null;
};

export type ProfileView = Profile & {
  email: string | null;
  /** A short-lived signed URL, or null when there is no picture. */
  avatar_url: string | null;
};

export const PROFILE_COLUMNS =
  "full_name, phone, phone_verified_at, home_state, avatar_path";

/**
 * A URL the browser can put in an `<img>`.
 *
 * The bucket is private (20260901000036), so this is minted rather than
 * constructed — the opposite of `photoUrl` in lib/assets/fields.ts, and for the
 * reason recorded there.
 */
export async function avatarUrl(
  db: SupabaseClient,
  avatarPath: string | null,
): Promise<string | null> {
  if (!avatarPath) return null;
  const { data } = await db.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(avatarPath, AVATAR_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

/** Everything the account screen and the header menu show, for the signed-in user. */
export async function readProfile(): Promise<ProfileView | null> {
  const user = await currentUser();
  if (!user) return null;

  const db = serviceClient();
  const { data } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  // The trigger in 20260830000005 means a row always exists, but a missing one
  // should show an empty profile rather than an error page.
  const profile = (data ?? {
    full_name: null,
    phone: null,
    phone_verified_at: null,
    home_state: null,
    avatar_path: null,
  }) as Profile;

  return {
    ...profile,
    email: user.email ?? null,
    avatar_url: await avatarUrl(db, profile.avatar_path),
  };
}
