import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container, Eyebrow, H1, Lede } from "@/components/ui";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Partner integration reference",
  description:
    "Quote and bind: the two calls, the credential, and what sandbox means.",
};

/**
 * The integration reference. Public on purpose — somebody deciding whether to
 * apply should be able to read exactly what they would be building against, and
 * there is nothing secret in it. Every value shown is a shape, never a key.
 *
 * Kept truthful about the current milestone rather than aspirational. A partner
 * who discovers after signing that the carrier is a mock has been misled; one who
 * read it here has been told.
 */
export default function PartnerDocsPage() {
  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-3xl">
        <Eyebrow>Partner integration</Eyebrow>
        <H1>Two calls.</H1>
        <Lede>
          Quote, then bind. Everything else — the waiver, the signatures, the
          document, the audit chain — belongs to whoever owns the agreement, and
          the coverage service never sees any of it.
        </Lede>
      </div>

      <div className="mt-16 max-w-3xl space-y-16">
        <Doc title="The credential">
          <P>
            One header. <Code>Authorization: Bearer &lt;your key&gt;</Code>
          </P>
          <P>
            Keys are minted in the partner console and shown once, at the moment
            they are created. We store a SHA-256 hash and nothing else, so a key
            you lose cannot be recovered — mint another and revoke the old one.
          </P>
          <P>
            A key is bound to one environment. Sandbox keys start{" "}
            <Code>iwk_sk_</Code>, live keys start <Code>iwk_lk_</Code>, so a key
            pasted into the wrong config file is visible before it is used.
          </P>
        </Doc>

        <Doc title="Sandbox and live">
          <P>
            The environment is decided entirely by the key. There is no test-mode
            flag in the payload, deliberately — a flag is one typo away from
            writing test data with a live key, or binding real cover with a test
            one.
          </P>
          <List
            items={[
              "A sandbox key quotes in every state, including states we are not admitted in, so you can build before your states open.",
              "Sandbox premiums are deterministic and the carrier is a mock. Policy numbers start MOCK-.",
              "Every sandbox summary string begins [SANDBOX — not real cover], and every response carries environment: \"sandbox\".",
              "A sandbox quote can only be bound with a sandbox key, and a live quote with a live key. Crossing them is a 409.",
              "Sandbox data can be wiped at any time and never appears in any report.",
            ]}
          />
          <Callout>
            Coverage is behind a mock carrier for the current milestone, in live as
            well as sandbox. The interface is the real one and swapping in a
            carrier changes nothing you integrate against — but nobody should
            discover that after signing something, so it is written here.
          </Callout>
        </Doc>

        <Doc title="POST /api/coverage/v1/quote">
          <P>
            Describe what is happening. Notice what is absent: there is no waiver
            id, no signer id, and no account. A party is described, not referenced.
          </P>
          <Pre>{QUOTE_REQUEST}</Pre>
          <P>And back:</P>
          <Pre>{QUOTE_RESPONSE}</Pre>
          <P>
            <Code>external_ref</Code> is your own handle for a person. It is opaque
            to us, and it is how you say which party the cover is for. Both parties
            may buy — that is two policies, not one policy with two names on it.
          </P>
          <P>
            Lending several things on one agreement? Send <Code>assets</Code> as
            well as <Code>asset</Code>. The lead item stays in{" "}
            <Code>asset</Code> so an integration written against a single item
            never has to change.
          </P>
        </Doc>

        <Doc title="POST /api/coverage/v1/bind">
          <Pre>{BIND_REQUEST}</Pre>
          <P>
            Binding is idempotent per quote. A quote that already has a policy
            returns that policy rather than making a second one, because the common
            failure here is a retried request rather than somebody wanting two of
            the same cover.
          </P>
          <P>
            <Code>collector</Code> decides who takes the premium. Carrier-collected
            is the default and the only one implemented; it keeps everyone out of
            fiduciary trust accounting.
          </P>
        </Doc>

        <Doc title="When it says no">
          <Table
            rows={[
              ["401", "The key is missing, wrong, revoked, or the partner is disabled."],
              ["400", "The payload is wrong. The message says which field."],
              ["403", "Your integration is not enabled for that state."],
              ["409", "The quote expired, or you crossed sandbox and live."],
              [
                "422",
                "carrier_not_admitted — no filed product in that state. Live only; sandbox quotes anywhere.",
              ],
            ]}
          />
          <P>
            Errors are <Code>{`{ "error": "…", "detail": "…" }`}</Code>. The
            detail is a stable machine-readable code where there is one; the error
            is a sentence for a human.
          </P>
        </Doc>

        <Doc title="Webhooks">
          <P>
            Optional, and only worth setting up if you care about what happens to a
            policy after it is bound — cancellation, expiry, a carrier-side change.
            Set an https endpoint in the console and you get a signing secret back
            once.
          </P>
          <P>
            The secret rotates whenever the URL changes. A secret that survived a
            change of endpoint would be a secret you had shared with whatever used
            to be at the old address.
          </P>
        </Doc>

        <Doc title="Testing">
          <P>
            The console has a sandbox tester: paste your sandbox key, pick a state,
            and it runs a real quote — and optionally a real bind — showing you the
            request and the response exactly as your own code will see them.
          </P>
          <P>Or from a terminal:</P>
          <Pre>{CURL}</Pre>
        </Doc>
      </div>

      <div className="mt-20 max-w-3xl rounded-2xl border border-line bg-surface p-8">
        <p className="font-serif text-2xl tracking-tight">Not a partner yet?</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Applying takes about four minutes and the states you operate in are the
          part we look at first.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/partners#apply"
            className="inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
          >
            Apply to partner
          </Link>
          <Link
            href="/partners/console"
            className="inline-flex items-center rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
          >
            Partner console
          </Link>
        </div>
      </div>
    </Container>
  );
}

