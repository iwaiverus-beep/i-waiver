import Link from "next/link";
import {
  Button,
  Card,
  Container,
  Disclosure,
  Eyebrow,
  H1,
  H2,
  Lede,
  Section,
} from "@/components/ui";
import { WaitlistForm } from "@/components/WaitlistForm";
import { LIVE, PRIMARY_CTA } from "@/lib/launch";
import { BRAND } from "@/lib/brand";

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-line bg-paper pb-20 pt-20 sm:pb-28 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>{LIVE ? BRAND.tagline : "In development"}</Eyebrow>
            <H1>
              A handshake is not a record.
              <br />
              <span className="text-accent">Make the loan count.</span>
            </H1>
            <Lede>
              When you lend a jet ski, a trailer, or a track day to someone, the
              part that matters happens later — when something goes wrong and
              nobody can prove what was agreed. {BRAND.name} turns the loan into
              a signed agreement both parties keep, with cover for the loan
              period built into the same signature.
            </Lede>
            <div className="mt-10 flex flex-wrap gap-4">
              <Button href={PRIMARY_CTA.href}>{PRIMARY_CTA.label}</Button>
              <Button href="/how-it-works" variant="ghost">
                See how it works
              </Button>
            </div>
            <p className="mt-8 text-sm text-ink-muted">
              Borrowers sign from a link. No account, no app, no download.
            </p>
          </div>
        </Container>
      </section>

      {/* The gap */}
      <Section tone="surface">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <Eyebrow>The gap</Eyebrow>
            <H2>Two problems, and they arrive together.</H2>
          </div>
          <div className="space-y-8">
            <Point title="The paperwork problem">
              A text message saying &ldquo;sure, take it this weekend&rdquo; is
              not evidence of anything. Neither is a waiver printed off the
              internet, signed on a clipboard, and photographed. When it is
              needed, it is needed in front of someone who will read it
              carefully.
            </Point>
            <Point title="The money problem">
              Personal policies frequently exclude the loan. The borrower
              assumes they are covered, the lender assumes the same, and the
              first anyone learns otherwise is at the claim. A signed waiver
              does not repair a damaged hull, and in several states it does not
              do much for the lender either.
            </Point>
            <Point title="Why they belong together">
              A release shifts risk. It does not fund it. Doing one without the
              other leaves whoever signed holding a document that reads well and
              pays nothing.
            </Point>
          </div>
        </div>
      </Section>

      {/* How it works */}
      <Section>
        <Eyebrow>How it works</Eyebrow>
        <H2>Three steps, one signature each.</H2>
        <Lede>
          The whole flow is built so the borrower never has to create an
          account. That is a deliberate constraint, not a shortcut.
        </Lede>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card step="1" title="Describe the loan">
            What is being lent, to whom, where, and for how long. The state
            where the activity happens decides which clauses apply — not where
            anyone lives.
          </Card>
          <Card step="2" title="Both parties sign">
            The borrower gets a link, opens it, reads the agreement, and signs.
            Consent to sign electronically is captured as its own record,
            separately from the signature itself.
          </Card>
          <Card step="3" title="Everyone keeps the record">
            Both sides receive the same document, fingerprinted so any later
            change is detectable, alongside a timestamped history of what
            happened and when.
          </Card>
        </div>

        <div className="mt-10">
          <Button href="/how-it-works" variant="ghost">
            The evidence model in detail
          </Button>
        </div>
      </Section>

      {/* Evidence */}
      <Section tone="ink">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft">
              Why it holds up
            </p>
            <h2 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
              Built to be read back, years later.
            </h2>
            <p className="mt-6 max-w-prose leading-relaxed text-paper/70">
              A waiver&rsquo;s entire value is being producible long after
              everyone has forgotten the weekend it covered. Most of the
              engineering here is about that one requirement.
            </p>
          </div>
          <dl className="space-y-8">
            <DarkPoint term="Versioned wording, never edited">
              Every clause is a published version with a date. When wording
              changes, a new version is published; the old one stays exactly as
              it was, because that is what somebody signed.
            </DarkPoint>
            <DarkPoint term="Signatures bound to the document">
              A signature records the fingerprint of the exact document that was
              on screen at the moment it was signed. Swap a page afterwards and
              the two no longer agree.
            </DarkPoint>
            <DarkPoint term="A history that cannot be quietly edited">
              Sent, delivered, opened, consented, signed — each event is
              appended and linked to the one before it. Removing or altering an
              entry breaks every link after it.
            </DarkPoint>
            <DarkPoint term="Written for the state it happens in">
              What makes a release enforceable differs by state, and in a few
              states it is not enforceable at all. The document is assembled for
              the jurisdiction of the activity, and we would rather tell you
              that plainly than sell you a shield that is not one.
            </DarkPoint>
          </dl>
        </div>
      </Section>

      {/* Audiences */}
      <Section tone="surface">
        <Eyebrow>Who it is for</Eyebrow>
        <H2>The same flow, two very different days.</H2>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <AudienceCard
            href="/individuals"
            title="People who lend their own things"
            body="You bought the boat. Your brother-in-law wants it for the weekend. You would like to stay on good terms with him afterwards, whatever happens on the water."
            cta="For individuals"
          />
          <AudienceCard
            href="/businesses"
            title="Businesses that collect waivers all day"
            body="A rental counter, a track, a shop. Multiple staff sending the same agreement, one shared set of templates, one bill, and a record you can actually retrieve when asked."
            cta="For businesses"
          />
        </div>
      </Section>

      {/* Cover */}
      <Section>
        <div className="max-w-prose">
          <Eyebrow>About the cover</Eyebrow>
          <H2>Offered at signing, where it is available.</H2>
          <Lede>
            The intent is that cover for the loan period is presented as part of
            the agreement — priced, disclosed, and accepted in the same flow,
            rather than sold to you afterwards by someone else.
          </Lede>
          <Disclosure>
            We are building toward this and are not there yet. {BRAND.name} is
            not currently offering, soliciting, or selling insurance. Any
            coverage ultimately made available will be issued by a licensed
            insurer, will depend on that insurer&rsquo;s approval in your state,
            and will be subject to the terms, limits, exclusions and eligibility
            rules of the policy actually issued. Where a waiver is
            unenforceable, we will say so on the agreement rather than let the
            document imply protection it does not provide.
          </Disclosure>
        </div>
      </Section>

      {/*
        The closing panel, once the site is live. Same slot the waitlist held —
        a page whose every other section ends in something to do should not
        finish on a disclosure.
      */}
      {LIVE && (
        <section className="border-t border-line bg-surface py-20 sm:py-28">
          <Container>
            <div className="max-w-prose">
              <Eyebrow>Get started</Eyebrow>
              <H2>Write the first one in a couple of minutes.</H2>
              <p className="mt-6 leading-relaxed text-ink-soft">
                Describe what you are lending, say who is borrowing it and for how
                long, and send it. They sign from a link on their phone — no
                account, no app, nothing to download. You keep the signed
                agreement and so do they.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <Button href={PRIMARY_CTA.href}>{PRIMARY_CTA.label}</Button>
                <Button href="/how-it-works" variant="ghost">
                  See how it works
                </Button>
              </div>
            </div>
          </Container>
        </section>
      )}

      {/* Waitlist — the other face of the slot above. See lib/launch.ts. */}
      {!LIVE && (
      <section id="waitlist" className="scroll-mt-20 border-t border-line bg-surface py-20 sm:py-28">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
            <div>
              <Eyebrow>Early access</Eyebrow>
              <H2>Tell us where you are.</H2>
              <p className="mt-6 max-w-prose leading-relaxed text-ink-soft">
                We are opening one state at a time, and the order depends on
                where the wording has been reviewed and where cover can actually
                be written. Leave your details and we will tell you when yours
                is live.
              </p>
              <p className="mt-6 text-sm text-ink-muted">
                Questions instead?{" "}
                <Link href="/about" className="text-accent underline underline-offset-4">
                  Read what we are building
                </Link>
                .
              </p>
            </div>
            <WaitlistForm />
          </div>
        </Container>
      </section>
      )}
    </>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-accent/30 pl-6">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-3 leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

function DarkPoint({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-base font-semibold text-paper">{term}</dt>
      <dd className="mt-2.5 leading-relaxed text-paper/65">{children}</dd>
    </div>
  );
}

function AudienceCard({
  href,
  title,
  body,
  cta,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-line bg-paper p-8 transition-colors hover:border-accent/40"
    >
      <h3 className="font-serif text-2xl tracking-tight text-ink">{title}</h3>
      <p className="mt-4 leading-relaxed text-ink-soft">{body}</p>
      <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-accent">
        {cta}
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
          →
        </span>
      </span>
    </Link>
  );
}
