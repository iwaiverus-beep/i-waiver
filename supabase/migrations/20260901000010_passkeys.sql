-- Passkeys, for signing in.
--
-- Not to be confused with 20260831000007, which put WebAuthn on the *signature*.
-- The two look alike and mean different things:
--
--   signing   a throwaway credential whose challenge is the document hash. It
--             exists to carry one attested gesture over specific bytes, and is
--             never used to authenticate anyone afterwards.
--   sign-in   a durable credential bound to an account, used repeatedly, and
--             the thing this table holds.
--
-- Face ID and fingerprint are not a separate feature from this. A passkey held by
-- a platform authenticator with userVerification required IS biometric sign-in —
-- the biometric unlocks the key, and the same flow covers a laptop's fingerprint
-- reader, a phone's face scan, and a hardware key with a PIN. Building them
-- separately would mean building the same thing twice.
--
-- What is stored is a PUBLIC key. It verifies signatures and cannot create them,
-- so unlike a password hash there is nothing here worth stealing: an attacker
-- with this whole table still cannot sign in as anybody. No biometric data
-- exists to store, for the reasons set out at length in 20260831000007.

create table user_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  -- Base64url of the raw credential id, as the browser reports it.
  credential_id text not null unique,
  public_key    text not null,
  -- Authenticators that implement it increment this per assertion. A counter
  -- that goes backwards means two devices are presenting the same credential,
  -- which means one is a clone.
  sign_count    bigint not null default 0,
  transports    text[] not null default '{}',
  -- What the person calls this device. Theirs to set; only ever shown to them.
  device_label  text,
  -- True when the platform syncs the key to a cloud keychain. Worth recording
  -- because it changes the recovery story: a synced key survives a lost phone,
  -- a device-bound one does not.
  backed_up     boolean,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

comment on table user_passkeys is
  'Public keys for passkey sign-in. Holds nothing secret: a public key verifies signatures and cannot produce them, so this table is not worth stealing.';
comment on column user_passkeys.sign_count is
  'Clone detection. A counter lower than the one stored means the credential is being presented by a second copy of itself.';

create index user_passkeys_user_idx on user_passkeys (user_id)
  where revoked_at is null;

-- Readable by the owner so they can see and name their devices. Never writable:
-- a client that could insert its own credential row could register a key against
-- somebody else's account, which is the whole game.
alter table user_passkeys enable row level security;

create policy user_passkeys_select_own on user_passkeys
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on user_passkeys from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Challenges
--
-- WebAuthn's replay defence is that the server picks a random challenge, and
-- only accepts an assertion signed over one it actually issued and has not seen
-- before. That requires server-side state; a challenge the client hands back
-- unverified defends against nothing.
--
-- Kept as a table rather than a signed stateless token so that single use is
-- enforced by a real update rather than by hoping nobody replays inside the
-- expiry window.
-- ---------------------------------------------------------------------------

create table webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  challenge   text not null unique,
  -- Null for sign-in: with discoverable credentials the browser tells us who it
  -- is, so there is nobody to name up front. Set for registration, where we
  -- already know.
  user_id     uuid references profiles (id) on delete cascade,
  purpose     text not null check (purpose in ('register', 'authenticate')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

comment on table webauthn_challenges is
  'Short-lived, single-use WebAuthn challenges. Service role only — no policies, and RLS on, so anon and authenticated are denied outright.';

create index webauthn_challenges_live_idx on webauthn_challenges (expires_at)
  where consumed_at is null;

alter table webauthn_challenges enable row level security;
revoke all on webauthn_challenges from anon, authenticated;

-- Expired rows are noise, not evidence: nothing downstream references them and
-- an unconsumed challenge proves only that somebody opened a login page.
create or replace function public.purge_expired_webauthn_challenges()
returns void
language sql
security definer
set search_path = ''
as $fn$
  delete from public.webauthn_challenges
   where expires_at < now() - interval '1 hour';
$fn$;
