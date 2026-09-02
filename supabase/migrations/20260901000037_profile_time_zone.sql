-- The clock the reader is standing in.
--
-- This is NOT the clock an agreement is written in, and the distinction is the
-- whole reason the column can exist safely. A loan window belongs to the state
-- where the activity happens — `agreements.time_zone` (20260901000020), derived
-- from the jurisdiction and overridable per agreement, because the jet ski is in
-- Florida whoever arranged the loan and the document has to say Florida time.
-- Nothing here changes that, and nothing may ever read this column to decide what
-- a document says. A lender who moves to Denver does not retroactively move a
-- Florida waiver into Mountain time.
--
-- What it is for: knowing what to compare that clock against. A lender in Kansas
-- City opening the lend form sees a window in EDT, an hour off their own watch,
-- and the honest thing to do is say so on the screen. Until now the only way to
-- guess where they were sitting was the browser's own zone, which is right most
-- of the time and wrong in exactly the cases that matter — a laptop still set to
-- the last trip, a machine whose clock nobody has touched since it was imaged, a
-- lender working from somewhere that is not home. This is them telling us
-- instead of us inferring, and null keeps the inference.
--
-- Stored as an IANA name rather than an offset, because an offset is only true
-- until the next daylight saving change. The constraint checks the SHAPE of a
-- zone name, not its existence: the tz database is revised several times a year
-- and a list pinned in a migration would start refusing names that became valid
-- after it was written. The application validates the name against Intl before it
-- ever gets here — `asIanaZone` in lib/format.ts — which asks the runtime's own
-- copy of that database rather than a copy of ours.

alter table profiles
  add column time_zone text;

alter table profiles
  add constraint profile_time_zone_is_iana_shaped
  check (
    time_zone is null
    or time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$'
  );

comment on column profiles.time_zone is
  'The account holder''s own clock, as an IANA name. Presentation only: it decides what the app compares an agreement''s window against when telling somebody how far off their own watch it is. NEVER read it to decide what a document says — that is agreements.time_zone, which comes from where the activity happens. Null means fall back to the browser''s zone.';
