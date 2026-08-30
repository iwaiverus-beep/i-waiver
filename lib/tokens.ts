import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { signingLinkPepper } from "@/lib/env";

/**
 * Signing-link tokens — the borrower's entire auth story.
 *
 * The token is generated once, put in a URL, and never stored. What is stored is
 * `sha256(pepper : token)`. Two consequences follow, and both are the point:
 *
 *   * A database leak does not yield working signing links. The rows hold hashes,
 *     and the pepper is not in the database.
 *   * Rotating SIGNING_LINK_TOKEN_PEPPER invalidates every outstanding link at
 *     once. That is the emergency lever, and it works because the hash of an old
 *     token can no longer be reproduced.
 *
 * Lookup is by hash against a unique index, so there is no comparison loop to
 * leak timing: an attacker holding a hash still has to invert sha256 to get a
 * token, and one holding a token already has the capability.
 */

/** 256 bits, url-safe. Long enough that guessing is not an attack. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256")
    .update(`${signingLinkPepper()}:${token}`)
    .digest("hex");
}

/** Hours, not days — per the data model. */
export const SIGNING_LINK_TTL_HOURS = 48;

export function linkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SIGNING_LINK_TTL_HOURS * 60 * 60 * 1000);
}

/** sha256 of arbitrary text, hex. Used for consent text and document bodies. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
