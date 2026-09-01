# Partners

How a waiver platform or a carrier gets from "we should talk" to a live key, what
each side controls, and which decisions are deliberately not self-service.

The strategic case for any of this is in `docs/data-model.md` under **Service
boundary**: the durable business may be supplying coverage to the platforms that
already exist rather than winning their customers. This document is the operating
model that follows from it.

---

## The shape of it

```
  apply  →  approve  →  sandbox  →  onboarding  →  live
  public    staff      partner     both          super admin only
```

Each arrow is a different kind of gate, and the differences matter more than the
steps.

| Step | Who does it | Where |
|---|---|---|
| Apply | Anyone | `/partners` → `POST /api/partners/apply` |
| Approve | Staff with `partners.review` | `/admin/applications/[id]` |
| Sandbox key | The partner, themselves | `/partners/console` |
| Onboarding | Both, per step | `/partners/console` and `/admin/partners/[id]` |
| Live key | Staff with `partners.key.live` | `/admin/partners/[id]` |

## Applying

`partner_applications` is marketing-adjacent intake, sitting outside the agreement
graph exactly the way `waitlist` does. Nobody who fills the form in is a party to
anything.

One open application per contact address, enforced by a partial unique index. A
second submission while the first is still open gets the same "we have it" answer
as the first, because confirming that a company has already applied would leak a
fact about somebody else's business to anybody who can guess an address.

## Approval

`approveApplication` in `lib/partners/applications.ts` is the **only** path that
creates a `partners` row. Keeping it single is what makes the invariants hold for
every partner rather than for the ones somebody remembered: a unique slug, an
owner who can actually sign in, and an onboarding record that starts at step one.

Approval issues no key. The contact becomes an `owner` member and gets an email
with a sign-in link; the first key is minted in the console by the person who will
paste it into their configuration. That keeps a raw credential out of an email,
and it means the audit trail records who *took* the key rather than who authorised
it.

## Signing in — the invitation is the address

There is no invitation token. A `partner_members` row carries an email and a null
`user_id`; the first time that person signs in with a **confirmed** account,
`lib/partners/access.ts` binds it.

The whole safety of that rests on `email_confirmed_at`. Supabase sets it for a
magic link, an OAuth sign-in and a confirmed password signup. Without that check,
anybody could sign up claiming a colleague's address and inherit their access — so
an unconfirmed account claims nothing, and is not told why.

What this buys: nothing in an inbox grants access, so a forwarded invitation gives
the recipient nothing. What it costs: somebody who signs in with a personal
address rather than the work address we were given sees "this account is not a
partner", which is why `components/NoPartnerAccess.tsx` spends a paragraph on
exactly that.

## Sandbox and live

The environment is a property of the **key**, resolved in
`lib/coverage/auth.ts` from the row and never from anything the caller sends.
There is no test-mode flag in a payload, deliberately: a flag is one typo away
from writing test data with a live key, or binding real cover with a test one.

It is carried onto every `coverage_contexts`, `quotes`, `policies` and `payments`
row the key produces (migration `20260901000013`), which is what makes sandbox
traffic excludable from reporting and safely deletable.

| | Sandbox | Live |
|---|---|---|
| States | Every state, admitted or not | Only the states on the key |
| Carrier | Mock. Policy numbers start `MOCK-` | Mock *for now* — see below |
| Summaries | Prefixed `[SANDBOX — not real cover]` | Plain |
| Binding | Sandbox quotes only | Live quotes only (409 across) |
| Deletable | `purge_sandbox_coverage` | Never |

**Sandbox quotes in states we are not admitted in.** This is the one place the two
environments genuinely behave differently, and it is on purpose: without it, the
order of events for a partner is sign the contract, wait for a filing, *then*
start building. What a sandbox must never do is lie about live — hence the label
in the response, in every summary string, and in the console.

**Live is still a mock carrier for this milestone.** That is a different axis from
sandbox-versus-live and the two must not be conflated: the day a real carrier is
wired in, coverage attached to a signed agreement must already be sitting in the
live half of the data. It is written on `/partners/docs` and in the console so a
partner cannot discover it after signing something.

## Keys

