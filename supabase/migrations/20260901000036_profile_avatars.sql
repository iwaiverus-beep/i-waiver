-- A face on the account.
--
-- Everything a lender can say about themselves already existed — `full_name`,
-- `phone`, `home_state` on `profiles` since 20260829000001, and a payment handle
-- since 20260901000032. What was missing was a picture and, more to the point,
-- anywhere to go and set any of it. This adds the one column that was actually
-- absent; the rest of the work is a screen, not a schema.

alter table profiles
  add column avatar_path text;

comment on column profiles.avatar_path is
  'Object key in the private avatars bucket. Null is the ordinary state — the header falls back to initials, and most accounts will never upload one.';

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
--
-- PRIVATE, unlike `asset-photos` in 20260901000028, and the difference is the
-- subject. A marketing photograph of a jet ski is published on purpose: it is
-- shown to a borrower who has not signed in and may never have an account, so a
-- public URL is the feature. A photograph of somebody's face is not published by
-- anybody, and "the key is a uuid so nobody will guess it" is not a decision to
-- make on a person's behalf. It is served as a short-lived signed URL minted
-- server-side, the same way `agreement-documents` is.
--
-- No storage policies, so `anon` and `authenticated` are denied outright. Uploads
-- happen where every other privileged write in this codebase happens: a route
-- handler on the service client that has done its own authorisation first.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;
