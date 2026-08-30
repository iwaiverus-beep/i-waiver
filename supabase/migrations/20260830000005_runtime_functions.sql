-- iWaiver — runtime functions the application layer depends on.
--
-- Three things live here:
--
--   1. `assert_clause_set_reviewed` — named in CLAUDE.md as the render-path guard.
--      It was defined in the prototype `app` schema and went out with it in
--      20260830000003. It is restored here as the ONLY door to clause bodies:
--      `render_clause_set` calls it before returning a single character of legal
--      text, so "render without asserting" is not a mistake that can be made.
--
--   2. The audit hash expression, extracted from the insert trigger into a shared
--      function so that verification and generation cannot drift apart. A verifier
--      that reimplements the hash is a verifier that eventually disagrees with the
--      thing it verifies for reasons unrelated to tampering. The expression is
--      byte-identical to the one in 20260829000001.
--
--   3. A profile row for every new auth user, so the application never has to guess
--      whether one exists.

-- ---------------------------------------------------------------------------
-- 1. Profiles follow auth.users
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

comment on function public.handle_new_auth_user is
  'Every authenticated user has exactly one profile from the moment they exist. Borrowers are unaffected: a signer is not a user and never passes through auth.users at all.';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 2. The audit hash, in one place
-- ---------------------------------------------------------------------------

create or replace function public.audit_event_hash(
  p_prev_hash    text,
  p_agreement_id uuid,
  p_signer_id    uuid,
  p_event_type   public.audit_event_type,
  p_actor        public.audit_actor,
  p_occurred_at  timestamptz,
  p_payload      jsonb
)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select encode(
    extensions.digest(
      -- occurred_at is hashed as a UTC epoch, never as ::text: the textual
      -- rendering of a timestamptz depends on the session DateStyle and TimeZone,
      -- which would make the chain unverifiable from a different session.
      coalesce(p_prev_hash, '')               || '|' ||
      p_agreement_id::text                    || '|' ||
      coalesce(p_signer_id::text, '')         || '|' ||
      p_event_type::text                      || '|' ||
      p_actor::text                           || '|' ||
      extract(epoch from p_occurred_at)::text || '|' ||
      coalesce(p_payload::text, '{}'),
      'sha256'
    ),
    'hex'
  )
$fn$;

comment on function public.audit_event_hash is
  'The single definition of an audit event hash. The insert trigger and the chain verifier both call it, so they cannot drift.';

-- Rewritten to delegate. The bytes hashed are unchanged from 20260829000001.
create or replace function public.audit_events_chain()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_prev_hash text;
begin
  select ae.hash into v_prev_hash
  from public.audit_events ae
  where ae.agreement_id = new.agreement_id
  order by ae.id desc
  limit 1;

  new.prev_hash := v_prev_hash;
  new.hash := public.audit_event_hash(
    v_prev_hash, new.agreement_id, new.signer_id,
    new.event_type, new.actor, new.occurred_at, new.payload
  );

  return new;
end;
$fn$;

