import type { Metadata } from "next";
import {
  Button,
  Container,
  Eyebrow,
  H1,
  H2,
  Lede,
  Section,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why a release without funding is half a product, and what we are actually building.",
};

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-line pb-16 pt-20 sm:pb-20 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>About</Eyebrow>
            <H1>A release shifts risk. It does not fund it.</H1>
            <Lede>
              That sentence is the whole reason {BRAND.name} exists. Everything
              else is a consequence of taking it seriously.
            </Lede>
          </div>
        </Container>
      </section>

      <Section>
        <div className="mx-auto max-w-prose space-y-6 leading-relaxed text-ink-soft">
          <p>
            Waiver software is a solved problem, roughly. You can collect a
            signature on a tablet at a counter, and several companies do that
            competently. What none of it does is put money behind the moment it
            describes.
          </p>
          <p>
            So the customer ends up with a document that reads well and pays
            nothing. When something actually happens, the release gets tested by
            somebody whose job is to find a reason it should not apply — and in
            a meaningful number of states, they find one, because a pre-injury
            release is void or nearly so there regardless of how it is drafted.
          </p>
          <p>
            The alternative is not better drafting. It is putting the cover in
            the same signature as the agreement, so that when the release does
            not hold, something else does.
          </p>
          <p>
            That reordering has consequences all the way down. The agreement has
            to be evidence-grade, because a policy that attaches to a document
            nobody can produce is worth very little. The wording has to be
            versioned and immutable, because you have to be able to show what
            somebody saw two years ago. The borrower cannot be forced to make an
            account, because a signing flow with a signup in it does not get
            signed. And the state has to be a first-class input, because
            everything about whether this works is state law.
          </p>
        </div>
      </Section>

      <Section tone="surface">
        <Eyebrow>How we build</Eyebrow>
        <H2>Four commitments, held even when inconvenient.</H2>
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <Principle title="A signer is not a user">
            Borrowers sign from a link and may never create an account. We will
            not add a signup to the signing flow, whatever it would do for our
            numbers.
          </Principle>
          <Principle title="Snapshot, never re-derive">
            What a document said, what an asset was worth, which rules applied —
            all frozen at the time of the event. Historical truth is not
            recalculated from today&rsquo;s data.
          </Principle>
          <Principle title="Corrections add, never overwrite">
            The signature history and the audit trail are append-only. A mistake
            is fixed by adding a record that says so, not by editing the one
            that was wrong.
          </Principle>
          <Principle title="No unreviewed language reaches a signer">
            Operative clauses come from a reviewed, versioned library. Placeholder
            legal text is structurally prevented from reaching anybody who is
            about to sign something.
          </Principle>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-prose">
          <Eyebrow>Where we are</Eyebrow>
          <H2>Early, and specific about it.</H2>
          <div className="mt-6 space-y-5 leading-relaxed text-ink-soft">
            <p>
              We are pre-launch. We are building state by state, because the two
              gates — a carrier able to write in that state, and counsel having
              reviewed the wording for it — are both outside our control and
              neither can be rushed by wanting it more.
            </p>
            <p>
              Adults only to begin with. Agreements involving minors are a
              different product rather than a checkbox: a parental pre-injury
              release is void or near-void in most states, which means the
              minor version has to be built cover-first, with different
              economics and different copy. It deserves to be built properly
              rather than bolted on.
            </p>
            <p>
              If that sounds slower than it needs to be, it is. The alternative
              is selling people a document that does not do what they think it
              does, which is the thing we set out to fix.
            </p>
          </div>
        </div>
      </Section>

      <Section tone="ink">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">
            Want to know when your state opens?
          </h2>
          <Button href="/#waitlist">Request early access</Button>
        </div>
      </Section>
    </>
  );
}

function Principle({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-serif text-xl tracking-tight text-ink">{title}</h3>
      <p className="mt-3 leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
