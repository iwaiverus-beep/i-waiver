import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Partner API keys.
 *
 * The same shape as lib/tokens.ts and for the same reasons, with one deliberate
 * difference: there is NO pepper. The hash stored in
 * `partner_integrations.api_key_hash` must be reproducible by
 * lib/coverage/auth.ts, which has authenticated partner calls as plain
 * `sha256(token)` since the coverage service was written. Adding a pepper here
 * without changing that would mint keys that can never authenticate; changing
 * both would invalidate every key already issued.
 *
 * The consequence is worth being honest about. A database leak yields hashes of
 * high-entropy 256-bit random strings, which is not invertible, so the practical
 * protection is the same. What is lost is the emergency lever the signing-link
 * pepper gives: there is no single value to rotate that invalidates every
 * outstanding key at once. Revoking every row does that instead, which is why
 * `revoked_at` exists and why lib/coverage/auth.ts filters on it.
 *
 * A raw key is returned exactly once, from the route that creates it. Nothing
 * stores it, nothing logs it, and there is no endpoint that reveals it later.
 */

/**
 * `iwk_` marks it as ours in a log or a support ticket; `sk` (sandbox) and `lk`
 * (live) mean a human can tell at a glance which world a key belongs to before
 * they paste it into production config.
 */
export type KeyEnvironment = "sandbox" | "live";

const PREFIXES: Record<KeyEnvironment, string> = {
  sandbox: "iwk_sk_",
  live: "iwk_lk_",
};

export type MintedKey = {
  /** Shown once. Never persisted. */
  raw: string;
  /** What goes in `api_key_hash`. */
  hash: string;
  /** What goes in `key_prefix` — enough to identify, useless to authenticate. */
  prefix: string;
};

export function mintApiKey(environment: KeyEnvironment): MintedKey {
  const raw = `${PREFIXES[environment]}${randomBytes(32).toString("base64url")}`;
  return {
    raw,
    hash: hashApiKey(raw),
    // The marker plus six characters. Enough to distinguish two keys in a list;
    // 250 bits short of guessing the rest.
    prefix: `${raw.slice(0, PREFIXES[environment].length + 6)}…`,
  };
}

/** Must stay identical to the hash lib/coverage/auth.ts computes. */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Which environment a key claims to belong to, from its marker alone. */
export function environmentOf(raw: string): KeyEnvironment | null {
  if (raw.startsWith(PREFIXES.live)) return "live";
  if (raw.startsWith(PREFIXES.sandbox)) return "sandbox";
  return null;
}

/**
 * The webhook signing secret.
 *
 * Separate from the API key because it travels in the other direction: the key
 * proves a partner is calling us, this proves we are calling them. A partner that
 * reuses one for the other has a replay problem, so they are visibly different
 * strings.
 */
export function mintWebhookSecret(): MintedKey {
  const raw = `iwh_${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashApiKey(raw), prefix: `${raw.slice(0, 10)}…` };
}
