import type { Metadata } from "next";
import Link from "next/link";
import { Container, DraftNotice, Eyebrow, H1 } from "@/components/ui";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy",
  description: `How ${BRAND.name} handles personal information.`,
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <article className="py-20 sm:py-28">
      <Container>
        <div className="max-w-prose">
          <Eyebrow>Legal</Eyebrow>
          <H1>Privacy</H1>

          <div className="mt-10">
            <DraftNotice>
              This page is a structural outline, not a privacy policy. It has
              not been reviewed by counsel and must not be published as final.
              A signing product handling identity verification touches state
              insurance data-security regimes and biometric privacy statutes,
              and this text is not a substitute for advice on either.
            </DraftNotice>
          </div>

          <div className="mt-12 space-y-10">
            <Clause heading="What we collect">
              Details you enter about an agreement — the parties, the asset, the
              dates and the state. Information captured at signing, including
              consent to transact electronically, the signature itself, and the
              network and device details recorded alongside it as evidence.
              Contact details for delivery. The result of any identity check.
            </Clause>

            <Clause heading="What we deliberately do not collect">
              We do not store biometric identifiers. Where a device unlock is
              used to confirm a signing session, we retain the
              platform&rsquo;s attestation that it succeeded and nothing that
              could reconstruct a face or fingerprint. Where identity
              verification runs, we keep the outcome and the name-match result,
              not the underlying identity documents or imagery.
            </Clause>

            <Clause heading="What the other party sees">
              A lender sees whether a borrower&rsquo;s identity check passed and
              how closely the name matched. They do not see date of birth,
              address, or any document image. Borrowers are told this before
              they sign.
            </Clause>

            <Clause heading="How long we keep it">
              Signed agreements and their evidence are retained well beyond the
              period they describe, because their value is being producible
              later. Identity verification material is held to a short,
              documented schedule and deleted on it. Where a dispute is known, a
              record stops aging out until the matter closes.
            </Clause>

            <Clause heading="Who we share it with">
              Service providers who deliver messages, process payments, verify
              identity, and store documents. Where cover is placed, the
              information a carrier requires to quote and issue a policy, under
              a written data-sharing agreement.
            </Clause>

            {/* Stated here as well as on /legal/messaging because a carrier
                reviewing a messaging registration reads the privacy policy
                looking for this exact assurance, and takes its absence as the
                answer. The two pages must not drift apart. */}
            <Clause heading="Text messages">
              Where you give us a mobile number and agree to be texted about
              your agreement, that number and that agreement are used to reach
              you about it and nothing else. They are never sold, and never
              shared with anyone else for their own marketing. They go only to
              the provider that delivers the message for us. What we send and
              how to stop it is set out on the{" "}
              <Link
                href="/legal/messaging"
                className="underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                text messages page
              </Link>
              .
            </Clause>

            <Clause heading="Your rights">
              Placeholder. State-specific rights of access, correction,
              deletion and appeal, together with how to exercise them and how
              long we take to respond, need to be written against the specific
              states we operate in.
            </Clause>

            <Clause heading="Contact">
              Placeholder — a monitored address and postal address are required
              before this page can be published.
            </Clause>
          </div>
        </div>
      </Container>
    </article>
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
