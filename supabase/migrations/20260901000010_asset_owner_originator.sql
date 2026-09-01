-- Assets belong to originators, not to people.
--
-- An organisation could already originate an agreement — `agreements.originator_id`
-- has pointed at `originators` since the initial schema — but the thing being lent
-- still had to be owned by an individual's profile. A rental shop's fleet therefore
-- had to sit under one employee's account: invisible to their colleagues, welded to
-- that person by `on delete restrict`, and untrue on its face. The shop owns the jet
-- ski, not the member of staff who happened to type it in.
--
-- After this migration there is one ownership path, and it is the same shape as the
-- one agreements already use. Whether the owner is a person or a business is a
-- property of the originator, not a branch in the schema.

alter table assets
  add column owner_originator_id uuid references originators (id) on delete restrict;

-- Backfill.
--
-- Every existing asset is owned by an individual, but that individual may have no
-- originator row yet: `ensureIndividualOriginator()` creates one lazily on first
-- send, and saving a jet ski to your list does not send anything. So mint the
-- missing ones first. `originators_user_key` is a partial unique index on
-- (user_id) where user_id is not null, so the `not exists` guard is what keeps
-- this insert idempotent.
insert into originators (user_id)
select distinct a.owner_user_id
from assets a
where not exists (
  select 1 from originators o where o.user_id = a.owner_user_id
);

update assets a
set owner_originator_id = o.id
from originators o
where o.user_id = a.owner_user_id
  and a.owner_originator_id is null;

alter table assets
  alter column owner_originator_id set not null;

-- The old column and its index go together; the index was partial on
-- `archived_at is null` and the replacement keeps that, since every read of this
-- table is a read of the un-archived list.
drop index if exists assets_owner_idx;

alter table assets
  drop column owner_user_id;

create index assets_owner_idx on assets (owner_originator_id) where archived_at is null;

comment on column assets.owner_originator_id is
  'The party that owns the asset: an individual or an organisation. Mirrors agreements.originator_id, so a shop''s fleet belongs to the shop rather than to whichever member of staff entered it.';

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------
--
-- Same shape as the agreements policies: membership resolves through
-- `public.user_originator_ids()`, which already folds in accepted, non-revoked org
-- memberships. That is what makes a colleague able to see the fleet.
--
-- Unlike the agreement graph, this policy is a supported path rather than a second
-- line of defence — `app/api/assets/route.ts` deliberately runs on the caller's own
-- client, because an asset row on its own is not evidence.

drop policy if exists assets_owner_all on assets;

create policy assets_owner_all on assets
  for all to authenticated
  using (owner_originator_id in (select public.user_originator_ids()))
  with check (owner_originator_id in (select public.user_originator_ids()));
