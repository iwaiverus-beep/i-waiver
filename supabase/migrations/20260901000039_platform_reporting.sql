-- What the admin console counts.
--
-- WHY VIEWS RATHER THAN QUERIES IN TYPESCRIPT. A dashboard built by pulling rows
-- through PostgREST and adding them up in Node is a dashboard that is correct
-- until the day there are more rows than one page — and then it is quietly and
-- confidently wrong, because `.select()` truncates rather than failing. Counting
-- belongs where the rows are.
--
-- THE BOUNDARY IS PRESERVED IN THE SHAPE OF THIS FILE. CLAUDE.md constraint 9
-- says the coverage domain is a separate bounded context and the agreements side
-- learns what cover exists from its own audit events, not by querying `quotes`.
-- So there is no view here that joins an agreement to a quote. There are two
-- independent reports:
--
--   * `platform_lender_report`, `platform_borrower_report`,
--     `platform_agreement_stats` read only the agreement graph.
--   * `platform_coverage_stats` reads only the coverage tables.
--
-- The admin dashboard puts the two sets of numbers on one screen. That is a human
-- reading two reports side by side, which is allowed and always was; a join
-- between them in SQL would be the boundary quietly ceasing to exist.
--
-- LIVE ONLY, EVERYWHERE IT MATTERS. Every coverage figure filters
-- `environment = 'live'`. Sandbox quotes exist so partners can build against us
-- before a filing lands (20260901000013); counting them as business would make
-- every insurance number on the dashboard fiction, and the person reading it has
-- no way to tell.
--
-- SECURITY. These are plain views, so they run with the owner's rights and see
-- past RLS. That is the same trade every staff table already makes, and it is
-- handled the same way: revoked from anon and authenticated outright, read only
-- by the service client, which does its own authorisation in
-- lib/platform/access.ts.

-- ---------------------------------------------------------------------------
-- Lenders
-- ---------------------------------------------------------------------------

-- One row per originator, which is the definition of a lender in this schema:
-- the party that creates agreements, an individual or an organization, never
-- both. Not one row per profile — a person who is also on an organization's staff
-- would otherwise be counted twice and neither number would be the truth.
create view platform_lender_report as
select
  o.id                                            as originator_id,
  o.kind                                          as lender_kind,
  o.channel::text                                 as channel,
  o.created_at,
  coalesce(org.legal_name, p.full_name, 'Unnamed') as display_name,
  org.dba                                         as trading_name,
  coalesce(org.primary_state, p.home_state)::text as home_state,
  org.plan_tier::text                             as plan_tier,
  o.managed_by_partner_id,
  pa.name                                         as managed_by_partner_name,
  o.partner_external_ref,
  -- The email is deliberately taken from the most recent agreement this lender
  -- put their name to, not from the account. `profiles` has no email column —
  -- the address lives in auth.users, which PostgREST does not expose — and the
  -- lender `signers` row is where the contact details for this relationship were
  -- actually recorded anyway.
  latest.email                                    as contact_email,
  latest.phone                                    as contact_phone,
  stats.agreements_total,
  stats.agreements_executed,
  stats.agreements_voided,
  stats.agreements_open,
  stats.distinct_borrowers,
  stats.first_agreement_at,
  stats.last_agreement_at,
  (select count(*) from assets a
     where a.owner_originator_id = o.id and a.archived_at is null) as assets_active
from originators o
left join profiles p       on p.id = o.user_id
left join organizations org on org.id = o.org_id
left join partners pa       on pa.id = o.managed_by_partner_id
left join lateral (
  select
    count(*)                                                   as agreements_total,
    count(*) filter (where ag.status = 'executed')              as agreements_executed,
    count(*) filter (where ag.status = 'voided')                as agreements_voided,
    count(*) filter (where ag.status in ('sent', 'partially_signed')) as agreements_open,
    count(distinct lower(s.email))                              as distinct_borrowers,
    min(ag.created_at)                                          as first_agreement_at,
    max(ag.created_at)                                          as last_agreement_at
  from agreements ag
  left join signers s
    on s.agreement_id = ag.id and s.role = 'borrower' and s.email is not null
  where ag.originator_id = o.id
) stats on true
left join lateral (
  select s.email, s.phone
  from agreements ag
  join signers s on s.agreement_id = ag.id and s.role = 'lender'
  where ag.originator_id = o.id
  order by ag.created_at desc
  limit 1
) latest on true;

