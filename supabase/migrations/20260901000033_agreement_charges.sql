-- What the borrower owes, and which of the two roads it travels.
--
-- Three things were asked for at once — a damage deposit, prepaid fuel, and a
-- rental fee — and they are three different animals wearing the same coat:
--
--   deposit   security, refundable, not revenue, not taxable, and its whole
--             lifecycle is a hold that is either released or taken.
--   fuel etc. a sale or a reimbursement. Paid or refunded. Sales tax reaches it.
--   usage fee the lender's service revenue, rental tax in many states, and the
--             one that changes what insurance is legally possible.
--
-- So: one table, a `kind`, and lifecycles that differ per kind — not three columns
-- on `agreements`.
--
-- --- Why not in `payments` ---------------------------------------------------
--
-- `payments` (20260829000001) is premium. Premium may be money held in a producer
-- capacity, which is why that table carries a `fiduciary` flag and defaults its
-- collector to the carrier. This is the lender's ordinary trade income, and ours
-- only in the sense that we may take an application fee on top. Putting regulated
-- fiduciary money and a borrower's fuel reimbursement in one table would undo the
-- separation that table was written to create. Same reasoning as splitting premium
-- from platform fee on day one; one level up.

create type charge_kind as enum
  ('security_deposit', 'fuel', 'cleaning', 'launch_fee', 'delivery', 'usage_fee');

comment on type charge_kind is
  'The line items. Everything except usage_fee is a deposit or a reimbursement of a cost the lender actually bore, which is why an individual may state them. usage_fee is consideration for the use of the thing, which makes the loan a bailment for hire — see 20260901000031 and the guard below.';

create type charge_settlement as enum ('platform', 'direct');

comment on type charge_settlement is
  'Which road. platform = Stripe Connect, the organization is merchant of record and we take an application fee. direct = the two of them settle it themselves and we relay a handle. There is no third road where we hold the money.';

create type charge_status as enum
  ('quoted', 'authorized', 'captured', 'released',
   'paid', 'refunded', 'waived', 'void');

comment on type charge_status is
  'Two lifecycles in one enum. A deposit runs quoted -> authorized -> captured or released. Everything else runs quoted -> paid -> refunded. waived is the lender forgiving it; void follows the agreement being voided. The constraints below stop either lifecycle borrowing the other''s words.';

create table agreement_charges (
  id                       uuid primary key default gen_random_uuid(),
  agreement_id             uuid not null references agreements (id) on delete restrict,
  kind                     charge_kind not null,
  amount_cents             bigint not null check (amount_cents >= 0),
  currency                 text not null default 'usd'
                             check (currency = lower(currency) and length(currency) = 3),
  detail                   text,
  settlement               charge_settlement not null,
  status                   charge_status not null default 'quoted',

  -- platform road
  stripe_payment_intent_id text,
  authorization_expires_at timestamptz,

  -- direct road
  payout_handle_id         uuid references lender_payout_handles (id) on delete set null,
  payout_snapshot          jsonb,
  settlement_asserted_by   uuid references profiles (id) on delete set null,
  settlement_asserted_at   timestamptz,

  environment              api_environment not null default 'live',
  created_at               timestamptz not null default now(),
  authorized_at            timestamptz,
  captured_at              timestamptz,
  released_at              timestamptz,
  paid_at                  timestamptz,
  refunded_at              timestamptz,

  -- Only a deposit is ever held. Authorising a cleaning fee and then "releasing"
  -- it describes something that did not happen.
  constraint charge_hold_is_deposit_only
    check (kind = 'security_deposit'
           or status not in ('authorized', 'captured', 'released')),

  -- And only the platform road can hold anything, because holding requires a
  -- processor. A direct charge reaching 'authorized' would be a claim that we put
  -- a hold on a card we never saw.
  constraint charge_direct_holds_nothing
    check (settlement = 'platform'
           or status not in ('authorized', 'captured', 'released')),

  -- The seven-day problem, made impossible to forget.
  --
  -- A Stripe authorisation expires in about a week. A fortnight on a boat outlives
  -- it, and a deposit everyone believes is held but is not is worse than no deposit
  -- at all. Storing the expiry as a column — required whenever a hold is live —
  -- gives the re-authorisation job something to select on, rather than leaving it
  -- to infer the deadline from timestamp arithmetic.
  constraint charge_authorization_has_an_expiry
    check (status <> 'authorized' or authorization_expires_at is not null),

  -- Commitment 4, snapshot don't reference. A borrower told to pay @jane-doe must
  -- still be able to see @jane-doe after Jane changes her handle.
  constraint charge_direct_settlement_has_a_snapshot
    check (settlement = 'platform'
           or status not in ('paid', 'refunded')
           or payout_snapshot is not null),

  -- An assertion belongs only to the road where we saw nothing.
  constraint charge_assertion_is_direct_only
    check (settlement = 'direct' or settlement_asserted_at is null),
  constraint charge_assertion_is_attributed
    check ((settlement_asserted_at is null) = (settlement_asserted_by is null))
);

comment on table agreement_charges is
  'Money between the lender and the borrower. Never premium — that is payments. One row per line item, stated on the instrument before it is signed.';
comment on column agreement_charges.settlement is
  'Fixed by the originator: an organization settles through Stripe, an individual can only ever settle direct.';
