-- Carriers — the other side of the coverage boundary.
--
-- WHY A CARRIER IS NOT A PARTNER. `partners` and `partner_integrations` model
-- somebody who CALLS us: they hold an inbound API key, we check it in
-- lib/coverage/auth.ts, and they hit /api/coverage/v1/quote. A carrier is the
-- exact opposite. We call THEM, holding a credential they issued, and they call
-- back with policy and claim events. Recording a carrier as a partner would have
-- meant issuing them a key to an API they will never use, while the credential
-- that actually matters — theirs — had nowhere to live at all.
--
-- WHAT WAS ACTUALLY MISSING. Until now there was no carrier in the schema in any
-- form. `state_availability.carrier_admitted` is a single boolean, which encodes
-- an assumption nobody wrote down: that there is exactly one carrier, forever,
-- and it is anonymous. The moment a second one appears — one admitted in FL, a
-- different one writing TX — that column cannot say which, `assertStateOpen`
-- cannot pick, and `quotes.product_code` cannot be traced back to whoever priced
-- it. This migration replaces the assumption with rows.
--
-- Four things, in the order they matter:
--
--   1. `carriers` — who they are, and which code adapter speaks to them.
--   2. `carrier_products` — what they sell. `product_code` is the value that has
--      always flowed into `quotes.product_code`; it is now a real row.
--   3. `carrier_state_filings` — where each product may be written. This is what
--      replaces the boolean, and it is a legal fact rather than an appetite.
--   4. `carrier_credentials` / `carrier_events` — the outbound and inbound halves
--      of talking to them.
--
-- The whole of this lives inside the coverage bounded context (CLAUDE.md
-- constraint 9). Nothing here references an agreement, a signer or an originator,
-- and nothing outside lib/coverage/ may read these tables.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- `fronting` and `surplus_lines` are here because they change what a filing
-- means, not for tidiness: a surplus lines writer is by definition NOT admitted,
-- and a filing row that says otherwise is wrong.
create type carrier_kind as enum ('carrier', 'mga', 'fronting', 'surplus_lines');

create type carrier_status as enum
  ('prospect', 'contracted', 'active', 'suspended', 'terminated');

create type filing_status as enum ('not_filed', 'filed', 'approved', 'withdrawn');

create type carrier_auth_kind as enum ('bearer', 'basic', 'hmac', 'mtls');

-- A carrier applies through the same public form a waiver platform does — an
-- inbound lead is an inbound lead — but approving one creates a `carriers` row,
-- not a partner. `approved` is unusable for that outcome: the constraint
-- `approved_application_has_partner` requires a partner_id, and there is no
-- partner. Closing it as `declined` would be the other tempting shortcut and puts
-- the wrong word in the queue for something we said yes to.
alter type partner_application_status add value if not exists 'approved_as_carrier';

-- ---------------------------------------------------------------------------
-- 1. Who they are
-- ---------------------------------------------------------------------------

create table carriers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  -- Every admitted US insurer has one. It is the identifier a regulator, a
  -- broker and a bordereau all use, so it is worth a column rather than living
  -- in notes.
  naic_code     text,
  kind          carrier_kind not null default 'carrier',
  status        carrier_status not null default 'prospect',
  am_best_rating text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  -- THE LINK BETWEEN A ROW AND CODE. lib/coverage/carrier.ts keeps a registry of
  -- CarrierClient implementations keyed by this string. A carrier whose adapter
  -- is not registered cannot quote, and the coverage service refuses loudly
  -- rather than falling back to the mock — silently mocking a real carrier is
  -- how a policy number that means nothing reaches a customer.
  adapter       text not null default 'mock',
  notes         text,
  created_at    timestamptz not null default now(),
  activated_at  timestamptz,
  suspended_at  timestamptz,

  constraint active_carrier_has_been_activated
    check (status <> 'active' or activated_at is not null)
);

comment on table carriers is
  'Insurers and MGAs whose paper sits behind our quotes. Not partners: we hold their credential and call them, not the reverse.';
comment on column carriers.adapter is
  'Selects the CarrierClient implementation in lib/coverage/carrier.ts. An unregistered value is a refusal, never a fallback to the mock.';
comment on column carriers.status is
  'Only `active` may be selected to quote. prospect and contracted exist so a carrier can be tracked through the relationship before any code points at them.';

create unique index carriers_naic_key on carriers (lower(naic_code))
  where naic_code is not null;

