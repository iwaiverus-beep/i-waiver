# iWaiver — data model sketch

Working draft. Postgres / Supabase. Assumes Next.js on Vercel, Stripe, Twilio, an
identity-verification vendor, and a carrier quote-and-bind API.

---

## The two decisions everything else hangs off

### 1. A signer is not a user

In LeadLynk, every actor has an account and belongs to a company. Here, the borrower
signs from a text message and may never create an account. If you model the borrower
as a user, you will either force signups (killing conversion) or create ghost user rows
(corrupting your auth model).

So: `agreements` have `signers`. A signer *may* link to a `user`, or may be nothing more
than a name, a phone number, and a verified identity captured at signing time. An
account is offered *after* signing, as a place to keep copies — never as a gate.

### 2. The originator is polymorphic, not always a company

The requirements doc contains two businesses: Dave lending his Sea-Doo, and a rental
shop or motocross track collecting waivers at volume. Both are valid. They only coexist
if the party that creates an agreement is an **originator**, which resolves to either an
individual user or an organization.

Build company-first and P2P becomes a hack. Build P2P-only and you can't serve the
rental shop. Model the originator now; it costs almost nothing today.

Access control follows from this: RLS is scoped by *participation* (a row in `signers`,
or membership in the originating org), not by a `tenant_id` on every table.

---

## Entity map

```
users ──< org_memberships >── organizations
  │                               │
  └───────< originators >─────────┘        (individual OR org)
                 │
users ──< assets │
  │              │
  └──< agreements >── template_versions >── clauses
          │  │
          │  ├──< signers ──< signing_links
          │  │        │
          │  │        ├──< consent_records      (ESIGN)
          │  │        ├──< identity_verifications
          │  │        └──< signatures
          │  │
          │  ├──< compliance_checks >── jurisdiction_rule_sets
          │  ├──< documents            (rendered, hashed, immutable)
          │  ├──< quotes ──< policies
          │  ├──< payments
          │  └──< audit_events         (append-only, hash-chained)
```

---

## Core tables

### `users`
Account holders. Mostly lenders. Borrowers optionally, post-signature.
Supabase `auth.users` extended with a `profiles` row.

| column | notes |
|---|---|
| `id` | uuid, FK auth.users |
| `full_name` | |
| `phone` | E.164, verified flag separate |
| `home_state` | drives default jurisdiction |
| `created_at` | |

### `organizations`
Only exists for the business tier. A P2P lender never has one.

| column | notes |
|---|---|
| `id` | uuid |
| `legal_name`, `dba` | |
| `primary_state` | |
| `plan_tier` | `free`, `pro`, `business` |
| `verification_level` | `none`, `email`, `id_me` — matches the doc's step-up idea |
| `created_at` | |

### `org_memberships`

| column | notes |
|---|---|
| `org_id`, `user_id` | FK |
| `role` | enum: `owner`, `admin`, `manager`, `staff` |
| `invited_at`, `accepted_at`, `revoked_at` | |

Platform staff are **not** rows here. Keep `super_admin` as a separate platform role
with its own audit trail, so an internal action is never indistinguishable from a
customer action.

### `originators`
The party that creates agreements. Exactly one of the two FKs is non-null.

| column | notes |
|---|---|
| `id` | uuid |
| `user_id` | nullable FK users |
| `org_id` | nullable FK organizations |
| `kind` | generated: `individual` \| `organization` |

Check constraint: exactly one of `user_id`, `org_id` is set.
`agreements.originator_id` points here rather than at `lender_user_id`.

### `assets`
The thing being lent. Reusable across agreements — Dave lends the same Sea-Doo all summer.
For the business tier the "asset" may be an activity rather than an object (track day,
rental slot), so keep `asset_class` open and allow a null identifier.

| column | notes |
|---|---|
| `id` | uuid |
| `owner_originator_id` | FK originators — a person **or** an organisation, same as `agreements.originator_id`. A shop's fleet belongs to the shop, not to the member of staff who entered it. |
| `asset_class` | enum: `pwc`, `boat`, `trailer`, `vehicle`, `equipment`, `other` |
| `description` | "2023 Sea-Doo GTI 130" |
| `identifier` | HIN / VIN / serial — matters for the carrier |
| `declared_value_cents` | int |
| `year`, `make`, `model` | nullable, feeds rating |
| `archived_at` | never hard-delete; policies reference it |

