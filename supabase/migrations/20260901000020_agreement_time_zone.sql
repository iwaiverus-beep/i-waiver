-- The clock a loan window is written in.
--
-- starts_at and ends_at are timestamptz and stay UTC. What was missing is the
-- zone the two of them were *meant* in. Until now the renderer derived one from
-- the jurisdiction through a nine-state lookup that returned Eastern for the
-- other forty-two, so a Washington loan rendered three hours off; and the entry
-- form read the typed time in whatever zone the browser sat in, which for a
-- server-rendered default was UTC. A lender in Kansas City could book a Florida
-- jet ski and have the waiver say an hour later than they typed.
--
-- Deriving it at render time cannot be right in any case. Twelve states straddle
-- a boundary: a Florida panhandle loan is Central while the rest of Florida is
-- Eastern, and no lookup keyed on "FL" can know which. So the agreement carries
-- its own zone and the renderer reads it.
--
-- BACKFILL. Existing rows take the correct zone for their state, which for the
-- forty-two states outside the old table is a change. That is safe: sending an
-- agreement freezes the formatted strings into documents.render_inputs
-- (lib/agreements/lifecycle.ts), so every sent or executed agreement keeps the
-- wording it was signed with. Only drafts re-render, and only to become right.

alter table agreements
  add column time_zone text;

update agreements set time_zone = case jurisdiction::text
  when 'AK' then 'America/Anchorage'
  when 'AZ' then 'America/Phoenix'
  when 'HI' then 'Pacific/Honolulu'
  when 'ID' then 'America/Boise'
  when 'IN' then 'America/Indiana/Indianapolis'
  when 'MI' then 'America/Detroit'
  when 'AL' then 'America/Chicago'
  when 'AR' then 'America/Chicago'
  when 'IA' then 'America/Chicago'
  when 'IL' then 'America/Chicago'
  when 'KS' then 'America/Chicago'
  when 'LA' then 'America/Chicago'
  when 'MN' then 'America/Chicago'
  when 'MO' then 'America/Chicago'
  when 'MS' then 'America/Chicago'
  when 'ND' then 'America/Chicago'
  when 'NE' then 'America/Chicago'
  when 'OK' then 'America/Chicago'
  when 'SD' then 'America/Chicago'
  when 'TN' then 'America/Chicago'
  when 'TX' then 'America/Chicago'
  when 'WI' then 'America/Chicago'
  when 'CO' then 'America/Denver'
  when 'MT' then 'America/Denver'
  when 'NM' then 'America/Denver'
  when 'UT' then 'America/Denver'
  when 'WY' then 'America/Denver'
  when 'CA' then 'America/Los_Angeles'
  when 'NV' then 'America/Los_Angeles'
  when 'OR' then 'America/Los_Angeles'
  when 'WA' then 'America/Los_Angeles'
  else 'America/New_York'
end
where time_zone is null;

alter table agreements
  alter column time_zone set not null;

-- An IANA name, not an offset. "America/New_York" carries the daylight saving
-- rules with it; "-05:00" is only true for part of the year, and a window that
-- crosses the March change would render half of itself wrong.
alter table agreements
  add constraint agreement_time_zone_is_iana
  check (time_zone like '%/%' and length(time_zone) between 3 and 64);

comment on column agreements.time_zone is
  'IANA zone the window was written in, defaulted from the state of activity and '
  'overridable for the twelve states that straddle a boundary. The renderer reads '
  'this rather than deriving one, so a panhandle loan can say CDT.';