comment on column agreement_charges.payout_snapshot is
  'The handle exactly as the borrower was shown it — provider, handle, display name, and the moment. Frozen here so revoking or editing the handle never rewrites a sent agreement.';
comment on column agreement_charges.settlement_asserted_by is
  'Who says it was settled. On the direct road this is the lender''s word and nothing more: no processor told us, and the audit value is settlement_asserted rather than paid for exactly that reason. Never render it as verified.';
comment on column agreement_charges.authorization_expires_at is
  'When the hold lapses. Selected on by the re-authorisation job; see charge_authorization_has_an_expiry.';
comment on column agreement_charges.environment is
  'Sandbox money is not money. Nothing here is ever presented to a processor — same rule as payments.environment.';

create index agreement_charges_agreement_idx
  on agreement_charges (agreement_id);

-- The re-authorisation job's whole query.
create index agreement_charges_expiring_hold_idx
  on agreement_charges (authorization_expires_at)
  where status = 'authorized';

create index agreement_charges_live_idx
  on agreement_charges (kind, created_at desc)
  where environment = 'live';

-- ---------------------------------------------------------------------------
-- The commercial-use guard
-- ---------------------------------------------------------------------------
--
-- `lib/compliance.ts` will check this too, and should: a refusal at the gate can
-- explain itself, offer the conversion, and leave a compliance_checks row naming
-- the rule set version it applied. This is the floor underneath that. The rule is
-- load-bearing enough — it decides whether the coverage we bind responds at all —
-- that it should not depend on every future caller remembering to run the gate
-- first.
--
-- Note what it does NOT do: it never rewrites the charge into an allowed kind, and
-- it never silently drops it. A lender trying to charge a daily rate is not making
-- a typo; they are running a rental business, and the honest answer is to say so
-- and point at the conversion.

create or replace function public.agreement_charge_commercial_use_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_originator_kind text;
begin
  if new.kind <> 'usage_fee' then
    return new;
  end if;

  select o.kind
    into v_originator_kind
    from public.agreements a
    join public.originators o on o.id = a.originator_id
   where a.id = new.agreement_id;

  if v_originator_kind is distinct from 'organization' then
    raise exception
      'A usage fee makes this a bailment for hire, which an individual lender cannot write.'
      using errcode = 'check_violation',
            hint = 'An individual may state reimbursement line items only (fuel, cleaning, launch fee, delivery) plus a security deposit. Charging for use requires an organization originator so a commercial coverage product can be quoted.';
  end if;

  return new;
end;
$$;

comment on function public.agreement_charge_commercial_use_guard is
  'Refuses a usage fee on an agreement an individual originated. The insurance consequence, not a policy preference — see 20260901000031.';

create trigger agreement_charges_commercial_use_guard
  before insert or update of kind, agreement_id on agreement_charges
  for each row execute function public.agreement_charge_commercial_use_guard();

-- ---------------------------------------------------------------------------
-- Frozen once it has been put in front of anybody
-- ---------------------------------------------------------------------------
--
-- The money terms are part of what the two of them signed, which means they belong
-- in the instrument and not only in a confirmation email. A schedule that exists
-- solely in an email is a side note neither party agreed to, and unenforceable —
-- which defeats the point of framing it at all.
--
-- Following from that: once the agreement leaves draft, the terms are as immutable
-- as the wording around them (commitment 3, 20260829000001). Status still moves —
-- a deposit is captured, a fee is refunded, a lender waives something — because
-- that is the record of what happened afterwards, not a revision of what was
-- agreed. What cannot move is what was agreed.

create or replace function public.agreement_charge_frozen_after_send()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.agreement_status;
begin
  select a.status into v_status
    from public.agreements a
   where a.id = new.agreement_id;

  if v_status = 'draft' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception
      'Charges are part of the signed instrument and cannot be added after it is sent.'
      using errcode = 'check_violation',
            hint = 'Correct it the way every other term is corrected: void and re-execute, with both linked through replaces_agreement_id.';
  end if;

  if new.kind <> old.kind
     or new.amount_cents <> old.amount_cents
     or new.currency <> old.currency
     or new.settlement <> old.settlement
     or new.detail is distinct from old.detail then
    raise exception
      'The money terms of a sent agreement are immutable; only the status of a charge may change.'
      using errcode = 'check_violation',
            hint = 'Capture, release, refund or waive the charge. To change what was owed, void and re-execute.';
  end if;

  return new;
end;
$$;

comment on function public.agreement_charge_frozen_after_send is
  'What was owed is part of what was signed. After draft, only what happened to a charge may change — never what it was.';

create trigger agreement_charges_frozen_after_send
  before insert or update on agreement_charges
  for each row execute function public.agreement_charge_frozen_after_send();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Readable by participants, exactly like payments and quotes: the borrower is
-- entitled to see what they owe and what became of their deposit. Written only
-- server-side on the service client, like everything else in the agreement graph
-- (constraint 2).

alter table agreement_charges enable row level security;

revoke all on agreement_charges from anon, authenticated;
grant select on agreement_charges to authenticated;

create policy agreement_charges_select_participant on agreement_charges
  for select to authenticated
  using (public.can_access_agreement(agreement_id));
