-- Merchandising the things you lend.
--
-- `assets` has been deliberately spartan since the initial schema, and correctly
-- so: its job was to identify a chattel well enough for a legal schedule and a
-- carrier. A 200-character description, make, model, a serial number, a declared
-- value. That is enough to say WHICH jet ski. It is nothing like enough to sell
-- one, and selling is what a lender is actually doing when a stranger scans the
-- code on their counter.
--
-- So this adds a second face to the same row. The identifying facts stay exactly
-- as they are and keep printing on Schedule A; alongside them sits a headline,
-- a longer description, photographs and an asking price, none of which any
-- document ever reads.
--
-- THE SEPARATION THAT MATTERS: `description` remains the legal label and is the
-- only text of the two that reaches an instrument. `headline` is sales copy.
-- Nothing in lib/render/ may ever be pointed at the new columns — a schedule that
-- reads "THE ULTIMATE LAKE DAY 🚤" instead of "2021 Yamaha VX Cruiser" is not a
-- description of a chattel, and the whole value of the schedule is that it is.
--
-- --- What a rate here IS, and is not ----------------------------------------
--
-- An asking price. It is what the lender advertises, shown on their public page
-- and carried through to a request so the queue says what somebody thought they
-- were agreeing to. It is not a term of anything and nothing is owed on it.
--
-- What a borrower actually owes is `agreement_charges` (20260901000033): stated
-- line items, frozen once the agreement leaves draft, settled through Stripe for
-- an organization or directly between two people for an individual. Those DO
-- print on the instrument, and must — a money term that lives only in an email is
-- a side note neither party agreed to.
--
-- So the two are a quote and a term, in that order, and the catalog deliberately
-- does not reach across: accepting a request opens the ordinary draft form with
-- the items picked, and a human being states the charges there. Nothing here can
-- put a number on an instrument, which is what keeps this migration out of the
-- review that changing an instrument requires.

-- ---------------------------------------------------------------------------
-- rate_unit
-- ---------------------------------------------------------------------------
--
-- An enum rather than free text because it is rendered next to a number on a
-- borrower's phone and "per day" / "a day" / "/day" typed three ways is three
-- different-looking prices for the same thing.
--
-- `flat` is not a duration and is the one that makes the set honest: delivery,
-- a fuel top-off and a cleaning fee are priced once, not per hour, and a
-- merchant forced to call those "per day" would be stating something untrue on
-- their own page.

create type rate_unit as enum ('hour', 'half_day', 'day', 'week', 'flat');

comment on type rate_unit is
  'How a rate is quoted. flat is deliberately in the set: a delivery charge or a cleaning fee is priced once, not per period.';

-- ---------------------------------------------------------------------------
-- The new columns
-- ---------------------------------------------------------------------------

alter table assets
  add column headline      text,
  add column details_md    text,
  add column rate_cents    bigint check (rate_cents >= 0),
  add column rate_unit     rate_unit,
  add column deposit_cents bigint check (deposit_cents >= 0),
  add column quantity      int not null default 1 check (quantity >= 1),
  add column is_offerable  boolean not null default false;

comment on column assets.headline is
  'Sales copy — the line that sells it. NEVER rendered into an agreement: description is the legal label and stays the only text of the two that reaches Schedule A.';

comment on column assets.details_md is
  'The long description for the lender''s public page. Also never rendered into an agreement.';

comment on column assets.rate_cents is
  'The asking price. Advertised, not owed: what a borrower actually owes is agreement_charges, stated on the draft by a person. See the header of this migration.';

comment on column assets.deposit_cents is
  'A refundable deposit, stated up front rather than discovered at the counter. Display only, same as rate_cents.';

comment on column assets.quantity is
  'Stock on hand, for the things there are twelve of. NOT availability: nothing here knows whether the pontoon is already out on Saturday, and a request remains a request.';

comment on column assets.is_offerable is
  'Whether this appears on the lender''s public intake page. Defaults false so that nothing anybody has already saved becomes public the moment this migration runs.';

-- A price is a number and a unit or it is neither. Half of one is a page that
-- says "$75" with nothing after it, which reads as a total and is not.
-- "Price on request" is a real answer and is both columns null.
alter table assets
  add constraint asset_rate_is_complete
  check ((rate_cents is null) = (rate_unit is null));

-- The public page reads offerable items for one lender at a time.
create index assets_offerable_idx
  on assets (owner_originator_id)
  where is_offerable and archived_at is null;

-- ---------------------------------------------------------------------------
-- An individual may not advertise a rate for the use of the thing
-- ---------------------------------------------------------------------------
--
-- The same rule the charge guard enforces one layer down, applied where a lender
-- first types the number rather than where it finally becomes a term.
--
-- Lending a jet ski to a friend is a gratuitous bailment. Charging them by the day
-- for it is a bailment for hire, and personal watercraft, boat and auto policies
-- exclude use for a fee — so the moment an individual charges for use, their own
-- policy stops responding and anything bound alongside it was priced against a
-- risk that no longer exists. A public page reading "$150 a day" is that, in
-- writing, on the open internet, before anybody has signed anything.
--
-- HOW IT TELLS THE DIFFERENCE, and the honest limits of it: a rate quoted per
-- period is consideration for the use of the thing over that period, which is
-- hire. A `flat` rate is the shape of a reimbursement — delivery, a tank of fuel,
-- a cleaning fee, a launch fee — and splitting the cost of those is not
-- consideration for use, so an individual may state them. That test is a floor,
-- not a gate: a flat fee CAN be hire, and this cannot see it. The gate is
-- `lib/compliance.ts` and the trigger on agreement_charges, where the kind of each
-- line item is stated explicitly rather than inferred.
--
-- Not a check constraint, because the rule reads the owning originator.