### `agreements`
The spine. One row per loan.

| column | notes |
|---|---|
| `id` | uuid |
| `lender_user_id` | FK users |
| `asset_id` | FK assets |
| `template_version_id` | **FK, immutable once sent** |
| `jurisdiction` | US state code where the activity happens, not where anyone lives |
| `activity_class` | drives which clauses and which rules apply |
| `starts_at`, `ends_at` | timestamptz, the exposure window |
| `status` | enum: `draft`, `sent`, `partially_signed`, `executed`, `expired`, `voided` |
| `cover_requested` | bool — was cover included when sent |
| `created_at`, `sent_at`, `executed_at` | |

Snapshot the asset values onto the agreement at send time (`asset_snapshot jsonb`).
If Dave edits the declared value in September, the June agreement must not change.

### Bundles — several things on one agreement

Lending a jet ski usually means lending the ski, the trailer and two life
jackets, to one person, for one afternoon. That is a single bailment of several
chattels, and the ordinary instrument for it is one release with a schedule
attached — not three releases.

`agreement_assets (agreement_id, asset_id, order_index)` is the draft's working
list. A join table rather than a `uuid[]` column because `assets` is referenced
`on delete restrict` so a lender cannot delete their way out of a signed record,
and Postgres cannot enforce a foreign key through an array element — an array
would silently drop that protection for every item after the first.

`agreements.asset_snapshots jsonb` is the ordered snapshot of every item, frozen
at send. Rule 4 applies item by item: after sending, the document is assembled
from the snapshots and the join table is never read for rendering again.

Three things stay exactly as they were, and each is load-bearing:

- `agreements.asset_id` is the **lead item** of the bundle. Every query, policy
  and constraint written against it keeps working.
- `agreements.asset_snapshot` is the **lead item's** snapshot.
- `asset_snapshots` is null on any agreement created before bundles existed,
  which the renderer reads as a bundle of one.

So a single-item agreement is byte-for-byte the record it was, and — the point
of the whole arrangement — it canonicalises to the same text and therefore the
same hash. `IWAIVER-AGREEMENT-V1` has a singular `ASSET` block and is frozen:
those exact bytes are what `documents.sha256` and every
`signatures.document_hash_at_signing` were computed from. `V2` replaces that
block with `SCHEDULE A` and is emitted only where there is more than one item —
a document V1 could never have produced, so nothing already signed is reachable
from it.

On the coverage side, `coverage_contexts.assets jsonb` mirrors this: `asset`
keeps its meaning as the single or lead item so an existing partner integration
needs no change, and `assets` carries the full schedule when there is one.

### `signers`
**The important one.** Independent of `users`.

| column | notes |
|---|---|
| `id` | uuid |
| `agreement_id` | FK |
| `role` | enum: `lender`, `borrower`, `co_signer`, `witness` |
| `user_id` | **nullable** FK users |
| `display_name` | as entered by whoever created the agreement |
| `email`, `phone` | at least one required for delivery |
| `signed_at` | null until signed |
| `declined_at` | |
| `order_index` | for sequential signing if you need it later |

Unique on `(agreement_id, role)` for lender/borrower.

### `signing_links`
Tokenized, short-lived, single-use. This is the borrower's entire auth story.

| column | notes |
|---|---|
| `id` | uuid |
| `signer_id` | FK |
| `token_hash` | store the hash, never the token |
| `expires_at` | hours, not days |
| `consumed_at` | |
| `delivery_channel` | `sms` \| `email` |
| `delivered_at`, `delivery_ref` | Twilio/SendGrid message id — evidence of delivery |
| `first_opened_at` | |
| `open_ip`, `open_user_agent` | |

Reissuing a link creates a new row. Never mutate.

---

## Document layer

### `templates` / `template_versions`
Versioned, immutable once published. You must be able to prove, two years later,
exactly what wording a signer saw.

`template_versions`:

