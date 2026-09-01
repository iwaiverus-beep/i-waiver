-- Partners — applying, being approved, and signing in.
--
-- The data model's strategic bet is that the durable business is supplying
-- coverage to waiver platforms that already exist (Smartwaiver, WaiverForever,
-- CleverWaiver, WaiverFile, Roller, VenueSumo) and to the carriers behind them,
-- rather than winning their customers. `partners` and `partner_integrations`
-- have been in the schema since 20260829000001 to make that possible. What was
-- missing is every human step around them: there was no way for a platform to
-- ask, no way for us to say yes, and no way for the person on the other side to
-- see their own credentials without someone reading a row out of the database to
-- them over the phone.
--
-- Four things are added, in the order a partner meets them:
--
--   1. `partner_applications` — the public request. Marketing-adjacent intake,
--      deliberately outside the agreement graph in exactly the way `waitlist`
--      is. Nobody who fills this in is a party to anything.
--   2. `partners` gains the descriptive columns an application supplies, so
--      approving one is a copy rather than a re-interview.
--   3. `partner_integrations` gains an ENVIRONMENT, an origin allowlist, and the
--      means to revoke a key. Sandbox is the default; going live is a decision.
--   4. `partner_members` — who at that company may sign in. This is the login.
--
-- WHAT THIS DOES NOT DO, and must not be read as doing. A partner member is a
-- credential holder for `partner_integrations`, not a user of the agreements
-- app. Nothing here grants any read of agreements, signers, signatures or
-- documents, and no policy added below mentions those tables. A partner sees
-- their own company, their own keys, and their own people. The coverage service
-- is still reached over HTTP with a bearer token, by them and by us alike.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- What kind of company is asking. The distinction is not cosmetic: a platform
-- hosts our surface, a carrier or MGA sits behind it, and the two are approved
-- against completely different questions.
create type partner_kind as enum
  ('waiver_platform', 'booking_platform', 'carrier', 'mga', 'broker', 'other');

create type partner_application_status as enum
  ('new', 'in_review', 'approved', 'declined', 'withdrawn');

-- Roles inside a partner company. `developer` is the default because the person
-- who integrates is almost never the person who signed the contract.
create type partner_role as enum ('owner', 'admin', 'developer', 'viewer');

-- Sandbox is not a flag on a key, it is a property of everything the key
-- produces. See 20260901000013, which carries it into the coverage tables.
create type api_environment as enum ('sandbox', 'live');

-- ---------------------------------------------------------------------------
-- 1. The request
-- ---------------------------------------------------------------------------

create table partner_applications (
  id                   uuid primary key default gen_random_uuid(),
  company_name         text not null,
  website              text,
  partner_kind         partner_kind not null default 'other',
  contact_name         text not null,
  contact_email        text not null,
  contact_phone        text,
  -- How they want to integrate, if they already know. `widget` is the answer we
  -- want most of the time — see the note on partner_integrations below.
  integration_interest integration_kind,
  -- States they operate in, self-reported. Not the same thing as the states an
  -- approved integration is enabled for; that is our decision, made later.
  jurisdictions        text[] not null default '{}',
  volume_band          text,
  notes                text,
  status               partner_application_status not null default 'new',
  status_note          text,
  reviewed_at          timestamptz,
  reviewed_by          uuid references profiles (id) on delete set null,
  partner_id           uuid references partners (id) on delete set null,
  source               text,
  user_agent           text,
  created_at           timestamptz not null default now(),

  -- Approval is what creates the partner. A row that says approved and points at
  -- nothing means someone said yes and nothing happened.
  constraint approved_application_has_partner
    check (status <> 'approved' or partner_id is not null),
  constraint reviewed_application_has_timestamp
    check (status in ('new', 'in_review') or reviewed_at is not null)
);

comment on table partner_applications is
  'Public intake for platforms and carriers asking to embed coverage. Marketing-adjacent, like waitlist — never joined to the agreement graph.';
comment on column partner_applications.jurisdictions is
  'Where the applicant says they operate. Informational. partner_integrations.allowed_jurisdictions is the enforced list and is set by us.';

-- One open request per contact at a time. A second submission while the first is
-- still open is someone filling the form in twice, not a new opportunity, and the
-- route handler turns the conflict into a friendly answer. Settled applications
-- are excluded so a declined company can reapply later.
create unique index partner_applications_open_email_key
  on partner_applications (lower(contact_email))
  where status in ('new', 'in_review');

create index partner_applications_status_idx
  on partner_applications (status, created_at desc);

alter table partner_applications enable row level security;
revoke all on partner_applications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The partner record
-- ---------------------------------------------------------------------------

