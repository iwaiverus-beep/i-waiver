import { PRIMARY_CTA } from "@/lib/launch";
import type { Metadata } from "next";
import {
  Button,
  Card,
  Container,
  Eyebrow,
  H1,
  H2,
  Lede,
  Section,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "For businesses",
  description:
    "Rental counters, tracks and shops: the same agreement flow with shared templates, multiple staff, and records you can actually retrieve.",
};

export default function BusinessesPage() {
  return (
    <>
      <section className="border-b border-line pb-16 pt-20 sm:pb-20 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>For businesses</Eyebrow>
            <H1>Waivers you can find again.</H1>
            <Lede>
              Collecting the signature is the easy part. The hard part arrives
              eighteen months later, when someone asks for the exact document a
              specific customer signed on a specific afternoon, and the honest
              answer is that nobody knows.
            </Lede>
          </div>
        </Container>
      </section>

      <Section>
        <Eyebrow>Who this fits</Eyebrow>
        <H2>Anywhere the same agreement is signed all day.</H2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Card title="Rental operations">
            Watercraft, powersports, trailers, equipment. High volume, same
            document, different customer every time.
          </Card>
          <Card title="Tracks and venues">
            Motocross, karting, off-road parks. Participants who arrive in
            groups and want to be riding, not queueing.
          </Card>
          <Card title="Shops and dealers">
            Demo rides, loaners, and test units going out the door with someone
            you met ten minutes ago.
          </Card>
        </div>
      </Section>

      <Section tone="surface">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <Eyebrow>What you get</Eyebrow>
            <H2>An organisation wrapper around the same flow.</H2>
            <p className="mt-6 leading-relaxed text-ink-soft">
              The agreement itself is identical to the one an individual sends.
              What the business tier adds is everything around it.
            </p>
          </div>
          <div className="space-y-7">
            <Feature title="Multiple staff, one account">
              Anyone on the counter can send an agreement. Roles decide who can
              change templates and who can only send them.
            </Feature>
            <Feature title="Shared templates">
              One reviewed set of wording per state and activity, used by
              everybody, versioned so you can prove which version was in use in
              any given month.
            </Feature>
            <Feature title="A dashboard that answers questions">
              Who signed, when, from where, and what exactly they saw. Retrieval
              is the feature, not an afterthought.
            </Feature>
            <Feature title="One bill">
              Per organisation, not per staff member sending links.
            </Feature>
            <Feature title="Cover offered to your customers">
              Where available, the same cover offered in the individual flow,
              presented to your customer at signing.
            </Feature>
          </div>
        </div>
      </Section>

      <Section>
        <div className="max-w-prose">
          <Eyebrow>What this is not</Eyebrow>
          <H2>We would rather be narrow and honest.</H2>
          <p className="mt-6 leading-relaxed text-ink-soft">
            The first version is deliberately not a kiosk product, does not
            integrate with your booking system, and does not do bulk operations.
            Those are real features and other people have spent years building
            them well.
          </p>
          <p className="mt-5 leading-relaxed text-ink-soft">
            Competing there would mean a long feature war over things that have
            nothing to do with why we exist. What we are building is the
            agreement being worth something, and the cover being part of it. If
            you need kiosk mode today, we are not the right choice today, and we
            would rather say so than take the contract.
          </p>
        </div>
      </Section>

      <Section tone="ink">
        <div className="max-w-prose">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft">
            A note on your own insurance
          </p>
          <h2 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
            Two different things, often confused.
          </h2>
          <p className="mt-6 leading-relaxed text-paper/70">
            Cover offered to <em>your customers</em> at signing is what this
            product is about. Commercial liability cover for{" "}
            <em>your business</em> is a different line entirely — an annual
            placement, usually through a commercial broker, with its own
            underwriting appetite.
          </p>
          <p className="mt-5 leading-relaxed text-paper/70">
            They are not the same purchase and we will not pretend otherwise.
            If you need the second one, you need a broker, and we will say so.
          </p>
        </div>
      </Section>

      <Section tone="surface">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <H2>Run somewhere that takes waivers?</H2>
          <Button href={PRIMARY_CTA.href}>{PRIMARY_CTA.label}</Button>
        </div>
      </Section>
    </>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-accent/30 pl-6">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
