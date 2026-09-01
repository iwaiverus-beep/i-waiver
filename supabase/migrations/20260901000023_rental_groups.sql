-- The booking: one thing, several households.
--
-- `agreement_assets` (20260901000011) solved many things for one person — lend the
-- ski, the trailer and two life jackets on one release with a schedule attached.
-- This is the mirror image, and it does NOT get solved the same way. A schedule of
-- chattels can live on one instrument because a bailment of several things to one
-- person is one bailment. A release by twelve people is twelve releases, because a
-- release is personal to the releasor and no adult can give one on another adult's
-- behalf.
--
-- So the group sits ABOVE the agreement graph and changes nothing inside it:
--
--   rental_groups
--     |- 1 agreement, group_role = 'rental'        the loan. Custody, damage,
--     |                                            deposit. Exactly today's
--     |                                            agreement, unchanged.
--     |- N agreements, group_role = 'participant'  one release per other adult
--                                                  aboard, same lender, same
--                                                  schedule, same window.
--
-- Every constraint survives intact: two parties per document, one borrower per
-- agreement, its own snapshot, its own hash, its own signature, its own evidence
-- chain, its own coverage quote. Voiding one takes only that one. This is
-- provenance and grouping, in the same sense that `managed_by_partner_id`
-- (20260901000019) recorded who arranged an agreement without inventing a third
-- kind of party.

-- ---------------------------------------------------------------------------
-- instrument_kind — the fourth axis of template selection
-- ---------------------------------------------------------------------------
--
-- Alongside jurisdiction, activity_class and originator_kind (20260901000016).
-- Same argument as that one: a release given by somebody who took the boat and a
-- release given by somebody who rode on it are different instruments, not the same
-- one with a different name in the blank. The renter's document says who is
-- responsible for returning it in good order; put that to a passenger and it says
-- something untrue about them.
--
-- And, as there, NO fallback. A participant with no participant wording published
-- gets a refusal, never the renter's document with their name in it.

create type instrument_kind as enum ('rental', 'participant');

comment on type instrument_kind is
  'Which instrument a template version is, and which structural part an agreement plays in a booking. rental = the loan itself, with custody and damage. participant = a release by somebody who takes part but never takes the thing.';

-- --- On clauses -------------------------------------------------------------
--
-- Nullable, and the null is load-bearing: it means "either side". The ESIGN
-- consent is genuinely one instrument — it is about signing electronically, not
-- about who is on the boat — and duplicating it per audience would mean two
-- copies of the same disclosure drifting apart.
--
-- Which also fixes a footgun this table has carried since 20260830000006. Nothing
-- ever guaranteed (kind, jurisdiction) was unique, but every lookup written
-- against it assumed so. Adding a second Florida release makes that assumption
-- false, so it becomes an enforced constraint on the way past rather than a bug
-- somebody finds when a passenger is served the renter's release.

alter table clauses add column instrument_kind instrument_kind;

update clauses set instrument_kind = 'rental' where kind <> 'esign_consent';

comment on column clauses.instrument_kind is
  'Which instrument this clause belongs to. Null means either — the ESIGN consent is the same disclosure whoever is signing. Deliberately no default: whoever adds a clause says who it is for.';

-- Two partial indexes rather than one over `coalesce(instrument_kind, ...)`. An
-- enum-to-text cast is STABLE, not IMMUTABLE, so Postgres will not index an
-- expression containing one — and `nulls not distinct` is version-dependent.
-- These two say exactly the same thing without depending on either: one clause
-- per instrument, and at most one shared clause of a kind.
create unique index clauses_instrument_key
  on clauses (kind, jurisdiction, instrument_kind)
  where instrument_kind is not null;

create unique index clauses_shared_instrument_key
  on clauses (kind, jurisdiction)
  where instrument_kind is null;

-- --- On template versions ---------------------------------------------------

alter table template_versions add column instrument_kind instrument_kind;

