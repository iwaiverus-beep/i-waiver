import "server-only";

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { relyingPartyId } from "@/lib/webauthn";
import { siteOrigin } from "@/lib/env";
import { BRAND } from "@/lib/brand";

/**
 * Passkey sign-in.
 *
 * The security of the whole thing rests on one rule: a challenge must be issued
 * by this server, used once, and then dead. Everything else WebAuthn does is
 * standard cryptography; the part an application gets wrong is challenge
 * handling, so it is deliberately boring here — a row is written when a challenge
 * is issued, and marked consumed the moment it is redeemed, before the assertion
 * is even verified.
 *
 * Credentials are DISCOVERABLE (residentKey: required). That is what makes "sign
 * in with Face ID" work with no email typed first: the authenticator itself
 * remembers which account it belongs to and tells us. Requiring an email up front
 * would defeat the point, and passing `allowCredentials` from an unauthenticated
 * request would leak which addresses have accounts.
 */

const CHALLENGE_TTL_MINUTES = 5;

async function issueChallenge(
  db: SupabaseClient,
  challenge: string,
  purpose: "register" | "authenticate",
  userId: string | null,
): Promise<void> {
  const { error } = await db.from("webauthn_challenges").insert({
    challenge,
    purpose,
    user_id: userId,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60_000).toISOString(),
  });
  if (error) throw new Error(`challenge not issued: ${error.message}`);
}

/**
 * Redeems a challenge, or refuses.
 *
 * The update is the check: `is("consumed_at", null)` means two requests racing
 * the same challenge cannot both succeed, because only one of them updates a
 * row. Reading first and writing after would leave exactly that gap.
 */
async function redeemChallenge(
  db: SupabaseClient,
  challenge: string,
  purpose: "register" | "authenticate",
): Promise<{ userId: string | null }> {
  const { data, error } = await db
    .from("webauthn_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("challenge", challenge)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();

  if (error) throw new Error(`challenge not redeemable: ${error.message}`);
  if (!data) {
    throw new PasskeyRefused(
      "That request has expired or was already used. Try again.",
    );
  }
  return { userId: data.user_id };
}

export class PasskeyRefused extends Error {}

// ---------------------------------------------------------------------------
// Registering a new passkey (the caller is already signed in)
// ---------------------------------------------------------------------------

export async function passkeyRegistrationOptions(
  db: SupabaseClient,
  user: { id: string; email: string },
) {
  // Existing credentials are excluded so the platform says "you already have one"
  // rather than silently making a second key for the same account on the same
  // device, which nobody wants and nobody can tell apart afterwards.
  const { data: existing } = await db
    .from("user_passkeys")
    .select("credential_id, transports")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  const options = await generateRegistrationOptions({
    rpName: BRAND.name,
    rpID: relyingPartyId(),
    userName: user.email,
    userDisplayName: user.email,
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((row) => ({
      id: row.credential_id,
      transports: (row.transports ?? []) as never,
    })),
    authenticatorSelection: {
      // Discoverable, so sign-in needs no email typed first.
      residentKey: "required",
      requireResidentKey: true,
      // The biometric. Without this a passkey is merely possession of a device.
      userVerification: "required",
    },
  });

  await issueChallenge(db, options.challenge, "register", user.id);
  return options;
}

export async function verifyPasskeyRegistration(
  db: SupabaseClient,
  input: {
    userId: string;
    response: RegistrationResponseJSON;
    deviceLabel?: string | null;
  },
) {
  const challenge = input.response.response.clientDataJSON
    ? JSON.parse(
        Buffer.from(input.response.response.clientDataJSON, "base64url").toString(),
      ).challenge
    : null;

  if (!challenge) throw new PasskeyRefused("That response was malformed.");

  const { userId: challengeUser } = await redeemChallenge(db, challenge, "register");

  // The challenge was issued to somebody. It must be the person presenting it.
  if (challengeUser !== input.userId) {
    throw new PasskeyRefused("That request was issued for a different account.");
  }

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge,
    expectedOrigin: siteOrigin(),
    expectedRPID: relyingPartyId(),
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new PasskeyRefused("That passkey could not be verified.");
  }

  const info = verification.registrationInfo;

  const { error } = await db.from("user_passkeys").insert({
    user_id: input.userId,
    credential_id: info.credential.id,
    public_key: Buffer.from(info.credential.publicKey).toString("base64url"),
    sign_count: info.credential.counter ?? 0,
    transports: info.credential.transports ?? [],
    device_label: input.deviceLabel?.slice(0, 60) ?? null,
    backed_up: info.credentialBackedUp ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      throw new PasskeyRefused("That passkey is already registered.");
    }
    throw new Error(`passkey not saved: ${error.message}`);
  }

  return { backedUp: info.credentialBackedUp ?? false };
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

export async function passkeyAuthenticationOptions(db: SupabaseClient) {
  const options = await generateAuthenticationOptions({
    rpID: relyingPartyId(),
    userVerification: "required",
    // Deliberately empty. Naming credentials here would require knowing who is
    // signing in, and answering that from an unauthenticated request is an
    // account-enumeration oracle.
    allowCredentials: [],
  });

  await issueChallenge(db, options.challenge, "authenticate", null);
  return options;
}

export async function verifyPasskeyAuthentication(
  db: SupabaseClient,
  response: AuthenticationResponseJSON,
): Promise<{ userId: string; email: string }> {
  const challenge = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString(),
  ).challenge as string;

  await redeemChallenge(db, challenge, "authenticate");

  const { data: credential } = await db
    .from("user_passkeys")
    .select("id, user_id, credential_id, public_key, sign_count, transports")
    .eq("credential_id", response.id)
    .is("revoked_at", null)
    .maybeSingle();

  // Same message whether the credential is unknown or revoked. Distinguishing
  // them would confirm which passkeys exist.
  if (!credential) throw new PasskeyRefused("That passkey was not recognised.");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: siteOrigin(),
    expectedRPID: relyingPartyId(),
    requireUserVerification: true,
    credential: {
      id: credential.credential_id,
      publicKey: Buffer.from(credential.public_key, "base64url"),
      counter: Number(credential.sign_count),
      transports: (credential.transports ?? []) as never,
    },
  });

  if (!verification.verified) {
    throw new PasskeyRefused("That passkey could not be verified.");
  }

  // A counter that has not advanced means this assertion came from a copy of the
  // credential rather than the original. Real authenticators either increment or
  // report zero throughout; a decrease is the signal worth acting on.
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter > 0 && newCounter <= Number(credential.sign_count)) {
    throw new PasskeyRefused(
      "That passkey looks like it has been copied. It has not been used, and you should remove it.",
    );
  }

  await db
    .from("user_passkeys")
    .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
    .eq("id", credential.id);

  const { data: authUser } = await db.auth.admin.getUserById(credential.user_id);
  const email = authUser?.user?.email;
  if (!email) throw new PasskeyRefused("That account has no email address.");

  return { userId: credential.user_id, email };
}
