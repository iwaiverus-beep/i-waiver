-- i-Waiver's own people, and a record of what they did.
--
-- Until now the only kinds of person in this schema were a lender, a borrower
-- and (as of 20260901000012) someone who works at a partner. There was no way to
-- express "works here" — which meant approving a partner, opening a state,
-- answering a support ticket or looking at somebody's account either could not
-- be done at all, or had to be done by hand against the database with a service
-- role key. Both of those are worse than a role table.
--
-- TWO PROPERTIES MATTER MORE THAN THE ROLE LIST ITSELF.
--
-- 1. Staff access is a grant, not an attribute of an email address. A row here is
--    the whole of it; deleting or revoking the row ends the access immediately,
--    with no cache and no second place to remember. The one exception is the
--    bootstrap allowlist in lib/platform/access.ts, which exists only so the
--    first super admin can create the second, and which is an environment
--    variable precisely so that it is visible in a deploy config rather than
--    buried in a row.
--
-- 2. Everything staff do to somebody else's account is logged, and the log cannot
--    be edited. `staff_actions` is append-only in the same way `audit_events` is,
--    for the same reason: a support tool that can quietly change a partner's
--    jurisdictions or read a customer's record is only acceptable if there is an
--    unarguable record of it having happened. Corrections are new rows.
--
-- WHAT STAFF STILL CANNOT DO. Nothing here creates a path into the evidence
-- tables. `signatures`, `consent_records`, `documents`, `audit_events`,
-- `compliance_checks` and `identity_verifications` have no write policy at all
-- and gain none; a support engineer with the highest role in this table still
-- cannot alter what somebody signed. Support looks; it does not rewrite history.

create type staff_role as enum
  ('super_admin', 'admin', 'support', 'compliance', 'read_only');

comment on type staff_role is
  'super_admin manages staff and issues live keys. admin runs partner approvals and onboarding. support answers tickets and reads accounts. compliance opens states and reviews clause sets. read_only sees the consoles and changes nothing.';

create table platform_staff (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  email      text not null,
  role       staff_role not null default 'read_only',
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references profiles (id) on delete set null
);

comment on table platform_staff is
  'Who works at i-Waiver. One row per person per grant; revoking sets revoked_at rather than deleting, so the history of who had access when survives.';

-- One live grant per person. A revoked row does not block a later re-grant, which
-- is how someone who leaves and comes back is handled without losing the record
-- of the first spell.
create unique index platform_staff_active_user_key
  on platform_staff (user_id)
  where revoked_at is null;

create index platform_staff_role_idx on platform_staff (role) where revoked_at is null;

alter table platform_staff enable row level security;
revoke all on platform_staff from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The staff action log
-- ---------------------------------------------------------------------------

create table staff_actions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles (id) on delete set null,
  -- Kept in clear alongside the id: the point of this table is to be readable in
  -- two years, and a foreign key to a deleted profile is not an answer to "who".
  actor_email text not null,
  actor_role  staff_role not null,
  -- Free text by design. An enum here would need a migration every time a new
  -- admin screen is added, and the value of the log is breadth, not tidiness.
  action      text not null,
  -- What was acted on: 'partner', 'partner_application', 'support_ticket',
  -- 'platform_staff', 'agreement', 'state_availability'.
  subject_type text not null,
  subject_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table staff_actions is
  'Append-only record of everything staff did through the admin tools. Never edited; a correction is another row.';
comment on column staff_actions.detail is
  'Before/after where a value changed, and the reason given. Never PII beyond what is needed to identify the subject.';

create index staff_actions_subject_idx on staff_actions (subject_type, subject_id, created_at desc);
create index staff_actions_actor_idx   on staff_actions (actor_id, created_at desc);

create trigger staff_actions_no_update
  before update on staff_actions
  for each row execute function reject_mutation();

create trigger staff_actions_no_delete
  before delete on staff_actions
  for each row execute function reject_mutation();

alter table staff_actions enable row level security;
revoke all on staff_actions from anon, authenticated;
