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
  title: "For individuals",
  description:
    "Lend your boat, jet ski, trailer or truck on a signed agreement instead of a text message — without making anyone sign up for anything.",
};

export default function IndividualsPage() {
  return (
    <>
      <section className="border-b border-line pb-16 pt-20 sm:pb-20 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>For individuals</Eyebrow>
            <H1>Lend it. Stay on good terms.</H1>
            <Lede>
              The awkward conversation is never about the paperwork. It is about
              money, three weeks later, when the person who borrowed your boat
              does not remember agreeing to anything.
            </Lede>
          </div>
        </Container>
      </section>

      <Section>
        <div className="grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          <div>
            <Eyebrow>A familiar weekend</Eyebrow>
            <H2>&ldquo;Sure, take it Saturday.&rdquo;</H2>
            <div className="mt-6 space-y-5 leading-relaxed text-ink-soft">
              <p>
                Dave has a Sea-Doo. Marcus wants it for the weekend. Dave says
                yes, because Marcus is a friend and saying no over paperwork
                would be worse than the risk.
              </p>
              <p>
                On Sunday the machine comes back with a cracked hull and a story
                about a submerged log. Marcus is sorry. Marcus also assumed he
                was covered by something, and it turns out he was not, and Dave
                discovers his own policy takes a dim view of lending it out.
              </p>
              <p>
                Nothing here was dishonest. Both of them simply never wrote
                anything down, and the money has to come from somewhere.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink">
              What changes
            </p>
            <ul className="mt-6 space-y-5">
              <Bullet>
                Marcus signs before he takes it, from a link on his phone, in
                about a minute.
              </Bullet>
              <Bullet>
                What he agreed to is fixed in writing, in language written for
                the state he is riding in.
              </Bullet>
              <Bullet>
                Both of them keep the same document, and neither can quietly
                change it later.
              </Bullet>
              <Bullet>
                Where it is available, cover for the weekend is part of what he
                signs — so the repair is a claim, not an argument.
              </Bullet>
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="surface">
        <Eyebrow>What you can lend</Eyebrow>
        <H2>If it has a hull number, a VIN, or a serial.</H2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Card title="Personal watercraft">
            Jet skis and the trailer that gets them there.
          </Card>
          <Card title="Boats">
            Runabouts, fishing boats, pontoons. The identifier matters, so we
            ask for it.
          </Card>
          <Card title="Trailers">
            Utility, enclosed, and car haulers — the most-lent thing most people
            own.
          </Card>
          <Card title="Vehicles and off-road">
            Trucks, side-by-sides, dirt bikes, quads.
          </Card>
          <Card title="Equipment">
            Generators, compressors, log splitters, mowers.
          </Card>
          <Card title="Something else">
            The category is open. If it is worth writing down, describe it and
            we will handle it.
          </Card>
        </div>
      </Section>

      <Section>
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <Eyebrow>The rule we will not break</Eyebrow>
            <H2>Your borrower never has to sign up.</H2>
            <p className="mt-6 leading-relaxed text-ink-soft">
              Every product that touches this space eventually tries to make the
              other person create an account. It kills the moment, and half of
              them abandon it standing on the dock.
            </p>
            <p className="mt-5 leading-relaxed text-ink-soft">
              So the borrower signs from a link and that is the whole of it. If
              they want somewhere to keep their copies afterwards, an account is
              offered <em>after</em> the fact — never as a gate in front of the
              signature.
            </p>
          </div>
          <div>
            <Eyebrow>Honest about limits</Eyebrow>
            <H2>Some states will not enforce this.</H2>
            <p className="mt-6 leading-relaxed text-ink-soft">
              A pre-injury release is void or close to it in a handful of
              states, and treated coldly in several more. That is the law, and
              no amount of drafting gets around it.
            </p>
            <p className="mt-5 leading-relaxed text-ink-soft">
              Where that is the case we will tell you on the agreement itself.
              You still get a clear record of the loan and its terms, and the
              cover becomes the part doing the actual work.
            </p>
          </div>
        </div>
      </Section>

      <Section tone="ink">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">
            Lending something this season?
          </h2>
          <Button href={PRIMARY_CTA.href}>{PRIMARY_CTA.label}</Button>
        </div>
      </Section>
    </>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm leading-relaxed text-ink-soft">
      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </li>
  );
}
