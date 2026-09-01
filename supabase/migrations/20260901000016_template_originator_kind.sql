-- Which wording a signer sees depends on who is lending, not only on where and what.
--
-- A private loan between two neighbours and a commercial rental are not the same
-- instrument with a different name in the blank. The consideration differs, the
-- parties differ, and in several states the enforceability analysis differs with
-- them. Until now `template_versions` was keyed on (jurisdiction, activity_class)
-- only, so there was nowhere for that distinction to live and an organisation would
-- silently have been served the individual wording.
--
-- Doing this now is deliberate: there is one specimen template in one state, so the
-- re-version costs nothing. The same change against a dozen counsel-reviewed states
-- would mean re-versioning every one of them.
--
-- The column goes on the version rather than on `templates`, following jurisdiction
-- and activity_class, which already live there.

create type originator_kind as enum ('individual', 'organization');

comment on type originator_kind is
  'Mirrors the values of the generated originators.kind column. Kept as a distinct enum because template selection must be exhaustive over it; originators.kind stays text because it is generated.';

alter table template_versions
  add column originator_kind originator_kind;

-- Every template version that exists today is the individual instrument: the sole
-- seeded template describes itself as an "individual-to-individual loan".
update template_versions
set originator_kind = 'individual'
where originator_kind is null;

alter table template_versions
  alter column originator_kind set not null;

-- No default, on purpose. A default of 'individual' would quietly mislabel the first
-- organisation template somebody forgets to tag, and mislabelling it means serving a
-- private-loan release to a rental customer. Whoever writes a template version says
-- who it is for.

comment on column template_versions.originator_kind is
  'Who this wording is for: an individual lender or an organisation. The third axis of template selection, alongside jurisdiction and activity_class. There is deliberately no fallback between the two.';

drop index if exists template_versions_lookup_idx;

create index template_versions_lookup_idx
  on template_versions (jurisdiction, activity_class, originator_kind)
  where published_at is not null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- What this deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- It seeds no organisation template. An organisation therefore cannot create an
-- agreement in any state until one exists, and the route says so in plain words.
--
-- That is the honest state, not an omission. Inventing commercial wording here
-- would either be placeholder text pretending to be an instrument, or a copy of the
-- individual clauses asserting a sameness this migration exists to deny. Both are
-- worse than a clear refusal. The organisation set arrives the same way the Florida
-- individual set does: drafted by counsel, published in its own migration, with
-- state_availability updated in the same one.
--
-- Note for whoever writes that migration: state_availability.clause_set_reviewed_at
-- is per state, not per (state, originator_kind). Reviewing one kind currently flips
-- the state `live` for both and stops the specimen banner printing on either. The
-- render guard still refuses unpublished clause versions, so nothing unreviewed can
-- reach a signer today — but that column needs splitting before the second kind is
-- published in a state where the first already is.
