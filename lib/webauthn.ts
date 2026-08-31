import "server-only";

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { siteOrigin } from "@/lib/env";

/**
 * Signing with the device's own biometrics.
 *
 * THE CHALLENGE IS THE DOCUMENT HASH. That is the whole trick, and it is what
 * makes this worth more than a checkbox. WebAuthn signs whatever challenge it is
 * given, so by handing it the sha256 of the canonical document we get an
 * assertion that is cryptographically bound to those exact bytes. A signature
 * lifted from one agreement cannot be replayed onto another, because the
 * challenge inside clientDataJSON would not match.
 *
 * WHY NO BIOMETRIC DATA EXISTS HERE. The fingerprint or face never leaves the
 * device's secure enclave — it only unlocks a private key held there. What
 * crosses the network is a public key and a signature. There is no biometric
 * identifier to store, leak, or be sued over under Illinois BIPA. That is not a
 * happy accident of the library; it is why WebAuthn is the right primitive and a
 * "send us a selfie" flow is not.
 *
 * A borrower has no account and will never have one, so there is no credential to
 * look up and no authentication ceremony to run. Each signature performs a fresh
 * registration whose challenge is that document's hash. The credential is
 * single-purpose and disposable: we never authenticate anyone with it afterwards.
 * It exists to carry one attested gesture, once.
 */

/** What the browser is told to sign. 32 raw bytes of the document hash. */
export function challengeFromDocumentHash(documentHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(documentHash)) {
    throw new Error("document hash is not a sha256 hex string");
  }
  return Buffer.from(documentHash, "hex").toString("base64url");
}

/** The relying party is the site itself — the hostname, without scheme or port. */
export function relyingPartyId(): string {
  const host = new URL(siteOrigin()).hostname;
  // A registrable domain, so a credential made on www. still verifies at the apex.
  const parts = host.split(".");
  if (parts.length > 2 && host !== "localhost") return parts.slice(-2).join(".");
  return host;
}

export type VerifiedAssertion = {
  credential_id: string;
  public_key: string;
  /** Base64url of the challenge that was signed — must equal the document hash. */
  challenge: string;
  origin: string;
  /** True only if the authenticator actually verified the user. */
  user_verified: boolean;
  /** Platform (built into the device) vs cross-platform (a security key). */
  attachment: string | null;
  aaguid: string | null;
  sign_count: number;
  verified_at: string;
};

export class BiometricRefused extends Error {}

/**
 * Verifies a registration response and reduces it to what may be stored.
 *
 * The reduction is deliberate and is the second half of the BIPA commitment. The
 * raw response is never persisted — every field written to the database is named
 * explicitly below. A future browser or library version that starts returning
 * something new cannot leak it into our tables by accident, because nothing here
 * spreads an object it did not enumerate.
 */
export async function verifyBiometricSignature(input: {
  response: RegistrationResponseJSON;
  documentHash: string;
}): Promise<VerifiedAssertion> {
  const expectedChallenge = challengeFromDocumentHash(input.documentHash);
  const origin = siteOrigin();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: relyingPartyId(),
      // Self-attestation is fine and is what most platforms send. We are not
      // trying to establish which manufacturer made the device, only that a
      // user-verifying authenticator signed this document's hash.
      requireUserVerification: true,
    });
  } catch (error) {
    throw new BiometricRefused(
      `That signature could not be verified: ${(error as Error).message}`,
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new BiometricRefused("That signature could not be verified.");
  }

  const info = verification.registrationInfo;

  // Belt and braces: requireUserVerification above should already have refused,
  // but the UV flag is the single fact that distinguishes "they used Face ID"
  // from "they tapped a button", so it is checked again rather than assumed.
  if (!info.userVerified) {
    throw new BiometricRefused(
      "Your device did not confirm it was you. Use Face ID, Touch ID or your passcode.",
    );
  }

  return {
    credential_id: info.credential.id,
    public_key: Buffer.from(info.credential.publicKey).toString("base64url"),
    challenge: expectedChallenge,
    origin,
    user_verified: info.userVerified,
    attachment: verification.registrationInfo.credentialDeviceType ?? null,
    aaguid: info.aaguid ?? null,
    sign_count: info.credential.counter ?? 0,
    verified_at: new Date().toISOString(),
  };
}
