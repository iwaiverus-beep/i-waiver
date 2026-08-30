-- iWaiver — initial schema
-- Derived from iwaiver-data-model.md (working draft).
--
-- Design commitments encoded here, from that document:
--   1. A signer is not a user. `signers` stands alone; `signers.user_id` is nullable
--      and a borrower never needs an account. Borrower auth is `signing_links` only.
--   2. The originator is polymorphic. `originators` resolves to exactly one of an
--      individual user or an organization; `agreements` point at it.
--   3. Nothing about an executed agreement is mutable. Corrections void and re-execute.
--   4. Snapshot, don't reference. Asset values, rating inputs, template bodies, rule sets.
--   5. Append-only audit, hash-chained per agreement.
--
-- RLS is enabled on every table here, but policies live in the next migration.
-- A table with RLS on and no policy denies all access to anon/authenticated, which is
-- the correct failure direction if that second migration is not applied.

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------

create domain jurisdiction_code as text
  check (value ~ '^[A-Z]{2}$');

comment on domain jurisdiction_code is
  'US state code, or the literal US for a base record that is not state-specific.';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type plan_tier          as enum ('free', 'pro', 'business');
create type verification_level as enum ('none', 'email', 'id_me');
create type org_role           as enum ('owner', 'admin', 'manager', 'staff');

create type asset_class as enum
  ('pwc', 'boat', 'trailer', 'vehicle', 'equipment', 'other');

create type agreement_status as enum
  ('draft', 'sent', 'partially_signed', 'executed', 'expired', 'voided');

create type signer_role     as enum ('lender', 'borrower', 'co_signer', 'witness');
create type signer_capacity as enum ('adult', 'minor', 'guardian_for');

create type delivery_channel as enum ('sms', 'email');

create type clause_kind as enum
  ('assumption_of_risk', 'release', 'covenant_not_to_sue',
   'indemnity', 'damage_responsibility', 'esign_consent');

create type document_kind as enum
  ('agreement', 'certificate_of_insurance', 'receipt', 'third_party_agreement');

create type signature_method as enum ('drawn', 'typed', 'clicked');

create type audit_actor as enum ('lender', 'borrower', 'system', 'carrier');

create type audit_event_type as enum
  ('created', 'sent', 'delivered', 'opened', 'consented', 'viewed_clause',
   'identity_verified', 'compliance_checked', 'signed', 'quoted', 'bound',
   'paid', 'voided');

create type idv_method as enum
  ('doc_scan', 'selfie_match', 'db_lookup', 'phone_possession');
create type idv_status as enum ('pending', 'passed', 'failed', 'manual_review');

create type enforceability as enum ('yes', 'limited', 'no');

create type compliance_check_kind as enum
  ('operator_age', 'education_cert', 'identity', 'jurisdiction_supported');
create type compliance_result as enum ('pass', 'fail', 'warn', 'skipped');

create type coverage_kind as enum
  ('physical_damage', 'liability', 'accident_medical', 'deductible_reimbursement');

create type policy_status as enum
  ('bound', 'active', 'expired', 'cancelled', 'voided');

create type payment_collector as enum ('platform', 'carrier');
create type payment_status    as enum
  ('pending', 'authorized', 'paid', 'failed', 'refunded');

create type source_channel as enum ('first_party', 'partner');

create type integration_kind   as enum ('widget', 'api', 'redirect');
create type compensation_model as enum ('flat_referral', 'platform_fee', 'none');

create type waiver_efficacy as enum ('standard', 'limited', 'void');

-- ---------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------

-- The data model calls this `users`; it is named `profiles` here to keep it visibly
-- distinct from auth.users, which it extends 1:1.
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  phone             text,
  phone_verified_at timestamptz,
  home_state        jurisdiction_code,
  created_at        timestamptz not null default now()
);

comment on table profiles is
  'Account holders — mostly lenders. Borrowers only if they opt in after signing.';
comment on column profiles.phone is
  'E.164. Verification is tracked separately in phone_verified_at.';
comment on column profiles.home_state is
  'Default jurisdiction only. Never the jurisdiction of an agreement.';

