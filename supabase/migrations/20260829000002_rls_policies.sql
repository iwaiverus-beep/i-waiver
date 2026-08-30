-- iWaiver — row level security
--
-- Access is scoped by PARTICIPATION, not by a tenant_id column: you can reach an
-- agreement because you originated it (directly, or through an org you are an accepted
-- member of) or because you are a signer on it who happens to also hold an account.
--
-- Two things this file deliberately does NOT do:
--
--   * It grants the borrower nothing. A borrower signs from a tokenized link and
--     usually has no account at all, so there is no auth.uid() to write a policy
--     against. That path runs server-side under the service role, which bypasses RLS,
--     after the server has validated the token hash, its expiry, and its single use.
--     Resist the temptation to "fix" this with an anon policy — the token is the
--     capability, and it must never be checked in the database's policy layer.
--
--   * It leaves several tables with RLS on and zero policies. That is not an omission.
--     RLS enabled + no policy = deny all for anon and authenticated, which is what
--     signing_links, partner_integrations and coverage_contexts should be.

-- ---------------------------------------------------------------------------
-- Helpers
--
-- security definer so a policy can read originators / org_memberships without
-- recursing into those tables' own policies. search_path is pinned empty and every
-- reference is schema-qualified.
-- ---------------------------------------------------------------------------

create or replace function public.user_originator_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
    from public.originators o
   where o.user_id = auth.uid()
  union
  select o.id
    from public.originators o
    join public.org_memberships m on m.org_id = o.org_id
   where m.user_id = auth.uid()
     and m.accepted_at is not null
     and m.revoked_at is null
$$;

comment on function public.user_originator_ids is
  'Every originator the current user acts as: their own individual originator, plus any org they are an accepted, non-revoked member of.';

create or replace function public.is_org_member(p_org_id uuid, p_roles public.org_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.org_memberships m
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.accepted_at is not null
       and m.revoked_at is null
       and (p_roles is null or m.role = any(p_roles))
  )
$$;

create or replace function public.can_access_agreement(p_agreement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.agreements a
     where a.id = p_agreement_id
       and a.originator_id in (select public.user_originator_ids())
  )
  or exists (
    select 1
      from public.signers s
     where s.agreement_id = p_agreement_id
       and s.user_id = auth.uid()
  )
$$;

comment on function public.can_access_agreement is
  'Participation test. True if the caller originated the agreement or is a signer on it who holds an account. An accountless borrower is served server-side under the service role.';

