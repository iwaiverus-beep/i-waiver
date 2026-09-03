# iWaiver

Working name. The public brand may change; internal identifiers (repo, schema,
env prefixes) stay `iwaiver` regardless.

## What this is

A two-party agreement platform with embedded insurance. Someone lends an asset
(jet ski, boat, trailer) to someone else, both sign, and coverage for the loan
period is included in what they sign — not offered afterwards.

Two originator types: an individual (P2P) or an organization (rental shop,
motocross track). Same agreement flow either way.

Three kinds of lender, which is the same two things arriving by different routes:
an individual, a company, and a company whose account a **partner platform**
administers over the API. The partner is never the lender and never a party to the
release — see `docs/partners.md`.

## Stack

Next.js (App Router) · Supabase (Postgres + auth + storage) · Vercel · Cloudflare
DNS (DNS-only records, not proxied) · Stripe · Resend for email. SMS is a later
addition; keep `delivery_channel` an enum so adding it is config, not migration.

## Deployment accounts

Vercel (team `iWaver`) and Supabase are iWaiver's own accounts. Cloudflare is
not: `i-waiver.com` was registered at Cloudflare Registrar on 2026-08-28 and its
zone lives in the **LeadLynk** Cloudflare account
(`d51e84d55aa708d515ca77d0d71d1c58`, nameservers drake/faye). That is not the
intended end state — an ICANN 60-day lock blocks transferring a new registration
until roughly 2026-10-27 — but it is the arrangement, and it works.

Do not "separate" it by adding a second zone for the domain in another
Cloudflare account. That was tried on 2026-08-28: the duplicate sat `pending`
forever on nameservers the registrar never pointed at, and would have silently
accepted every record written to it while the real zone stayed empty. A
registrar-locked domain cannot be moved by re-creating its zone elsewhere.

What does stay separate is the credential.
`IWAIVER_CLOUDFLARE_API_TOKEN` must be scoped to Zone → DNS → Edit on the single
`i-waiver.com` zone, so it cannot read or write anything else in that account.
Never use the machine's ambient account-wide `CLOUDFLARE_API_TOKEN`:
`scripts/setup-deploy.mjs` rejects that exact value, and rejects any token that
can reach a second zone.

## Read first

- `docs/data-model.md` — the reasoning behind the schema. Read before proposing
  schema changes.
- `supabase/migrations/` — the schema itself. **The migrations are the source of
  truth for what the schema is; the doc is the source of truth for why.** If a
  migration contradicts the doc, fix the doc in the same PR.
- `docs/partners.md` — how a partner gets from applying to a live key, what our
  own staff roles can do, and what is deliberately not built yet. Read before
  touching anything under `lib/partners/`, `lib/platform/` or `app/admin/`.
- `README.md` — how to get it running, and what is mocked.
- `supabase/templates/README.md` — the auth emails. They are the one part of the
  product's outbound mail that is project configuration rather than code, so
  editing a file there changes nothing until `scripts/setup-auth-emails.mjs`
  pushes it.

Where the application lives:

| Path | What it owns |
|---|---|
| `lib/agreements/lifecycle.ts` | send · execute · void. Every transition after `draft`. |
| `lib/agreements/signing.ts` | the borrower's tokenised session and the signature. |
| `lib/agreements/access.ts` | authorisation, since the service client bypasses RLS. |
| `lib/agreements/create.ts` | the draft, identical however it was asked for. Both callers use it. |
| `lib/agreements/partner-origination.ts` | agreements a partner platform creates for its customer. |
| `lib/agreements/groups.ts` | bookings: several households on one thing, one release each. |
| `lib/agreements/list.ts` | the lender's list — search, sort, filter, page. Read as the user, over the `agreement_list` view. |
| `lib/agreements/archive.ts` | filing finished agreements off the working list. A shelf, never a delete. |
| `lib/render/agreement.ts` | canonical text and the hash a signature is bound to. |
| `lib/render/pdf.ts` | the artifact. Reproducible bytes, pinned dates. |
| `lib/compliance.ts` | the gate. Blocking, not advisory. |
| `lib/coverage/` | the other bounded context. Reached over HTTP, never imported. |
| `lib/coverage/carriers.ts` | who may write what, where, today. Per product, not per carrier. |
| `lib/coverage/admin.ts` | carriers, products, filings, credentials. Never quotes. |
| `lib/audit.ts` | append-only events; verification happens in SQL, not here. |
| `lib/partners/` | applications, membership, keys, onboarding. Never touches the agreement graph. |
| `lib/partners/prospects.ts` | the target list, before anybody is a partner. Holds no key and no way in. |
| `lib/partners/vocabulary.ts` | the words both consoles render. No imports, no `server-only`. |
| `lib/platform/` | our own staff: role capabilities, and the append-only staff action log. |
| `lib/platform/emulation.ts` | viewing the product as one customer, for a support call. Reads only, and three separate layers say so. |
| `lib/platform/reports.ts` | lenders, borrowers, agreement totals. Counts in SQL; reads no quote. |
| `lib/coverage/reporting.ts` | quoted, bound, collected. The insurance half of the dashboard, on its own side of the boundary. |
| `lib/support/` | tickets. One reader strips internal notes, and there is no flag that skips it. |

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
   policy at all, and `signing_links`, `coverage_contexts`, `partners`,
   `partner_integrations`, `partner_applications`, `partner_members`,
   `partner_onboarding`, `partner_branding`, `platform_staff`, `staff_actions`,
   `support_tickets` and `support_messages` are revoked from `anon` and
   `authenticated` outright. Everything the partner console and the admin console
   show is assembled server-side on the service client, which does its own
   authorisation — `lib/partners/access.ts` and `lib/platform/access.ts`.
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

