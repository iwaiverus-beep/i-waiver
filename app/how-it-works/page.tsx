import type { Metadata } from "next";
import {
  Button,
  Container,
  Disclosure,
  Eyebrow,
  H1,
  H2,
  Lede,
  Section,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "From describing the loan to a record that can be produced years later — the agreement flow and the evidence behind it.",
};

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-line pb-16 pt-20 sm:pb-20 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>How it works</Eyebrow>
            <H1>From a favour to a record.</H1>
            <Lede>
              The flow is short on purpose. Everything else described here
              happens underneath it, so that the document still means something
              when it is read back by someone looking for a reason it should
              not.
            </Lede>
          </div>
        </Container>
      </section>

      <Section>
        <ol className="space-y-16">
          <Step
            n="1"
            title="Describe the loan"
            body="What is being lent, who is borrowing it, where it will be used, and for how long. The asset can be a thing — a hull number, a VIN — or it can be an activity, like a track session. The state you enter is where the activity happens, which is not always where either party lives, and it is the state whose law will decide whether the release holds."
            aside="The details you enter are frozen onto the agreement when it is sent. If you change the declared value of your boat in September, the agreement from June still says what it said in June."
          />
          <Step
            n="2"
            title="The borrower signs from a link"
            body="They receive a link, open it, and read the agreement. They consent to signing electronically — recorded as its own separate entry, because a signature with no record of consent is a weaker record — and then they sign. There is no account to create and no app to install."
            aside="The link is single-use and short-lived. Reissuing one creates a new link rather than reviving the old, so the history shows exactly which link was used and when."
          />
          <Step
            n="3"
            title="Checks run before anything is binding"
            body="Age, any certification the state requires for the activity, and whether the jurisdiction is one we can serve at all. These are blocking, not advisory. If we told you a borrower was eligible and the claim later denied on a fact we could have checked, you would be looking at us, not at the carrier."
            aside="The rule set used is versioned. We can show which rules were applied on the day, not merely which rules apply now."
          />
          <Step
            n="4"
            title="Both parties get the same document"
            body="A single document, fingerprinted, delivered to everyone who signed it. Alongside it sits a history: created, sent, delivered, opened, consented, signed — each entry timestamped and linked to the one before."
            aside="Corrections never overwrite. A mistake is fixed by voiding the agreement and executing a new one, with the two linked, so the trail shows what happened instead of hiding it."
          />
        </ol>
      </Section>

      <Section tone="surface">
        <div className="max-w-prose">
          <Eyebrow>Retention</Eyebrow>
          <H2>Kept for as long as it could matter.</H2>
          <p className="mt-6 leading-relaxed text-ink-soft">
            The window in which an injury claim can be brought runs to two or
            three years in most states, and longer for written contracts. A
            record that expires before the risk does is not much of a record, so
            documents stay retrievable well past the loan they describe.
          </p>
          <p className="mt-5 leading-relaxed text-ink-soft">
            The thing we delete aggressively is identity verification imagery.
            We keep the result — whether a check passed, and how closely the
            name matched — and not the underlying documents. A lender sees the
            outcome, never the borrower&rsquo;s date of birth, address, or ID
            photograph.
          </p>
          <p className="mt-5 leading-relaxed text-ink-soft">
            If a dispute is known, the record stops aging out entirely,
            regardless of any retention setting.
          </p>
        </div>
      </Section>

      <Section tone="ink">
        <div className="max-w-prose">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft">
            Where cover fits
          </p>
          <h2 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
            Priced in the flow, not sold afterwards.
          </h2>
          <p className="mt-6 leading-relaxed text-paper/70">
            The design intent is that cover for the loan period is quoted while
            the agreement is being signed, disclosed in plain terms, and
            accepted in the same step. Both parties can be covered — they are
            different people with different exposure, so that is two separate
            policies rather than one with two names on it.
          </p>
          <p className="mt-5 leading-relaxed text-paper/70">
            Where a waiver is not enforceable, the cover is the entire value and
            the document is a record of the loan rather than a shield. We would
            rather say that on the page than let the paperwork imply otherwise.
          </p>
        </div>
        <Disclosure>
          <span className="text-paper/50">
            {BRAND.name} is in development and is not currently offering,
            soliciting, or selling insurance. Any coverage made available will
            be issued by a licensed insurer and subject to that insurer&rsquo;s
            approval in your state, and to the terms, limits, exclusions and
            eligibility rules of the policy actually issued.
          </span>
        </Disclosure>
      </Section>

      <Section>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <H2>Want it in your state?</H2>
          <Button href="/#waitlist">Request early access</Button>
        </div>
      </Section>
    </>
  );
}

function Step({
  n,
  title,
  body,
  aside,
}: {
  n: string;
  title: string;
  body: string;
  aside: string;
}) {
  return (
    <li className="grid gap-8 lg:grid-cols-[auto_1fr_20rem] lg:gap-12">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-serif text-lg text-accent">
        {n}
      </span>
      <div>
        <h3 className="font-serif text-2xl tracking-tight text-ink">{title}</h3>
        <p className="mt-4 leading-relaxed text-ink-soft">{body}</p>
      </div>
      <p className="border-l-2 border-line pl-6 text-sm leading-relaxed text-ink-muted lg:border-l lg:pl-6">
        {aside}
      </p>
    </li>
  );
}
