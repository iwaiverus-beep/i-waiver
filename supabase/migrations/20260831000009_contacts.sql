-- People you lend to.
--
-- A convenience list, nothing more. Most P2P lending is to the same handful of
-- friends, and retyping a phone number every time is the kind of friction that
-- makes someone go back to a handshake.
--
-- DELIBERATELY NOT JOINED TO THE AGREEMENT GRAPH. There is no contact_id on
-- `signers` and there must never be one. When an agreement is created from a
-- contact, the name and address are COPIED onto the signer row — rule 2,
-- snapshot don't reference. If a foreign key existed instead, correcting a
-- typo in a contact two years from now would silently rewrite who a signed
-- agreement says was party to it. The contact is an input to the form, not a
-- participant in the record.
--
-- The same reasoning is already why `assets` are snapshotted into
-- `agreements.asset_snapshot` at send time, and why `waitlist` is fenced off
-- from everything downstream of it.
--
-- Unlike the agreement graph, this table IS client-writable under RLS. It holds
-- no evidence: a contact list is the user's own address book, it proves nothing
-- about anything, and routing it through a server action would be ceremony
-- without a purpose. The policies below scope every row to its owner.

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references profiles (id) on delete cascade,
  display_name  text not null,
  email         text,
  phone         text,
  notes         text,
  -- Where the row came from. `device` means the browser's contact picker handed
  -- it over; worth knowing, because those arrive unverified and often partial.
  source        text not null default 'manual'
                  check (source in ('manual', 'device', 'agreement')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  archived_at   timestamptz,
  constraint contact_is_reachable check (email is not null or phone is not null)
);

comment on table contacts is
  'The lender''s own address book. Never referenced by signers — contact details are copied onto a signer at creation so that editing a contact cannot alter a signed agreement.';
comment on column contacts.last_used_at is
  'Touched when an agreement is created from this contact, so the picker can put the people you actually lend to at the top.';

-- Never hard-delete from the UI: archiving keeps the row addressable if someone
-- wonders later where a signer's details came from.
create index contacts_owner_idx on contacts (owner_user_id, display_name)
  where archived_at is null;

create index contacts_recent_idx on contacts (owner_user_id, last_used_at desc nulls last)
  where archived_at is null;

-- One entry per address per owner. A second "Marcus" with the same email is a
-- mistake, not a second person.
create unique index contacts_owner_email_key
  on contacts (owner_user_id, lower(email))
  where email is not null and archived_at is null;

alter table contacts enable row level security;

create policy contacts_owner_all on contacts
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
