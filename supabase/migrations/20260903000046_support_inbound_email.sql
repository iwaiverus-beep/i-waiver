-- The email listener: every message that arrives at a support mailbox, and what
-- became of it.
--
-- THE GAP THIS CLOSES. Support has had two front doors and only one of them was
-- visible. A partner raising a ticket in their console lands in `support_tickets`
-- and appears in the queue; anybody who simply replied to one of our emails, or
-- wrote to support@ because that is the address on the footer of every message we
-- send, landed in a Gmail inbox that the product knows nothing about. The queue
-- said "inbox clear" while mail sat unanswered, which is worse than saying
-- nothing — it is a dashboard asserting something false.
--
-- So inbound mail is recorded here first, as mail, before anybody decides what it
-- is. That ordering matters: the record of "this arrived" must not depend on the
-- classification succeeding.
--
-- WHY MAIL DOES NOT SILENTLY BECOME A TICKET. A reply carrying a reference we
-- issued is a reply, and the listener appends it to that thread on its own —
-- there is nothing to decide. Everything else waits for a human to press a
-- button. An open mailbox that mints a ticket per message mints one per spam,
-- per bounce, per out-of-office and per newsletter, and a queue full of those is
-- a queue people stop reading. The triage step is two clicks and it is the thing
-- that keeps the queue meaning what it says.

create type support_inbound_status as enum (
  -- Arrived, nobody has looked at it.
  'new',
  -- Carried a reference we issued; appended to that thread by the listener.
  'linked',
  -- A human read it and opened a ticket from it.
  'ticketed',
  -- A human read it and it was not support. Kept, not deleted — see below.
  'ignored'
);

create table support_inbound_emails (
  id           uuid primary key default gen_random_uuid(),

  -- The address it was sent TO. support@ is the only one routed today; the column
  -- exists because partners@ and claims@ are the obvious next two, and one
  -- listener reading several mailboxes is the design that does not need a second
  -- table when that happens.
  mailbox      text not null,

  from_email   text not null,
  from_name    text,
  subject      text,
  -- Plain text. The provider is asked for the text part and the HTML part is
  -- dropped on the floor: this is a record of what somebody said, staff read it
  -- in a console, and rendering a stranger's HTML on an authenticated internal
  -- screen is an attack surface bought for no benefit at all.
  body         text not null,

  -- The provider's Message-ID, where there is one.
  --
  -- UNIQUE, and that is the whole point of the column. Every mail provider retries
  -- a webhook that does not answer 2xx, several times, with the same message. A
  -- listener without this constraint answers one slow request badly and ends up
  -- with four copies of a customer's question in the triage queue.
  message_id   text unique,

  received_at  timestamptz not null default now(),

  status       support_inbound_status not null default 'new',
  -- The thread it belongs to: matched by reference, or created during triage.
  ticket_id    uuid references support_tickets (id) on delete set null,

  -- Who triaged it. Null where the listener matched a reference by itself, which
  -- is a perfectly good answer meaning nobody had to.
  handled_by   uuid references profiles (id) on delete set null,
  handled_at   timestamptz,

  created_at   timestamptz not null default now()
);

comment on table support_inbound_emails is
  'Mail that arrived at a support mailbox. Recorded before it is classified, and never deleted — see the note in this migration.';
comment on column support_inbound_emails.message_id is
  'The provider Message-ID. Unique so a webhook retry records the message once rather than filling the triage queue with copies.';
comment on column support_inbound_emails.status is
  'new = untriaged, linked = appended to a thread by reference, ticketed = a human opened one, ignored = a human read it and it was not support.';

-- The triage queue, which is the only read that happens often.
create index support_inbound_emails_queue_idx
  on support_inbound_emails (received_at desc)
  where status = 'new';

create index support_inbound_emails_recent_idx
  on support_inbound_emails (received_at desc);
create index support_inbound_emails_ticket_idx
  on support_inbound_emails (ticket_id, received_at);

-- WHY 'ignored' AND NOT A DELETE. "We never got your email" is a claim somebody
-- will make, and the only way to answer it is to still hold the message. Ignoring
-- is a judgement one member of staff made on one afternoon; deleting would make
-- that judgement unreviewable. Nothing in the console deletes a row here.

alter table support_inbound_emails enable row level security;
revoke all on support_inbound_emails from anon, authenticated;

-- No policies, on purpose. Reaching this table means going through
-- lib/support/inbound.ts on the service client, behind `currentStaff()`. A
-- customer has no business reading a mailbox, not even their own mail in it —
-- their copy of that conversation is the thread, which they already have.