| column | notes |
|---|---|
| `id` | uuid |
| `template_id` | FK |
| `version` | int, monotonic |
| `jurisdiction` | state code, or `US` for the base |
| `activity_class` | |
| `originator_kind` | `individual` \| `organization` — a private loan and a commercial rental are different instruments, not the same one with a different name in the blank. Selection is exact on all three axes; there is **no** fallback from `organization` to `individual`. |
| `clause_set` | jsonb — ordered clause version ids |
| `published_at` | null = draft |
| `superseded_at` | |
| `body_hash` | sha256 of the canonical rendered source |

Never edit a published version. Publish a new one.

### `clauses` / `clause_versions`
The four instruments stay **separate records**, so a court can void one without taking
the rest with it, and so you can vary them per state.

| column | notes |
|---|---|
| `kind` | enum: `assumption_of_risk`, `release`, `covenant_not_to_sue`, `indemnity`, `damage_responsibility`, `esign_consent` |
| `jurisdiction` | |
| `body_md` | with merge fields |
| `requires_separate_signature` | bool — some states want the release initialled on its own |
| `conspicuous_formatting` | jsonb — caps / bold / min font size, e.g. Texas express-negligence rules |
| `effective_from`, `effective_to` | |

### `documents`
The rendered artifact.

| column | notes |
|---|---|
| `agreement_id` | FK |
| `kind` | `agreement`, `certificate_of_insurance`, `receipt` |
| `storage_key` | write-once bucket, versioning + object lock on |
| `sha256` | |
| `rendered_at` | |
| `render_inputs` | jsonb — everything needed to reproduce it byte-for-byte |

**Retention — tier it, don't truncate it.** A waiver's whole value is being producible
years later. Injury limitation periods run 2–3 years in most states (Kansas: 2), written
contracts ~5, and anything involving a minor tolls until 18 plus the limitation period.
Licensed producers also carry state record-retention minimums (commonly 3–7 years), the
carrier's producer agreement sets its own floor, and ESIGN requires electronic records be
kept for whatever period the underlying law requires.

**Launch setting: 3 years**, as a configurable floor — not a hardcoded TTL.

| tier | period | where |
|---|---|---|
| hot | 12–24 months | visible in-app, indexed, searchable |
| cold | to the retention floor (3 yrs at launch) | archived object storage, retrievable on request |
| extended | minor involved: to age 18 + limitation period | cold, flagged, exempt from purge |

Two guardrails that make 3 years safe to start with:

- **Floors lengthen, deletions don't reverse.** Store the floor per record class in config.
  Don't enable the purge job at all until the carrier's producer agreement retention terms
  are known — keeping everything for the first couple of years costs almost nothing.
- **Legal hold.** `agreements.legal_hold_at` (nullable). Once a claim or dispute is known,
  the record stops aging out regardless of policy, and the purge query must respect it.
  One boolean now; a serious problem if added after the fact.

Cost is not the constraint: a signed PDF is ~200 KB, so 100k agreements is ~20 GB.
The thing to delete aggressively is **ID verification imagery**, not agreements.

---

## Evidence layer

### `consent_records`
ESIGN/UETA consent to transact electronically. **Separate from the signature.** A
signature without a recorded consent is a weaker record.

| column | notes |
|---|---|
| `signer_id` | FK |
| `consented_at` | |
| `consent_text_hash` | which disclosure they saw |
| `ip`, `user_agent` | |
| `withdrawn_at` | |

### `signatures`

| column | notes |
|---|---|
| `signer_id` | FK |
| `method` | `drawn`, `typed`, `clicked` |
| `image_storage_key` | for drawn |
| `typed_name` | |
| `document_hash_at_signing` | **binds the signature to the exact bytes signed** |
| `signed_at`, `ip`, `user_agent`, `geo` | |

### `audit_events`
Append-only. No updates, no deletes. Enforce with a trigger and revoke UPDATE/DELETE.

| column | notes |
|---|---|
| `id` | bigserial |
| `agreement_id` | FK |
| `signer_id` | nullable |
| `event_type` | `created`, `sent`, `delivered`, `opened`, `consented`, `viewed_clause`, `identity_verified`, `compliance_checked`, `signed`, `quoted`, `bound`, `paid`, `voided` |
| `occurred_at` | |
| `actor` | `lender`, `borrower`, `system`, `carrier` |
| `ip`, `user_agent`, `geo` | |
| `payload` | jsonb |
| `prev_hash`, `hash` | hash chain per agreement — cheap tamper evidence |

