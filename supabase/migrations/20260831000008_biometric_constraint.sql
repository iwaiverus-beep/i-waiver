-- The constraint for 20260831000007, in its own migration.
--
-- Postgres allows `alter type ... add value` inside a transaction, but forbids
-- using the new value in that same transaction. This check references
-- 'biometric', so it has to wait for the next one.
--
-- It mirrors drawn_signature_has_image and typed_signature_has_name from the
-- initial schema: each signature method must carry the evidence that makes it
-- worth anything. For a biometric signature that means a verified assertion AND
-- the user-verification flag actually set — a platform authenticator that only
-- checked presence (a tap, no biometric or passcode) does not get to be recorded
-- as a biometric signature.

alter table signatures
  add constraint biometric_signature_has_verified_assertion
  check (
    method <> 'biometric'
    or (device_assertion is not null and user_verified is true)
  );
