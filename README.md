# iWaiver

A two-party agreement platform with embedded insurance. Someone lends an asset,
both parties sign, and cover for the loan period is part of what they sign.

Working name — see `CLAUDE.md` for what is decided and what is not.

## Getting it running

### 1. Environment

```bash
# Create .env.local (see "Environment" below for the variables it needs)
```

Fill in, at minimum:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page. Server only. Bypasses RLS. |
| `SIGNING_LINK_TOKEN_PEPPER` | generate one, below |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`RESEND_API_KEY` is optional. Without it the app still runs end to end: emails are
written to the server log and recorded as transport `console`, never as delivered.
The borrower's signing link is shown in the terminal and on the agreement page.

`RESEND_WEBHOOK_SECRET` is how the app finds out what became of a message it sent.
`delivered_at` on a signing link has only ever meant the provider accepted it — a
full mailbox or a mistyped domain bounces after that, and without the webhook it
bounces silently. Add an endpoint in Resend → Webhooks pointing at

```
https://<your host>/api/webhooks/resend
```

subscribed to `email.sent`, `email.delivered`, `email.delivery_delayed`,
`email.bounced` and `email.complained`, then paste its `whsec_…` signing secret in.
Until it is set the endpoint refuses every request rather than trusting unsigned
ones — a caller who could forge a bounce could send a lender chasing an address
that was fine.

Optional, for the partner and admin consoles:

| Variable | What it does |
|---|---|
| `IWAIVER_BOOTSTRAP_ADMINS` | Comma-separated addresses that become super admins on first sign-in. The only way into an empty `/admin`. Clear it once real staff rows exist — an address left here cannot be revoked from inside the product. |
| `PARTNER_NOTIFICATIONS_EMAIL` | Where a new partner application is announced. Without it the application is still saved, and a warning says nobody was told. |
| `SUPPORT_EMAIL` | The address customers are pointed at. Defaults to `support@` the brand domain. |

Grant yourself admin access the first time:

```bash
# in .env.local
IWAIVER_BOOTSTRAP_ADMINS=you@example.com
# then sign in at /login and open /admin
```

### 2. Database

```bash
node scripts/db-push.mjs           # dry run: lists what is pending
node scripts/db-push.mjs --apply
```

Not `supabase db push`. The CLI rejects the newer `sbp_v0_` personal access token
format, and an ambient `SUPABASE_ACCESS_TOKEN` (a publishable `sb_publ...` key on
at least one machine here) shadows the real one regardless. The script drives the
Management API instead and records each migration in
`supabase_migrations.schema_migrations`, so `supabase migration list` still agrees
with reality.

Six migrations. The last two are new: `20260830000005_runtime_functions.sql` adds
the render guard, the shared audit-hash function, the chain verifier and the
storage buckets; `20260830000006_reference_data.sql` seeds state availability, the
Florida rule set and a specimen clause set.

Supabase Auth: for local work, turn **off** email confirmation
(Authentication → Providers → Email), or you will have to confirm every test
account by hand.

The emails Auth does send — confirmation, password reset, magic link — are ours
rather than Supabase's defaults. They live in `supabase/templates/`; see the
README there and `scripts/setup-auth-emails.mjs`.

### 3. Publish the specimen clauses — development only

Out of the box **nothing will render**, on purpose. The seeded clause set is
unpublished, and `assert_clause_set_reviewed` refuses unpublished wording. That is
CLAUDE.md constraint 5 working, not a bug: placeholder legal language must be
physically incapable of reaching production, so nothing in the migration chain
publishes it.

To exercise the flow locally:

```bash
node scripts/db-run.mjs supabase/seed/dev_publish_specimen_clauses.sql --apply
```

The runner prints that file's header before it executes anything, and refuses to
act without `--apply`. Read the header. It is the only warning you get, and the
database it runs against is whichever one `.env.local` points at.

Publishing does not make the wording reviewed, and the product still says so:
`state_availability.clause_set_reviewed_at` stays NULL, Florida keeps computing to
`cover_only`, and every rendered document carries both a SPECIMEN banner and a
cover-only banner. Do not remove those to tidy up a demo.

### 4. Run

```bash
npm install
npm run dev
```

## The path this proves

1. Dave signs up at `/login` and creates a draft at `/agreements/new`.
2. He presses **Send for signature**. The compliance gate runs, the asset facts are
   frozen onto the agreement, the document is rendered and hashed, and two
   single-use links are minted. Marcus gets his by email.
3. Marcus opens his link. No account, no password. He reads the agreement, is
   offered cover priced for exactly those days, attests he is 18+, consents to sign
   electronically, and signs — typed or drawn.
4. Dave signs his own copy from the agreement page.
5. On the last signature the executed PDF is rendered, hashed, stored write-once,
   and emailed to both.
6. **Verify the chain** on the agreement page recomputes every audit hash in the
   database and says whether the record still holds.

## What is real and what is not

Real: the schema, the evidence model, the hash chain, the compliance gate, the
render guard, the token model, the PDF.

Mocked or absent, deliberately:

- **The carrier.** `lib/coverage/carrier.ts` is a deterministic stand-in. Policy
  numbers begin `MOCK-`. No policy exists with any insurer.
- **Identity verification.** Recorded as `skipped`, because nobody checked.
- **Payment.** Premium is carrier-collected; the platform-collected branch exists
  in the schema and not in the code. Stripe is not in the path.
- **The legal wording.** Specimen text, unreviewed. Florida therefore computes to
  `cover_only` and every document produced says so on its face.

## Layout

```
app/                     marketing site, lender area, signing page, API routes
  api/coverage/v1/       the coverage service's front door — partners use these too
  sign/[token]/          the borrower's entire experience
  partners/              public pitch + docs, and the partner console
  admin/                 i-Waiver's own console. Staff roles, not a URL secret.
lib/agreements/          lifecycle, signing, authorisation
lib/render/              canonical text + hash, then PDF
lib/coverage/            separate bounded context; reached over HTTP, never imported
lib/partners/            applications, membership, keys, onboarding
lib/platform/            staff roles and the staff action log
lib/support/             tickets, and the one reader that strips internal notes
supabase/migrations/     the schema. Source of truth.
supabase/seed/           not migrations. Read the headers.
docs/data-model.md       why the schema is shaped this way
docs/partners.md         how a partner gets from applying to live
```

## Commands

```bash
npm run dev        # next dev
npm run build      # production build
npm run typecheck  # tsc --noEmit — strict mode, and it stays on
```

### Operational scripts

Every one reads credentials from `.env.local` — never the ambient environment —
and every one is a dry run until you pass `--apply`.

```bash
node scripts/db-push.mjs      --apply   # pending migrations
node scripts/db-run.mjs <file> --apply  # one SQL file (the seeds live here)
node scripts/setup-deploy.mjs --apply   # Vercel project, env vars, domains, Cloudflare DNS
node scripts/setup-email.mjs  --apply   # register the domain with Resend, write its DNS
node scripts/setup-auth-emails.mjs --apply  # our name and sender on the auth emails
```

They share a preflight that refuses to run against the wrong account: the Vercel
token must resolve to exactly one team and not LeadLynk's, the Cloudflare token
must reach `i-waiver.com` and nothing else, and the Supabase token must see
exactly one project. This machine carries LeadLynk credentials in its ambient
environment, so that is a guard rather than a courtesy.

`setup-deploy.mjs` is a description of the correct state, not a one-time action —
re-running it corrects drift, including a DNS record that has been switched to
proxied. Vercel needs those records DNS-only.