### `identity_verifications`

| column | notes |
|---|---|
| `signer_id` | FK |
| `vendor`, `vendor_ref` | |
| `method` | `doc_scan`, `selfie_match`, `db_lookup`, `phone_possession` |
| `status` | `pending`, `passed`, `failed`, `manual_review` |
| `name_match_score` | |
| `verified_at` | |

Store the **result**, not the ID images. If you must hold images, short retention,
separate encrypted bucket, and a documented deletion job.

---

## Compliance gate

### `jurisdiction_rule_sets`
Versioned dataset, not code. You need to prove which rules were applied on a given date.

| column | notes |
|---|---|
| `id` | uuid |
| `version` | |
| `state` | |
| `activity_class` | |
| `min_operator_age` | |
| `education_required` | bool |
| `education_authority` | e.g. state boating cert |
| `waiver_enforceable_adult` | enum: `yes`, `limited`, `no` |
| `parental_waiver_enforceable` | enum — drives whether you allow minors at all |
| `indemnity_enforceable` | enum |
| `required_language` | jsonb — express negligence, conspicuousness |
| `effective_from`, `effective_to` | |

### `compliance_checks`

| column | notes |
|---|---|
| `agreement_id`, `signer_id` | |
| `rule_set_id` | which version was applied |
| `check_kind` | `operator_age`, `education_cert`, `identity`, `jurisdiction_supported` |
| `result` | `pass`, `fail`, `warn`, `skipped` |
| `evidence` | jsonb — cert number, DOB source |
| `blocking` | bool |
| `checked_at` | |

Make these blocking, not advisory. If you tell a lender the borrower is covered and
the claim later denies on an eligibility fact you could have caught, the lender looks
at you, not the carrier.

---

## Insurance layer

### `quotes`

| column | notes |
|---|---|
| `agreement_id` | FK |
| `beneficiary_signer_id` | who is the insured — lender and borrower quote separately |
| `product_code` | carrier's filed product |
| `coverage_kind` | `physical_damage`, `liability`, `accident_medical`, `deductible_reimbursement` |
| `limit_cents`, `deductible_cents` | |
| `premium_cents` | |
| `rating_inputs` | jsonb — **snapshot every input** |
| `rate_plan_version` | the carrier's filed plan version used |
| `carrier_quote_ref` | |
| `quoted_at`, `expires_at` | |

You must be able to reproduce any quote you ever showed. Regulators and carriers both
ask. Snapshot inputs; never recompute from current data.

### `policies`

| column | notes |
|---|---|
| `quote_id` | FK |
| `insured_signer_id` | |
| `carrier_policy_number` | |
| `status` | `bound`, `active`, `expired`, `cancelled`, `voided` |
| `effective_at`, `expires_at` | tied to the agreement window |
| `carrier_payload` | jsonb — raw bind response, kept verbatim |
| `certificate_document_id` | FK documents |

### `payments`
Split premium from your fee **at the schema level, day one**.

| column | notes |
|---|---|
| `agreement_id` | |
| `payer_signer_id` | |
| `premium_cents` | |
| `platform_fee_cents` | |
| `collector` | `platform` \| `carrier` — decide with the carrier before building |
| `fiduciary` | bool — premium held in a producer capacity may require a segregated trust account |
| `processor`, `processor_ref` | |
| `status`, `paid_at`, `refunded_at` | |

If the carrier collects premium and pays you commission, `collector = 'carrier'` and
most of the fiduciary problem disappears. Ask them before writing payment code.

---

## AI drafting — where the line goes

The requirements doc calls for an AI waiver generator. Keep the experience, change the
mechanism:

**AI conducts the interview and selects clauses. It does not write legal text.**

Two reasons. Generating bespoke legal language per customer resembles the unauthorized
practice of law in a number of states. And a uniquely generated document cannot be tied
to a versioned template, which collapses the entire evidence model above — you could
never prove what wording was standard on a given date.

### `intake_sessions`

