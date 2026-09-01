-- The third kind of lender: one whose account a partner administers.
--
-- WHO IS ACTUALLY THE LENDER. When a waiver platform originates through us, the
-- lender is THEIR customer — Bayside Rentals — not the platform. The release runs
-- between Bayside and the participant; the platform is not a party to it, and
-- putting the platform's name on the document as the lender would be false on the
-- face of the instrument.
--
-- So this is NOT a third arm on `originators`. That table resolves to exactly one
-- of an individual or an organization and it stays that way, because those are
-- the two things a party can BE. What is new is PROVENANCE: who administers the
-- account. A partner-managed lender is an organization like any other; the
-- difference is that nobody at that organization has a login here, and the rows
-- arrive over the API keyed by the partner's own id for them.
--
--   individual          user_id set,  managed_by null
--   company             org_id set,   managed_by null
--   partner-integrated  org_id set,   managed_by set
--
-- WHY A PARTNER-MANAGED ORIGINATOR MUST BE AN ORGANIZATION. `originators.user_id`
-- references `profiles`, which references `auth.users`. A partner cannot create
-- an account for somebody else, and should not be able to — so the constraint
-- below says out loud what the foreign keys already imply, rather than leaving it
-- as something you discover from an error message.
--
-- WHAT DOES NOT CHANGE. The lender's name on the document has never come from
-- `originators`; it comes from the `signers` row with role 'lender'
-- (`display_name`), snapshotted like everything else. So the identity on a
-- partner-originated agreement is carried exactly where it already was, and the
-- renderer needs no branch for this at all.

create type originator_channel as enum ('direct', 'partner');

alter table originators
  add column managed_by_partner_id uuid references partners (id) on delete restrict,
  -- The partner's own id for this customer. Opaque to us, and the handle they use
  -- to address the lender again without storing our uuid.
  add column partner_external_ref  text;

alter table originators
  add column channel originator_channel generated always as (
    case when managed_by_partner_id is not null
         then 'partner'::originator_channel
         else 'direct'::originator_channel end
  ) stored;

comment on column originators.managed_by_partner_id is
  'Set when a partner platform administers this lender''s account. The partner is NOT the lender and is never a party to the agreement — see the header of this migration.';
comment on column originators.partner_external_ref is
  'The partner''s own identifier for their customer. Opaque to us; the unique index on it is what makes lender creation idempotent on their retries.';
comment on column originators.channel is
  'Derived. How the account got here, not what the party is. `kind` still says whether it is a person or a business.';

alter table originators
  add constraint external_ref_needs_a_partner
    check (partner_external_ref is null or managed_by_partner_id is not null),
  -- A partner cannot create an auth user, and must not be able to attach a lender
  -- account to somebody's personal profile.
  add constraint partner_managed_lender_is_an_organization
    check (managed_by_partner_id is null or org_id is not null);

-- Idempotency. A partner POSTing the same customer twice — a retry, a replayed
-- webhook, a double-click in their own admin — gets the same lender back rather
-- than a second one, and the database is what guarantees it.
create unique index originators_partner_ref_key
  on originators (managed_by_partner_id, partner_external_ref)
  where managed_by_partner_id is not null and partner_external_ref is not null;

create index originators_partner_idx
  on originators (managed_by_partner_id)
  where managed_by_partner_id is not null;

-- ---------------------------------------------------------------------------
-- Which APIs a key may call
-- ---------------------------------------------------------------------------
--
-- Until now a partner key opened one door, so no scope was needed. There are two
-- now, and they are very different powers: `coverage` prices and binds insurance
-- against a described risk, while `agreements` creates a legal instrument in
-- somebody else's name and puts it in front of a signer.
--
-- A platform that only embeds cover must not be able to do the second, so the
-- default is `coverage` alone — which is also exactly what every key issued
-- before this migration was able to do, so nothing gains a power it did not have.

create type api_scope as enum ('coverage', 'agreements');

alter table partner_integrations
  add column scopes api_scope[] not null default array['coverage']::api_scope[];

alter table partner_integrations
  add constraint integration_has_a_scope check (cardinality(scopes) > 0);

comment on column partner_integrations.scopes is
  'Which APIs this key opens. Defaults to coverage alone: creating agreements in a third party''s name is a larger power than pricing cover, and is granted deliberately.';

-- ---------------------------------------------------------------------------
-- The partner's reference for an agreement
-- ---------------------------------------------------------------------------

alter table agreements add column partner_external_ref text;

comment on column agreements.partner_external_ref is
  'The originating platform''s own id for this transaction. Written from what the caller sent and never read to make a decision — the same rule quotes.agreement_id follows in the other direction. It exists so a retry is idempotent and so a support conversation can start from the id the partner has in front of them.';

-- Scoped to the originator rather than the partner, which is the same thing one
-- join away: an originator belongs to exactly one partner. Keeping the index
-- local means no join is needed to enforce it.
create unique index agreements_partner_ref_key
  on agreements (originator_id, partner_external_ref)
  where partner_external_ref is not null;
