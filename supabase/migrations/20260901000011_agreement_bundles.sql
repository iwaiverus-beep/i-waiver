-- Bundles — lending several things on one agreement.
--
-- Lending a jet ski almost never means lending only a jet ski. It means the ski,
-- the trailer, and two life jackets, to one person, for one afternoon. That is a
-- single bailment of several chattels, and the ordinary legal instrument for it
-- is one release with a schedule of items attached — not three releases.
--
-- WHY A JOIN TABLE AND NOT AN ARRAY COLUMN. `assets` is referenced `on delete
-- restrict` from `agreements` precisely so a lender cannot delete their way out
-- of a signed record. A uuid[] column would drop that protection silently: the
-- database cannot enforce a foreign key through an array element, so archiving
-- an asset would leave a dangling id inside a signed agreement's item list. The
-- join table keeps the restrict on every item, not just the first.
--
-- WHAT IS ADDITIVE AND WHY IT MATTERS. Nothing here changes the meaning of an
-- existing column.
--
--   * `agreements.asset_id` stays, and stays the LEAD item of the bundle. Every
--     query, policy and constraint written against it keeps working, and a
--     single-item agreement is byte-for-byte the same record it was before this
--     migration existed.
--   * `agreements.asset_snapshot` stays, and stays the lead item's snapshot.
--   * `agreements.asset_snapshots` is new: the ordered snapshot of EVERY item,
--     frozen at send. Null on an agreement created before this migration, which
--     the renderer reads as "a bundle of one" and falls back to `asset_snapshot`.
--
-- The consequence worth stating plainly: every agreement signed before today
-- still renders to the same canonical text and the same hash. A migration that
-- quietly changed what a signed document says it covered would be the single
-- worst bug this schema could have, so the fallback path is not a convenience —
-- it is the reason this is safe to apply to a live database.
--
-- Constraint 4 (snapshot, don't reference) applies item by item. The join table
-- is the DRAFT's working list. Once sent, the document is assembled from
-- `asset_snapshots` and the join table is never read for rendering again.

create table agreement_assets (
  agreement_id uuid not null references agreements (id) on delete cascade,
  asset_id     uuid not null references assets (id) on delete restrict,
  -- Position in Schedule A. The order is the lender's, and it is part of what
  -- they saw when they sent it, so it is stored rather than derived.
  order_index  int not null default 0,
  created_at   timestamptz not null default now(),
  primary key (agreement_id, asset_id)
);

comment on table agreement_assets is
  'The items on one agreement, in schedule order. The draft''s working list only: once sent, the document is assembled from agreements.asset_snapshots and this table is never read for rendering again.';
comment on column agreement_assets.order_index is
  'Position in Schedule A as the lender arranged it. Part of what they sent, so stored rather than derived.';

-- The primary key already covers (agreement_id, asset_id); this one is for
-- reading a bundle back in schedule order.
create index agreement_assets_schedule_idx
  on agreement_assets (agreement_id, order_index);

alter table agreements
  add column asset_snapshots jsonb;

comment on column agreements.asset_snapshots is
  'Ordered array of every item''s facts, frozen at send time. Null means an agreement predating bundles: read asset_snapshot as a bundle of one. Never re-derive from agreement_assets after sending.';

-- A sent bundle cannot be empty. Deliberately permissive about null so that
-- pre-bundle agreements, and drafts, are untouched by it.
alter table agreements
  add constraint sent_bundle_has_snapshots
  check (
    asset_snapshots is null
    or (
      jsonb_typeof(asset_snapshots) = 'array'
      and jsonb_array_length(asset_snapshots) >= 1
    )
  );

-- Backfill: every existing agreement becomes a bundle of one, so that the join
-- table is authoritative for the item list from here on and no code path has to
-- ask "is this an old agreement or a new one?".
insert into agreement_assets (agreement_id, asset_id, order_index)
select id, asset_id, 0
  from agreements
 where asset_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The coverage side of the boundary
-- ---------------------------------------------------------------------------
--
-- Constraint 9: coverage is a separate bounded context, and `coverage_contexts`
-- IS the integration contract — the same shape a third-party partner posts. So
-- this is a contract change, made deliberately and additively.
--
-- `asset` keeps its exact meaning: the single covered item, or the lead item of
-- a bundle. A partner integrating against one asset is unaffected and needs no
-- code change. `assets` is the full schedule, present only when there is more
-- than one thing, and a caller that ignores it still prices a real risk — just
-- the lead item's risk rather than the bundle's.
--
-- Note what did NOT happen here: no agreement id, no signer id, no join back
-- into the agreement graph. A bundle crosses the boundary as a list of described
-- things, exactly as one thing crossed it as a described thing.

alter table coverage_contexts
  add column assets jsonb;

comment on column coverage_contexts.assets is
  'Every covered item, when more than one thing is covered. asset stays the lead item so an existing partner integration keeps working unchanged. Null means a single-asset context.';

alter table coverage_contexts
  add constraint coverage_assets_is_array
  check (assets is null or jsonb_typeof(assets) = 'array');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table agreement_assets enable row level security;

-- Readable by the same participation rule as the agreement it belongs to.
create policy agreement_assets_select_participant on agreement_assets
  for select to authenticated
  using (public.can_access_agreement(agreement_id));

-- No write policy, on purpose, and this is a departure from the draft-stage
-- write policies `agreements` and `signers` carry.
--
-- Those exist as a second line of defence behind application code that does not
-- use them. Repeating the pattern here would add a client-writable path into the
-- agreement graph whose only real effect would be to make constraint 2 look
-- negotiable. RLS enabled with no write policy is deny-all for anon and
-- authenticated; the service role, which is where every agreement write actually
-- happens, bypasses RLS and does its own authorisation in lib/agreements/access.