| column | notes |
|---|---|
| `agreement_id` | FK |
| `transcript` | jsonb — the Q&A, kept as evidence of what was asked |
| `model_version` | which model and prompt version ran |
| `extracted_facts` | jsonb — asset, value, dates, jurisdiction, activity |
| `selected_clause_versions` | uuid[] — the output that matters |
| `human_reviewed` | bool |

Free-text the AI produces should be confined to non-operative fields: the description
of the asset, the plain-English summary shown on screen. Every operative clause comes
from `clause_versions`, drafted by counsel, versioned, immutable.

### Uploaded documents (business tier)
If an org uploads its own waiver, store it as `documents.kind = 'third_party_agreement'`
with `warranted = false`. It bypasses the drafting engine, so it cannot carry the
same assurance, and the UI should say so. Don't make it the default path — the
state-specific language is the moat.

---

## Service boundary — the part that actually ships

Strategic assumption: the waiver app may end up as a reference implementation, and the
durable business may be supplying coverage to existing waiver platforms (Smartwaiver,
WaiverForever, Roller, VenueSumo). Architect for that now; it costs little today.

**Two bounded contexts, one-way dependency:**

```
  Agreements service  ──calls──>  Coverage service
  (waiver, signing,               (quote, bind, cancel,
   evidence, templates)            certificate, claims handoff)
```

Coverage never reads agreement tables. Agreements never writes policy tables. The
first-party app calls the **same public interface a partner would** — no shared tables,
no internal shortcuts. If the first-party path skips a step, the contract isn't real and
you'll rebuild it at first integration.

### `coverage_contexts`
The normalized description of what's being covered, independent of any waiver. This is
the integration contract, and it must be satisfiable by a partner who knows far less
than you do.

| column | notes |
|---|---|
| `id` | uuid |
| `source` | `first_party` \| `partner` |
| `partner_id` | nullable FK |
| `external_ref` | the partner's own id for the transaction |
| `activity_class` | required |
| `jurisdiction` | required — state of activity |
| `starts_at`, `ends_at` | required |
| `parties` | jsonb — role, name, contact, age band |
| `asset` | jsonb, nullable — class, value, identifier |
| `supplemental` | jsonb — facts *we* collected that the partner didn't have |

Design rule: keep the **required** set small enough that a partner can supply it from
data they already hold. Everything else is collected in your own surface.

### `partners` / `partner_integrations`

| column | notes |
|---|---|
| `partner_id` | |
| `integration_kind` | `widget`, `api`, `redirect` |
| `environment` | `sandbox` \| `live`. Sandbox by default; going live is a decision |
| `api_key_hash`, `key_prefix`, `key_rotated_at` | prefix is display only |
| `allowed_jurisdictions` | at least one — the database refuses an empty list |
| `allowed_origins` | where a widget may be framed from |
| `compensation_model` | `flat_referral`, `platform_fee`, `none` — **not** premium-based |
| `webhook_url`, `webhook_secret_hash` | secret rotates whenever the URL changes |
| `revoked_at`, `revoked_by`, `last_used_at` | rotation is create-then-revoke |

**Added since the first draft** (migrations `20260901000012`–`15`), because the tables
above described a partner nobody could become:

- `partner_applications` — the public request. Marketing-adjacent, outside the
  agreement graph exactly as `waitlist` is.
- `partner_members` — who at that company may sign in. The invitation is the email
  address; there is no token. Grants access to that company's integration settings
  and to nothing in the agreement graph.
- `partner_onboarding` — completed steps only. The step list is code, not data.
- `partner_branding` — co-branding for the widget, reviewed before it renders.
- `platform_staff` / `staff_actions` — our own people, and an append-only record of
  what they did.
- `support_tickets` / `support_messages` — append-only threads, with internal notes
  the customer reader cannot return.

`environment` also lives on `coverage_contexts`, `quotes`, `policies` and `payments`
(`20260901000013`), and `public.purge_sandbox_coverage` empties the sandbox with every
statement filtered on it. See `docs/partners.md` for the operating model.

### Lenders a partner administers — added 20260901000019

Three kinds of lender, which are two kinds of party arriving by different routes:

| | party | administered by |
|---|---|---|
| individual | `originators.user_id` | themselves |
| company | `originators.org_id` | its own staff |
| partner-integrated | `originators.org_id` | a partner platform, over the API |

