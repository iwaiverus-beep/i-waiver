-- Sandbox and live, inside the coverage bounded context.
--
-- A partner cannot integrate against a system where the only way to see a quote
-- is to create a real one. They need to run their tests on a Tuesday afternoon
-- with made-up names, break things, and run them again — and none of that may
-- ever appear in an attach-rate report, a carrier bordereau, or a regulator's
-- view of what we sold.
--
-- WHY THIS IS A COLUMN AND NOT A SEPARATE DEPLOYMENT. A second Supabase project
-- for sandbox would drift: schema applied to one and not the other, a partner
-- testing against last month's contract, and the standing temptation to "just
-- check something" in live because sandbox is behind. One database, one code
-- path, one column that says which world a row belongs to — and a purge function
-- that can empty the sandbox without any chance of touching a real policy.
--
-- WHY THE DEFAULT IS `live`. Every row that exists before this migration was
-- produced by the first-party app against a real signing flow. Defaulting to
-- `live` leaves their meaning exactly as it was. New sandbox rows are written
-- explicitly by lib/coverage/service.ts from the caller's credential; nothing
-- becomes sandbox by omission, which is the safe direction — a sandbox row
-- mistakenly marked live is a reporting error, a live row mistakenly marked
-- sandbox is a policy that a purge would delete.
--
-- The first party is always `live`. The carrier being a mock for this milestone
-- is a different axis entirely, and conflating the two would let a real signed
-- agreement quietly become test data the day a real carrier is wired in.

alter table coverage_contexts
  add column environment api_environment not null default 'live';

alter table quotes
  add column environment api_environment not null default 'live';

alter table policies
  add column environment api_environment not null default 'live';

alter table payments
  add column environment api_environment not null default 'live';

comment on column coverage_contexts.environment is
  'Which world this belongs to. Taken from the calling integration''s credential; first-party is always live.';
comment on column quotes.environment is
  'Copied from the context at quote time so channel reporting never has to join to find out whether a number was real.';
comment on column policies.environment is
  'A sandbox policy is not a policy. It is excluded from every bordereau and may be deleted; a live one may not.';
comment on column payments.environment is
  'Sandbox money is not money. Nothing here is ever presented to a processor.';

-- Reporting reads live only, and says so in the index rather than hoping every
-- query author remembers the filter.
create index quotes_live_channel_idx
  on quotes (source, quoted_at desc)
  where environment = 'live';

create index policies_live_idx
  on policies (status, effective_at desc)
  where environment = 'live';

-- ---------------------------------------------------------------------------
-- Emptying the sandbox
-- ---------------------------------------------------------------------------

-- Deliberately a function rather than a documented DELETE someone runs by hand.
-- The `where environment = 'sandbox'` on every statement is the entire safety
-- property, and it should live in one reviewed place rather than in whatever a
-- support engineer types at 6pm.
--
-- Deletion order is forced by the schema, not chosen: payments and policies both
-- reference quotes `on delete restrict`, and quotes reference coverage_contexts
-- the same way. Those restricts exist so nobody can delete their way out of a
-- bound policy, and this function does not weaken them — it satisfies them.
create or replace function public.purge_sandbox_coverage(p_partner_id uuid default null)
returns table (
  payments_deleted bigint,
  policies_deleted bigint,
  quotes_deleted   bigint,
  contexts_deleted bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payments bigint;
  v_policies bigint;
  v_quotes   bigint;
  v_contexts bigint;
  v_ids      uuid[];
begin
  -- Resolve the target set once, from the context, so every later statement is
  -- filtered by the same list rather than by a repeated join that could drift.
  select coalesce(array_agg(c.id), '{}')
    into v_ids
    from coverage_contexts c
   where c.environment = 'sandbox'
     and (p_partner_id is null or c.partner_id = p_partner_id);

  if cardinality(v_ids) = 0 then
    return query select 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  with doomed as (
    delete from payments p
     where p.environment = 'sandbox'
       and p.quote_id in (select q.id from quotes q where q.coverage_context_id = any (v_ids))
    returning p.id
  )
  select count(*) into v_payments from doomed;

  with doomed as (
    delete from policies p
     where p.environment = 'sandbox'
       and p.quote_id in (select q.id from quotes q where q.coverage_context_id = any (v_ids))
    returning p.id
  )
  select count(*) into v_policies from doomed;

  with doomed as (
    delete from quotes q
     where q.environment = 'sandbox'
       and q.coverage_context_id = any (v_ids)
    returning q.id
  )
  select count(*) into v_quotes from doomed;

  with doomed as (
    delete from coverage_contexts c
     where c.environment = 'sandbox'
       and c.id = any (v_ids)
    returning c.id
  )
  select count(*) into v_contexts from doomed;

  return query select v_payments, v_policies, v_quotes, v_contexts;
end;
$$;

comment on function public.purge_sandbox_coverage(uuid) is
  'Empties sandbox coverage data, optionally for one partner. Every statement is filtered on environment = ''sandbox''; there is no argument that widens it to live.';

revoke all on function public.purge_sandbox_coverage(uuid) from public, anon, authenticated;