create table organizations (
  id                 uuid primary key default gen_random_uuid(),
  legal_name         text not null,
  dba                text,
  primary_state      jurisdiction_code,
  plan_tier          plan_tier not null default 'free',
  verification_level verification_level not null default 'none',
  created_at         timestamptz not null default now()
);

comment on table organizations is
  'Business tier only. A P2P lender never has one.';

create table org_memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  role        org_role not null default 'staff',
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz,
  unique (org_id, user_id)
);

comment on table org_memberships is
  'Customer-side membership only. Platform staff are NOT rows here — super_admin stays a separate platform role with its own audit trail, so an internal action is never indistinguishable from a customer action.';

create index org_memberships_user_idx on org_memberships (user_id)
  where accepted_at is not null and revoked_at is null;

create table originators (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles (id) on delete restrict,
  org_id     uuid references organizations (id) on delete restrict,
  kind       text generated always as
               (case when user_id is not null then 'individual' else 'organization' end) stored,
  created_at timestamptz not null default now(),
  constraint originator_is_exactly_one_party check (num_nonnulls(user_id, org_id) = 1)
);

comment on table originators is
  'The party that creates agreements: an individual OR an organization, never both. Access control is scoped by participation through this table, not by a tenant_id column on every table.';

create unique index originators_user_key on originators (user_id) where user_id is not null;
create unique index originators_org_key  on originators (org_id)  where org_id  is not null;

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

create table assets (
  id                   uuid primary key default gen_random_uuid(),
  owner_user_id        uuid not null references profiles (id) on delete restrict,
  asset_class          asset_class not null default 'other',
  description          text not null,
  identifier           text,
  declared_value_cents bigint check (declared_value_cents >= 0),
  year                 int check (year between 1900 and 2100),
  make                 text,
  model                text,
  created_at           timestamptz not null default now(),
  archived_at          timestamptz
);

comment on table assets is
  'The thing being lent, reusable across agreements. For the business tier an asset may be an activity rather than an object, so identifier is nullable and asset_class stays open. Never hard-delete — policies reference these rows.';
comment on column assets.identifier is 'HIN / VIN / serial. Matters to the carrier.';

create index assets_owner_idx on assets (owner_user_id) where archived_at is null;

-- ---------------------------------------------------------------------------
-- Document layer — templates and clauses
-- ---------------------------------------------------------------------------

create table clauses (
  id           uuid primary key default gen_random_uuid(),
  kind         clause_kind not null,
  jurisdiction jurisdiction_code not null default 'US',
  label        text not null,
  created_at   timestamptz not null default now()
);

comment on table clauses is
  'The instruments stay separate records so a court can void one without taking the rest with it, and so each can vary per state.';

create table clause_versions (
  id                          uuid primary key default gen_random_uuid(),
  clause_id                   uuid not null references clauses (id) on delete restrict,
  version                     int not null check (version > 0),
  body_md                     text not null,
  body_hash                   text not null,
  requires_separate_signature boolean not null default false,
  conspicuous_formatting      jsonb not null default '{}'::jsonb,
  effective_from              timestamptz,
  effective_to                timestamptz,
  published_at                timestamptz,
  superseded_at               timestamptz,
  created_at                  timestamptz not null default now(),
  unique (clause_id, version)
);

comment on column clause_versions.body_md is 'Clause text with merge fields.';
comment on column clause_versions.requires_separate_signature is
  'Some states want the release initialled on its own.';
comment on column clause_versions.conspicuous_formatting is
  'Caps / bold / minimum font size — e.g. the Texas express-negligence rules.';

create table templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table template_versions (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references templates (id) on delete restrict,
  version        int not null check (version > 0),
  jurisdiction   jurisdiction_code not null,
  activity_class text not null,
  clause_set     jsonb not null default '[]'::jsonb,
  body_hash      text not null,
  published_at   timestamptz,
  superseded_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (template_id, version)
);

comment on table template_versions is
  'Immutable once published. You must be able to prove, two years later, exactly what wording a signer saw. Never edit a published version — publish a new one.';
comment on column template_versions.clause_set is 'Ordered array of clause_version ids.';
comment on column template_versions.body_hash is 'sha256 of the canonical rendered source.';

create index template_versions_lookup_idx
  on template_versions (jurisdiction, activity_class)
  where published_at is not null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- Agreements — the spine
