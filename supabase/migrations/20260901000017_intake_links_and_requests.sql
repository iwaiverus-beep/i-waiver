-- Borrower-initiated intake: static QR codes, and the queue they feed.
--
-- Until now origination ran one way. The lender created an agreement, and a
-- tokenised link carried it to a borrower who had no account. This adds the other
-- direction: a borrower walks up to a printed code, scans it, and asks.
--
-- THE DECISION EVERYTHING HERE RESTS ON: a scan creates a *request*, never an
-- agreement. Accepting a request creates an ordinary draft through the ordinary
-- path. Nothing about origination, signing, evidence or the compliance gate
-- changes, because the agreement graph is never touched by an unauthenticated
-- stranger — only this queue is. If a scan could create an agreement, anyone with
-- a photograph of a poster could mint legal instruments in somebody else's name.
--
-- Which is also why `agreement_requests` is deliberately NOT an evidence table.
-- It is disposable: it expires, it can be declined, and purging it destroys
-- nothing that a later claim would need. The evidence begins at the draft.

-- ---------------------------------------------------------------------------
-- intake_links — the QR code itself
-- ---------------------------------------------------------------------------
--
-- Static, by design, because it is printed on a counter card or a trailer decal
-- and cannot be reissued per visitor. That makes it the exact opposite of
-- `signing_links`, which are hashed, single-use and measured in hours — and the
-- reason the two are separate tables rather than one with a flag. A row here is
-- not a credential and confers nothing: it names a lender and, optionally, a
-- thing. `slug` is therefore stored in the clear, unlike `signing_links.token_hash`.
--
-- Revoked rather than deleted: a printed code outlives the decision to stop using
-- it, and a scan of a withdrawn code should say so rather than 404.

create table intake_links (
  id             uuid primary key default gen_random_uuid(),
  originator_id  uuid not null references originators (id) on delete cascade,

  -- Null means an originator-level code: "start something with this lender".
  -- Set means an asset-level code, and the borrower's side can be complete
  -- because every fact about the thing is already known.
  asset_id       uuid references assets (id) on delete restrict,

  slug           text not null unique check (slug ~ '^[a-z0-9]{10,32}$'),
  label          text,

  -- Both are the lender's to state, not the borrower's. Jurisdiction is where the
  -- activity happens, which for a fixed premises is a fact about the premises, and
  -- for a private lender is where they hand the thing over.
  activity_class text not null,
  jurisdiction   jurisdiction_code not null,

  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

comment on table intake_links is
  'A static, printable QR target. Not a credential: it names a lender and optionally an asset, and can never sign anything. Contrast signing_links, which are hashed, single-use and short-lived.';

comment on column intake_links.slug is
  'Public and stored in the clear, because it is printed in the world. Confers no access on its own — a scan can only add a row to agreement_requests.';

comment on column intake_links.asset_id is
  'Null for an originator-level code. Set for an asset-level one, which is what lets the borrower complete every detail: the specifics come from the lender''s own saved asset, never from the person scanning.';

-- No explicit unique index on `slug`: the inline `unique` in the column
-- definition above already creates one, and Postgres names it
-- `intake_links_slug_key` — the same name this line used to ask for, which made
-- the migration fail against any database on its own second statement.

create index intake_links_owner_idx
  on intake_links (originator_id, created_at desc)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- agreement_requests — the queue
-- ---------------------------------------------------------------------------

create type request_status as enum ('pending', 'accepted', 'declined', 'expired');

create table agreement_requests (
  id              uuid primary key default gen_random_uuid(),
  intake_link_id  uuid not null references intake_links (id) on delete restrict,

  -- Denormalised from the link so the lender's queue is one indexed read, and so
  -- a request survives its link being revoked. Both are set by the server from the
  -- resolved link, never from the request body.
  originator_id   uuid not null references originators (id) on delete cascade,
  asset_id        uuid references assets (id) on delete restrict,

  -- What the borrower actually typed. Held here and nowhere else until the lender
  -- accepts: an unverified stranger's assertion is not yet a signer.
  borrower_name   text not null,
  borrower_email  text,
  borrower_phone  text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  note            text,

  status          request_status not null default 'pending',
  agreement_id    uuid references agreements (id) on delete set null,

  -- A pending request is an offer to do business, not a standing obligation. It
  -- ages out so a queue left alone for a month is not a list of strangers who have
  -- long since gone home.
  expires_at      timestamptz not null default now() + interval '14 days',
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,

  -- Kept for abuse triage only. A printed code is scannable by anyone who walks
  -- past it, so the queue needs a way to see a flood for what it is. Not evidence,
  -- and purged with the row.
  submitted_ip    inet,
  submitted_agent text,

  constraint request_has_a_way_to_reach_them
    check (borrower_email is not null or borrower_phone is not null),

  constraint request_period_is_ordered
    check (starts_at is null or ends_at is null or ends_at > starts_at),

  constraint accepted_request_has_an_agreement
    check (status <> 'accepted' or agreement_id is not null)
);

comment on table agreement_requests is
  'A borrower''s inbound ask, created by an unauthenticated scan. Deliberately not an evidence table: disposable, expiring, and destroyed on purge without losing anything a claim would need. Evidence begins at the draft this becomes.';

comment on column agreement_requests.status is
  'pending until the lender acts. accepted sets agreement_id, and from that point the ordinary draft is the record.';

-- The queue read: this lender's live requests, newest first. Partial, because a
-- decided request is history and never appears in the queue again.
create index agreement_requests_queue_idx
  on agreement_requests (originator_id, created_at desc)
  where status = 'pending';

create index agreement_requests_link_idx
  on agreement_requests (intake_link_id, created_at desc);

create index agreement_requests_agreement_idx
  on agreement_requests (agreement_id)
  where agreement_id is not null;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Both tables are lender-side reads only. The borrower's insert does NOT come
-- through RLS: it arrives unauthenticated at a route handler, which resolves the
-- slug and writes on the service client. So `anon` gets nothing at all here, and
-- there is no insert policy for anyone — same posture as signing_links.

alter table intake_links enable row level security;
alter table agreement_requests enable row level security;

revoke all on intake_links from anon, authenticated;
revoke all on agreement_requests from anon, authenticated;

grant select on intake_links to authenticated;
grant select on agreement_requests to authenticated;

create policy intake_links_select_own on intake_links
  for select to authenticated
  using (originator_id in (select public.user_originator_ids()));

create policy agreement_requests_select_own on agreement_requests
  for select to authenticated
  using (originator_id in (select public.user_originator_ids()));

-- ---------------------------------------------------------------------------
-- Ageing
-- ---------------------------------------------------------------------------
--
-- Called by the queue read rather than scheduled, so there is no cron to forget.
-- Cheap: the partial index above means it touches only live rows.

create or replace function public.expire_stale_requests()
returns void
language sql
security definer
set search_path = public
as $$
  update agreement_requests
  set status = 'expired', decided_at = now()
  where status = 'pending' and expires_at < now();
$$;

comment on function public.expire_stale_requests is
  'Ages out pending requests past expires_at. Called from the lender queue read so that no scheduled job is required.';