create or replace function public.verify_audit_chain(p_agreement_id uuid)
returns table (
  event_id      bigint,
  occurred_at   timestamptz,
  event_type    public.audit_event_type,
  link_ok       boolean,
  hash_ok       boolean,
  stored_hash   text,
  expected_hash text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with ordered as (
    select
      ae.*,
      lag(ae.hash) over (order by ae.id) as preceding_hash,
      row_number()  over (order by ae.id) as rn
    from public.audit_events ae
    where ae.agreement_id = p_agreement_id
  )
  select
    o.id,
    o.occurred_at,
    o.event_type,
    -- The first event of an agreement must have no predecessor; every later one
    -- must name the hash of the row immediately before it.
    (o.prev_hash is not distinct from case when o.rn = 1 then null else o.preceding_hash end),
    (o.hash = public.audit_event_hash(
       o.prev_hash, o.agreement_id, o.signer_id,
       o.event_type, o.actor, o.occurred_at, o.payload)),
    o.hash,
    public.audit_event_hash(
       o.prev_hash, o.agreement_id, o.signer_id,
       o.event_type, o.actor, o.occurred_at, o.payload)
  from ordered o
  order by o.id
$fn$;

comment on function public.verify_audit_chain is
  'Recomputes an agreement audit chain. hash_ok false means a row own contents were altered; link_ok false means a row was removed or reordered ahead of it.';

revoke all on function public.verify_audit_chain(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The render guard
-- ---------------------------------------------------------------------------

create or replace function public.assert_clause_set_reviewed(p_template_version_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tv        public.template_versions%rowtype;
  v_ids       uuid[];
  v_count     int;
  v_offending text;
begin
  select * into v_tv
  from public.template_versions tv
  where tv.id = p_template_version_id;

  if not found then
    raise exception 'template version % does not exist', p_template_version_id
      using errcode = 'no_data_found';
  end if;

  if v_tv.published_at is null then
    raise exception
      'template version % is not published; unreviewed wording must never reach a signer',
      p_template_version_id
      using errcode = 'restrict_violation';
  end if;

  if v_tv.superseded_at is not null then
    raise exception 'template version % was superseded at %',
      p_template_version_id, v_tv.superseded_at
      using errcode = 'restrict_violation';
  end if;

  if jsonb_typeof(v_tv.clause_set) <> 'array' or jsonb_array_length(v_tv.clause_set) = 0 then
    raise exception 'template version % has an empty clause set', p_template_version_id
      using errcode = 'restrict_violation';
  end if;

  select array_agg((t.value)::uuid order by t.ordinality)
    into v_ids
  from jsonb_array_elements_text(v_tv.clause_set) with ordinality as t(value, ordinality);

  -- Every referenced id must resolve. A clause_set naming an id that no longer
  -- exists would render as a silently shorter document, which is worse than an error.
  select count(*) into v_count
  from public.clause_versions cv
  where cv.id = any(v_ids);

  if v_count <> coalesce(array_length(v_ids, 1), 0) then
    raise exception
      'template version % references % clause versions but only % exist',
      p_template_version_id, coalesce(array_length(v_ids, 1), 0), v_count
      using errcode = 'restrict_violation';
  end if;

  select string_agg(cv.id::text, ', ')
    into v_offending
  from public.clause_versions cv
  where cv.id = any(v_ids)
    and (cv.published_at is null or cv.superseded_at is not null);

  if v_offending is not null then
    raise exception
      'clause versions not published or superseded, refusing to render: %', v_offending
      using errcode = 'restrict_violation',
            hint = 'Publish a clause version only once counsel has reviewed it.';
  end if;
end;
$fn$;

comment on function public.assert_clause_set_reviewed is
  'CLAUDE.md constraint 5. Raises unless the template version and every clause version it names are published and unsuperseded. Called by render_clause_set, which is the only way to obtain clause bodies.';

-- The single door to clause text. Asserting first is not left to the caller.
create or replace function public.render_clause_set(p_template_version_id uuid)
returns table (
  ordinal                     int,
  clause_version_id           uuid,
  kind                        public.clause_kind,
  label                       text,
  body_md                     text,
  body_hash                   text,
  requires_separate_signature boolean,
  conspicuous_formatting      jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_clause_set_reviewed(p_template_version_id);

  return query
  select
    t.ordinality::int,
    cv.id,
    c.kind,
    c.label,
    cv.body_md,
    cv.body_hash,
    cv.requires_separate_signature,
    cv.conspicuous_formatting
  from public.template_versions tv
  cross join lateral jsonb_array_elements_text(tv.clause_set)
       with ordinality as t(value, ordinality)
  join public.clause_versions cv on cv.id = (t.value)::uuid
  join public.clauses c on c.id = cv.clause_id
  where tv.id = p_template_version_id
  order by t.ordinality;
end;
$fn$;

comment on function public.render_clause_set is
  'Ordered clause bodies for a template version, or an exception. There is deliberately no way to read clause text for rendering that skips the review assertion.';

revoke all on function public.assert_clause_set_reviewed(uuid) from anon, authenticated;
revoke all on function public.render_clause_set(uuid)          from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage
--
-- Both private, both with no storage policies, so anon and authenticated are
-- denied outright. A document reaches a participant as a short-lived signed URL
-- minted server-side after the same participation test the table policies apply.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('agreement-documents', 'agreement-documents', false),
       ('signature-images',    'signature-images',    false)
on conflict (id) do nothing;
