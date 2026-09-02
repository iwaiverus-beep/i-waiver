-- Trends, for the half of a dashboard that a single number cannot answer.
--
-- 20260901000039 gave the console its counts. A count says where things stand
-- and nothing about which way they are moving, which is the question anybody
-- actually opens a dashboard to ask. These are the same figures over time.
--
-- WHY A DENSE SERIES. Every view here starts from generate_series and left joins
-- the data onto it, so a day on which nothing happened is a row with a zero
-- rather than a missing row. A sparse series drawn as a line silently joins last
-- Tuesday to this Friday and reports a smooth climb across a week when nothing
-- happened at all -- and the flat stretches are exactly what somebody watching a
-- launch needs to see.
--
-- WHICH DAY A THING LANDS ON. `::date` in the database's own zone, which is UTC.
-- Deliberately not the agreement's `time_zone`: that column says which clock the
-- LOAN is written in, an honest and load-bearing fact about the document
-- (20260901000020), and it is the wrong axis for a company-wide chart -- bucketing
-- by it would put two agreements created in the same minute on different days
-- because the jet skis were in different states. One zone for the whole chart,
-- stated here rather than assumed.
--
-- NINETY DAYS. Long enough to see a trend, short enough that a dense daily series
-- is cheap. The window is in the view rather than the query so that every caller
-- gets the same one and no screen can quietly widen it.
--
-- SECURITY. Same as the reporting views: plain views running with the owner's
-- rights, revoked from anon and authenticated, read only by the service client
-- behind lib/platform/access.ts.

-- ---------------------------------------------------------------------------
-- Agreement side
-- ---------------------------------------------------------------------------

create view platform_agreement_daily as
with days as (
  select generate_series(
    current_date - interval '89 days',
    current_date,
    interval '1 day'
  )::date as day
)
select
  d.day,
  coalesce(c.n, 0) as created,
  coalesce(s.n, 0) as sent,
  -- Executed, meaning both parties signed. The same definition the headline
  -- count uses, so the chart and the number above it cannot disagree.
  coalesce(e.n, 0) as executed,
  coalesce(v.n, 0) as voided
from days d
left join (
  select created_at::date as day, count(*) as n from agreements group by 1
) c on c.day = d.day
left join (
  select sent_at::date as day, count(*) as n
    from agreements where sent_at is not null group by 1
) s on s.day = d.day
left join (
  select executed_at::date as day, count(*) as n
    from agreements where executed_at is not null group by 1
) e on e.day = d.day
left join (
  select voided_at::date as day, count(*) as n
    from agreements where voided_at is not null group by 1
) v on v.day = d.day;

comment on view platform_agreement_daily is
  'Agreements created, sent, executed and voided per day for the last 90 days, in UTC, with zero rows for the quiet days. An agreement appears in more than one column: the same one created on Monday and signed on Wednesday is counted in both, because these are events and not a state machine snapshot.';

-- New lenders per day. `originators`, not `profiles`: signing up is not the same
-- act as becoming a party that creates agreements, and the originator row is
-- written lazily at the moment somebody actually lends something.
create view platform_lender_daily as
with days as (
  select generate_series(
    current_date - interval '89 days',
    current_date,
    interval '1 day'
  )::date as day
)
select
  d.day,
  coalesce(o.total, 0)        as lenders,
  coalesce(o.individual, 0)   as lenders_individual,
  coalesce(o.organization, 0) as lenders_organization
from days d
left join (
  select
    created_at::date as day,
    count(*)                                      as total,
    count(*) filter (where kind = 'individual')   as individual,
    count(*) filter (where kind = 'organization') as organization
  from originators
  group by 1
) o on o.day = d.day;

comment on view platform_lender_daily is
  'First-time lenders per day for the last 90 days. Counted from originators rather than profiles, because an account that has never lent anything is not yet a lender.';

-- ---------------------------------------------------------------------------
-- Coverage side
-- ---------------------------------------------------------------------------
--
-- Live only, like every other coverage figure. See 20260901000039's header: a
-- sandbox quote exists so a partner can build against us before a filing lands,
-- and drawing it on the same chart as real business would make the line fiction.

