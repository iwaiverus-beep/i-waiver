-- Getting a finished agreement off the desk without getting it out of the file.
--
-- `docs/data-model.md` already describes the shape of this: retention is TIERED,
-- not truncated — hot for 12–24 months, cold to the retention floor, three years
-- at launch. This migration is the in-app half of that boundary and nothing else.
-- `archived_at` decides which side of hot/cold a row is shown on. It decides
-- nothing about whether the row, its evidence, its documents or its audit chain
-- continue to exist, because they do, for the full floor, whatever this column
-- says.
--
-- Three things it is deliberately NOT:
--
--   * not a delete, and not a soft delete. Nothing reads `archived_at` and skips
--     a row anywhere except a list on a screen. The agreement is still fetchable
--     by id, still renders, still verifies.
--   * not a status. `agreement_status` describes where the loan got to between
--     the two parties, and the lifecycle writes it from evidence. Archiving is a
--     filing decision the lender makes about their own desk, and putting it in
--     the same enum would mean an agreement could be 'archived' INSTEAD of
--     'executed' — losing the one fact on the row that matters most.
--   * not retention. `assets.archived_at` (20260829000001) already carries this
--     exact meaning on that table — off the working list, never hard-deleted —
--     and this is the same word for the same thing.
--
-- Constraint 8 keeps its teeth. `legal_hold_at` overrides all retention logic,
-- and a held agreement is precisely the one nobody may quietly lose sight of. So
-- a hold does not merely block archiving, it UNDOES it — see the trigger below.

alter table agreements
  add column archived_at timestamptz,
  add column archived_by uuid references profiles (id) on delete set null;

comment on column agreements.archived_at is
  'Filed away: hidden from the lender''s day-to-day list, present everywhere else. NOT a delete, NOT a status, NOT retention — the record is kept to the retention floor regardless of this column. See docs/data-model.md, hot vs cold.';
comment on column agreements.archived_by is
  'Who filed it. Null for a row nobody has filed, or one filed by a user since removed.';

-- The default list: this originator's unarchived agreements, newest first. A
-- partial index rather than a wider one, because the archived side is the long
-- tail and the working set should not have to page past it.
create index agreements_originator_active_idx
  on agreements (originator_id, created_at desc)
  where archived_at is null;

-- The other side of the filter is a real screen too — a lender looking for
-- something from two summers ago.
create index agreements_originator_archived_idx
  on agreements (originator_id, archived_at desc)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- A legal hold takes it back off the shelf
-- ---------------------------------------------------------------------------
--
-- Enforced here rather than only in the route, because the route will not always
-- be the only thing that sets a hold. Somebody placing one is reacting to a claim
-- or a dispute, and the honest reading of that act is "this one is live again",
-- not "this one is live but stays hidden".

create or replace function public.clear_archive_on_legal_hold()
returns trigger
language plpgsql
as $$
begin
  if new.legal_hold_at is not null then
    new.archived_at := null;
    new.archived_by := null;
  end if;
  return new;
end;
$$;

comment on function public.clear_archive_on_legal_hold is
  'Constraint 8: a held agreement is the one that must stay in front of the lender. Setting legal_hold_at unfiles it.';

create trigger agreements_hold_unarchives
  before insert or update of legal_hold_at, archived_at on agreements
  for each row
  execute function public.clear_archive_on_legal_hold();

-- ---------------------------------------------------------------------------
-- agreement_list — the read model behind the dashboard
-- ---------------------------------------------------------------------------
--
-- The first view in this schema, and it earns that by being the only honest way
-- to answer the question the screen asks.
--
-- A lender searching their agreements is searching for a PERSON — "Marcus", "the
-- Hendersons" — and for a THING — "the blue ski". Neither is a column on
-- `agreements`. Names live in `signers`; descriptions live in `assets`, through
-- `agreement_assets`. PostgREST cannot express "match the parent OR any of its
-- children" in one request, and doing it in the application means reading a
-- lender's entire history into Node to filter twenty-five rows out of it — which
-- is the exact thing paging exists to avoid. So the join happens where joins
-- happen, and one request can then search, sort, filter, count and page.
--
-- SECURITY_INVOKER, which is the whole reason this is safe. The view runs with
-- the caller's own permissions, so `agreements_select_participant` and the
-- `signers` and `assets` policies apply to it exactly as they apply to the tables
-- underneath. It is not a new way to see anything; it is a different shape for
-- what the caller could already read. Constraint 2 is untouched — a read model
-- has no write path, and nothing writes to the agreement graph through this.
--
-- Note what it does not carry: no template version, no hash, no snapshot, no
-- signature, no document. A list row is a name, a date and a state.

create view agreement_list with (security_invoker = true) as
select
  a.id,
  a.originator_id,
  a.status,
  a.jurisdiction,
  a.activity_class,
  a.starts_at,
  a.ends_at,
  a.created_at,
  a.sent_at,
  a.executed_at,
  a.voided_at,
  a.archived_at,
  a.legal_hold_at,
  -- The last thing that happened to it, whatever that was. GREATEST ignores
  -- nulls in Postgres, and created_at is not null, so this always has a value.
  greatest(a.created_at, a.sent_at, a.executed_at, a.voided_at) as last_activity_at,
  coalesce(parties.signers, '[]'::jsonb) as signers,
  parties.borrower_name,
  coalesce(schedule.item_count, 0) as item_count,
  -- Lowercased once, here, so a search is a plain LIKE against one column rather
  -- than an ILIKE across five joined ones.
  lower(
    concat_ws(
      ' ',
      parties.party_text,
      replace(a.activity_class, '_', ' '),
      a.jurisdiction,
      schedule.item_text
    )
  ) as search_text
from agreements a
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'role', s.role,
        'display_name', s.display_name,
        'email', s.email,
        'signed_at', s.signed_at
      )
      order by s.role, s.display_name
    ) as signers,
    max(s.display_name) filter (where s.role = 'borrower') as borrower_name,
    string_agg(concat_ws(' ', s.display_name, s.email), ' ') as party_text
  from signers s
  where s.agreement_id = a.id
) parties on true
left join lateral (
  select
    count(*) as item_count,
    string_agg(
      concat_ws(' ', item.description, item.make, item.model, item.identifier),
      ' '
    ) as item_text
  from agreement_assets aa
  left join assets item on item.id = aa.asset_id
  where aa.agreement_id = a.id
) schedule on true;

comment on view agreement_list is
  'Read model for the lender''s agreement list: one row per agreement with its parties, its item count and a searchable text blob. security_invoker, so the participation policies on the tables underneath decide what comes back. Never written to.';

-- Same shape as every other grant in this schema: signed-in callers only, and
-- `anon` revoked out loud rather than left to whatever the default privileges on
-- this schema happen to be. security_invoker means an anonymous reader would get
-- nothing back anyway; saying so is cheaper than relying on that twice.
revoke all on agreement_list from anon;
grant select on agreement_list to authenticated;

-- PostgREST caches the schema it serves. Without this the new view is a 404 until
-- the pool happens to notice, which looks exactly like a broken deploy.
notify pgrst, 'reload schema';
