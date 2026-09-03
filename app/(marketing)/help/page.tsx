import type { Metadata } from "next";

import { Container, Eyebrow, H1, H2, Lede, Section } from "@/components/ui";
import { HelpForm } from "@/components/HelpForm";
import { BRAND } from "@/lib/brand";
import { retentionFloorYears, supportEmail } from "@/lib/env";

export const metadata: Metadata = {
  title: "Help",
  description:
    "Answers to the questions we are asked most, and a way to reach a person about anything else.",
};

/**
 * The help page.
 *
 * PUBLIC, AND THAT IS THE POINT. It is linked from the account menu, so most
 * people arriving are signed in — but the likeliest single reason anybody opens a
 * help page is that they cannot get into their account, and a help page behind a
 * sign-in cannot help them. It therefore lives in the marketing group with the
 * public masthead, and the form works with or without a session.
 *
 * FAQS ABOVE THE FORM, deliberately. Roughly half of what a support desk
 * receives is a question the product has already answered somewhere nobody was
 * looking, and each one of those costs a customer a day of waiting and costs us a
 * reply. Putting the form first would be easier to build and would collect
 * questions we do not need to be asked.
 *
 * Every answer below is a fact about how this product behaves, not a
 * reassurance. Where a number is configurable it is read from configuration
 * rather than typed here — a help page quoting a retention period the deployment
 * does not honour is worse than one that stays quiet about it.
 */

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Does the person signing need an account?",
    a: (
      <>
        No, and it is deliberate. They get a link, they read the agreement, they
        sign. The link works for a set number of hours — the email says how many
        — and it can be used once. A signing flow with a sign-up in the middle of
        it does not get signed, so there is not one.
      </>
    ),
  },
  {
    q: "The signing link never arrived. What now?",
    a: (
      <>
        Check the spam folder first, then check the address on the agreement for a
        typo — those two account for nearly all of it. {BRAND.name} also records
        what the mail provider did with each link, so if it bounced or was
        rejected the agreement will say so rather than sitting there looking sent.
        If it says delivered and they still have nothing, write to us with the
        agreement reference and we will look at the delivery record.
      </>
    ),
  },
  {
    q: "Several people are coming. Does one signature cover them all?",
    a: (
      <>
        No. Everybody taking part signs their own release, and nobody&rsquo;s
        signature stands in for anybody else&rsquo;s — including a parent signing
        for themselves and then handing the phone on. Responsibility for the thing
        being lent and for returning it stays with whoever booked it, on their own
        agreement; the others are signing a release for taking part.
      </>
    ),
  },
  {
    q: "What is the long string of characters on my signed PDF?",
    a: (
      <>
        A SHA-256 fingerprint of the executed document. Keep it. If the copy you
        are holding ever has to be checked — because somebody disputes what it
        said, which is the only moment any of this matters — that fingerprint is
        how it is done. Change one character of the PDF and it no longer matches.
      </>
    ),
  },
  {
    q: "How long do you keep a signed agreement?",
    a: (
      <>
        At least {retentionFloorYears()} years. It is a floor rather than a
        target: the number can be lengthened but not shortened, because a claim
        can arrive well after everybody has forgotten the loan, and an agreement
        nobody can produce is worth very little.
      </>
    ),
  },
  {
    q: "Is the cover available where I am?",
    a: (
      <>
        Not everywhere, and we will not pretend otherwise. Whether cover can be
        offered depends on the issuing carrier, on that carrier&rsquo;s approval
        in your state, and on eligibility — so it varies by state and it changes
        as filings land. You are shown the options that genuinely apply before you
        sign anything, and no options where there are none.
      </>
    ),
  },
  {
    q: "Can I sign in with Face ID instead of a password?",
    a: (
      <>
        Yes. Your profile has a Face ID and passkeys section — add your device
        there and it becomes a way in on that device. A password stays on the
        account as the fallback, because a passkey lives on hardware and hardware
        gets lost.
      </>
    ),
  },
  {
    q: "Where does money for a loan actually land?",
    a: (
      <>
        Wherever you tell us, under Getting paid in your profile. Nothing is
        collected on your behalf until that is set up — an amount agreed with
        nowhere to send it is not a payment, and we would rather stop at the point
        the information is missing than after it.
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <>
      <section className="border-b border-line pb-16 pt-20 sm:pb-20 sm:pt-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Help</Eyebrow>
            <H1>Answers first, then a person.</H1>
            <Lede>
              The questions below are the ones we are actually asked. If yours is
              not here, the form at the foot of the page reaches a human — and so
              does {supportEmail()}, which is the same desk.
            </Lede>
          </div>
        </Container>
      </section>

      <Section>
        <div className="max-w-3xl">
          <H2>Frequently asked</H2>
          <dl className="mt-10 divide-y divide-line">
            {FAQS.map((faq) => (
              <div key={faq.q} className="py-7 first:pt-0">
                <dt className="text-base font-semibold text-ink">{faq.q}</dt>
                <dd className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
                  {faq.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section tone="surface">
        <div className="max-w-3xl">
          <Eyebrow>Ask us</Eyebrow>
          <H2>Request help, or tell us what to build.</H2>
          <p className="mt-6 max-w-prose text-sm leading-relaxed text-ink-soft">
            Both land on the same desk and both get read. They are asked for
            separately because they are not the same thing: a request for help has
            somebody waiting on an answer, and an idea does not — so ideas are not
            put in a queue in front of people who are stuck, and they are not
            filed as complaints either.
          </p>

          <div className="mt-10">
            <HelpForm />
          </div>

          <p className="mt-6 max-w-prose text-xs leading-relaxed text-ink-muted">
            You will get a confirmation with a reference on it. Replying to that
            email reaches the same people — there is no separate address to
            remember and nothing to sign in to.
          </p>
        </div>
      </Section>
    </>
  );
}
