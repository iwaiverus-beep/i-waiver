-- Signing with the phone's own biometrics.
--
-- The decision this implements, from the data model: "Device biometrics only.
-- Face ID / Touch ID unlocks the signing session; store the platform's assertion
-- (webauthn-style) and nothing else. Never capture or persist a biometric
-- identifier."
--
-- That last sentence is not cautious phrasing, it is the whole design. Illinois
-- BIPA carries a private right of action with per-violation statutory damages,
-- and Texas and Washington have their own regimes. A fingerprint template in a
-- database is a liability that dwarfs anything this product earns.
--
-- WebAuthn is the right primitive precisely because it makes that impossible by
-- construction. The biometric never leaves the device's secure enclave; it only
-- unlocks a private key held there. What crosses the network is a public key and
-- a signature over a challenge — no biometric data exists to be leaked, and none
-- can be reconstructed from what is stored here.
--
-- What the stored assertion actually proves:
--   * a platform authenticator on the signer's own device
--   * performed a user-verification gesture (biometric, or the device passcode
--     as the platform's fallback — the two are indistinguishable to us)
--   * over a challenge that IS the document hash
--
-- What it does not prove: identity. It is not a check that this is the person
-- named on the agreement. That remains identity_verifications, which is still
-- recorded as `skipped` because no vendor is wired. The UI must not blur the two.
--
-- Split across two migrations because Postgres will not let a newly added enum
-- value be used in the same transaction that adds it; the check constraint that
-- references 'biometric' lands in 20260831000008.

alter type signature_method add value if not exists 'biometric';

alter table signatures
  add column if not exists device_assertion jsonb,
  add column if not exists user_verified    boolean;

comment on column signatures.device_assertion is
  'Verified WebAuthn credential, reduced to a whitelist of fields — never the raw response. Contains a public key, a credential id and the challenge that was signed. Contains no biometric identifier, and must never be extended to.';

comment on column signatures.user_verified is
  'The authenticator''s UV flag: the device required a biometric or passcode before releasing the key. False or null means the gesture was presence-only (a tap), which is worth much less as evidence.';