create index carriers_active_idx on carriers (status) where status = 'active';

alter table carriers enable row level security;
revoke all on carriers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. What they sell
-- ---------------------------------------------------------------------------

create table carrier_products (
  id                       uuid primary key default gen_random_uuid(),
  carrier_id               uuid not null references carriers (id) on delete restrict,
  -- Globally unique, not unique per carrier. `quotes.product_code` is a bare text
  -- column with no foreign key — it is a SNAPSHOT, per constraint 4, and must not
  -- become a reference. Making the code globally unique means a quote written two
  -- years ago still resolves to exactly one product when somebody asks who priced
  -- it, without the schema pretending the quote points at a live row.
  product_code             text not null unique,
  coverage_kind            coverage_kind not null,
  activity_class           text not null,
  display_name             text not null,
  description              text,
  default_limit_cents      bigint check (default_limit_cents >= 0),
  default_deductible_cents bigint check (default_deductible_cents >= 0),
  retired_at               timestamptz,
  created_at               timestamptz not null default now()
);

comment on table carrier_products is
  'One row per thing a carrier will write. product_code is the value that has always appeared in quotes.product_code.';
comment on column carrier_products.retired_at is
  'A retired product stops being quoted and keeps every quote and policy already written against it. Never delete one.';

create index carrier_products_carrier_idx on carrier_products (carrier_id)
  where retired_at is null;
create index carrier_products_lookup_idx
  on carrier_products (activity_class, coverage_kind)
  where retired_at is null;

alter table carrier_products enable row level security;
revoke all on carrier_products from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Where they may write it
-- ---------------------------------------------------------------------------

