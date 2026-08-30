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

## Non-negotiable constraints

These are legal and evidentiary requirements, not style preferences. Do not
design around them. If a task seems to require breaking one, stop and ask.

1. **A signer is not a user.** `app.signers.user_id` is nullable and usually null.
   Borrowers sign from a tokenised link and may never create an account. Never
   add a signup requirement to the signing flow.

2. **All writes to the agreement graph go through server-side route handlers
   using the service role.** There are deliberately no INSERT/UPDATE/DELETE RLS
   policies for `authenticated`. Never add client-side writes to agreements,
   signers, signatures, consent, documents, or audit events.

3. **Append-only tables.** `audit_events`, `consent_records`, `signatures`, and
   `documents` reject UPDATE and DELETE at the database level. Corrections happen
   by inserting new rows, never by editing old ones.

4. **Snapshot, don't reference.** Asset values, template bodies, rule sets and
   rating inputs are frozen onto the record at the time of the event. Never
   re-derive historical state by reading current rows.

5. **No unreviewed clause reaches a signer.** Call
   `app.assert_clause_set_reviewed(template_version_id)` in the render path.
   Placeholder legal language must be physically incapable of reaching production.

6. **Published template and clause versions are immutable.** Publish a new
   version; never edit a published one.

7. **Never store biometric identifiers.** Device attestations (WebAuthn/Face ID
   assertions) only. Illinois BIPA carries per-violation statutory damages.

8. **Never delete an agreement under legal hold.** `agreements.legal_hold_at`
   overrides all retention logic. Retention floor is config, not a hardcoded TTL.

9. **The coverage domain is a separate bounded context.** No foreign keys cross
   between `app` (agreements) and the coverage schema. Agreements calls coverage
   through the same public interface a third-party partner would use. If the
   first-party path takes a shortcut, the contract isn't real.

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

## Not yet decided

- Public brand name.
- Whether the carrier or the platform collects premium (build the abstraction,
  implement carrier-collected first).
- Minors are out of scope for now. The schema has `signers.capacity` and
  `guardian_signer_id` ready, but the compliance gate must refuse `minor`
  capacity until that product is deliberately built.