-- Every template version that exists is the loan itself. The only one seeded
-- describes itself as a loan "for a fixed period", and its clause set includes the
-- damage-responsibility instrument, which only a bailee can be given.
update template_versions set instrument_kind = 'rental' where instrument_kind is null;

alter table template_versions alter column instrument_kind set not null;

-- No default, for the reason 20260901000016 gave about originator_kind: a default
-- would quietly mislabel the first participant template somebody forgets to tag,
-- and mislabelling it means handing a passenger a document about returning a boat
-- they never had.

comment on column template_versions.instrument_kind is
  'The fourth axis of template selection, alongside jurisdiction, activity_class and originator_kind. There is deliberately no fallback between rental and participant.';

drop index if exists template_versions_lookup_idx;

create index template_versions_lookup_idx
  on template_versions (jurisdiction, activity_class, originator_kind, instrument_kind)
  where published_at is not null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- rental_groups — the booking
-- ---------------------------------------------------------------------------
--
-- Deliberately thin. It holds no facts about the boat, the window or the state,
-- because every one of those is already snapshotted onto each agreement in the
-- group and a second copy here would be a second answer. What it holds is a name
-- somebody at a counter can recognise, and the fact that these releases belong to
-- one afternoon.
--
-- Not an evidence table. Deleting the group would destroy nothing a claim needs:
-- each agreement stands on its own, which is why `agreements.group_id` is
-- `on delete restrict` rather than cascade. The grouping can go; the releases
-- cannot.

create table rental_groups (
  id             uuid primary key default gen_random_uuid(),
  originator_id  uuid not null references originators (id) on delete cascade,

  -- "The Millers, Chens and Ruiz - Saturday charter". What the person on the dock
  -- calls it. Never rendered into a document.
  label          text not null check (length(btrim(label)) > 0),

  -- Set when the lender says everybody who is coming has been added. Closing stops
  -- the join link and is reversible; it is a state of the booking, not of any
  -- agreement in it.
  closed_at      timestamptz,

  created_at     timestamptz not null default now()
);

comment on table rental_groups is
  'One booking of one thing by several households. Holds no facts about the loan — those are snapshotted onto each agreement. Not evidence: the grouping is disposable, the releases inside it are not.';