alter table partners
  add column kind          partner_kind not null default 'other',
  add column website       text,
  add column contact_email text,
  add column approved_at   timestamptz;

comment on column partners.kind is
  'Platform, carrier or intermediary. Decides which side of the boundary they sit on: a platform calls the coverage API, a carrier is what sits behind it.';
comment on column partners.disabled_at is
  'Set to switch a partner off without deleting anything. lib/coverage/auth.ts refuses every key belonging to a disabled partner.';

-- ---------------------------------------------------------------------------
-- 3. Credentials, environments, and turning them off
-- ---------------------------------------------------------------------------

alter table partner_integrations
  -- SANDBOX BY DEFAULT. A new integration cannot touch a real carrier or a real
  -- policy until somebody deliberately issues a live key, which the console does
  -- not let a partner do for themselves.
  add column environment   api_environment not null default 'sandbox',
  add column label         text,
  -- The first few characters of the key, stored in clear so a partner can tell
  -- two keys apart in a list. The rest exists only in their config: the raw key
  -- is shown once, at creation, and is not recoverable afterwards.
  add column key_prefix    text,
  -- Where a widget integration is allowed to be framed from. Empty means the
  -- widget is not enabled yet; the widget route refuses an origin that is not
  -- named here, which is the difference between an embedded surface we control
  -- and an iframe anyone can host.
  add column allowed_origins text[] not null default '{}',
  add column created_by    uuid references profiles (id) on delete set null,
  add column revoked_at    timestamptz,
  add column revoked_by    uuid references profiles (id) on delete set null,
  -- Coarse, deliberately. Stamped at most hourly by lib/coverage/auth.ts rather
  -- than on every call, because a write per request to record a read is a poor
  -- trade and an approximate answer is enough to spot a key nobody uses, or a
  -- key being used by someone who should not have it.
  add column last_used_at  timestamptz;

comment on column partner_integrations.environment is
  'sandbox or live. Carried onto every coverage_context, quote and policy the key produces, so sandbox traffic can be excluded from reporting and deleted without touching a real record.';
comment on column partner_integrations.key_prefix is
  'Display only. Never sufficient to authenticate: the stored secret is sha256 of the whole key, and the whole key was shown once.';
comment on column partner_integrations.revoked_at is
  'Rotation is create-then-revoke, so the old row stays as history. A revoked row still holds its hash and can never be resurrected into a working key.';
comment on column partner_integrations.allowed_origins is
  'Origins permitted to embed the widget, as scheme://host[:port]. Required before a widget integration will render anywhere.';

-- Every state an integration may quote in must be named. This is the fix for a
-- quiet default: lib/coverage/service.ts treats an EMPTY allowed_jurisdictions
-- as "no restriction", which was a reasonable reading when partners were created
-- by hand and is a bad one now that an approval flow creates them. Rather than
-- change what the coverage service means by an empty list — that boundary is
-- deliberately not ours to reinterpret from this side — the database refuses to
-- store one.
alter table partner_integrations
  add constraint integration_names_its_jurisdictions
    check (cardinality(allowed_jurisdictions) > 0);

create index partner_integrations_partner_idx
  on partner_integrations (partner_id)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 4. The login
-- ---------------------------------------------------------------------------

create table partner_members (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners (id) on delete cascade,
  -- Null until the invitation is claimed. The invitation IS the email address:
  -- there is no token to lose, and no second delivery channel to secure.
  user_id     uuid references profiles (id) on delete cascade,
  email       text not null,
  role        partner_role not null default 'developer',
  invited_at  timestamptz not null default now(),
  invited_by  uuid references profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,

  constraint accepted_member_has_user
    check ((accepted_at is null) = (user_id is null))
);

comment on table partner_members is
  'Who at a partner company may sign in. Grants access to that company only, and to nothing in the agreement graph. Membership is claimed by signing in with the invited address on a CONFIRMED account — see lib/partners/access.ts, which refuses to claim an unconfirmed one.';
comment on column partner_members.role is
  'owner and admin may invite people and mint sandbox keys. developer may mint sandbox keys. viewer may read. Nobody on the partner side may issue a live key.';

create unique index partner_members_partner_email_key
  on partner_members (partner_id, lower(email));

create unique index partner_members_partner_user_key
  on partner_members (partner_id, user_id)
  where user_id is not null;

create index partner_members_user_idx
  on partner_members (user_id)
  where user_id is not null and revoked_at is null;

alter table partner_members enable row level security;

-- Consistent with partners and partner_integrations, which 20260829000002
-- revoked outright: everything a partner sees is assembled by a route handler on
-- the service client, which does its own authorisation. There is no client-side
-- read of a key hash, and no policy here that could become one.
revoke all on partner_members from anon, authenticated;