10. **Sandbox is a property of the credential, never of the request.** The
    environment is resolved in `lib/coverage/auth.ts` from the integration row and
    written onto every `coverage_contexts`, `quotes`, `policies` and `payments` row
    the call produces. Do not add a `test: true` to any payload: a flag is one typo
    away from writing test data with a live key, or binding real cover with a test
    one. A live key is issued only by `partners.key.live` (super admin), only when
    every onboarding step marked `blocksGoLive` is complete, and only for named
    states — all three checked in the route, not the UI.

11. **A carrier is not a partner, and the direction is why.** `partners` /
    `partner_integrations` model somebody who CALLS us and holds an inbound API
    key. A carrier is called BY us, holding a credential they issued — so they
    live in `carriers` (20260901000018), inside the coverage bounded context, and
    approving a carrier-kind application creates a carrier rather than a partner.

    Two rules inside that. **No carrier secret is ever stored:**
    `carrier_credentials.secret_env_var` holds the NAME of the environment
    variable, and a check constraint rejects anything not shaped like one, because
    a key we must send in clear is a key that would otherwise sit in every backup.
    And **there is no fallback adapter:** a carrier whose `adapter` has no
    registered `CarrierClient` is dropped from the quote, never quietly served by
    the mock — that would put `MOCK-` policy numbers under a real insurer's name.

    Whether a product may be quoted in a state is `carrier_state_filings`, a legal
    fact recorded only by `carriers.filings` (compliance and super admin).
    `state_availability.carrier_admitted` is now a trigger-maintained cache of it,
    not an input.

12. **A partner platform is not the lender.** When a platform originates through
    `/api/agreements/v1`, the lender is THEIR customer and the release runs
    between that customer and the participant. `originators` therefore keeps its
    two arms — a party is a person or a business — and 20260901000019 adds
    PROVENANCE (`managed_by_partner_id`), not a third kind of party. A
    partner-managed originator must be an organization, and the name on the
    document comes from the lender `signers` row as it always has.

    That door needs the `agreements` scope, which is never granted by default and
    only from the admin console. It takes live keys only: a document this API
    creates is real, and a "this one is a test" column next to evidence is the
    column that gets set wrong. Signing links are returned to the caller, which is
    a bearer credential for their customer's signature — intended, and said out
    loud in the docs rather than left to be discovered.

13. **Staff can look; they cannot rewrite history.** `platform_staff` grants access
    to the admin console and nothing in the evidence tables, which have no write
    policy and must never gain one. `staff_actions` is append-only like
    `audit_events`; corrections are new rows. And the embedded surface is
    **co-branding, not white label** — our surface makes the offer, which is the
    whole reason a partner is not an unlicensed producer. Never add a setting that
    removes i-Waiver's identity from it, however reasonably a partner asks.

14. **One release, one releasor.** A release is personal to the person giving it,
    and no adult can give one on another adult's behalf. So when several
    households take one boat, that is several agreements grouped into a
    `rental_group` (20260901000023) — never one agreement with more signers on
    it. One `rental` agreement for whoever took the thing, one `participant`
    agreement each for everybody else, each with its own document, hash,
    signature, evidence chain and quote.

    `instrument_kind` is the fourth axis of template selection, after
    jurisdiction, activity_class and originator_kind, and like the third it has
    **no fallback**. The participant set omits `damage_responsibility`
    deliberately: that clause can only be given by somebody who took custody, and
    putting it to a passenger both says something untrue about them and invites
    the argument that the whole document was boilerplate. Never add a signer to
    somebody else's agreement to save a step.

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
