-- Carrier onboarding: telling a carrier they are in, and letting them fill in
-- their own details without an account.
--
-- Approving a carrier application creates a `carriers` row and, until now, did
-- nothing else at all: no email, no next step, no way for the carrier to give us
-- the facts the row is missing. A carrier applied, we said yes to ourselves, and
-- they never heard from us again. Everything here exists to close that gap.
--
-- The shape is deliberately NOT the partner shape. A partner gets an account, a
-- console and an API key because they call us. A carrier is called BY us, so an
-- account would be a login to nothing. What a carrier needs is a one-time link
-- that lets them answer questions about themselves, and that is all this is.

-- ---------------------------------------------------------------------------
-- 1. When we said yes
-- ---------------------------------------------------------------------------

-- `status` already answers "may this carrier be quoted", and only `active` does.
-- It cannot also answer "did we approve them", because a prospect we added
-- ourselves from a list and a carrier who applied and was approved are both
-- `prospect` and are not the same thing to the person reading the screen.
--
-- A timestamp rather than a status value, for two reasons. The status enum gates
-- quoting through `available_carrier_products`, and widening something that
-- gates quoting to carry an unrelated fact is how a filter eventually lets the
-- wrong row through. And approval is an event with a date, which a status cannot
-- record: a carrier can move prospect -> contracted -> active and the date we
-- said yes stays true throughout.
alter table carriers add column if not exists approved_at timestamptz;

comment on column carriers.approved_at is
  'Set when a carrier application was approved into this row. Never gates quoting — `status` does that — it exists so the console can tell an approved carrier apart from a prospect somebody typed in.';

-- ---------------------------------------------------------------------------
-- 2. The link we send them
-- ---------------------------------------------------------------------------

-- Hashed at rest, like `signing_links` and unlike `intake_links`, and the reason
-- is which of those this resembles. An intake link is printed on a counter card
-- and the worst a stranger can do with it is join a queue. This one names a
-- specific carrier and accepts a body of text attributed to them, so a leaked
-- token is a stranger putting words in a named insurer's mouth. It is worth a
-- hash and an expiry even though nothing it writes is ever trusted directly.
create table carrier_onboarding_links (
  id           uuid primary key default gen_random_uuid(),
  carrier_id   uuid not null references carriers (id) on delete cascade,
  token_hash   text not null unique,
  -- Who we sent it to. Kept even after the link is spent, because "which address
  -- did we invite" is the first question asked when a carrier says they never
  -- got it, and the carrier's contact_email may have been corrected since.
  sent_to      text not null,
  expires_at   timestamptz not null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- Not single-use. A carrier who submits, then realises they gave the sandbox
  -- URL for the wrong environment, should be able to open the same link and say
  -- so; forcing them to ask us for a new one turns a correction into a support
  -- ticket. `used_at` is therefore first-use, not consumption.
  used_at      timestamptz,
  revoked_at   timestamptz
);

create index carrier_onboarding_links_carrier_idx
  on carrier_onboarding_links (carrier_id);

comment on table carrier_onboarding_links is
  'One-time-issued, multi-use links letting a carrier fill in their own details with no account. Hashed at rest: the token names a carrier and accepts text attributed to them.';

-- ---------------------------------------------------------------------------
-- 3. What they told us, before we believe any of it
-- ---------------------------------------------------------------------------

create type carrier_submission_status as enum ('pending', 'accepted', 'rejected');

-- A staging table, not an edit.
--
-- Nothing a carrier types may reach `carriers` without a member of staff saying
-- so. That is not distrust of insurers; it is that these columns feed quoting.
-- `naic_code` carries a unique index and is how a regulator identifies them, and
-- the contact address is where a claim notification goes. A form on the open
-- internet writing straight to those is a form that can rename a carrier.
create table carrier_submissions (
  id             uuid primary key default gen_random_uuid(),
  carrier_id     uuid not null references carriers (id) on delete cascade,
  link_id        uuid references carrier_onboarding_links (id) on delete set null,
  status         carrier_submission_status not null default 'pending',

  -- The identity fields, mirroring `carriers`. Accepting copies these across;
  -- until then they are only a claim somebody made through a form.
  legal_name     text,
  naic_code      text,
  am_best_rating text,
  contact_name   text,
  contact_email  text,
  contact_phone  text,

  -- The states they say they are admitted and filed in.
  --
  -- Text, and deliberately NOT turned into `carrier_state_filings` rows on
  -- acceptance. A filing row is a claim about a regulator's decision — it is the
  -- only input to whether a live quote may be given in a state, which is why
  -- `carriers.filings` sits on the compliance role and not on admin. A carrier
  -- asserting its own filings through a web form and having those become the
  -- record would route around that check entirely. Staff read this list and
  -- record filings themselves, product by product, as they always did.
  states         text[] not null default '{}',

  -- What an adapter will eventually be written against.
  api_base_url   text,
  api_docs_url   text,
  products       text,
  notes          text,

  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid references auth.users (id) on delete set null,
  review_note    text,

  constraint reviewed_submission_has_a_date
    check (status = 'pending' or reviewed_at is not null)
);

create index carrier_submissions_carrier_idx
  on carrier_submissions (carrier_id, submitted_at desc);

-- The console asks "is anything waiting on me" on every carrier page load.
create index carrier_submissions_pending_idx
  on carrier_submissions (carrier_id) where status = 'pending';

comment on table carrier_submissions is
  'What a carrier said about itself through an onboarding link. Staged: nothing here reaches `carriers` until a member of staff accepts it.';
comment on column carrier_submissions.states is
  'Self-reported. Never becomes a carrier_state_filings row automatically — a filing is a claim about a regulator, recorded by compliance.';

-- ---------------------------------------------------------------------------
-- 4. Access
-- ---------------------------------------------------------------------------

-- Same posture as every other table in the carrier module: RLS on, no policies,
-- reached only through the service client behind `requireStaff` — or, for the
-- public submit route, behind a token this file makes unguessable.
alter table carrier_onboarding_links enable row level security;
alter table carrier_submissions enable row level security;
