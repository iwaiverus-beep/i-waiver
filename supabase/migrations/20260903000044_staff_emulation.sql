-- Support emulation: a super admin looking at a customer's screens.
--
-- WHAT THIS IS FOR. A customer calls and says a screen is wrong. Asking them to
-- describe it costs both sides ten minutes and usually produces a description of
-- something else. Looking at the same screen they are looking at answers it in
-- one. That is the whole scope: LOOKING.
--
-- WHY IT IS A TABLE AND NOT A FLAG ON A COOKIE. The cookie the browser carries is
-- an opaque id and nothing else. Everything that decides whether the emulation is
-- allowed, whom it is of, and whether it has expired is read from this row on the
-- server. A signed cookie carrying the target's id would work and would put the
-- answer to "who was this person looking at" in a place nobody can query.
--
-- Constraint 13 is the design: staff can look, they cannot rewrite history. So
-- this table is the record of the looking, and it is deliberately shaped like
-- staff_actions — append-only, readable in two years, and never the same thing as
-- a customer's own action. org_memberships already says why that distinction
-- matters: an internal action must never be indistinguishable from a customer's.
--
-- The one mutation allowed is ending a session. A row is written when emulation
-- starts and its `ended_at` is set once when it stops; the trigger below refuses
-- every other update, so the who, the whom and the when cannot be rewritten
-- after the fact.

create table staff_emulations (
  id uuid primary key default gen_random_uuid(),

  -- The real person. Kept in clear beside the id for the same reason
  -- staff_actions does it: a foreign key to a deleted profile is not an answer to
  -- "who was this".
  staff_user_id uuid references profiles (id) on delete set null,
  staff_email   text not null,
  staff_role    staff_role not null,

  -- The account being looked at. Also kept in clear, and deliberately a label
  -- rather than an email: what matters in an audit is that a human reading this
  -- row can tell who was looked at, and the label is what the operator saw when
  -- they chose.
  target_user_id uuid references profiles (id) on delete set null,
  target_label   text not null,

  -- Free text, required by the route. Not for tidiness: a reason typed at the
  -- moment is the only part of this record that says WHY somebody looked, and it
  -- is the first thing anybody reviewing an access log wants.
  reason text not null,

  started_at timestamptz not null default now(),

  -- A hard stop, written at the start rather than computed at read time. An
  -- emulation that lapses into being permanent because nobody pressed the button
  -- is the failure mode here, and a column the server compares against now() is
  -- harder to forget than a policy in application code.
  expires_at timestamptz not null,

  ended_at     timestamptz,
  -- 'operator' when they pressed the button, 'expired' when the clock ran out.
  ended_reason text,

  constraint emulation_ends_after_it_starts check (expires_at > started_at),
  constraint emulation_end_is_explained check (
    (ended_at is null and ended_reason is null)
    or (ended_at is not null and ended_reason is not null)
  ),
  constraint emulation_reason_is_meaningful check (length(btrim(reason)) >= 3)
);

comment on table staff_emulations is
  'Every occasion a staff member viewed the product as a customer. Append-only except for ending a session; a correction is another row.';
comment on column staff_emulations.expires_at is
  'Hard stop. The server refuses the emulation past this instant whether or not ended_at was ever set.';
comment on column staff_emulations.reason is
  'Why the operator looked. Required, because it is the only field that answers that question.';

create index staff_emulations_staff_idx
  on staff_emulations (staff_user_id, started_at desc);
create index staff_emulations_target_idx
  on staff_emulations (target_user_id, started_at desc);
-- The lookup on every emulated request: one live session by its id.
create index staff_emulations_live_idx
  on staff_emulations (id)
  where ended_at is null;

/**
 * Allows a session to be ended and nothing else.
 *
 * Not `reject_mutation()`, because unlike staff_actions this row has a legitimate
 * second state. Everything that establishes what happened is frozen; only the
 * ending may be written, and only once.
 */
create or replace function reject_emulation_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.staff_user_id  is distinct from old.staff_user_id
     or new.staff_email    is distinct from old.staff_email
     or new.staff_role     is distinct from old.staff_role
     or new.target_user_id is distinct from old.target_user_id
     or new.target_label   is distinct from old.target_label
     or new.reason         is distinct from old.reason
     or new.started_at     is distinct from old.started_at
     or new.expires_at     is distinct from old.expires_at
  then
    raise exception
      'staff_emulations is append-only apart from ending a session'
      using errcode = 'restrict_violation';
  end if;

  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
    raise exception 'an emulation session is ended once'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger staff_emulations_no_rewrite
  before update on staff_emulations
  for each row execute function reject_emulation_rewrite();

create trigger staff_emulations_no_delete
  before delete on staff_emulations
  for each row execute function reject_mutation();

-- Constraint 2: revoked outright rather than left to RLS. Nothing in the product
-- reads this except the service client in lib/platform/emulation.ts, which does
-- its own authorisation.
alter table staff_emulations enable row level security;
revoke all on staff_emulations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who can be looked at
-- ---------------------------------------------------------------------------

-- One row per (lender, account that can sign in as that lender).
--
-- NOT one row per lender. platform_lender_report is one row per originator
-- because that is what a lender is, and it is the right shape for counting. It is
-- the wrong shape for this question: an organization's screens are reached by
-- whichever of its people signs in, so choosing whom to emulate means choosing a
-- PERSON, and a business with four staff offers four different views of the same
-- account.
--
-- Deliberately excludes anybody holding a live platform_staff grant. Emulating a
-- colleague would turn "look at a customer's screen" into a way to inherit
-- somebody else's console access, and the audit row would name the wrong person
-- as the one who looked. The route checks this too; it is here so the list the
-- operator picks from cannot offer it in the first place.
create view platform_emulatable_accounts as
with staff_accounts as (
  select user_id from platform_staff where revoked_at is null
)
-- An individual lender: the account is the party.
select
  o.id                                as originator_id,
  o.kind                              as lender_kind,
  coalesce(p.full_name, 'Unnamed')    as lender_name,
  p.id                                as user_id,
  coalesce(p.full_name, 'Unnamed')    as account_name,
  'owner'::text                       as account_role,
  p.home_state::text                  as home_state
from originators o
join profiles p on p.id = o.user_id
where o.user_id is not null
  and p.id not in (select user_id from staff_accounts)

union all

-- A business: every person who has accepted an invitation and not been revoked.
select
  o.id                                as originator_id,
  o.kind                              as lender_kind,
  org.legal_name                      as lender_name,
  p.id                                as user_id,
  coalesce(p.full_name, 'Unnamed')    as account_name,
  m.role::text                        as account_role,
  p.home_state::text                  as home_state
from originators o
join organizations org on org.id = o.org_id
join org_memberships m
  on m.org_id = o.org_id
 and m.accepted_at is not null
 and m.revoked_at is null
join profiles p on p.id = m.user_id
where p.id not in (select user_id from staff_accounts);

comment on view platform_emulatable_accounts is
  'Accounts a super admin may view the product as: one row per (lender, person who can sign in as it). Excludes platform staff.';

revoke all on platform_emulatable_accounts from anon, authenticated;
