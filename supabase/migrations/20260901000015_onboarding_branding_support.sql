-- The three things that sit between "approved" and "live": onboarding, branding,
-- and somewhere to ask a question.
--
-- Approving a partner is the easy half. The half that actually decides whether an
-- integration ships is the six weeks afterwards — a sandbox key, a test that
-- passes, a logo, a list of states someone has actually checked, and a person to
-- email when the bind call returns 422 at 11pm. None of that was expressible.

-- ---------------------------------------------------------------------------
-- 1. Onboarding — the checklist that decides go-live
-- ---------------------------------------------------------------------------
--
-- WHY COMPLETIONS AND NOT STEPS. The obvious design is a `partner_onboarding_steps`
-- table seeded with one row per step per partner. It rots: adding a step means
-- backfilling every partner, removing one means deciding what to do with the rows,
-- and reordering means a column that exists only to be sorted on. So the steps
-- themselves live in lib/partners/onboarding.ts, where adding one is a code change
-- reviewed like any other, and this table records only that a named step was
-- completed. A step nobody has completed simply has no row.
--
-- Some steps complete themselves — issuing a sandbox key, a first successful
-- sandbox quote — and some are a human saying yes. Both land here identically,
-- because "who decided this was done" is the question worth being able to answer,
-- and `completed_by is null` is a perfectly good answer meaning "the system saw it
-- happen".

create table partner_onboarding (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references partners (id) on delete cascade,
  -- Matches a key in ONBOARDING_STEPS. Unrecognised values are shown verbatim
  -- rather than hidden, so a renamed step is visible instead of silently missing.
  step         text not null,
  completed_at timestamptz not null default now(),
  completed_by uuid references profiles (id) on delete set null,
  note         text
);

comment on table partner_onboarding is
  'Completed onboarding steps. The step list itself is code (lib/partners/onboarding.ts), not data — see the note in this migration.';
comment on column partner_onboarding.completed_by is
  'The staff member who marked it done, or null where the system observed it (a key issued, a sandbox quote that returned 200).';

create unique index partner_onboarding_step_key on partner_onboarding (partner_id, step);

alter table partner_onboarding enable row level security;
revoke all on partner_onboarding from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Branding — co-branding, and its limits
-- ---------------------------------------------------------------------------
--
-- READ THIS BEFORE EXTENDING IT. The reason the embedded surface exists at all is
-- the licensing point in docs/data-model.md: if the PARTNER presents the offer,
-- captures the opt-in and takes a cut, the partner starts to resemble an
-- unlicensed producer. If OUR surface does the soliciting, disclosure, consent and
-- payment, we are the licensed party and they are hosting a frame.
--
-- That is a statement about who is speaking, and branding is how a reader decides
-- who is speaking. So this table is a co-branding record, not a white-label one.
-- The partner's mark sits alongside ours and the offer is made in our name. Do not
-- add a column that removes i-Waiver's identity from the widget, however
-- reasonably a partner asks for it — the request is commercially normal and
-- granting it dismantles the whole structure. If a white-label arrangement is
-- genuinely wanted, that is a licensing conversation with counsel and a different
-- schema, not a boolean here.

create table partner_branding (
  partner_id     uuid primary key references partners (id) on delete cascade,
  -- What the partner is called in the frame, if it differs from partners.name.
  display_name   text,
  logo_url       text,
  -- Hex, validated. The widget renders these into CSS custom properties; anything
  -- that is not a colour is an injection vector wearing a colour's clothes.
  primary_color  text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color   text check (accent_color  is null or accent_color  ~ '^#[0-9A-Fa-f]{6}$'),
  theme          text not null default 'auto' check (theme in ('light', 'dark', 'auto')),
  -- Where the partner's own customers are told to go with a question. Shown next
  -- to ours, never instead of it: a coverage question has to be able to reach the
  -- licensed party.
  support_email  text,
  support_url    text,
  submitted_at   timestamptz,
  approved_at    timestamptz,
  approved_by    uuid references profiles (id) on delete set null,
  review_note    text,
  updated_at     timestamptz not null default now()
);

comment on table partner_branding is
  'Co-branding for the embedded widget. i-Waiver remains the party making the offer; see the note in this migration before adding anything that would change that.';
comment on column partner_branding.approved_at is
  'Unapproved branding does not render. A logo goes out on our surface, so somebody looks at it first.';

alter table partner_branding enable row level security;
revoke all on partner_branding from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Support
-- ---------------------------------------------------------------------------

create type support_category as enum
  ('integration', 'sandbox', 'billing', 'coverage_question', 'claim',
   'account', 'bug', 'other');

create type support_priority as enum ('low', 'normal', 'high', 'urgent');

create type support_status as enum
  ('open', 'pending_customer', 'pending_us', 'resolved', 'closed');

create type support_author_kind as enum ('partner', 'lender', 'staff', 'system');

-- Human-readable reference. People quote these back on the phone, and a uuid is
-- not something anyone can read aloud.
create sequence support_ticket_reference_seq start 1001;

create table support_tickets (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique
                    default 'IW-' || nextval('support_ticket_reference_seq')::text,
  -- Null for a lender or for someone who wrote in from the public site. A ticket
  -- is not required to belong to a partner.
  partner_id      uuid references partners (id) on delete set null,
  opened_by       uuid references profiles (id) on delete set null,
  opener_email    text not null,
  opener_name     text,
  subject         text not null,
  category        support_category not null default 'other',
  priority        support_priority not null default 'normal',
  status          support_status not null default 'open',
  assigned_to     uuid references profiles (id) on delete set null,
  first_reply_at  timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table support_tickets is
  'One conversation. Partners raise these from their console; lenders and the public raise them from the contact form.';
comment on column support_tickets.first_reply_at is
  'Set on the first STAFF message. This is the number a partner integration agreement will eventually promise, so it is recorded from day one rather than reconstructed later.';

create index support_tickets_queue_idx
  on support_tickets (status, priority desc, created_at)
  where status in ('open', 'pending_us');
create index support_tickets_partner_idx on support_tickets (partner_id, created_at desc);
create index support_tickets_opener_idx  on support_tickets (opened_by, created_at desc);

create table support_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references support_tickets (id) on delete cascade,
  author_id    uuid references profiles (id) on delete set null,
  author_email text not null,
  author_kind  support_author_kind not null,
  body         text not null,
  -- A staff-only note on the ticket. Never returned by any route a customer can
  -- reach; lib/support/tickets.ts filters it out rather than trusting a caller to.
  internal     boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint only_staff_write_internal_notes
    check (not internal or author_kind = 'staff')
);

comment on table support_messages is
  'Append-only. A support thread that can be edited after the fact is not a record of what was said.';

create index support_messages_ticket_idx on support_messages (ticket_id, created_at);

create trigger support_messages_no_update
  before update on support_messages
  for each row execute function reject_mutation();

create trigger support_messages_no_delete
  before delete on support_messages
  for each row execute function reject_mutation();

alter table support_tickets  enable row level security;
alter table support_messages enable row level security;

revoke all on support_tickets  from anon, authenticated;
revoke all on support_messages from anon, authenticated;