`originators` keeps exactly two arms. What is added is **provenance** —
`managed_by_partner_id`, `partner_external_ref`, and a derived `channel` — because
the platform is not the lender and is not a party to the release. A constraint
requires a partner-managed originator to be an organization: `user_id` points at
`auth.users`, and a partner cannot create somebody else's account.

`partner_integrations.scopes` (`coverage` | `agreements`) decides which door a key
opens, defaulting to `coverage` alone. `agreements.partner_external_ref` makes the
partner's create idempotent.

### `carriers` — added 20260901000018

The original draft had no carrier in it at all. `state_availability.carrier_admitted`
was a single boolean, which encoded an assumption nobody had written down: exactly one
carrier, forever, anonymous. A second carrier — one admitted in FL, another writing TX —
could not be expressed, and `quotes.product_code` could not be traced back to whoever
priced it.

| table | notes |
|---|---|
| `carriers` | name, NAIC, kind, status, and `adapter` — the key naming its `CarrierClient` |
| `carrier_products` | `product_code` is globally unique, because `quotes.product_code` is a snapshot with no FK |
| `carrier_state_filings` | (product, state). **Replaces `carrier_admitted`**, which is now a trigger-maintained cache |
| `carrier_credentials` | outbound: the NAME of the env var holding their key, never the key. Inbound: a hash |
| `carrier_events` | what they told us after a bind. Immutable except for processing state |

`quotes.carrier_id` and `policies.carrier_id` are new and nullable — null means a row
written before carriers existed, when there was one anonymous carrier.

**A carrier is not a partner.** `partners` models somebody who calls US and holds an
inbound key; a carrier is called BY us. Approving a carrier-kind application creates a
`carriers` row, not a partner. See `docs/partners.md`.

Empty `allowed_jurisdictions` means "no restriction" to `lib/coverage/service.ts` —
a reasonable reading when partners were created by hand, and a bad one now that an
approval flow creates them. Rather than reinterpret the coverage service's semantics
from outside it, the check constraint makes an empty list unstorable.

### Why a widget, not only an API

If a partner presents the offer, captures the opt-in, and takes a cut of premium, the
partner starts to resemble an unlicensed producer. If **your** embedded surface does the
soliciting, disclosure, consent and payment, you are the licensed party and they are
hosting a frame. That distinction is the reason this category exists, and it's why a
partner can't trivially rebuild it after seeing it. Compensation structured as anything
premium-based reopens the problem — get it structured by counsel, per state.

Add `quotes.source` and `policies.source` (`first_party` | `partner`) so attach rate,
loss experience and commission can be reported per channel. The carrier will ask.

---

## Rules of the road

1. **Nothing about an executed agreement is mutable.** Corrections happen by voiding and
   re-executing, with both linked.
2. **Snapshot, don't reference.** Asset values, rating inputs, template bodies, rule sets.
3. **Append-only audit, hash-chained.** Revoke UPDATE and DELETE at the role level.
4. **Signer, not user.** Resist every temptation to require a borrower account.
5. **State is a first-class input**, captured as where the activity happens.
6. **Carrier API behind an anti-corruption layer.** Their semantics should never reach
   your domain model.
7. **PII minimisation.** Results over raw documents; encrypt at rest; document deletion.

---

## Open questions for the carrier

- Do they collect premium, or do you?
- What's the filed rate plan, and is there a real-time quote-and-bind API?
- Who is the insured of record on each coverage — lender, borrower, or both?
- What data do they require at bind, and what's their claims intake?
- Retention and data-sharing terms for signed agreements.
- Will they support a **third-party distribution channel**, and does exclusivity (if any)
  cover partner platforms as well as your own app?
- What's the minimum data set they need at bind? That number sets the ceiling on how
  easily you can integrate with platforms that hold less data than you do.

## Open questions for you

**Decided:**

- **All states, gated individually.** Rule sets are data, so nothing in the architecture
  blocks fifty states. Availability per state is gated by two things outside your control:
  the carrier being admitted and filed there, and counsel having reviewed the clause set.
  See `state_availability` below.
- **The lender sees the verification *result*, not the data.** Pass / fail / name-match
  only. No DOB, address, or document images pass between two consumers. Disclose to the
  borrower at signing that the lender will see the outcome.
