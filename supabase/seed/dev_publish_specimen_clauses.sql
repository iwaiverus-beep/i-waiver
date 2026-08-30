-- ###########################################################################
-- #  DEVELOPMENT ONLY. DO NOT RUN THIS AGAINST PRODUCTION.                   #
-- ###########################################################################
--
-- This script publishes the specimen clause set seeded by
-- 20260830000006_reference_data.sql so that the signing flow can be exercised
-- end to end on a development database.
--
-- Why it is not a migration
-- -------------------------
-- CLAUDE.md constraint 5: no unreviewed clause reaches a signer, and placeholder
-- legal language must be physically incapable of reaching production. The guard
-- (`assert_clause_set_reviewed`) reads the database, not an environment variable,
-- so the only way to satisfy it is to publish a clause version. If publishing
-- lived in the migration chain, `supabase db push` against production would arm
-- the placeholder wording automatically. It lives here instead, outside the
-- chain, where it takes a deliberate human act against a named database.
--
-- What running it means
-- ---------------------
-- Documents will render. Every rendered document will open with the specimen
-- marker that is baked into each clause body, and the state's clause set remains
-- unreviewed, so `state_availability.status` stays `cover_only` and the
-- application labels the document accordingly. Both of those are intentional and
-- must not be edited away to make a demo look tidier.
--
-- What to do for real
-- -------------------
-- Counsel reviews the wording. Their reviewed text becomes clause version 2 via a
-- migration (published versions are immutable — constraint 6), version 1 is
-- superseded, and `state_availability.clause_set_reviewed_at` is set for the state
-- in the same migration. Then the state computes to `live` and this file is
-- irrelevant.
--
-- Usage:
--   psql "$DEV_DATABASE_URL" -f supabase/seed/dev_publish_specimen_clauses.sql

do $dev$
declare
  v_published int;
begin
  if current_setting('server_version_num')::int < 130000 then
    raise exception 'unexpected server version';
  end if;

  update clause_versions cv
     set published_at   = now(),
         effective_from = coalesce(cv.effective_from, now())
   where cv.published_at is null
     and cv.body_md like '%SPECIMEN LANGUAGE%';

  get diagnostics v_published = row_count;
  raise notice 'published % specimen clause version(s)', v_published;

  update template_versions tv
     set published_at = now()
   where tv.published_at is null
     and not exists (
       select 1
       from jsonb_array_elements_text(tv.clause_set) as t(cid)
       join clause_versions cv on cv.id = (t.cid)::uuid
       where cv.published_at is null
     );

  get diagnostics v_published = row_count;
  raise notice 'published % template version(s)', v_published;
end;
$dev$;

-- Prove the guard now passes for the Florida PWC template, and fails loudly if
-- something was missed. A silent success here would be worse than an error.
select public.assert_clause_set_reviewed(tv.id)
from template_versions tv
join templates t on t.id = tv.template_id
where t.slug = 'pwc-loan-fl' and tv.version = 1;
