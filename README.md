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

### 2. Database

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Six migrations. The last two are new: `20260830000005_runtime_functions.sql` adds
the render guard, the shared audit-hash function, the chain verifier and the
storage buckets; `20260830000006_reference_data.sql` seeds state availability, the
Florida rule set and a specimen clause set.

Supabase Auth: for local work, turn **off** email confirmation
(Authentication → Providers → Email), or you will have to confirm every test
account by hand.

### 3. Publish the specimen clauses — development only

Out of the box **nothing will render**, on purpose. The seeded clause set is
unpublished, and `assert_clause_set_reviewed` refuses unpublished wording. That is
CLAUDE.md constraint 5 working, not a bug: placeholder legal language must be
physically incapable of reaching production, so nothing in the migration chain
publishes it.

To exercise the flow locally:

```bash
psql "$DEV_DATABASE_URL" -f supabase/seed/dev_publish_specimen_clauses.sql
```

Read the header of that file before running it against anything you care about.

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
lib/agreements/          lifecycle, signing, authorisation
lib/render/              canonical text + hash, then PDF
lib/coverage/            separate bounded context; reached over HTTP, never imported
supabase/migrations/     the schema. Source of truth.
supabase/seed/           not migrations. Read the headers.
docs/data-model.md       why the schema is shaped this way
```

## Commands

```bash
npm run dev        # next dev
npm run build      # production build
npm run typecheck  # tsc --noEmit — strict mode, and it stays on
```