`partner_integrations` holds `sha256(key)` and a display prefix. The raw key is
returned once, from the route that creates it, and there is no endpoint that
reveals it again — losing one means minting another and revoking the old, which
takes about four seconds and is the right amount of friction for a credential.

**No pepper**, unlike signing-link tokens. `lib/coverage/auth.ts` has
authenticated partners as plain `sha256(token)` since the coverage service was
written; adding one without changing that would mint keys that can never
authenticate, and changing both would invalidate every key already issued. The
consequence: there is no single value to rotate that kills every key at once.
`revoked_at` is the lever instead, and `disabled_at` on the partner is the bigger
one — it refuses every key that partner holds.

Rotation is create-then-revoke. The old row stays, holding its hash and the record
of who turned it off.

## Onboarding, and the live-key gate

The steps are code (`lib/partners/onboarding.ts`), not data. Adding one is a
reviewed code change; `partner_onboarding` records only which of them a partner
has completed. The reasoning is in migration `20260901000015`.

Two kinds, and the distinction is the point:

- **observed** — the system saw it happen: a key issued, a sandbox quote that
  returned 200, a bind that succeeded. Nobody can tick these by hand, and
  `/api/admin/partners/[id]/onboarding` refuses with a sentence saying so.
- **attested** — a person said yes: the contract is signed, the states are
  checked, compliance is happy.

Every step marked `blocksGoLive` must be complete before a live key will issue.
The check is in the route, not the UI: "we'll do the compliance review after
launch" is not something that can be arranged by clicking.

`compliance_review` is narrowed further to the `compliance.states` capability. It
is a legal judgement, so the person who makes it is not the person running the
commercial pipeline.

## Branding is co-branding

`partner_branding` exists so a customer halfway through a partner's checkout does
not feel handed off to a stranger. It is **not** white label, and that is a
licensing position rather than a preference.

Our surface presents the offer, gives the disclosures, takes the consent and
handles the payment. That is what keeps the partner from resembling an unlicensed
producer, and it is a statement about who is speaking — which is precisely what
branding communicates. Do not add a column that removes i-Waiver's identity from
the widget, however reasonably a partner asks. The request is commercially normal
and granting it dismantles the structure.

Submitting branding clears `approved_at`, so any change goes back in the queue and
the last approved version keeps rendering until somebody looks at the new one.

## Compensation

Never premium-based. A partner that presents the offer, captures the opt-in and
takes a cut of premium starts to look like an unlicensed producer, which is the
entire problem the embedded widget avoids. `compensation_model` is
`flat_referral`, `platform_fee` or `none`, and the column comment in
`20260829000001` says the same thing. Have counsel structure it per state.

---

# The three kinds of lender

A lender is whoever lends the thing and is a party to the release. There are three,
and the third is the one this section is about.

| | party | account administered by |
|---|---|---|
| individual | a person (`originators.user_id`) | themselves, here |
| company | an organization (`originators.org_id`) | its own staff, here |
| partner-integrated | **still an organization** | a partner platform, over the API |

**The platform is not the lender.** When a waiver platform originates through us,
the lender is *their customer* — Bayside Rentals — and the release runs between
Bayside and the participant. The platform is not a party to it and its name
appears nowhere on the document. What is new is not a third kind of *party*; it is
**provenance**: who administers the account.

So `originators` keeps its two arms (migration `20260901000019` adds no third one)
and gains `managed_by_partner_id` + `partner_external_ref`, with a derived
`channel` of `direct` or `partner`. A partner-managed originator **must** be an
organization — a constraint says so — because `originators.user_id` points at
`auth.users` and a partner cannot create an account for somebody else.

The lender's name on the document has never come from `originators` anyway: it
comes from the `signers` row with role `lender`, snapshotted like everything else.
So the renderer needs no branch for any of this.

## The agreements API

`/api/agreements/v1/*`, a second door with its own scope.

```
POST /api/agreements/v1/lenders            register a customer as a lender
POST /api/agreements/v1/agreements         create one, and send it
GET  /api/agreements/v1/agreements/{id}    where it has got to
```

Both writes are **idempotent on the caller's own `external_ref`**, enforced by
partial unique indexes rather than by application logic. A retry returns what the
first call made. That matters more here than anywhere else in the product, because
the side effect of a duplicate is an email to a real person about a document they
have already been sent.

