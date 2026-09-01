-- How a lender gets paid — which is two different answers, on purpose.
--
-- An organization is a business taking commercial rental income. It gets Stripe
-- Connect: the org is the merchant of record, funds settle to the org, and we take
-- an application fee. We never hold the money. That is the same instinct as
-- `payments.collector = 'carrier'` in 20260829000001 — staying out of custody is
-- worth more than the float.
--
-- An individual gets no processing at all. They tell us where they would like to
-- be reimbursed, we pass it along, and the two of them settle it between
-- themselves. Nothing moves through us and nothing is owed to us.
--
-- That asymmetry is deliberate, and it is not a smaller version of the same
-- feature:
--
--   * Money between strangers means full KYC on every individual lender and
--     1099-K issuance above the threshold. That is a compliance programme, not a
--     column.
--   * Venmo's own terms require a business profile for commercial transactions.
--     Cost reimbursement between two people is what a personal handle is for; a
--     daily rental rate collected on one gets the account frozen. Keeping the P2P
--     line items to reimbursement keeps our users inside Venmo's rules as well as
--     the carrier's.
--   * And the coverage argument in 20260901000031. An individual charging for use
--     has no policy that responds.
--
-- So the individual route is a handoff with a frame around it, and it is bounded
-- by what 20260901000033 will let an individual put on the instrument.

-- ---------------------------------------------------------------------------
-- Organizations — Stripe Connect
-- ---------------------------------------------------------------------------

alter table organizations
  add column stripe_account_id       text,
  add column stripe_charges_enabled  boolean not null default false,
  add column stripe_onboarded_at     timestamptz;

comment on column organizations.stripe_account_id is
  'The connected account. The organization is the merchant of record on every charge; we are never in the flow of funds.';
comment on column organizations.stripe_charges_enabled is
  'Mirrors charges_enabled on the connected account. Onboarding is not finished until Stripe says so, and a platform-settled charge must refuse until then rather than take money the org cannot receive.';

create unique index organizations_stripe_account_key
  on organizations (stripe_account_id)
  where stripe_account_id is not null;

-- ---------------------------------------------------------------------------
-- Individuals — a handle we relay, not an account we charge
-- ---------------------------------------------------------------------------

create type payout_provider as enum ('venmo', 'cashapp', 'zelle', 'paypal', 'other');

comment on type payout_provider is
  'Who the two of them settle through. Not an integration: we never call any of these. Venmo is the common case today and will not be the last one, which is why this is an enum and not a venmo_username column.';

-- The individual-only rule, declared rather than trusted.
--
-- `originators.kind` is a stored generated column (20260829000001), so a composite
-- foreign key onto (id, kind) lets the database itself refuse to hang a personal
-- payment handle off an organization. An organization that wants to be paid has
-- Stripe; if it also had a Venmo handle on file, the relay email would eventually
-- send a business's customers to a personal account.
alter table originators
  add constraint originators_id_kind_key unique (id, kind);

create table lender_payout_handles (
  id              uuid primary key default gen_random_uuid(),
  originator_id   uuid not null,
  originator_kind text not null default 'individual',
  provider        payout_provider not null,
  handle          text not null,
  display_name    text,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,

  constraint payout_handle_is_individual
    check (originator_kind = 'individual'),

  -- The anti-phishing constraint, and the reason there is no QR image column.
  --
  -- We render this handle into an email that goes out under our name. An uploaded
  -- QR code is an arbitrary destination we would be forwarding on a lender's word,
  -- and a handle allowed to contain a URL is the same hole with extra steps. So the
  -- character set is narrow enough that no scheme, host or path can be smuggled
  -- through it, and the QR is GENERATED from the validated handle at render time —
  -- never accepted as an image.
  constraint payout_handle_is_a_handle
    check (handle ~ '^[A-Za-z0-9@._+-]{2,64}$'),

  constraint payout_handle_originator_fk
    foreign key (originator_id, originator_kind)
    references originators (id, kind)
    on delete cascade
);

comment on table lender_payout_handles is
  'Where an individual lender would like to be reimbursed. We relay it and generate its QR; we never contact the provider, never see the transfer, and are owed nothing from it.';
comment on column lender_payout_handles.originator_kind is
  'Always the literal individual. Carried as a column so the composite FK to originators (id, kind) can enforce that structurally — see the constraint above.';
comment on column lender_payout_handles.handle is
  'Provider handle only, e.g. @jane-doe. Constrained to a character set that cannot express a URL: this string is rendered into outbound mail and into a QR code.';
comment on column lender_payout_handles.confirmed_at is
  'The lender confirmed we transcribed it correctly. Not verification of the account — we have no way to check that one exists, and must never imply we did.';
comment on column lender_payout_handles.revoked_at is
  'Soft delete. Agreements already sent keep their own snapshot (20260901000033), so revoking here never rewrites what a borrower was told.';

-- One live handle per provider. A lender may keep both a Venmo and a Zelle; they
-- may not keep two Venmos, which only ever means one of them is stale.
create unique index lender_payout_handles_live_key
  on lender_payout_handles (originator_id, provider)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Same posture as 20260901000023: the lender reads their own, nobody writes
-- through RLS. The borrower never reads this table — what they see is the snapshot
-- frozen onto the charge, served to them server-side, because an accountless
-- signer has no session to read with in the first place.

alter table lender_payout_handles enable row level security;

revoke all on lender_payout_handles from anon, authenticated;
grant select on lender_payout_handles to authenticated;

create policy lender_payout_handles_select_own on lender_payout_handles
  for select to authenticated
  using (originator_id in (select public.user_originator_ids()));