-- Used by the evidence policies below. A policy that reads `signers` or `quotes`
-- inline would re-enter those tables' own policies; resolving the parent id through
-- a definer function keeps each policy a single, non-nested check.
create or replace function public.signer_agreement_id(p_signer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.agreement_id from public.signers s where s.id = p_signer_id
$$;

create or replace function public.quote_agreement_id(p_quote_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select q.agreement_id from public.quotes q where q.id = p_quote_id
$$;

create or replace function public.agreement_is_draft(p_agreement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.agreements a
     where a.id = p_agreement_id
       and a.status = 'draft'
  )
$$;

-- ---------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------

create policy profiles_select_own on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_insert_own on profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy organizations_select_member on organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy organizations_update_admin on organizations
  for update to authenticated
  using (public.is_org_member(id, array['owner', 'admin']::public.org_role[]))
  with check (public.is_org_member(id, array['owner', 'admin']::public.org_role[]));

create policy org_memberships_select_own_or_org on org_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(org_id));

create policy org_memberships_write_admin on org_memberships
  for all to authenticated
  using (public.is_org_member(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));

create policy originators_select_own on originators
  for select to authenticated
  using (id in (select public.user_originator_ids()));

-- A P2P lender creates their own individual originator on first use; an org
-- originator may only be created by someone who administers that org.
create policy originators_insert_self on originators
  for insert to authenticated
  with check (
    (user_id = auth.uid() and org_id is null)
    or (org_id is not null
        and public.is_org_member(org_id, array['owner', 'admin']::public.org_role[]))
  );

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

create policy assets_owner_all on assets
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- A signer needs to see the asset description on the agreement they are signing, but
-- that read goes through agreements.asset_snapshot, not through this table. The
-- snapshot is the point: the live row may have changed since.

-- ---------------------------------------------------------------------------
-- Reference data — readable, never writable from a client
-- ---------------------------------------------------------------------------

create policy templates_select_all on templates
  for select to authenticated
  using (true);

create policy template_versions_select_published on template_versions
  for select to authenticated
  using (published_at is not null);

create policy clauses_select_all on clauses
  for select to authenticated
  using (true);

create policy clause_versions_select_published on clause_versions
  for select to authenticated
  using (published_at is not null);

create policy jurisdiction_rule_sets_select on jurisdiction_rule_sets
  for select to authenticated
  using (true);

-- Read by anon as well: this drives the public "where we operate" surface.
create policy state_availability_select on state_availability
  for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Agreements
--
-- Clients may edit only while the agreement is a draft. Every transition after that
-- (sent, partially_signed, executed, voided) is a server action under the service
-- role, because each one has side effects — delivery, rendering, hashing, audit —
-- that must not be reachable by writing a column directly.
-- ---------------------------------------------------------------------------

create policy agreements_select_participant on agreements
  for select to authenticated
  using (public.can_access_agreement(id));

create policy agreements_insert_own_originator on agreements
  for insert to authenticated
  with check (originator_id in (select public.user_originator_ids()));

create policy agreements_update_draft_only on agreements
  for update to authenticated
  using (
    status = 'draft'
    and originator_id in (select public.user_originator_ids())
  )
  with check (
    status = 'draft'
    and originator_id in (select public.user_originator_ids())
  );

create policy agreements_delete_draft_only on agreements
  for delete to authenticated
  using (
    status = 'draft'
    and originator_id in (select public.user_originator_ids())
  );

-- ---------------------------------------------------------------------------
-- Signers
-- ---------------------------------------------------------------------------

create policy signers_select_participant on signers
  for select to authenticated
  using (public.can_access_agreement(agreement_id));

create policy signers_write_draft_only on signers
  for all to authenticated
  using (
    public.agreement_is_draft(agreement_id)
    and public.can_access_agreement(agreement_id)
  )
  with check (
    public.agreement_is_draft(agreement_id)
    and public.can_access_agreement(agreement_id)
  );

-- ---------------------------------------------------------------------------
-- Evidence — readable by participants, written only by the server
--
-- No insert/update/delete policies anywhere in this section. Evidence rows are
-- created by the signing flow under the service role; a client that could write its
-- own consent record or signature row would make the whole evidence model worthless.
-- ---------------------------------------------------------------------------

create policy documents_select_participant on documents
  for select to authenticated
  using (public.can_access_agreement(agreement_id));

create policy consent_records_select_participant on consent_records
  for select to authenticated
  using (public.can_access_agreement(public.signer_agreement_id(signer_id)));

create policy signatures_select_participant on signatures
  for select to authenticated
  using (public.can_access_agreement(public.signer_agreement_id(signer_id)));

create policy identity_verifications_select_participant on identity_verifications
  for select to authenticated
  using (public.can_access_agreement(public.signer_agreement_id(signer_id)));

comment on column identity_verifications.vendor_ref is
  'Opaque vendor handle. MUST NOT contain PII: participants can read this row, and the standing decision is that a lender sees pass / fail / name-match only — never DOB, address, or document images.';

create policy audit_events_select_participant on audit_events
  for select to authenticated
  using (public.can_access_agreement(agreement_id));

create policy compliance_checks_select_participant on compliance_checks
  for select to authenticated
  using (public.can_access_agreement(agreement_id));

create policy intake_sessions_select_participant on intake_sessions
  for select to authenticated
  using (public.can_access_agreement(agreement_id));

-- Rule 3: append-only audit, enforced at the role level as well as by trigger.
revoke update, delete on audit_events from authenticated, anon;
revoke update, delete on documents    from authenticated, anon;
revoke update, delete on signatures   from authenticated, anon;
revoke update, delete on consent_records from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Insurance — readable by participants, written only by the coverage service
-- ---------------------------------------------------------------------------

create policy quotes_select_participant on quotes
  for select to authenticated
  using (agreement_id is not null and public.can_access_agreement(agreement_id));

create policy policies_select_participant on policies
  for select to authenticated
  using (public.can_access_agreement(public.quote_agreement_id(quote_id)));

create policy payments_select_participant on payments
  for select to authenticated
  using (agreement_id is not null and public.can_access_agreement(agreement_id));

-- ---------------------------------------------------------------------------
-- Service-role-only tables
--
-- Left with RLS enabled and no policies, on purpose. Listed here so that a future
-- reader can tell the difference between "deliberate" and "forgotten".
--
--   signing_links        token hashes; the capability itself. Never client-readable.
--   partner_integrations api key hashes, webhook secret hashes.
--   coverage_contexts    the partner integration contract; crosses the service
--                        boundary and is reached through the coverage API, not PostgREST.
--   partners             administered internally.
-- ---------------------------------------------------------------------------

revoke all on signing_links        from authenticated, anon;
revoke all on partner_integrations from authenticated, anon;
revoke all on coverage_contexts    from authenticated, anon;
revoke all on partners             from authenticated, anon;