**Scopes.** `partner_integrations.scopes` defaults to `coverage` alone, and every
key issued before `20260901000019` has exactly that — so nothing gained a power it
did not have. `agreements` is granted only from the admin console, deliberately:
pricing cover against a described risk is bounded, while this creates a legal
instrument in a third party's name and puts it in front of a signer.

**No sandbox.** The agreements API takes live keys only, and says so with
`detail: "sandbox_not_supported"`. A document this API creates is a real document,
hashed and stored write-once, sent to a real address; there is no such thing as a
pretend signature. The alternative — a parallel agreement graph flagged as test —
would put a "this one is fake" column next to evidence, which is exactly the column
that gets set wrong. Build against the coverage sandbox, then run the agreement
flow with a real test lender.

**Signing links come back in the response.** A signing link is the borrower's
entire authorisation (constraint 1), so a partner holding one holds a bearer
credential for their customer's signature. That is intended — the borrower is
usually at their counter and redirecting beats emailing — but it is stated plainly
rather than buried. The email goes out as well, so an unused link still reaches the
person it belongs to.

**Why the licensing structure survives.** The partner creates the *waiver*. The
signer still lands on **our** signing page, where cover is offered, disclosed,
consented to and paid for. The soliciting surface is unchanged, so a partner
originating an agreement is still not a partner selling insurance.

## What blocks it today

Nothing partner-originated can be sent until an **organization** template exists
for the state and activity. Template selection is exact on
(jurisdiction, activity_class, originator_kind) with **no fallback** from
`organization` to `individual` — a business must never receive a private-loan
release with its name in it — and only an FL `individual` template is seeded.

So the API currently returns:

> There is no personal watercraft template for FL for business lenders yet.

That is the guard working, not a bug. It is also the one thing standing between
this and a working integration: it needs counsel's business-lender wording as a
published template version.

---

# Carriers are not partners

The single most important distinction in this document, and the one the schema
originally got wrong.

```
   waiver platform  ──calls──>   us   ──calls──>  carrier
   inbound API key              (we hold their credential)
```

A waiver platform **calls us**: bearer key, `partner_integrations`,
`POST /api/coverage/v1/quote`. A carrier is the exact opposite — we call them,
holding a credential they issued, and they call back with policy and claim
events. Recording a carrier as a partner would hand them a key to an API they
will never use while their real credential had nowhere to live.

So a carrier-kind application (`carrier`, `mga`) still arrives through the same
public form — an inbound lead is an inbound lead — and approval routes it to
`carriers` via `approveCarrierApplication`. The application closes as
`approved_as_carrier`, which exists because `approved` requires a `partner_id`
and `declined` would be the wrong word for something we said yes to.

Approving a carrier issues **nothing**: no account, no key, no email. What
happens next is a contract, then filings, then somebody writes an adapter.

## Where a product may be written

`carrier_state_filings`, one row per (product, state). It replaces
`state_availability.carrier_admitted`, which was a single boolean encoding an
assumption nobody wrote down: that there is exactly one carrier, forever, and it
is anonymous.

- `available_carrier_products(state, activity_class, on)` is the one question the
  coverage service asks — **who** may write **what**, here, today.
- `carrier_admitted` is now a trigger-maintained **cache** of that. Do not set it
  by hand.
- Recording a filing needs `carriers.filings`, which only compliance and super
  admin hold. It is a claim about a regulator's decision and the sole input to
  whether a live quote may be given in a state; somebody under pressure to open
  Texas should not be able to assert that Texas is open.

Routing is **per product, not per carrier**. Physical damage on one carrier's
paper and liability on another's is an ordinary programme, so each quote records
its own `carrier_id` and binding follows the quote. One carrier being unreachable
degrades a quote rather than failing it.

## Credentials, in two directions

| | Outbound (we call them) | Inbound (they call us) |
|---|---|---|
| What | Their API key | A secret they sign webhooks with |
| Stored | The **name** of the env var holding it | A sha256 hash |
| Why | We must send it in clear on every call, so storing it would put a working production credential for someone else's insurance system in every backup | We only ever verify it — same treatment as a partner key |

