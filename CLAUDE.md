# iWaiver

Working name. The public brand may change; internal identifiers (repo, schema,
env prefixes) stay `iwaiver` regardless.

## What this is

A two-party agreement platform with embedded insurance. Someone lends an asset
(jet ski, boat, trailer) to someone else, both sign, and coverage for the loan
period is included in what they sign — not offered afterwards.

Two originator types: an individual (P2P) or an organization (rental shop,
motocross track). Same agreement flow either way.

## Stack

Next.js (App Router) · Supabase (Postgres + auth + storage) · Vercel · Cloudflare
DNS (DNS-only records, not proxied) · Stripe · Resend for email. SMS is a later
addition; keep `delivery_channel` an enum so adding it is config, not migration.

## Read first

- `docs/data-model.md` — the reasoning behind the schema. Read before proposing
  schema changes.
- `supabase/migrations/` — the schema itself. **The migrations are the source of
  truth for what the schema is; the doc is the source of truth for why.** If a
  migration contradicts the doc, fix the doc in the same PR.
- `README.md` — how to get it running, and what is mocked.

Where the application lives:

| Path | What it owns |
|---|---|
| `lib/agreements/lifecycle.ts` | send · execute · void. Every transition after `draft`. |
| `lib/agreements/signing.ts` | the borrower's tokenised session and the signature. |
| `lib/agreements/access.ts` | authorisation, since the service client bypasses RLS. |
| `lib/render/agreement.ts` | canonical text and the hash a signature is bound to. |
| `lib/render/pdf.ts` | the artifact. Reproducible bytes, pinned dates. |
| `lib/compliance.ts` | the gate. Blocking, not advisory. |
| `lib/coverage/` | the other bounded context. Reached over HTTP, never imported. |
| `lib/audit.ts` | append-only events; verification happens in SQL, not here. |

## Non-negotiable constraints

These are legal and evidentiary requirements, not style preferences. Do not
design around them. If a task seems to require breaking one, stop and ask.

1. **A signer is not a user.** `public.signers.user_id` is nullable and usually
   null. Borrowers sign from a tokenised link and may never create an account.
   Never add a signup requirement to the signing flow.

2. **All writes to the agreement graph go through server-side route handlers
   using the service role.** Never add client-side writes to agreements, signers,
   signatures, consent, documents, or audit events.

   Precisely: no evidence table (`signatures`, `consent_records`, `documents`,
   `audit_events`, `compliance_checks`, `identity_verifications`) has any write
   policy at all, and `signing_links`, `coverage_contexts`, `partners` and
   `partner_integrations` are revoked from `anon` and `authenticated` outright.
   `agreements`, `signers`, `assets`, `profiles` and `originators` do carry
   draft-stage write policies from 20260829000002 — **the application does not use
   them.** They are a second line of defence, not a supported path. Everything
   goes through `lib/agreements/*` on the service client, which does its own
   authorisation because RLS will not do it there.

3. **Append-only tables.** `audit_events`, `consent_records`, `signatures`, and
   `documents` reject UPDATE and DELETE at the database level. Corrections happen
   by inserting new rows, never by editing old ones.

4. **Snapshot, don't reference.** Asset values, template bodies, rule sets and
   rating inputs are frozen onto the record at the time of the event. Never
   re-derive historical state by reading current rows.

5. **No unreviewed clause reaches a signer.**
   `public.assert_clause_set_reviewed(template_version_id)` raises unless the
   template version and every clause version it names are published and
   unsuperseded. You do not have to remember to call it: `public.render_clause_set`
   is the only way to obtain clause bodies and calls it first. Do not add a second
   way to read `clause_versions.body_md` for rendering.

   Placeholder legal language is kept physically incapable of reaching production
   by nothing in the migration chain ever publishing it. The specimen clause set in
   20260830000006 is seeded with `published_at` null, so a production database
   built from these files cannot render at all. Publishing for local work is a
   deliberate act against a named database:
   `supabase/seed/dev_publish_specimen_clauses.sql`, which is not a migration.
   Never move that logic into one.

6. **Published template and clause versions are immutable.** Publish a new
   version; never edit a published one.

7. **Never store biometric identifiers.** Device attestations (WebAuthn/Face ID
   assertions) only. Illinois BIPA carries per-violation statutory damages.

8. **Never delete an agreement under legal hold.** `agreements.legal_hold_at`
   overrides all retention logic. Retention floor is config, not a hardcoded TTL.

9. **The coverage domain is a separate bounded context.** Agreements calls
   coverage over HTTP at `/api/coverage/v1/*` — the same endpoints, payloads and
   credential mechanism a third-party partner uses. If the first-party path takes a
   shortcut, the contract isn't real, so do not import `lib/coverage/service` from
   the agreements side. `lib/coverage/contract.ts` is the whole of what crosses;
   it names no agreement and no signer.

   The schema is one Postgres schema, not two, and `quotes.agreement_id` and
   `quotes.beneficiary_signer_id` are real foreign keys — the check constraint
   `first_party_quote_has_agreement` requires the first. They exist for first-party
   reporting and are **written from a caller-supplied reference, never read to make
   a decision.** The agreements app learns what cover exists from its own
   `audit_events`, not by querying `quotes` or `policies`. A join from a quote back
   into the agreement graph is the boundary quietly ceasing to exist.

## Conventions

- **TypeScript strict mode stays on.** Do not add `// @ts-nocheck`. A type error
  here can mean an unenforceable contract or a policy bound with the wrong limit.
- Money is always integer cents, never floats.
- Timestamps are `timestamptz`, always UTC, never naive dates.
- Phone numbers are E.164.
- Jurisdiction means the state where the **activity** happens, not where anyone
  lives.
- Migrations only — never change the schema through the Supabase dashboard.

## Current milestone

One state, one activity class, adults only, individual originator, email
delivery, coverage mocked behind the real interface.

The path to prove: Dave creates an agreement → Marcus signs from an emailed link
→ both get a hashed PDF → the audit chain verifies.

That path is built. FL / `personal_watercraft` is the seeded state and activity.
What is deliberately mocked or absent, so nobody mistakes it for done:

- **Coverage is a mock carrier** (`lib/coverage/carrier.ts`) behind the real
  interface. Premiums are deterministic; policy numbers start `MOCK-`. Swapping in
  a real carrier is a second `CarrierClient` and nothing else.
- **Identity verification is not wired.** The gate records `identity` as `skipped`,
  which is what actually happened. Do not change it to `pass`.
- **Premium is carrier-collected.** `payments.collector` exists for the platform
  branch; that branch is not implemented and Stripe is not in the path.
- **The clause set is a specimen.** FL computes to `cover_only` because
  `clause_set_reviewed_at` is null, and every rendered document says so on its
  face. It becomes `live` when counsel's wording lands as clause version 2 and
  that column is set — in the same migration.

## Not yet decided

- Public brand name.
- Whether the carrier or the platform collects premium (build the abstraction,
  implement carrier-collected first).
- Minors are out of scope for now. The schema has `signers.capacity` and
  `guardian_signer_id` ready, but the compliance gate must refuse `minor`
  capacity until that product is deliberately built.
