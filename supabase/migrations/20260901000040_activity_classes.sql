-- Activity classes become data, and readiness becomes answerable in one query.
--
-- THE PROBLEM THIS FIXES. `activity_class` has been a bare text column since the
-- initial schema, and the vocabulary lived in three places that disagreed: the
-- lend form offered one value, the intake-code form offered four, and the carrier
-- product form was a free-text box where a typo produced a product that nothing
-- would ever match and no error would ever mention. Meanwhile the STATE list was
-- honest -- `state_availability` is real data and the form only offers what is
-- open -- so the two halves of the same question were answered to different
-- standards.
--
-- Two things arrive here. First, `activity_classes`: the vocabulary, as rows,
-- with foreign keys from the tables that CONFIGURE the product. Second,
-- `state_activity_readiness`: one view that says, for every state and activity,
-- which of the four gates are satisfied and which are not.
--
-- WHICH COLUMNS GET THE FOREIGN KEY, AND WHY NOT THE REST. `agreements.
-- activity_class` and `coverage_contexts.activity_class` are SNAPSHOTS in the
-- same sense as `quotes.product_code`: they record what was true on the day, and
-- a reference would let a later edit rewrite history. They keep their bare text
-- columns deliberately. The config tables -- carrier products, rule sets,
-- template versions, intake links -- are live statements about what the product
-- does now, and those get the key.

-- ---------------------------------------------------------------------------
-- The vocabulary
-- ---------------------------------------------------------------------------

create table activity_classes (
  -- The code IS the primary key. Every column being retrofitted with a foreign
  -- key already holds these strings, and a surrogate id would mean rewriting
  -- them all to point at a number that means nothing to a reader of a rule set.
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,58}[a-z0-9]$'),
  label       text not null,
  description text,
  -- The order a person would list them in, not alphabetical.
  sort_order  int not null default 100,
  -- Soft, like carrier_products.retired_at and for the same reason: a retired
  -- activity stops being offered and keeps every agreement ever written under it.
  retired_at  timestamptz,
  created_at  timestamptz not null default now()
);

comment on table activity_classes is
  'The vocabulary of activity_class. Being a row rather than a hardcoded list is what lets the lend form, the intake-code form and the carrier product form agree, and what stops a typo in the carrier form creating a product nothing can match.';
comment on column activity_classes.retired_at is
  'A retired activity stops being offered and keeps every agreement, rule set and template already written against it. Never delete one.';

insert into activity_classes (code, label, description, sort_order) values
  ('personal_watercraft', 'Jet ski / personal watercraft',
   'A jet ski, wave runner or other personal watercraft, operated by the borrower.', 10),
  ('boating', 'Boating',
   'A powered or sailing vessel other than a personal watercraft.', 20),
  ('towing', 'Towing a trailer',
   'A trailer lent for transport, whether or not the thing on it is also ours.', 30),
  ('equipment_use', 'Using equipment',
   'Equipment lent for use on land or water that is not itself a vessel.', 40)
on conflict (code) do nothing;

-- Anything already in the database that this seed does not name. Written before
-- the foreign keys go on, so that adding them cannot fail on live data: a value
-- somebody typed into the free-text carrier form is a fact about the database
-- whatever we think of it, and the migration's job is to bring it into the
-- vocabulary rather than to refuse to run.
insert into activity_classes (code, label, description, sort_order)
select distinct
  v.activity_class,
  initcap(replace(v.activity_class, '_', ' ')),
  'Adopted from existing data by migration 20260901000040. Nobody has written a description for it.',
  900
from (
  select activity_class from carrier_products
  union select activity_class from jurisdiction_rule_sets
  union select activity_class from template_versions
  union select activity_class from intake_links
) v
where v.activity_class is not null
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- The keys
-- ---------------------------------------------------------------------------

alter table carrier_products
  add constraint carrier_products_activity_class_fkey
  foreign key (activity_class) references activity_classes (code) on update cascade;

alter table jurisdiction_rule_sets
  add constraint jurisdiction_rule_sets_activity_class_fkey
  foreign key (activity_class) references activity_classes (code) on update cascade;

alter table template_versions
  add constraint template_versions_activity_class_fkey
  foreign key (activity_class) references activity_classes (code) on update cascade;

alter table intake_links
  add constraint intake_links_activity_class_fkey
  foreign key (activity_class) references activity_classes (code) on update cascade;

comment on column carrier_products.activity_class is
  'References activity_classes.code. Was free text, and a typo here produced a product that available_carrier_products() would never return, with nothing to say why.';