-- ---------------------------------------------------------------------------

create table agreements (
  id                  uuid primary key default gen_random_uuid(),
  originator_id       uuid not null references originators (id) on delete restrict,
  asset_id            uuid references assets (id) on delete restrict,
  template_version_id uuid not null references template_versions (id) on delete restrict,
  jurisdiction        jurisdiction_code not null,
  activity_class      text not null,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  status              agreement_status not null default 'draft',
  cover_requested     boolean not null default false,
  asset_snapshot      jsonb,
  legal_hold_at       timestamptz,
  voided_at           timestamptz,
  voided_reason       text,
  replaces_agreement_id uuid references agreements (id) on delete restrict,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  executed_at         timestamptz,
  constraint agreement_window_is_ordered check (ends_at > starts_at),
  constraint sent_agreement_has_snapshot
    check (status = 'draft' or asset_id is null or asset_snapshot is not null)
);

comment on table agreements is
  'One row per loan. The originator, not a lender_user_id, is the creating party — see originators.';
comment on column agreements.jurisdiction is
  'US state where the ACTIVITY happens, not where anyone lives.';
comment on column agreements.template_version_id is
  'Immutable once sent. Re-pointing a sent agreement at new wording destroys the evidence model.';
comment on column agreements.asset_snapshot is
  'Asset values frozen at send time. If the owner edits the declared value in September, the June agreement must not change.';
comment on column agreements.legal_hold_at is
  'Once a claim or dispute is known the record stops aging out regardless of retention policy. The purge job MUST respect this.';
comment on column agreements.replaces_agreement_id is
  'Corrections happen by voiding and re-executing, with both linked.';

create index agreements_originator_idx  on agreements (originator_id, created_at desc);
create index agreements_status_idx      on agreements (status);
create index agreements_jurisdiction_idx on agreements (jurisdiction, activity_class);
create index agreements_legal_hold_idx  on agreements (legal_hold_at) where legal_hold_at is not null;

-- ---------------------------------------------------------------------------
-- Signers — independent of users, on purpose
-- ---------------------------------------------------------------------------

create table signers (
  id                  uuid primary key default gen_random_uuid(),
  agreement_id        uuid not null references agreements (id) on delete cascade,
  role                signer_role not null,
  capacity            signer_capacity not null default 'adult',
  guardian_signer_id  uuid references signers (id) on delete restrict,
  user_id             uuid references profiles (id) on delete set null,
  display_name        text not null,
  email               text,
  phone               text,
  order_index         int not null default 0,
  signed_at           timestamptz,
  declined_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint signer_is_reachable check (email is not null or phone is not null),
  constraint signer_not_both_signed_and_declined
    check (num_nonnulls(signed_at, declined_at) < 2),
  constraint guardian_only_for_minor
    check (guardian_signer_id is null or capacity = 'minor')
);

comment on table signers is
  'The important one. Independent of profiles: a borrower signs from a link and may never create an account. user_id is nullable and an account is offered AFTER signing, never as a gate.';
comment on column signers.capacity is
  'Adults only at launch. The minor path is gated in application code until the insurance-first minor product ships — a parental pre-injury release is void or near-void in most states.';
comment on column signers.order_index is 'For sequential signing, if that is ever needed.';

-- Exactly one lender and one borrower per agreement; co-signers and witnesses are open.
create unique index signers_principal_role_key
  on signers (agreement_id, role)
  where role in ('lender', 'borrower');

