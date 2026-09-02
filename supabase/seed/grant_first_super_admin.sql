-- Grants the first super admin.
--
-- READ THIS BEFORE RUNNING IT. A super admin can grant staff access to anyone,
-- issue LIVE API keys, and add carriers. It is the widest grant this product has.
--
-- Why a seed and not a migration: staff access is a fact about one named person
-- at one company, not a fact about the schema. Putting an email address in the
-- migration chain would re-assert that grant against every database ever built
-- from these files, including a reviewer's laptop and any future staging copy.
--
-- Why a seed and not IWAIVER_BOOTSTRAP_ADMINS: the environment variable exists so
-- the first super admin can be created when there is no other way in, and
-- lib/platform/access.ts is explicit that an address left in it CANNOT BE REVOKED
-- from inside the product. A real row can be. Since the database is reachable
-- from the repo (scripts/db-push.mjs, scripts/db-run.mjs), writing the row
-- directly is the better of the two doors and leaves the variable empty.
--
--   node scripts/db-run.mjs supabase/seed/grant_first_super_admin.sql --apply
--
-- Everyone after this one is granted from /admin/staff, which writes a
-- staff_actions row naming who did it. This seed cannot, because there is nobody
-- to name yet — that asymmetry is the whole reason it exists and the reason it
-- should be run exactly once.

insert into platform_staff (user_id, email, role, note)
select
  u.id,
  lower(u.email),
  'super_admin',
  'First super admin. Granted from supabase/seed/grant_first_super_admin.sql.'
from auth.users u
where lower(u.email) = 'john.mcelroy@i-waiver.com'
  -- An unconfirmed address is a claim, not a fact, and this is the last place to
  -- accept a claim. currentStaff() applies the same test on every request.
  and u.email_confirmed_at is not null
  -- platform_staff.user_id references profiles, not auth.users. A confirmed
  -- account with no profile row would fail the foreign key at the end of a long
  -- statement instead of matching nothing here.
  and exists (select 1 from profiles p where p.id = u.id)
  and not exists (
    select 1 from platform_staff s
     where s.user_id = u.id and s.revoked_at is null
  )
on conflict do nothing;

-- Says what happened. Zero means the address has no confirmed account yet: sign
-- in once as that address, then run this again.
select
  count(*) filter (where role = 'super_admin') as super_admins,
  string_agg(email, ', ') filter (where role = 'super_admin') as who
from platform_staff
where revoked_at is null;