create index rental_groups_owner_idx
  on rental_groups (originator_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The agreement's part in it
-- ---------------------------------------------------------------------------

alter table agreements
  add column group_id   uuid references rental_groups (id) on delete restrict,
  add column group_role instrument_kind;

alter table agreements
  add constraint agreement_group_role_paired
    check ((group_id is null) = (group_role is null));

comment on column agreements.group_id is
  'The booking this agreement belongs to, when it is part of one. Null for an ordinary two-party loan, which is most of them. on delete restrict: the grouping is disposable, the agreements inside it never are.';

comment on column agreements.group_role is
  'Which structural part this agreement plays in the booking. The template version is still the authority on what wording it carries; this is the authority on what it is FOR, and lib/agreements/groups.ts is the only thing that writes either.';

create index agreements_group_idx
  on agreements (group_id, created_at)
  where group_id is not null;

-- Exactly one loan per booking. Several people may ride, but only one of them
-- took the boat, and only that one owes for the hull.
create unique index agreements_group_rental_key
  on agreements (group_id)
  where group_role = 'rental';

-- ---------------------------------------------------------------------------
-- group_links — the check-in code at the dock
-- ---------------------------------------------------------------------------
--
-- A shop is not going to type twelve email addresses while a boat waits. One code
-- goes up on the counter, each adult taps it, and each signs their own release.
--
-- THIS IS A THIRD KIND OF LINK AND IT IS WORTH BEING EXACT ABOUT WHY.
--
--   signing_links  a capability. Carries the right to bind a named person to an
--                  instrument. Hashed at rest, single use, hours.
--   intake_links   no capability at all. Printed on a counter card, outlives many
--                  borrowers, and the worst a stranger does with it is join a
--                  queue — which is why 20260901000017 insists a scan creates a
--                  request and never an agreement.
--   group_links    in between, and it creates an agreement, which the intake
--                  decision refused to allow. So the difference has to carry the
--                  weight.
--
-- It carries it like this: a scanner of a group link chooses NOTHING. Not the
-- lender, not the boat, not the dates, not the state, not the wording. All of that
-- is fixed by the booking before the code exists. The only thing they can add is
-- themselves, to a booking they are physically standing next to, and the only
-- document that can result is a release of the lender by the person who typed
-- their own name into it. The intake decision guards against a stranger with a
-- photograph of a poster minting instruments in someone else's name; there is no
-- version of that available here.
--
-- The rest is belt and braces, and all of it enforced rather than assumed: the
-- code is minted by a signed-in lender for one booking, it expires, it is capped,
-- and it can be revoked.

create table group_links (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references rental_groups (id) on delete cascade,

  -- In the clear, like intake_links and unlike signing_links: it is displayed as a
  -- QR code on a counter, and it confers nothing on its own.
  slug        text not null unique check (slug ~ '^[a-z0-9]{10,32}$'),

  -- Hours, not weeks. A booking is an afternoon.
  expires_at  timestamptz not null,

  -- A boat has a capacity and so does this. Without a cap, a code left on a
  -- counter overnight is an open invitation to fill somebody's booking with
  -- strangers.
  max_uses    int not null default 30 check (max_uses between 1 and 200),
  uses        int not null default 0 check (uses >= 0),

  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint group_link_within_cap check (uses <= max_uses)
);

comment on table group_links is
  'The check-in code for one booking. Creates a participant agreement, which an intake link may never do — safe only because the scanner chooses nothing except their own name: lender, thing, window, state and wording are all fixed by the booking before the code exists.';

comment on column group_links.uses is
  'Incremented in the same statement that claims the link, so the cap cannot be raced past. Never decremented — a claimed use is a release that exists.';

create index group_links_group_idx
  on group_links (group_id, created_at desc)
  where revoked_at is null;

-- Claiming a use, atomically.
--
-- One UPDATE carrying every condition. Read-then-write in the application would
-- let two people tapping the code at the same moment both take the last slot,
-- which is the one moment the cap is supposed to mean something — a boat is full
-- exactly when several people are checking in at once.
--
-- Returns the booking on success and nothing at all on failure. WHY it failed is
-- worked out afterwards by reading the row, because the caller has somebody
-- standing in front of them who needs to be told which of "expired", "full" and
-- "no longer in use" happened.

create or replace function public.claim_group_link_use(p_slug text, p_now timestamptz)
returns table (group_id uuid)
language sql
security definer
set search_path = public
as $$
  update group_links l
     set uses = l.uses + 1
   where l.slug = p_slug
     and l.revoked_at is null
     and l.expires_at > p_now
     and l.uses < l.max_uses
     and exists (
       select 1 from rental_groups g
        where g.id = l.group_id and g.closed_at is null
     )
  returning l.group_id;
$$;

comment on function public.claim_group_link_use is
  'Takes one use of a dock code, or returns nothing. A single statement so the cap cannot be raced past. Returns only the booking id — never why it refused, which the caller reads separately.';

-- Callable by nobody through PostgREST. The join route runs on the service client
-- like every other write to the agreement graph, and a security definer function
-- that increments a counter is not something anon should be able to call directly.
revoke all on function public.claim_group_link_use(text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Same posture as 20260901000017. The lender reads their own bookings; nobody
-- writes through RLS. The participant's insert arrives unauthenticated at a route
-- handler which resolves the slug and writes on the service client, exactly as the
-- signing routes do — so `anon` gets nothing here at all.
--
-- group_links is revoked outright, from both roles. It is closer to a capability
-- than to a poster, and a lender reads their own codes through the server like
-- everything else on the booking screen.

alter table rental_groups enable row level security;
alter table group_links enable row level security;

revoke all on rental_groups from anon, authenticated;
revoke all on group_links   from anon, authenticated;

grant select on rental_groups to authenticated;

create policy rental_groups_select_own on rental_groups
  for select to authenticated
  using (originator_id in (select public.user_originator_ids()));