create view platform_coverage_daily as
with days as (
  select generate_series(
    current_date - interval '89 days',
    current_date,
    interval '1 day'
  )::date as day
)
select
  d.day,
  coalesce(q.n, 0)       as quotes,
  coalesce(q.premium, 0) as quoted_premium_cents,
  coalesce(p.n, 0)       as policies,
  coalesce(p.premium, 0) as bound_premium_cents,
  coalesce(pay.n, 0)     as payments_paid,
  coalesce(pay.premium, 0) as collected_premium_cents,
  coalesce(pay.fee, 0)   as collected_fee_cents
from days d
left join (
  select quoted_at::date as day, count(*) as n, sum(premium_cents) as premium
    from quotes where environment = 'live' group by 1
) q on q.day = d.day
left join (
  -- Dated by when the policy was created, and priced from the quote it came
  -- from. Re-deriving the premium from today's rate would answer what we would
  -- charge now rather than what somebody actually paid.
  select pol.created_at::date as day, count(*) as n, sum(qt.premium_cents) as premium
    from policies pol
    join quotes qt on qt.id = pol.quote_id
   where pol.environment = 'live'
   group by 1
) p on p.day = d.day
left join (
  select paid_at::date as day,
         count(*) as n,
         sum(premium_cents) as premium,
         sum(platform_fee_cents) as fee
    from payments
   where environment = 'live' and status = 'paid' and paid_at is not null
   group by 1
) pay on pay.day = d.day;

comment on view platform_coverage_daily is
  'Live quotes, binds and collections per day for the last 90 days. Bound premium is read off the originating quote, which is where the price was snapshotted.';

-- ---------------------------------------------------------------------------
-- Where the business is
-- ---------------------------------------------------------------------------

-- Volume by the two axes the product is actually opened along. Sits next to the
-- readiness matrix on the config screen for the obvious reason: the combinations
-- with the most demand and the least readiness are the roadmap.
create view platform_agreement_by_state_activity as
select
  a.jurisdiction::text                                   as state,
  a.activity_class,
  count(*)                                               as agreements,
  count(*) filter (where a.status = 'executed')          as executed,
  count(*) filter (where a.status = 'voided')            as voided,
  count(*) filter (where a.status in ('sent', 'partially_signed')) as open,
  count(distinct a.originator_id)                        as lenders,
  count(*) filter (where a.cover_requested)              as cover_requested,
  min(a.created_at)                                      as first_at,
  max(a.created_at)                                      as last_at
from agreements a
group by a.jurisdiction, a.activity_class;

comment on view platform_agreement_by_state_activity is
  'Agreement volume per state and activity. `cover_requested` is the lender asking for cover on the agreement side, not a bound policy -- the two live in different bounded contexts and are never joined here.';

-- What a borrower did with the link they were sent. The last step of the funnel
-- and the one nothing else measures: an agreement stuck at `sent` is a borrower
-- who did not sign, and knowing whether that is normal needs the rate.
create view platform_signing_funnel as
select
  count(*)                                                as links_issued,
  count(*) filter (where s.signed_at is not null)         as signed,
  count(*) filter (where s.declined_at is not null)       as declined,
  count(*) filter (where s.signed_at is null and s.declined_at is null) as outstanding,
  count(*) filter (where s.role = 'borrower')             as borrower_links,
  count(*) filter (where s.role = 'participant')          as participant_links,
  -- Median is the honest average here. One borrower who signed three weeks late
  -- drags a mean into uselessness, and the question is what a typical borrower
  -- does.
  percentile_cont(0.5) within group (
    order by extract(epoch from (s.signed_at - a.sent_at))
  ) filter (where s.signed_at is not null and a.sent_at is not null) as median_seconds_to_sign
from signers s
join agreements a on a.id = s.agreement_id
where s.role in ('borrower', 'participant')
  and a.sent_at is not null;

comment on view platform_signing_funnel is
  'What happened to the signing links that were actually sent. Drafts are excluded on purpose -- an agreement nobody sent has not failed to be signed.';

-- ---------------------------------------------------------------------------
-- Nothing here is readable from a browser
-- ---------------------------------------------------------------------------

revoke all on platform_agreement_daily            from anon, authenticated;
revoke all on platform_lender_daily               from anon, authenticated;
revoke all on platform_coverage_daily             from anon, authenticated;
revoke all on platform_agreement_by_state_activity from anon, authenticated;
revoke all on platform_signing_funnel             from anon, authenticated;