`carrier_credentials.secret_env_var` has a check constraint enforcing the shape of
an environment variable name, so a secret pasted into that field fails visibly
instead of being written.

## Adapters

`carriers.adapter` names a key in `ADAPTERS` in `lib/coverage/carrier.ts`. There
is **no default and no fallback**: an unregistered adapter means the carrier
cannot be made active, and if one somehow is, `groupByCarrier` drops it with a log
line rather than substituting the mock. A real carrier quoting `MOCK-` policy
numbers under its own name is the worst failure available here.

Adding a real carrier is: write a second `CarrierClient`, register it, set
`adapter`, record the filings, make it active. Nothing else changes.

The seeded `mock` carrier is a real row with three FL filings that mirror what
`lib/coverage/carrier.ts` already returned, so nothing about the signing flow
changed when carriers were modelled. Those filings are mock data, not a statement
about any real filing.

---

# i-Waiver staff

`platform_staff` (migration `20260901000014`) is who works here. Two properties
matter more than the role list:

1. **Access is a grant, not an attribute of an address.** A row is the whole of
   it; revoking ends it on the next request, with no cache and no second place it
   is remembered.
2. **Everything staff do is logged, and the log cannot be edited.**
   `staff_actions` is append-only in the same way `audit_events` is, and for the
   same reason: a support tool that can change a partner's configuration or read a
   customer's record is acceptable only if there is an unarguable record of it.

Roles and capabilities are in `lib/platform/roles.ts`, and rendered on
`/admin/staff` so the answer is readable without opening the repository.

| Role | Shape of it |
|---|---|
| `super_admin` | Everything, including granting staff access and issuing live keys |
| `admin` | Runs the partner pipeline. Cannot put anyone live |
| `support` | Answers tickets. Reads accounts, changes nothing about them |
| `compliance` | Opens states, signs off clause sets |
| `read_only` | Sees the console |

**What staff still cannot do.** Nothing in these migrations opens a path into the
evidence tables. `signatures`, `consent_records`, `documents`, `audit_events`,
`compliance_checks` and `identity_verifications` have no write policy at all and
gain none. A super admin cannot alter what somebody signed. Support looks; it does
not rewrite history.

## Bootstrapping

An empty staff table is a locked door with the key inside.
`IWAIVER_BOOTSTRAP_ADMINS` is the way in: a listed address is treated as a super
admin whether or not a row exists, and the first sign-in writes a real row so the
grant becomes visible like everyone else's.

It is an environment variable so that it is legible in a deploy configuration and
changing it is a deployment. **Empty it once real staff rows exist** — an address
left in it cannot be revoked from inside the product, and `/admin` says so on the
banner while it is still in use.

## Support

`support_tickets` and `support_messages`. One module reads both sides
(`lib/support/tickets.ts`) because the alternative — a customer-facing reader and
a staff-facing reader written separately — is how an internal note ends up on a
customer's screen. There is exactly one function that returns messages to a
customer and it filters `internal` unconditionally; there is no parameter that
turns the filter off, and the database refuses an internal note from a non-staff
author as well.

`first_reply_at` is set on the first non-internal staff message. That number will
eventually appear in a partner integration agreement, so it is recorded from day
one rather than reconstructed later. An internal note does not start the clock.

---

## Not built yet

Stated plainly so nobody mistakes the shape above for a finished platform.

- **The widget itself.** `partner_integrations.integration_kind` accepts `widget`
  and `allowed_origins` is stored and commented, but there is no embeddable
  surface yet and nothing enforces the origin allowlist. Until it exists, `widget`
  describes an intention.
- **Webhook delivery.** The endpoint and the signing secret are stored and
  rotated; nothing sends a delivery, and the `webhook_verified` onboarding step
  therefore cannot complete on its own.
- **Ticket email ingest.** Tickets are raised in the console. A reply to a
  notification email does not land on the thread.
- **Assigning a ticket to a named colleague.** `assigned_to` exists; the console
  offers "assign to me" and nothing else, because a staff picker has not been
  built and a field that takes a uuid is worse than no field.
- **Partner-facing usage reporting.** `last_used_at` is coarse by design (stamped
  at most hourly). There is no call volume, no attach rate, no revenue view.
- **Switching between partners** for somebody who belongs to two. The console
  shows the first and says so.
