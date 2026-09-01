-- A default for agreements.time_zone, so the column is safe to deploy behind.
--
-- 20260901000020 added it NOT NULL with no default. That is correct for the
-- code that sets it, and broken for the code already running: a migration is
-- applied before the deploy that uses it, and for that window the live
-- createDraftAgreement did not name the column at all. Every insert in the gap
-- would have failed a not-null violation — the whole point of the feature is
-- writing an agreement, so that is the product down, not degraded.
--
-- The same hole reopens on any rollback to a build older than this one.
--
-- Eastern is the value the old renderer produced for every state outside its
-- nine-state table, so a row that lands on the default is no worse off than it
-- would have been before any of this. It is a floor for a deploy window, not a
-- guess anybody should rely on: the application always sends the zone
-- explicitly, derived from the state of activity.

alter table agreements
  alter column time_zone set default 'America/New_York';

comment on column agreements.time_zone is
  'IANA zone the window was written in, defaulted from the state of activity and '
  'overridable for the twelve states that straddle a boundary. The renderer reads '
  'this rather than deriving one, so a panhandle loan can say CDT. The column '
  'default exists only to keep inserts working across a deploy window; the '
  'application always sets it.';