create or replace function public.asset_rate_commercial_use_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.rate_unit is null or new.rate_unit = 'flat' then
    return new;
  end if;

  select o.kind
    into v_kind
    from public.originators o
   where o.id = new.owner_originator_id;

  if v_kind is distinct from 'organization' then
    raise exception
      'Charging by the hour, day or week for something you lend makes it a rental, which an individual cannot insure.'
      using errcode = 'check_violation',
            hint = 'Leave the rate blank, or use a one-off amount for what you are out of pocket — delivery, fuel, cleaning. Renting things out for a fee needs a business account so commercial cover can be quoted.';
  end if;

  return new;
end;
$$;

comment on function public.asset_rate_commercial_use_guard is
  'Refuses a per-period asking price on an individual''s item. The insurance consequence, not a policy preference — the same rule agreement_charges enforces on a usage_fee line item, applied where the number is first typed.';

create trigger assets_rate_commercial_use_guard
  before insert or update of rate_cents, rate_unit, owner_originator_id on assets
  for each row execute function public.asset_rate_commercial_use_guard();

-- ---------------------------------------------------------------------------
-- asset_photos
-- ---------------------------------------------------------------------------
--
-- A separate table rather than an array column: photographs are ordered, get
-- alt text, and are added and removed one at a time.
--
-- `on delete cascade` is right here and is worth contrasting with everything
-- else that points at `assets`, which is `on delete restrict` because those rows
-- are evidence or reference evidence. A photograph is neither. It proves
-- nothing, no agreement points at it, and losing every one of them would cost a
-- lender their listing and a claim nothing at all. Assets are still never
-- hard-deleted — they archive — so this is a rule for a case that should not
-- arise rather than a routine path.

create table asset_photos (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets (id) on delete cascade,
  storage_path text not null unique,
  alt          text,
  order_index  int not null default 0,
  created_at   timestamptz not null default now()
);

comment on table asset_photos is
  'Marketing photographs of a lendable item. Not evidence and never rendered into an agreement. Condition photographs, if they are ever built, belong to the handover and do not go here.';

comment on column asset_photos.storage_path is
  'Object key within the asset-photos bucket. Unique, so a double-submitted upload cannot produce two rows pointing at one object and a delete leave one dangling.';

comment on column asset_photos.order_index is
  'Gallery order as the lender arranged it. The first is the one that shows in a list.';

create index asset_photos_asset_idx on asset_photos (asset_id, order_index);

-- --- Access -----------------------------------------------------------------
--
-- Mirrors `assets_owner_all` from 20260901000010, and for the same reason: this
-- is a supported path, not a second line of defence. An item row is not
-- evidence, so app/api/assets/* deliberately runs on the caller's own client and
-- lets the policy do the authorising. A photograph of one is even less than
-- that.
--
-- Note what is NOT here: no policy for `anon`. The borrower's page renders
-- through the service client, which is how it already reads the item itself, so
-- a stranger scanning a code never needs a row-level grant. The image BYTES are
-- public — see the bucket below — but the table is not readable by anyone
-- outside the lender's own originators.

alter table asset_photos enable row level security;

revoke all on asset_photos from anon;
grant select, insert, update, delete on asset_photos to authenticated;

create policy asset_photos_owner_all on asset_photos
  for all to authenticated
  using (
    asset_id in (
      select a.id from public.assets a
       where a.owner_originator_id in (select public.user_originator_ids())
    )
  )
  with check (
    asset_id in (
      select a.id from public.assets a
       where a.owner_originator_id in (select public.user_originator_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: the first public bucket in this project
-- ---------------------------------------------------------------------------
--
-- Both existing buckets are private and carry no storage policies at all, so
-- anon and authenticated are denied outright and a document reaches a
-- participant as a short-lived signed URL minted after a participation test.
-- That posture is right for what those buckets hold.
--
-- This one is public, and the argument is that its contents are already public
-- by construction. A photograph here exists to be looked at by whoever points a
-- camera at a code printed on a counter card. There is no population to
-- restrict it to — the code is in the world — so signing the URLs would buy no
-- confidentiality and would cost the browser cache, the CDN and every borrower
-- on a marina's weak wifi.
--
-- WHAT MAY NEVER GO IN HERE, and the rule is narrow on purpose:
--
--   * marketing photographs of a lendable item        yes
--   * a photograph of damage, or of a handover        NO — that is evidence
--   * anything from an identity check                 NO — see identity_verifications
--   * anything a signer produced                      NO — signature-images
--
-- Writes are not granted to anybody. There is no insert, update or delete policy
-- on storage.objects for this bucket, so uploads happen where every other
-- privileged write in this codebase happens: a route handler on the service
-- client that has done its own authorisation first.

insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', true)
on conflict (id) do nothing;
