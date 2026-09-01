-- Add-ons: renting this suggests these.
--
-- The whole of this feature rests on something that already exists. Since
-- 20260901000011 an agreement carries a SCHEDULE of items rather than one item —
-- lend the pontoon, the trailer and two life jackets on one release, frozen into
-- `asset_snapshots` at send time. A cooler with ice is therefore not a new kind
-- of thing that needs a new kind of record. It is a second line on a schedule the
-- document already knows how to render and the carrier already prices against.
--
-- So there are exactly two new tables and neither is in the agreement graph:
--
--   asset_offers             the lender's own merchandising. "When somebody asks
--                            for the pontoon, show them these." A suggestion,
--                            never a bundle: nothing is forced onto anyone and
--                            nothing here can put an item on an agreement.
--
--   agreement_request_items  what a borrower actually ticked, hanging off the
--                            request. Disposable, exactly like the request.
--
-- Accepting a request still creates an ordinary draft by the ordinary route. The
-- only difference is that the form opens with three items pre-picked instead of
-- one, and the lender is still the person who presses send.

-- ---------------------------------------------------------------------------
-- asset_offers
-- ---------------------------------------------------------------------------
--
-- No surrogate key: the pair IS the fact, and a natural primary key is what stops
-- a lender adding the cooler to the pontoon twice by double-clicking.
--
-- `on delete cascade` on both sides, for the same reason asset_photos cascades.
-- An offer is merchandising. It proves nothing, no agreement points at it, and an
-- item that goes away should take its suggestions with it rather than leaving
-- rows that resolve to nothing.

create table asset_offers (
  parent_asset_id  uuid not null references assets (id) on delete cascade,
  offer_asset_id   uuid not null references assets (id) on delete cascade,
  order_index      int not null default 0,
  default_selected boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (parent_asset_id, offer_asset_id),
  constraint offer_is_not_itself check (parent_asset_id <> offer_asset_id)
);

comment on table asset_offers is
  'A lender''s own upsells: which of their items to suggest alongside another. Merchandising only — nothing here can place an item on an agreement. Accepting a request does that, through the ordinary draft path.';

comment on column asset_offers.default_selected is
  'Whether the box is ticked when the page opens. For the thing that genuinely goes with it every time — the trailer with the boat — not as a way to slip a charge past somebody.';

comment on column asset_offers.order_index is
  'The order the lender arranged them in, which is the order the borrower sees.';

create index asset_offers_parent_idx on asset_offers (parent_asset_id, order_index);

-- Both items must belong to the same lender.
--
-- Enforced here rather than in the route because the consequence of getting it
-- wrong is a lender's public page advertising somebody else's stock, and because
-- `assets` is readable by every colleague in an organisation — so an id arriving
-- from a browser is not self-authorising even when the caller can legitimately
-- read the row it names.
--
-- A trigger rather than a check constraint: the rule spans two other rows, which
-- is more than a check constraint may look at.

create or replace function public.asset_offer_same_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_owner uuid;
  offer_owner  uuid;
begin
  select owner_originator_id into parent_owner
    from public.assets where id = new.parent_asset_id;
  select owner_originator_id into offer_owner
    from public.assets where id = new.offer_asset_id;

  if parent_owner is null or offer_owner is null then
    raise exception 'both items must exist';
  end if;

  if parent_owner <> offer_owner then
    raise exception 'an item can only be offered alongside another of the same lender''s items';
  end if;

  return new;
end;
$$;

comment on function public.asset_offer_same_owner is
  'Refuses an offer that links one lender''s item to another lender''s. A trigger rather than a check constraint because the rule reads two other rows.';

create trigger asset_offers_same_owner
  before insert or update on asset_offers
  for each row execute function public.asset_offer_same_owner();

-- --- Access -----------------------------------------------------------------
--
-- Same posture as asset_photos: the lender's own client under a policy, because
-- an item's merchandising is not evidence. The borrower's page reads offers
-- through the service client, as it already reads the item itself, so `anon`
-- needs nothing.

alter table asset_offers enable row level security;

revoke all on asset_offers from anon;
grant select, insert, update, delete on asset_offers to authenticated;

create policy asset_offers_owner_all on asset_offers
  for all to authenticated
  using (
    parent_asset_id in (
      select a.id from public.assets a
       where a.owner_originator_id in (select public.user_originator_ids())
    )
  )
  with check (
    parent_asset_id in (
      select a.id from public.assets a
       where a.owner_originator_id in (select public.user_originator_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- agreement_request_items
-- ---------------------------------------------------------------------------
--
-- What the borrower ticked. Note where this sits: on `agreement_requests`, which
-- 20260901000017 was explicit about NOT being an evidence table. It expires, it
-- can be declined, and purging it destroys nothing a later claim would need. The
-- same is true of these rows, and `on delete cascade` is what makes that literal
-- — the purge takes the request and the items go with it.
--
-- `on delete restrict` on the asset, though. An item a borrower has asked for
-- must not vanish out from under a pending request; a lender archives instead,
-- and the queue still shows what was asked for.
--
-- Deliberately NOT stored here: the price. A rate is a fact about the lender's
-- item at the moment it is read, and a request is a conversation rather than a
-- record — quoting it back later from a frozen number would be inventing a
-- commitment nobody made. Snapshotting is what the agreement does, and the
-- agreement does not carry prices at all.

create table agreement_request_items (
  request_id  uuid not null references agreement_requests (id) on delete cascade,
  asset_id    uuid not null references assets (id) on delete restrict,
  order_index int not null default 0,
  created_at  timestamptz not null default now(),
  primary key (request_id, asset_id)
);

comment on table agreement_request_items is
  'The add-ons a borrower ticked on a public page. Disposable with the request that owns them, like everything else on that side of the queue. Becoming a line on Schedule A happens later, when a lender accepts and an ordinary draft is created.';

comment on column agreement_request_items.order_index is
  'The order they were shown in, kept so the lender''s form opens looking like the page the borrower filled in.';

create index agreement_request_items_request_idx
  on agreement_request_items (request_id, order_index);

alter table agreement_request_items enable row level security;

revoke all on agreement_request_items from anon, authenticated;
grant select on agreement_request_items to authenticated;

-- Lender-side read only, mirroring `agreement_requests_select_own`. The
-- borrower's insert does not come through RLS at all: it arrives unauthenticated
-- at a route handler which resolves the slug and writes on the service client.
create policy agreement_request_items_select_own on agreement_request_items
  for select to authenticated
  using (
    request_id in (
      select r.id from public.agreement_requests r
       where r.originator_id in (select public.user_originator_ids())
    )
  );