create index signers_agreement_idx on signers (agreement_id);
create index signers_user_idx      on signers (user_id) where user_id is not null;
create index signers_email_idx     on signers (lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- Signing links — the borrower's entire auth story
-- ---------------------------------------------------------------------------

create table signing_links (
  id               uuid primary key default gen_random_uuid(),
  signer_id        uuid not null references signers (id) on delete cascade,
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  delivery_channel delivery_channel not null default 'email',
  delivered_at     timestamptz,
  delivery_ref     text,
  first_opened_at  timestamptz,
  open_ip          inet,
  open_user_agent  text,
  created_at       timestamptz not null default now()
);

comment on table signing_links is
  'Tokenized, short-lived, single-use. Reissuing a link creates a NEW row — never mutate an existing one.';
comment on column signing_links.token_hash is 'Store the hash. Never the token.';
comment on column signing_links.expires_at is 'Hours, not days.';
comment on column signing_links.delivery_ref is
  'Twilio / SendGrid message id — evidence of delivery.';

create index signing_links_signer_idx on signing_links (signer_id, created_at desc);
create index signing_links_live_idx   on signing_links (expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------------
-- Documents — the rendered artifact
-- ---------------------------------------------------------------------------

create table documents (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references agreements (id) on delete restrict,
  kind          document_kind not null,
  storage_key   text not null unique,
  sha256        text not null,
  warranted     boolean not null default true,
  render_inputs jsonb,
  rendered_at   timestamptz not null default now()
);

comment on table documents is
  'Write-once bucket, object versioning and object lock on. A waiver''s whole value is being producible years later.';
comment on column documents.warranted is
  'False for a third_party_agreement an org uploaded. It bypasses the drafting engine so it cannot carry the same assurance, and the UI must say so.';
comment on column documents.render_inputs is
  'Everything needed to reproduce the document byte-for-byte.';

create index documents_agreement_idx on documents (agreement_id, kind);

-- ---------------------------------------------------------------------------
-- Evidence layer
-- ---------------------------------------------------------------------------

create table consent_records (
  id                uuid primary key default gen_random_uuid(),
  signer_id         uuid not null references signers (id) on delete restrict,
  consented_at      timestamptz not null default now(),
  consent_text_hash text not null,
  ip                inet,
  user_agent        text,
  withdrawn_at      timestamptz
);

comment on table consent_records is
  'ESIGN/UETA consent to transact electronically. Separate from the signature on purpose — a signature without a recorded consent is a weaker record.';
comment on column consent_records.consent_text_hash is 'Which disclosure text they were shown.';

create index consent_records_signer_idx on consent_records (signer_id);

create table signatures (
  id                       uuid primary key default gen_random_uuid(),
  signer_id                uuid not null references signers (id) on delete restrict,
  method                   signature_method not null,
  image_storage_key        text,
  typed_name               text,
  document_hash_at_signing text not null,
  signed_at                timestamptz not null default now(),
  ip                       inet,
  user_agent               text,
  geo                      jsonb,
  constraint drawn_signature_has_image
    check (method <> 'drawn' or image_storage_key is not null),
  constraint typed_signature_has_name
    check (method <> 'typed' or typed_name is not null)
);

comment on column signatures.document_hash_at_signing is
  'Binds the signature to the exact bytes signed. Without this the signature proves far less.';

create index signatures_signer_idx on signatures (signer_id);

create table identity_verifications (
  id               uuid primary key default gen_random_uuid(),
  signer_id        uuid not null references signers (id) on delete restrict,
  vendor           text not null,
  vendor_ref       text,
  method           idv_method not null,
  status           idv_status not null default 'pending',
  name_match_score numeric(5,4) check (name_match_score between 0 and 1),
  verified_at      timestamptz,
  created_at       timestamptz not null default now()
);

comment on table identity_verifications is
  'Store the RESULT, not the ID images. If images must be held: short retention, separate encrypted bucket, documented deletion job. The lender sees pass / fail / name-match only — never DOB, address, or document images.';

create index identity_verifications_signer_idx on identity_verifications (signer_id);

-- ---------------------------------------------------------------------------
-- Audit — append-only, hash-chained per agreement
-- ---------------------------------------------------------------------------

create table audit_events (
  id           bigserial primary key,
  agreement_id uuid not null references agreements (id) on delete restrict,
  signer_id    uuid references signers (id) on delete set null,
  event_type   audit_event_type not null,
  actor        audit_actor not null,
  occurred_at  timestamptz not null default now(),
  ip           inet,
  user_agent   text,
  geo          jsonb,
  payload      jsonb not null default '{}'::jsonb,
  prev_hash    text,
  hash         text not null
);

comment on table audit_events is
  'Append-only. No updates, no deletes — enforced by trigger below and by revoking UPDATE/DELETE at the role level. prev_hash/hash form a per-agreement chain for cheap tamper evidence.';

create index audit_events_agreement_idx on audit_events (agreement_id, id);

-- ---------------------------------------------------------------------------
-- Compliance gate
-- ---------------------------------------------------------------------------

create table jurisdiction_rule_sets (
  id                           uuid primary key default gen_random_uuid(),
  version                      int not null check (version > 0),
  state                        jurisdiction_code not null,
  activity_class               text not null,
  min_operator_age             int check (min_operator_age between 0 and 120),
  education_required           boolean not null default false,
  education_authority          text,
  waiver_enforceable_adult     enforceability not null default 'yes',
  parental_waiver_enforceable  enforceability not null default 'no',
  indemnity_enforceable        enforceability not null default 'yes',
  required_language            jsonb not null default '{}'::jsonb,
  effective_from               timestamptz not null default now(),
  effective_to                 timestamptz,
  created_at                   timestamptz not null default now(),
  unique (state, activity_class, version)
);

comment on table jurisdiction_rule_sets is
  'A versioned dataset, not code. You need to prove which rules were applied on a given date.';
comment on column jurisdiction_rule_sets.required_language is
  'Express-negligence and conspicuousness requirements.';

create table compliance_checks (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references agreements (id) on delete cascade,
  signer_id    uuid references signers (id) on delete cascade,
  rule_set_id  uuid not null references jurisdiction_rule_sets (id) on delete restrict,
  check_kind   compliance_check_kind not null,
  result       compliance_result not null,
  evidence     jsonb not null default '{}'::jsonb,
  blocking     boolean not null default true,
  checked_at   timestamptz not null default now()
);

comment on table compliance_checks is
  'Blocking, not advisory. If you tell a lender the borrower is covered and the claim later denies on an eligibility fact you could have caught, the lender looks at you, not the carrier.';
comment on column compliance_checks.rule_set_id is 'Which rule set VERSION was applied.';

create index compliance_checks_agreement_idx on compliance_checks (agreement_id);
create index compliance_checks_blocking_idx  on compliance_checks (agreement_id)
  where blocking and result = 'fail';

-- ---------------------------------------------------------------------------
-- Service boundary — coverage context and partners
-- ---------------------------------------------------------------------------

create table partners (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table partner_integrations (
  id                   uuid primary key default gen_random_uuid(),
  partner_id           uuid not null references partners (id) on delete cascade,
  integration_kind     integration_kind not null,
  api_key_hash         text not null unique,
  key_rotated_at       timestamptz,
  allowed_jurisdictions text[] not null default '{}',
  compensation_model   compensation_model not null default 'flat_referral',
  webhook_url          text,
  webhook_secret_hash  text,
  created_at           timestamptz not null default now()
);

comment on column partner_integrations.compensation_model is
  'Never premium-based. Compensation structured as a share of premium makes the partner resemble an unlicensed producer, which is the whole problem the embedded widget avoids. Have counsel structure this per state.';

create table coverage_contexts (
  id             uuid primary key default gen_random_uuid(),
  source         source_channel not null default 'first_party',
  partner_id     uuid references partners (id) on delete restrict,
  external_ref   text,
  activity_class text not null,
  jurisdiction   jurisdiction_code not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  parties        jsonb not null default '[]'::jsonb,
  asset          jsonb,
  supplemental   jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint coverage_window_is_ordered check (ends_at > starts_at),
  constraint partner_source_has_partner
    check ((source = 'partner') = (partner_id is not null))
);

comment on table coverage_contexts is
  'The normalized description of what is being covered, independent of any waiver. This IS the integration contract. Keep the required set small enough that a partner can supply it from data they already hold; everything else goes in supplemental.';
comment on column coverage_contexts.supplemental is
  'Facts we collected that the partner did not have. A wrong guess about the carrier bind payload lands here instead of forcing a schema change or a renegotiated partner contract.';

create unique index coverage_contexts_partner_ref_key
  on coverage_contexts (partner_id, external_ref)
  where partner_id is not null and external_ref is not null;

-- ---------------------------------------------------------------------------
-- Insurance layer
-- ---------------------------------------------------------------------------

create table quotes (
  id                    uuid primary key default gen_random_uuid(),
  coverage_context_id   uuid not null references coverage_contexts (id) on delete restrict,
  agreement_id          uuid references agreements (id) on delete restrict,
  beneficiary_signer_id uuid references signers (id) on delete restrict,
  source                source_channel not null default 'first_party',
  product_code          text not null,
  coverage_kind         coverage_kind not null,
  limit_cents           bigint check (limit_cents >= 0),
  deductible_cents      bigint check (deductible_cents >= 0),
  premium_cents         bigint not null check (premium_cents >= 0),
  rating_inputs         jsonb not null default '{}'::jsonb,
  rate_plan_version     text not null,
  carrier_quote_ref     text,
  quoted_at             timestamptz not null default now(),
  expires_at            timestamptz,
  constraint first_party_quote_has_agreement
    check (source <> 'first_party' or agreement_id is not null)
);

comment on table quotes is
  'Both parties may buy: two policies, not one policy with two insureds. Attach rate is therefore measured PER SIGNER, not per agreement, or it is understated by half.';
comment on column quotes.coverage_context_id is
  'The coverage service reads this, never the agreement tables. agreement_id is retained for first-party reporting only and must not be read across the service boundary.';
comment on column quotes.rating_inputs is
  'Snapshot every input. You must be able to reproduce any quote you ever showed — regulators and carriers both ask. Never recompute from current data.';

create index quotes_agreement_idx   on quotes (agreement_id) where agreement_id is not null;
create index quotes_beneficiary_idx on quotes (beneficiary_signer_id);
create index quotes_context_idx     on quotes (coverage_context_id);

create table policies (
  id                      uuid primary key default gen_random_uuid(),
  quote_id                uuid not null references quotes (id) on delete restrict,
  insured_signer_id       uuid references signers (id) on delete restrict,
  source                  source_channel not null default 'first_party',
  carrier_policy_number   text not null,
  status                  policy_status not null default 'bound',
  effective_at            timestamptz not null,
  expires_at              timestamptz not null,
  carrier_payload         jsonb not null default '{}'::jsonb,
  certificate_document_id uuid references documents (id) on delete restrict,
  created_at              timestamptz not null default now(),
  constraint policy_window_is_ordered check (expires_at > effective_at)
);

comment on column policies.carrier_payload is 'Raw bind response, kept verbatim.';
comment on column policies.effective_at is 'Tied to the agreement window.';

create unique index policies_carrier_number_key on policies (carrier_policy_number);
create index policies_quote_idx on policies (quote_id);

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  agreement_id       uuid references agreements (id) on delete restrict,
  quote_id           uuid references quotes (id) on delete restrict,
  payer_signer_id    uuid references signers (id) on delete restrict,
  premium_cents      bigint not null default 0 check (premium_cents >= 0),
  platform_fee_cents bigint not null default 0 check (platform_fee_cents >= 0),
  collector          payment_collector not null default 'carrier',
  fiduciary          boolean not null default false,
  processor          text,
  processor_ref      text,
  status             payment_status not null default 'pending',
  paid_at            timestamptz,
  refunded_at        timestamptz
);

comment on table payments is
  'Premium and platform fee are split at the schema level from day one. Default collector is carrier: it avoids fiduciary trust accounting entirely. Keep platform behind the same interface until you know you need it.';
comment on column payments.fiduciary is
  'Premium held in a producer capacity may require a segregated trust account.';

create index payments_agreement_idx on payments (agreement_id);

-- ---------------------------------------------------------------------------
-- AI intake — selects clauses, never writes legal text
-- ---------------------------------------------------------------------------

create table intake_sessions (
  id                      uuid primary key default gen_random_uuid(),
  agreement_id            uuid not null references agreements (id) on delete cascade,
  transcript              jsonb not null default '[]'::jsonb,
  model_version           text not null,
  prompt_version          text,
  extracted_facts         jsonb not null default '{}'::jsonb,
  selected_clause_versions uuid[] not null default '{}',
  human_reviewed          boolean not null default false,
  created_at              timestamptz not null default now()
);

comment on table intake_sessions is
  'AI conducts the interview and SELECTS clauses. It does not write legal text. Generating bespoke legal language resembles the unauthorized practice of law in a number of states, and a uniquely generated document cannot be tied to a versioned template — which collapses the entire evidence model.';
comment on column intake_sessions.transcript is
  'Kept as evidence of what was asked.';
comment on column intake_sessions.selected_clause_versions is
  'The output that matters. Every operative clause comes from clause_versions, drafted by counsel, versioned, immutable.';

create index intake_sessions_agreement_idx on intake_sessions (agreement_id);

-- ---------------------------------------------------------------------------
-- State availability
-- ---------------------------------------------------------------------------

create table state_availability (
  state                  jurisdiction_code primary key,
  carrier_admitted       boolean not null default false,
  product_codes          text[] not null default '{}',
  clause_set_reviewed_at timestamptz,
  waiver_efficacy        waiver_efficacy not null default 'standard',
  status                 text generated always as (
    case
      when not carrier_admitted then 'unavailable'
      when clause_set_reviewed_at is null then 'cover_only'
      when waiver_efficacy = 'void'::waiver_efficacy then 'cover_only'
      else 'live'
    end
  ) stored,
  notes                  text,
  updated_at             timestamptz not null default now()
);

comment on table state_availability is
  'All states, gated individually. Nothing in the architecture blocks fifty states — availability is gated by the carrier being admitted and filed, and by counsel having reviewed the clause set.';
comment on column state_availability.status is
  'cover_only matters: in a void-waiver state you can still sell the coverage, but the product must present honestly — the cover is the whole value and the document is a record of the loan rather than a shield. Do not quietly underdeliver the waiver.';
comment on column state_availability.waiver_efficacy is
  'MT, LA and VA are void or near-void; WI, CT and VT are hostile.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement and the audit hash chain
-- ---------------------------------------------------------------------------

create or replace function reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is not permitted: this table is append-only',
    tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_events_no_update
  before update on audit_events
  for each row execute function reject_mutation();

create trigger audit_events_no_delete
  before delete on audit_events
  for each row execute function reject_mutation();

-- Links the event to the previous one for the same agreement. Any later edit to an
-- earlier row breaks every hash downstream of it.
create or replace function audit_events_chain()
returns trigger
language plpgsql
as $$
declare
  v_prev_hash text;
begin
  select ae.hash into v_prev_hash
  from audit_events ae
  where ae.agreement_id = new.agreement_id
  order by ae.id desc
  limit 1;

  new.prev_hash := v_prev_hash;
  new.hash := encode(
    extensions.digest(
      -- occurred_at is hashed as a UTC epoch, never as ::text: the textual
      -- rendering of a timestamptz depends on the session DateStyle and TimeZone,
      -- which would make the chain unverifiable from a different session.
      coalesce(v_prev_hash, '') || '|' ||
      new.agreement_id::text     || '|' ||
      coalesce(new.signer_id::text, '') || '|' ||
      new.event_type::text       || '|' ||
      new.actor::text            || '|' ||
      extract(epoch from new.occurred_at)::text || '|' ||
      coalesce(new.payload::text, '{}'),
      'sha256'
    ),
    'hex'
  );

  return new;
end;
$$;

create trigger audit_events_set_chain
  before insert on audit_events
  for each row execute function audit_events_chain();

-- ---------------------------------------------------------------------------
-- Row level security — enabled everywhere, policies in the next migration
-- ---------------------------------------------------------------------------

alter table profiles               enable row level security;
alter table organizations          enable row level security;
alter table org_memberships        enable row level security;
alter table originators            enable row level security;
alter table assets                 enable row level security;
alter table clauses                enable row level security;
alter table clause_versions        enable row level security;
alter table templates              enable row level security;
alter table template_versions      enable row level security;
alter table agreements             enable row level security;
alter table signers                enable row level security;
alter table signing_links          enable row level security;
alter table documents              enable row level security;
alter table consent_records        enable row level security;
alter table signatures             enable row level security;
alter table identity_verifications enable row level security;
alter table audit_events           enable row level security;
alter table jurisdiction_rule_sets enable row level security;
alter table compliance_checks      enable row level security;
alter table partners               enable row level security;
alter table partner_integrations   enable row level security;
alter table coverage_contexts      enable row level security;
alter table quotes                 enable row level security;
alter table policies               enable row level security;
alter table payments               enable row level security;
alter table intake_sessions        enable row level security;
alter table state_availability     enable row level security;