- **Device biometrics only.** Face ID / Touch ID unlocks the signing session; store the
  platform's assertion (`webauthn`-style) and nothing else. Never capture or persist a
  biometric identifier — Illinois BIPA carries a private right of action with
  per-violation statutory damages, and Texas and Washington have their own regimes.
- **Email first, SMS as a fast follow.** Faster to launch, no carrier registration.
  Keep `delivery_channel` an enum from day one so adding SMS is configuration, not a
  migration. If SMS is wanted near launch, start A2P 10DLC registration early — it
  routinely takes weeks and becomes the critical path.

### `state_availability`

| column | notes |
|---|---|
| `state` | |
| `carrier_admitted` | bool — per product code |
| `product_codes` | text[] — what the carrier can actually write there |
| `clause_set_reviewed_at` | null until counsel signs off |
| `waiver_efficacy` | `standard`, `limited`, `void` — MT, LA, VA are void or near-void; WI, CT, VT hostile |
| `status` | generated: `live`, `cover_only`, `unavailable` |

`cover_only` matters. In a void-waiver state you can still sell the coverage, but the
product must present honestly — the cover is the whole value, and the document is a
record of the loan rather than a shield. Don't quietly underdeliver the waiver.

**Also decided:**

- **Adults only at launch; minors are a later product, not a later flag.** Because a
  parental pre-injury release is void or near-void in most states, the minor version is
  effectively **insurance-first**: accident medical does the work the release can't.
  Different value proposition and different copy. Leave room now, build later:
  - `signers.capacity` — `adult`, `minor`, `guardian_for`
  - `signers.guardian_signer_id` — nullable self-reference
  - `jurisdiction_rule_sets.parental_waiver_enforceable` already exists; the gate simply
    refuses `minor` capacity until the product ships.

- **P2P and business tier both at launch — with the business tier scoped narrowly.**
  Business v1 is the *same* agreement flow with an org wrapper: multiple staff can send,
  shared templates, a dashboard, one bill. It is **not** kiosk mode, booking-system
  integrations, or bulk operations. Those are Smartwaiver's moat, not yours, and
  competing there is a feature war with no insurance revenue attached.

**Still open — verify with the carrier before roadmapping:**

- **Business tier insurance is two different things.** Don't let "they can handle both"
  stand unverified:
  - **(a) Embedded consumer cover** sold to the business's *customers* at signing. Same
    product as P2P, same rails, high confidence. Build this.
  - **(b) Commercial liability for the business itself.** Different line, usually a
    different legal entity in the group, own filings and appetite. A motocross track is
    hard-to-place risk many carriers decline. And it's an annual placement through a
    commercial broker, not a per-transaction bind — it doesn't fit these rails at all.

  Ask which entity, which lines, admitted where. Until that's answered, plan on (a) only.

---

## Carrier answers so far

- **Premium collection: support both.** Build the abstraction now; implement
  `collector = 'carrier'` first — it avoids fiduciary trust accounting entirely. Keep
  `collector = 'platform'` behind the same interface until you know you need it.
- **Real-time quote-and-bind API: yes.** This is the single most important yes. It's what
  makes the signing-moment experience possible at all.
- **Both parties may buy.** That means **two policies, not one policy with two insureds** —
  different coverages, different insureds, possibly different product codes. Handled by
  `quotes.beneficiary_signer_id`. Consequence for reporting: **attach rate is measured per
  signer, not per agreement**, or you understate it by half.
- **Bind payload: guess low, adjust later.** `coverage_contexts` has a small required core
  plus open `supplemental`, so a wrong guess lands in supplemental instead of forcing a
  schema change or a renegotiated partner contract. Starting guess:

  ```
  parties[]      name, contact, age_band, role
  activity_class
  jurisdiction   state of activity
  starts_at, ends_at
  asset          class, declared_value, identifier?
  coverage       kind, limit, deductible
  identity       verification_status
  ```

- **Data sharing with the carrier: yes, and it needs paper.** A written data-sharing
  agreement or DPA, disclosure in the privacy policy, and compliance with the state
  insurance data security regimes (most states have adopted the NAIC model, which imposes
  third-party oversight duties and short-clock incident notification on licensees).
