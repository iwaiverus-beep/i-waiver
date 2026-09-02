-- The people we want to partner with, before they are partners.
--
-- WHY THIS TABLE EXISTS RATHER THAN A ROW IN `partners`. `approveApplication` in
-- lib/partners/applications.ts is the only place a `partners` row is created, and
-- that is load-bearing: every partner therefore has a unique slug, an owner who
-- can actually sign in, and an onboarding record that starts at step one. A
-- company we have never spoken to has none of those things. Writing Smartwaiver
-- into `partners` would mean inventing an owner for an account nobody asked for,
-- and it would put a company that said yes and a company that has not heard of us
-- in the same list under the same word.
--
-- So: a prospect is a target, not an account. It holds no key, has no members, and
-- nothing in the coverage or agreement path may read it. The moment they actually
-- apply, `application_id` links the two and the normal pipeline takes over; the
-- prospect row stays as the record of how the conversation started.
--
-- WHY CARRIERS ARE NOT IN HERE. `carriers.status` already has `prospect`, and a
-- carrier is the other direction entirely (CLAUDE.md constraint 11) — we call
-- them. Allianz and Lockton are seeded at the bottom of this file as carrier rows
-- in `prospect` status, not as partner prospects. Two pipelines, because they are
-- two relationships.

-- ---------------------------------------------------------------------------
-- Where a conversation has got to
-- ---------------------------------------------------------------------------

-- Deliberately short. A longer funnel invites the console to become a CRM, and
-- the question this list has to answer is only "who have we approached, and did
-- they answer".
create type prospect_status as enum
  ('identified', 'contacted', 'in_conversation', 'applied', 'won', 'lost');

comment on type prospect_status is
  'identified: on the list, nobody has written to them. contacted: we reached out. in_conversation: they answered. applied: they filled in the public form, and application_id says which. won: they became a partner. lost: they said no, and lost_reason says why.';

create table partner_prospects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  website       text,
  -- The same vocabulary the public application form uses, so a prospect that
  -- applies does not change category on the way in.
  kind          partner_kind not null default 'waiver_platform',
  status        prospect_status not null default 'identified',
  contact_name  text,
  contact_email text,
  contact_phone text,
  -- Who at i-Waiver is carrying it. Nullable: an unowned name on a list is an
  -- honest state, and pretending otherwise just makes the column a lie.
  owner_staff_id uuid references profiles (id) on delete set null,
  notes         text,
  lost_reason   text,

  -- Provenance once they enter the real pipeline. Both nullable, and neither is
  -- ever read to make a decision — the application and the partner are the
  -- authority on their own state.
  application_id uuid references partner_applications (id) on delete set null,
  partner_id     uuid references partners (id) on delete set null,

  created_at        timestamptz not null default now(),
  created_by        uuid references profiles (id) on delete set null,
  last_contacted_at timestamptz,
  updated_at        timestamptz not null default now(),

  -- A prospect that is `won` must say which partner it became, or the word means
  -- nothing. Same for `lost` and a reason: "lost" with no reason is the entry
  -- that six months later nobody can act on.
  constraint won_prospect_has_partner
    check (status <> 'won' or partner_id is not null),
  constraint lost_prospect_has_reason
    check (status <> 'lost' or lost_reason is not null)
);

comment on table partner_prospects is
  'Channel targets — waiver and booking platforms we want to supply. Not accounts: no key, no members, no onboarding. Nothing in lib/coverage/ or lib/agreements/ may read this table.';
comment on column partner_prospects.application_id is
  'Set when a prospect fills in the public form. Provenance only; the application row is the authority on its own status.';

create index partner_prospects_status_idx on partner_prospects (status, name);
create index partner_prospects_owner_idx on partner_prospects (owner_staff_id)
  where owner_staff_id is not null;

-- Same treatment as every other staff table: nothing is read from the browser.
-- The console assembles it server-side on the service client, which does its own
-- authorisation in lib/platform/access.ts.
alter table partner_prospects enable row level security;
revoke all on partner_prospects from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Carriers get a website too
-- ---------------------------------------------------------------------------

-- The first thing anyone does with a name on a target list is look it up. It was
-- already on `partners` and `partner_applications`; its absence here was an
-- oversight rather than a decision.
alter table carriers add column if not exists website text;

-- ---------------------------------------------------------------------------
-- The starting list
-- ---------------------------------------------------------------------------

-- Named by the founder. These are the incumbents in the market we are choosing
-- NOT to compete with — the strategic bet in docs/data-model.md is that the
-- durable business is supplying coverage to the platforms that already hold the
-- waiver relationship, rather than winning their customers one at a time.
--
-- Seeded as `identified`, which is the truth: nobody has written to any of them.
insert into partner_prospects (name, slug, website, kind, status, notes)
values
  ('Smartwaiver', 'smartwaiver', 'https://www.smartwaiver.com/',
   'waiver_platform', 'identified',
   'Largest of the incumbents. Digital waivers for rental, adventure and fitness operators.'),
  ('WaiverForever', 'waiverforever', 'https://www.waiverforever.com/',
   'waiver_platform', 'identified',
   'Kiosk and tablet led. Strong in small rental operators.'),
  ('CleverWaiver', 'cleverwaiver', 'https://www.cleverwaiver.com/',
   'waiver_platform', 'identified', null),
  ('WaiverFile', 'waiverfile', 'https://www.waiverfile.com/',
   'waiver_platform', 'identified', null),
  ('Roller', 'roller', 'https://www.roller.software/',
   'booking_platform', 'identified',
   'Full venue platform — ticketing, POS and waivers. The waiver is one module of several, so the integration surface is a booking flow rather than a waiver flow.'),
  ('VenueSumo', 'venuesumo', 'https://venuesumo.com/',
   'booking_platform', 'identified',
   'Booking and waiver management for venues.')
on conflict (slug) do nothing;

-- The two named insurance targets. Carrier rows, not partner rows — see the
-- header. Both `prospect`, and both with an adapter name that has NO registered
-- CarrierClient in lib/coverage/carrier.ts. That is deliberate belt and braces:
-- `prospect` already keeps them out of `available_carrier_products`, and if
-- somebody flips one to `active` before the integration is written, the coverage
-- service drops them from the quote rather than serving mock policy numbers under
-- a real insurer's name.
insert into carriers (name, slug, kind, status, website, adapter, notes)
values
  ('Allianz Travel Insurance', 'allianz-travel', 'carrier', 'prospect',
   'https://www.allianztravelinsurance.com/',
   'allianz',
   'Target carrier. Travel and event cancellation paper sold embedded at the point of booking, which is the closest existing analogue to selling cover at the point of signing. No integration written; the adapter name is reserved, not registered.'),
  ('Lockton Affinity', 'lockton-affinity', 'mga', 'prospect',
   'https://locktonaffinity.com/',
   'lockton',
   'Target programme manager. Builds affinity and embedded programmes on other carriers paper, so the route to admitted capacity may run through them rather than around them. No integration written; the adapter name is reserved, not registered.')
on conflict (slug) do nothing;