const QUOTE_REQUEST = `POST /api/coverage/v1/quote
Authorization: Bearer iwk_sk_…
Content-Type: application/json

{
  "context": {
    "activity_class": "personal_watercraft",
    "jurisdiction": "FL",
    "starts_at": "2026-09-14T14:00:00Z",
    "ends_at":   "2026-09-14T20:00:00Z",
    "parties": [
      { "external_ref": "cust_8812", "name": "Marcus Bell",
        "role": "borrower", "age_band": "25-34" },
      { "external_ref": "shop_1",    "name": "Bayside Rentals",
        "role": "lender" }
    ],
    "asset": {
      "asset_class": "pwc",
      "description": "2021 Sea-Doo GTI 130",
      "declared_value_cents": 950000
    }
  },
  "beneficiary_external_ref": "cust_8812"
}`;

const QUOTE_RESPONSE = `200 OK

{
  "coverage_context_id": "…",
  "environment": "sandbox",
  "beneficiary_external_ref": "cust_8812",
  "options": [
    {
      "quote_id": "…",
      "product_code": "PWC-PD-1",
      "coverage_kind": "physical_damage",
      "limit_cents": 950000,
      "deductible_cents": 50000,
      "premium_cents": 2400,
      "rate_plan_version": "mock-2026.08",
      "expires_at": "2026-09-14T13:30:00Z",
      "summary": "[SANDBOX — not real cover] Damage to the ski …"
    }
  ]
}`;

const BIND_REQUEST = `POST /api/coverage/v1/bind
Authorization: Bearer iwk_sk_…

{ "quote_ids": ["…"], "collector": "carrier" }`;

const CURL = `curl -s https://${BRAND.domain}/api/coverage/v1/quote \\
  -H "authorization: Bearer $IWAIVER_SANDBOX_KEY" \\
  -H "content-type: application/json" \\
  -d @quote.json | jq .environment`;

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-sm leading-relaxed text-ink-soft">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-ink">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-5 font-mono text-[12px] leading-relaxed text-ink">
      {children}
    </pre>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="max-w-prose space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
          <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([code, meaning]) => (
            <tr key={code} className="border-b border-line/60 last:border-0">
              <td className="w-20 px-5 py-3 font-mono text-xs text-ink">{code}</td>
              <td className="px-5 py-3 leading-relaxed text-ink-soft">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
      <p className="max-w-prose text-sm leading-relaxed text-flag">{children}</p>
    </div>
  );
}