comment on view platform_lender_report is
  'One row per lender (originator) for the admin console. Contact details come from the most recent lender signer row, because profiles carries no email.';

-- ---------------------------------------------------------------------------
-- Borrowers
-- ---------------------------------------------------------------------------

-- A borrower is not a user (CLAUDE.md constraint 1) and usually never becomes
-- one, so there is no table to count. The identity is the address they were sent
-- the link at, which is why this groups on lower(email) rather than on
-- signers.id: the same person borrowing a jet ski three times is one borrower and
-- three signer rows, and a report that says three has answered a different
-- question from the one asked.
--
-- Participants (20260901000022) are counted in their own column rather than
-- folded in. Somebody who got on the boat is not somebody who took custody of it,
-- and a single "borrowers" number covering both would overstate the customer base
-- on exactly the bookings that matter most.
create view platform_borrower_report as
select
  lower(s.email)                                            as email,
  max(s.display_name)                                       as display_name,
  max(s.phone)                                              as phone,
  count(*) filter (where s.role = 'borrower')               as as_borrower,
  count(*) filter (where s.role = 'participant')            as as_participant,
  count(*) filter (where s.signed_at is not null)           as signed,
  count(*) filter (where s.declined_at is not null)         as declined,
  count(*) filter (where s.user_id is not null) > 0         as has_account,
  count(distinct ag.originator_id)                          as lenders_used,
  array_agg(distinct ag.jurisdiction::text order by ag.jurisdiction::text) as states,
  min(s.created_at)                                         as first_seen_at,
  max(s.signed_at)                                          as last_signed_at
from signers s
join agreements ag on ag.id = s.agreement_id
where s.role in ('borrower', 'participant')
  and s.email is not null
group by lower(s.email);

comment on view platform_borrower_report is
  'One row per borrower, keyed on their email address rather than on a user account — a borrower signs from a tokenised link and may never register. Participants are counted separately from borrowers on purpose.';

-- ---------------------------------------------------------------------------
-- Headline counts — agreement side
-- ---------------------------------------------------------------------------

create view platform_agreement_stats as
select
  (select count(*) from originators)                                    as lenders,
  (select count(*) from originators where kind = 'individual')          as lenders_individual,
  (select count(*) from originators where kind = 'organization')        as lenders_organization,
  (select count(*) from originators where channel = 'partner')          as lenders_partner_managed,
  (select count(*) from platform_borrower_report)                       as borrowers,
  (select count(*) from platform_borrower_report where signed > 0)      as borrowers_signed,
  (select count(*) from agreements)                                     as agreements,
  (select count(*) from agreements where status = 'draft')              as agreements_draft,
  (select count(*) from agreements where status in ('sent', 'partially_signed')) as agreements_out,
  -- "Agreements signed" is `executed`, and only `executed`. An agreement one of
  -- two parties has signed is not a signed agreement, however much better the
  -- number would look.
  (select count(*) from agreements where status = 'executed')           as agreements_executed,
  (select count(*) from agreements where status = 'voided')             as agreements_voided,
  (select count(*) from agreements where status = 'expired')            as agreements_expired,
  (select count(*) from agreements where legal_hold_at is not null)     as agreements_on_hold,
  (select count(*) from signatures)                                     as signatures,
  (select count(*) from agreements where created_at > now() - interval '30 days') as agreements_30d,
  (select count(*) from agreements
     where status = 'executed' and executed_at > now() - interval '30 days')      as executed_30d,
  (select count(*) from assets where archived_at is null)               as assets_active,
  (select max(created_at) from agreements)                              as last_agreement_at;