-- ---------------------------------------------------------------------------
-- Readiness -- the four gates, in one place
-- ---------------------------------------------------------------------------
--
-- Opening a state for an activity needs four separate things, each owned by
-- somebody different: a carrier filing (the regulator), a rule set (counsel's
-- reading of the statute), a published template (counsel's wording), and the
-- clause-set review that flips the state out of specimen. Until now the only way
-- to know where a combination stood was to fail at it -- the form offered the
-- state, the draft refused with "there is no template", and nobody could see the
-- shape of the gap.
--
-- One row per (state, activity), whether or not anything exists for it. The
-- absences are the point: a matrix with holes in it is the roadmap.

create or replace view state_activity_readiness as
select
  sa.state,
  ac.code                    as activity_class,
  ac.label                   as activity_label,
  ac.sort_order              as activity_sort_order,
  sa.status                  as state_status,
  sa.waiver_efficacy,
  sa.clause_set_reviewed_at,
  sa.product_codes,

  -- Gate 1. Deliberately the same predicate as refresh_state_admitted(), plus the
  -- activity: `state_availability.carrier_admitted` is that predicate summed over
  -- every activity, which is why a state can read as admitted while the activity
  -- somebody actually wants has no filing behind it.
  exists (
    select 1
      from carrier_state_filings f
      join carrier_products p on p.id = f.product_id
      join carriers c on c.id = p.carrier_id
     where f.state = sa.state
       and p.activity_class = ac.code
       and f.status = 'approved'
       and c.status = 'active'
       and p.retired_at is null
       and (f.effective_from is null or f.effective_from <= current_date)
       and (f.effective_to is null or f.effective_to > current_date)
  ) as carrier_filed,

  -- Gate 2. The compliance gate refuses a send or a signature without one.
  exists (
    select 1
      from jurisdiction_rule_sets r
     where r.state = sa.state
       and r.activity_class = ac.code
       and r.effective_from <= now()
       and (r.effective_to is null or r.effective_to > now())
  ) as rule_set_published,

  -- Gate 3, four times. Template selection is exhaustive over originator kind and
  -- instrument kind with no fallback between them, so "has a template" is four
  -- questions, and answering it as one would hide exactly the gap that matters --
  -- FL today has both individual instruments and neither organisation one.
  exists (
    select 1 from template_versions tv
     where tv.jurisdiction = sa.state and tv.activity_class = ac.code
       and tv.originator_kind = 'individual' and tv.instrument_kind = 'rental'
       and tv.published_at is not null and tv.superseded_at is null
  ) as template_individual_rental,
  exists (
    select 1 from template_versions tv
     where tv.jurisdiction = sa.state and tv.activity_class = ac.code
       and tv.originator_kind = 'individual' and tv.instrument_kind = 'participant'
       and tv.published_at is not null and tv.superseded_at is null
  ) as template_individual_participant,
  exists (
    select 1 from template_versions tv
     where tv.jurisdiction = sa.state and tv.activity_class = ac.code
       and tv.originator_kind = 'organization' and tv.instrument_kind = 'rental'
       and tv.published_at is not null and tv.superseded_at is null
  ) as template_organization_rental,
  exists (
    select 1 from template_versions tv
     where tv.jurisdiction = sa.state and tv.activity_class = ac.code
       and tv.originator_kind = 'organization' and tv.instrument_kind = 'participant'
       and tv.published_at is not null and tv.superseded_at is null
  ) as template_organization_participant,

  -- Drafted but not published, which is a different state from absent and reads
  -- very differently on a roadmap: somebody has written the wording and it is
  -- waiting on counsel, rather than nobody having started.
  exists (
    select 1 from template_versions tv
     where tv.jurisdiction = sa.state and tv.activity_class = ac.code
       and tv.published_at is null and tv.superseded_at is null
  ) as template_drafted_unpublished

from state_availability sa
cross join activity_classes ac
where ac.retired_at is null;

comment on view state_activity_readiness is
  'One row per (state, activity), including the empty ones. The four gates to opening a combination -- carrier filing, rule set, published template per originator and instrument kind, and the clause-set review -- each owned by somebody different and until now only discoverable by failing at them.';

-- ---------------------------------------------------------------------------
-- Who may read what
-- ---------------------------------------------------------------------------

alter table activity_classes enable row level security;

-- Same reasoning as state_availability: the public "where we operate" surface
-- needs it, and the vocabulary of activities is not a secret.
create policy activity_classes_select on activity_classes
  for select to anon, authenticated
  using (true);

-- The view is not security_invoker, so it reads its underlying tables as its
-- owner and the grant below is the whole of the access control. That is
-- deliberate, and it is the reason the view exposes booleans rather than rows:
-- "is there an approved filing in Texas for boating" is the same class of
-- information as state_availability.status, which anon already reads. Nothing
-- here discloses a filing reference, a carrier, a premium or a clause body.
grant select on state_activity_readiness to anon, authenticated;
