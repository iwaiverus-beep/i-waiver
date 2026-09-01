import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  Container,
  Eyebrow,
  H1,
  H2,
  Lede,
  Section,
} from "@/components/ui";
import { PartnerApplicationForm } from "@/components/PartnerApplicationForm";

export const metadata: Metadata = {
  title: "For partners",
  description:
    "Waiver platforms, booking systems and carriers: embed coverage into the signature your customers already collect.",
};

/**
 * The public pitch to platforms and carriers.
 *
 * Written to two quite different readers. A waiver platform wants to know what it
 * costs them to add and what it earns; a carrier wants to know who is doing the
 * soliciting and where the licensing sits. The middle section answers the second
 * question in the open, because a carrier who has to ask it has already decided
 * we have not thought about it.
 */
export default function PartnersPage() {
  return (
    <>
      <section className="border-b border-line pb-16 pt-20 sm:pb-20 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>For partners</Eyebrow>
            <H1>You already have the signature. Add the cover.</H1>
            <Lede>
              Every waiver your platform collects is a moment where somebody is
              about to do something slightly risky and has just been asked to
              acknowledge it. That is the only moment in the entire transaction
              when cover is an obvious idea rather than an interruption — and it
              is a moment you own and we do not.
            </Lede>
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href="#apply"
                className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
              >
                Apply to partner
              </a>
              <Link
                href="/partners/docs"
                className="inline-flex items-center justify-center rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
              >
                Read the integration docs
              </Link>
              <Link
                href="/login?next=/partners/console"
                className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
              >
                Partner sign in
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <Section>
        <Eyebrow>Who this is for</Eyebrow>
        <H2>Two kinds of partner, one interface.</H2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Card title="Waiver platforms">
            You take the release. We attach cover for the activity to it, priced
            for the actual window, and the participant sees one screen rather than
            two.
          </Card>
          <Card title="Booking and rental software">
            The reservation already knows the item, the dates and the person. That
            is the entire quote request — you are holding it before the customer
            arrives.
          </Card>
          <Card title="Carriers and MGAs">
            A distribution channel where the risk data is captured at the point of
            activity rather than reconstructed from a form, and where the
            soliciting is done by a licensed party.
          </Card>
        </div>
      </Section>

      <Section tone="surface">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <Eyebrow>The awkward question, first</Eyebrow>
            <H2>Who is actually selling the insurance?</H2>
            <p className="mt-6 leading-relaxed text-ink-soft">
              We are. That is not a detail — it is the reason this is built the way
              it is.
            </p>
          </div>
          <div className="space-y-7">
            <Feature title="Our surface makes the offer">
              The embedded widget is ours, framed inside your product. It presents
              the offer, gives the disclosures, captures the opt-in and handles the
              money. Your customer sees your brand alongside ours; the offer is
              made in our name.
            </Feature>
            <Feature title="You are not a producer">
              A platform that presents the offer, takes the consent and earns a
              share of premium starts to look like an unlicensed producer. So your
              compensation is never premium-based. It is a flat referral or a
              platform fee, structured per state by counsel.
            </Feature>
            <Feature title="Where the API fits">
              The direct API exists and it is the same one our own app uses — no
              internal shortcuts. But calling it yourself moves the presentation of
              the offer into your product, and that changes the licensing analysis.
              Talk to us before choosing it.
            </Feature>
          </div>
        </div>
      </Section>

      <Section>
        <Eyebrow>What integrating looks like</Eyebrow>
        <H2>A sandbox on day one. Live when it is actually right.</H2>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card step="1" title="Apply">
            Company, contact, states, rough volume. A person reads it — expect a
            few working days.
          </Card>
          <Card step="2" title="Sign in and mint a sandbox key">
            No waiting on us for a credential. Sandbox quotes and binds against a
            mock carrier in every state, and nothing it produces is real.
          </Card>
          <Card step="3" title="Build against the same API we do">
            Two calls: quote, then bind. Our own signing flow goes through the same
            HTTP endpoints with a credential of its own.
          </Card>
          <Card step="4" title="Go live deliberately">
            Contract, states checked against the carrier&rsquo;s filings,
            compliance sign-off, branding reviewed. Then a live key, for the states
            on the list and no others.
          </Card>
        </div>
        <p className="mt-10 max-w-prose text-sm leading-relaxed text-ink-muted">
          The console shows you exactly which of those are outstanding at any
          moment, including the ones that are ours to finish rather than yours.
        </p>
      </Section>

      <Section tone="surface" className="scroll-mt-20">
        <div id="apply" className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <Eyebrow>Apply</Eyebrow>
            <H2>Tell us what you run.</H2>
            <p className="mt-6 leading-relaxed text-ink-soft">
              The states matter more than anything else on this form. These
              agreements are governed by state law, coverage availability follows
              the carrier&rsquo;s filings, and a waiver is not equally enforceable
              everywhere — so where you operate decides how quickly this can be
              useful to you.
            </p>
            <p className="mt-5 text-sm leading-relaxed text-ink-muted">
              Already a partner?{" "}
              <Link href="/login?next=/partners/console" className="text-accent underline">
                Sign in to the console
              </Link>
              .
            </p>
          </div>
          <PartnerApplicationForm />
        </div>
      </Section>
    </>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-accent/30 pl-6">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