comment on view platform_agreement_stats is
  'Single-row headline counts for the admin dashboard. Agreement graph only — nothing here reads a quote or a policy.';

-- ---------------------------------------------------------------------------
-- Headline counts — coverage side
-- ---------------------------------------------------------------------------

-- Live only. See the file header.
create view platform_coverage_stats as
select
  (select count(*) from quotes where environment = 'live')                        as quotes,
  (select count(*) from quotes where environment = 'live' and source = 'partner') as quotes_partner,
  (select coalesce(sum(premium_cents), 0) from quotes where environment = 'live') as quoted_premium_cents,
  (select count(*) from policies where environment = 'live')                      as policies,
  (select count(*) from policies where environment = 'live' and status = 'bound') as policies_bound,
  (select count(*) from policies where environment = 'live' and status = 'active') as policies_active,
  (select count(*) from policies where environment = 'live' and status = 'cancelled') as policies_cancelled,
  -- Bound premium is read off the quote each policy came from, because the quote
  -- is where the price was snapshotted. Re-deriving it from a rate today would
  -- answer what we would charge now, not what somebody paid.
  (select coalesce(sum(q.premium_cents), 0)
     from policies pol join quotes q on q.id = pol.quote_id
    where pol.environment = 'live' and pol.status in ('bound', 'active', 'expired')) as bound_premium_cents,
  (select coalesce(sum(premium_cents), 0) from payments
     where environment = 'live' and status = 'paid')                              as collected_premium_cents,
  (select coalesce(sum(platform_fee_cents), 0) from payments
     where environment = 'live' and status = 'paid')                              as collected_fee_cents,
  (select count(*) from payments where environment = 'live' and status = 'paid')  as payments_paid,
  (select count(*) from payments where environment = 'live' and status = 'refunded') as payments_refunded,
  (select count(*) from coverage_contexts where environment = 'live')             as coverage_contexts,
  (select count(*) from quotes where environment = 'sandbox')                     as sandbox_quotes,
  (select max(quoted_at) from quotes where environment = 'live')                  as last_quote_at;

comment on view platform_coverage_stats is
  'Single-row insurance figures for the admin dashboard, live environment only. Coverage tables only — no join back into the agreement graph.';

-- Per product, so "insurance purchase stats" can say what people actually bought
-- rather than only how much of it there was. `quotes.product_code` is a snapshot
-- and carries no foreign key (20260901000018), so this joins on the code to
-- recover the display name and is honest about a product that has since been
-- withdrawn: the code still appears, with a null name.
create view platform_coverage_by_product as
select
  q.product_code,
  q.coverage_kind::text                                    as coverage_kind,
  cp.display_name,
  c.name                                                   as carrier_name,
  count(*)                                                 as quotes,
  count(pol.id)                                            as policies,
  coalesce(sum(q.premium_cents), 0)                        as quoted_premium_cents,
  coalesce(sum(q.premium_cents) filter (where pol.id is not null), 0) as bound_premium_cents
from quotes q
left join policies pol
  on pol.quote_id = q.id and pol.status in ('bound', 'active', 'expired')
left join carrier_products cp on cp.product_code = q.product_code
left join carriers c on c.id = cp.carrier_id
where q.environment = 'live'
group by q.product_code, q.coverage_kind, cp.display_name, c.name;

comment on view platform_coverage_by_product is
  'Live quotes and binds per product. Joined on product_code rather than an id because quotes.product_code is a snapshot and must not become a reference.';

-- ---------------------------------------------------------------------------
-- Nothing here is readable from a browser
-- ---------------------------------------------------------------------------

revoke all on platform_lender_report      from anon, authenticated;
revoke all on platform_borrower_report    from anon, authenticated;
revoke all on platform_agreement_stats    from anon, authenticated;
revoke all on platform_coverage_stats     from anon, authenticated;
revoke all on platform_coverage_by_product from anon, authenticated;