create table carrier_state_filings (
  product_id     uuid not null references carrier_products (id) on delete cascade,
  state          jurisdiction_code not null,
  status         filing_status not null default 'not_filed',
  -- Admitted or surplus lines. Not the same question as whether the filing was
  -- approved, and the difference decides who the insured can complain to.
  admitted       boolean not null default false,
  filing_ref     text,
  effective_from date,
  effective_to   date,
  reviewed_by    uuid references profiles (id) on delete set null,
  reviewed_at    timestamptz,
  notes          text,
  updated_at     timestamptz not null default now(),

  primary key (product_id, state),

  -- An approved filing with no start date cannot be checked against a loan date,
  -- which is the only question anyone will ever ask it.
  constraint approved_filing_has_a_start
    check (status <> 'approved' or effective_from is not null),
  constraint filing_window_is_ordered
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

comment on table carrier_state_filings is
  'The replacement for state_availability.carrier_admitted. A legal fact about a filing, not a statement of appetite — quoting where there is no approved filing produces a number nobody can honour.';

create index carrier_state_filings_open_idx
  on carrier_state_filings (state, status)
  where status = 'approved';

alter table carrier_state_filings enable row level security;
revoke all on carrier_state_filings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keeping state_availability honest
-- ---------------------------------------------------------------------------
--
-- `state_availability.carrier_admitted` feeds a GENERATED column (`status`) that
-- the reference data, the compliance gate and the marketing pages all read, so it
-- cannot simply be dropped, and a generated column cannot be computed from
-- another table. It becomes a CACHE, maintained here, and its comment says so.
-- The filings are the truth; this column is a denormalisation of them.

create or replace function public.refresh_state_admitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jurisdiction_code := coalesce(new.state, old.state);
begin
  update state_availability sa
     set carrier_admitted = exists (
           select 1
             from carrier_state_filings f
             join carrier_products p on p.id = f.product_id
             join carriers c on c.id = p.carrier_id
            where f.state = v_state
              and f.status = 'approved'
              and c.status = 'active'
              and p.retired_at is null
              and (f.effective_from is null or f.effective_from <= current_date)
              and (f.effective_to is null or f.effective_to > current_date)
         ),
         updated_at = now()
   where sa.state = v_state;

  return null;
end;
$$;

comment on function public.refresh_state_admitted() is
  'Recomputes state_availability.carrier_admitted from the filings. The filings are the truth; that column is a cache with a generated column hanging off it.';

create trigger carrier_state_filings_refresh
  after insert or update or delete on carrier_state_filings
  for each row execute function public.refresh_state_admitted();

comment on column state_availability.carrier_admitted is
  'CACHE. Maintained by refresh_state_admitted() from carrier_state_filings. Do not set it by hand — a value written here is overwritten by the next filing change, and the filings are what lib/coverage/ actually reads.';

-- ---------------------------------------------------------------------------
-- The one query the coverage service asks
-- ---------------------------------------------------------------------------

create or replace function public.available_carrier_products(
  p_state          jurisdiction_code,
  p_activity_class text,
  p_on             date default current_date
)
returns table (
  carrier_id    uuid,
  carrier_slug  text,
  carrier_name  text,
  adapter       text,
  product_id    uuid,
  product_code  text,
  coverage_kind coverage_kind,
  admitted      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.slug, c.name, c.adapter,
         p.id, p.product_code, p.coverage_kind, f.admitted
    from carrier_state_filings f
    join carrier_products p on p.id = f.product_id
    join carriers c on c.id = p.carrier_id
   where f.state = p_state
     and f.status = 'approved'
     and c.status = 'active'
     and p.retired_at is null
     and p.activity_class = p_activity_class
     and (f.effective_from is null or f.effective_from <= p_on)
     and (f.effective_to is null or f.effective_to > p_on)
   order by c.name, p.product_code;
$$;

comment on function public.available_carrier_products(jurisdiction_code, text, date) is
  'Who may write what, where, today. The single question lib/coverage/service.ts asks before quoting. Takes a date so a quote can be reproduced against the filings that were in force when it was given.';

revoke all on function public.available_carrier_products(jurisdiction_code, text, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4a. Talking to them — outbound
-- ---------------------------------------------------------------------------

create table carrier_credentials (
  id                  uuid primary key default gen_random_uuid(),
  carrier_id          uuid not null references carriers (id) on delete cascade,
  environment         api_environment not null default 'sandbox',
  base_url            text,
  auth_kind           carrier_auth_kind not null default 'bearer',
  -- NOT the secret. The NAME of the environment variable that holds it.
  --
  -- This is the one place the pattern differs from partner keys and the reason is
  -- worth stating: a partner key is something we HASH and never need back, so a
  -- database leak yields nothing. A carrier's key is something we must SEND, in
  -- clear, on every call — so storing it here would put a working production
  -- credential for somebody else's insurance system in a row that support staff
  -- can read and that appears in every backup. It lives in the deploy config; the
  -- database records only which variable to look in.
  secret_env_var      text,
  -- The inbound half: what THEY present to US on a webhook. Hashed, like a
  -- partner key, because that one we only ever need to verify.
  inbound_secret_hash text,
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles (id) on delete set null,
  rotated_at          timestamptz,
  revoked_at          timestamptz,

  constraint credential_names_a_variable_not_a_secret
    check (secret_env_var is null or secret_env_var ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

comment on table carrier_credentials is
  'How we reach a carrier, per environment. Holds the NAME of the env var carrying their secret, never the secret itself — see the column comment.';
comment on column carrier_credentials.secret_env_var is
  'e.g. ACME_CARRIER_API_KEY. The check constraint enforces the shape of an environment variable name, so a secret pasted here fails immediately and visibly instead of being stored.';

create unique index carrier_credentials_live_key
  on carrier_credentials (carrier_id, environment)
  where revoked_at is null;

alter table carrier_credentials enable row level security;
revoke all on carrier_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4b. Talking to them — inbound
-- ---------------------------------------------------------------------------

create table carrier_events (
  id                 uuid primary key default gen_random_uuid(),
  carrier_id         uuid references carriers (id) on delete set null,
  event_type         text not null,
  -- Their id for the thing, so a redelivery is recognisable as one.
  external_ref       text,
  policy_id          uuid references policies (id) on delete set null,
  payload            jsonb not null default '{}'::jsonb,
  signature_verified boolean not null default false,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  error              text
);

comment on table carrier_events is
  'Everything a carrier told us after a bind: cancellation, endorsement, a claim opening. Kept verbatim, like policies.carrier_payload — the claims conversation happens in their language.';
comment on column carrier_events.signature_verified is
  'False means we could not prove it came from them. Such an event is recorded and NOT acted on; an unverified cancellation is a denial of service waiting to happen.';

create index carrier_events_unprocessed_idx
  on carrier_events (received_at)
  where processed_at is null;
create index carrier_events_policy_idx on carrier_events (policy_id)
  where policy_id is not null;
create unique index carrier_events_redelivery_key
  on carrier_events (carrier_id, event_type, external_ref)
  where external_ref is not null;

-- What was received is immutable; whether we have dealt with it is not. So this
-- is not the blanket reject_mutation() used on the evidence tables — an UPDATE is
-- allowed, but only of the processing columns. Rewriting what a carrier said, or
-- when they said it, is refused.
create or replace function public.carrier_events_no_rewrite()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'delete on carrier_events is not permitted: this is a received-message log'
      using errcode = 'restrict_violation';
  end if;

  if new.carrier_id  is distinct from old.carrier_id
     or new.event_type is distinct from old.event_type
     or new.external_ref is distinct from old.external_ref
     or new.payload is distinct from old.payload
     or new.received_at is distinct from old.received_at
     or new.signature_verified is distinct from old.signature_verified then
    raise exception 'carrier_events records what was received; only processed_at, policy_id and error may change'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger carrier_events_guard
  before update or delete on carrier_events
  for each row execute function public.carrier_events_no_rewrite();

alter table carrier_events enable row level security;
revoke all on carrier_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Which carrier wrote it
-- ---------------------------------------------------------------------------
--
-- Nullable, because every row written before today came from the single
-- anonymous carrier and inventing an attribution for them would be a lie. New
-- quotes carry it. Reporting that needs a carrier reads it and treats null as
-- "before carriers were modelled", which is exactly what it means.

alter table quotes   add column carrier_id uuid references carriers (id) on delete restrict;
alter table policies add column carrier_id uuid references carriers (id) on delete restrict;

comment on column quotes.carrier_id is
  'Who priced it. Null on quotes written before 20260901000018, when there was one anonymous carrier.';
comment on column policies.carrier_id is
  'Whose paper it is. The first question asked about any claim.';

create index quotes_carrier_idx   on quotes (carrier_id)   where carrier_id is not null;
create index policies_carrier_idx on policies (carrier_id) where carrier_id is not null;

-- ---------------------------------------------------------------------------
-- Seeding the carrier that already exists
-- ---------------------------------------------------------------------------
--
-- lib/coverage/carrier.ts has been quoting three products in Florida since it was
-- written. Those products are now rows, so that behaviour is unchanged rather
-- than reimplemented — a migration that quietly stopped offering liability and
-- medical cover in FL would be a change to what a signer is shown.
--
-- READ THE FILINGS BELOW AS WHAT THEY ARE. They mirror the mock's behaviour so
-- nothing changes today; they are not a statement about any real filing with any
-- real regulator. The carrier is named so that cannot be misread, its policy
-- numbers start MOCK-, and every document rendered in this deployment already
-- says on its face that it is unreviewed.
--
-- The seeded state_availability row for FL claims product_codes = {PWC-DAY-01}
-- while the code has always returned three. Nothing ever read that column, so the
-- disagreement was invisible. The filings below record what the system actually
-- did, and `available_carrier_products` is now the only thing consulted.

insert into carriers (name, slug, kind, status, adapter, activated_at, notes)
values (
  'Mock Carrier — no policy exists with any insurer',
  'mock',
  'carrier',
  'active',
  'mock',
  now(),
  'The deterministic stand-in in lib/coverage/carrier.ts. Replaced by a real carrier as a second row with its own adapter; this one is then set to terminated, never deleted, because quotes point at it.'
);

insert into carrier_products
  (carrier_id, product_code, coverage_kind, activity_class, display_name,
   default_limit_cents, default_deductible_cents, description)
select c.id, v.code, v.kind::coverage_kind, 'personal_watercraft', v.label,
       v.limit_cents, v.deductible_cents, v.description
  from carriers c,
       (values
          ('PWC-DAY-01', 'physical_damage',  'Damage to the watercraft',
             null::bigint, 25000::bigint,
             'Damage to the item up to its declared value, day-rated.'),
          ('PWC-LIA-01', 'liability',        'Liability to others',
             30000000::bigint, 0::bigint,
             'Injury or damage caused to someone else, day-rated.'),
          ('PWC-MED-01', 'accident_medical', 'Your own medical costs',
             1000000::bigint, 0::bigint,
             'Medical costs after an accident, day-rated.')
       ) as v(code, kind, label, limit_cents, deductible_cents, description)
 where c.slug = 'mock';

insert into carrier_state_filings
  (product_id, state, status, admitted, effective_from, notes)
select p.id, 'FL', 'approved', true, current_date,
       'Mirrors what lib/coverage/carrier.ts already returned in FL. Mock data — not a real filing.'
  from carrier_products p
  join carriers c on c.id = p.carrier_id
 where c.slug = 'mock';
