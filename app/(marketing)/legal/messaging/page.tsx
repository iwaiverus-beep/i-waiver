import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow, H1 } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { supportEmail } from "@/lib/env";

/**
 * The text-messaging disclosures, written to be read by a carrier.
 *
 * This page is not the same kind of document as /legal/privacy or /legal/terms,
 * and that is why it does not carry their draft notice. Those two make legal
 * claims about rights, liability and data handling that counsel has to write.
 * This one only describes what our own program does — what we send, how often,
 * how to stop it, and what we do with a number once we have it. Every sentence
 * is a fact about our system that we control and can honour, so it can be
 * published as written and then simply kept true.
 *
 * It exists because it is a precondition, not a nicety. Toll-free verification
 * and A2P registration are both reviewed by a human who opens the site and
 * looks for exactly these disclosures and for the place the number is entered;
 * their absence is the most common rejection. The matching opt-in language
 * lives on the borrower's own form in components/StartRequestForm.tsx, and the
 * two have to keep saying the same thing.
 *
 * Asks to be indexed, unlike the other legal pages. They are noindex because
 * nobody should arrive at an unfinished policy from a search result; this one
 * has the opposite job and is meant to be found. It changes nothing today —
 * app/robots.ts disallows the whole site while it is in preview, so nothing is
 * being crawled either way — and it is set here so that deleting that file at
 * launch leaves this page findable without anybody having to remember it.
 *
 * A reviewer never depended on that. They open the URL, which the footer of
 * every page links to.
 */

export const metadata: Metadata = {
  title: "Text messages",
  description: `What ${BRAND.name} sends by text message, and how to stop it.`,
  robots: { index: true, follow: true },
};

export default function MessagingPage() {
  const support = supportEmail();

  return (
    <article className="py-20 sm:py-28">
      <Container>
        <div className="max-w-prose">
          <Eyebrow>Legal</Eyebrow>
          <H1>Text messages</H1>

          <p className="mt-6 text-lg leading-relaxed text-ink-soft">
            {BRAND.name} can send you a text message when there is an agreement
            waiting for your signature. This page says exactly what we send, how
            often, and how to make it stop.
          </p>

          <div className="mt-12 space-y-10">
            <Clause heading="What we send">
              One kind of message, and only one: a link to an agreement someone
              has asked you to sign, and a reminder if you have not signed it by
              the time the loan is due to start. That is the entire program. We
              do not send marketing, offers, product news, or anything about
              anyone else&rsquo;s agreement.
            </Clause>

            <Clause heading="How you come to get one">
              You gave us your mobile number yourself, on the form where you
              asked to borrow something, and ticked the box beside it agreeing
              to be texted about it. Nobody else can turn texting on for you. If
              the person lending you the item typed your number in for you, we
              still ask you before we use it.
            </Clause>

            <Clause heading="How often">
              Not recurring. Messages are tied to a specific agreement, so you
              get them when one is sent to you and not otherwise — in practice,
              one or two messages per rental. If you never ask to borrow
              anything again, you will never hear from us again.
            </Clause>

            <Clause heading="Stopping them">
              Reply <Cmd>STOP</Cmd> to any message. That ends texts to that
              number immediately and permanently, and you do not have to explain
              it to anyone. Reply <Cmd>HELP</Cmd> for help, or write to{" "}
              <a
                href={`mailto:${support}`}
                className="underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                {support}
              </a>
              .
            </Clause>

            <Clause heading="Stopping texts does not cancel your agreement">
              Opting out changes how we reach you, not what you have signed or
              still need to sign. If there is an agreement waiting and you have
              given us an email address, the link goes there instead. If we have
              no other way to reach you, the person lending you the item will
              have to.
            </Clause>

            <Clause heading="What your number costs you">
              Message and data rates may apply, depending on your plan and your
              carrier. We do not charge for messages, and your carrier is not
              responsible for delayed or undelivered ones.
            </Clause>

            <Clause heading="What we do with your number">
              We use it to reach you about your own agreement, and for nothing
              else. Your mobile number and your agreement to be texted are never
              sold, and never shared with anyone for their own marketing. They
              are shared only with the messaging provider that delivers the
              message on our behalf, which is the same arrangement as the
              company that delivers our email. The wider account of what we hold
              and why is on the{" "}
              <Link
                href="/legal/privacy"
                className="underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                privacy page
              </Link>
              .
            </Clause>

            <Clause heading="Which numbers">
              US mobile numbers. We do not text landlines, and we do not send
              internationally.
            </Clause>
          </div>
        </div>
      </Container>
    </article>
  );
}

function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-[0.9em] font-semibold tracking-wide text-ink">
      {children}
    </code>
  );
}

function Clause({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-serif text-xl tracking-tight text-ink">{heading}</h2>
      <p className="mt-3 leading-relaxed text-ink-soft">{children}</p>
    </section>
  );
}
