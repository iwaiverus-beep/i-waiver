-- Marketing waitlist for the public site.
--
-- Deliberately outside the agreement graph: this is a marketing list, not
-- evidence, and it must never acquire a foreign key into agreements, signers or
-- anything downstream of them. Someone asking to be told when their state opens
-- is not a party to anything.
--
-- Consistent with the rest of the schema, writes go through a server-side route
-- handler using the service role. RLS is enabled with no policies, so anon and
-- authenticated are denied outright.

create table waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  full_name   text,
  party_type  text not null default 'individual'
                check (party_type in ('individual', 'business')),
  state       jurisdiction_code,
  source      text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

comment on table waitlist is
  'Public site early-access signups. Marketing data only — never joined to the agreement graph.';
comment on column waitlist.state is
  'State of intended activity, self-reported. Drives launch sequencing, nothing else.';

-- One signup per address; a repeat submission updates nothing and errors
-- cleanly, which the route handler turns into a friendly response.
create unique index waitlist_email_key on waitlist (lower(email));

create index waitlist_state_idx on waitlist (state) where state is not null;

alter table waitlist enable row level security;

revoke all on waitlist from anon, authenticated;
