import type { Metadata } from "next";
import { Container, DraftNotice, Eyebrow, H1 } from "@/components/ui";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Terms",
  description: `Terms of use for ${BRAND.name}.`,
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <article className="py-20 sm:py-28">
      <Container>
        <div className="max-w-prose">
          <Eyebrow>Legal</Eyebrow>
          <H1>Terms</H1>

          <div className="mt-10">
            <DraftNotice>
              This page is a structural outline, not terms of service. It has
              not been reviewed by counsel and must not be published as final.
              Nothing here creates a contract, and no part of it should be
              relied on.
            </DraftNotice>
          </div>

          <div className="mt-12 space-y-10">
            <Clause heading="What this site is">
              {BRAND.name} is in development. This site describes an intended
              product. It is not an offer to sell anything, it is not a
              solicitation to buy insurance, and no service is currently being
              provided through it.
            </Clause>

            <Clause heading="We are not your lawyer">
              Nothing on this site is legal advice. Whether an agreement is
              enforceable depends on the law of the state where the activity
              happens and on the facts of what occurred. A release is void or
              substantially limited in some states. If the answer matters to
              you, ask a lawyer licensed where you are.
            </Clause>

            <Clause heading="Insurance">
              Any cover eventually offered will be issued by a licensed insurer,
              subject to that insurer&rsquo;s approval in your state and to the
              terms, limits, exclusions and eligibility rules of the policy
              actually issued. Descriptions of cover on this site are
              summaries of intent and are not a policy. The policy governs.
            </Clause>

            <Clause heading="Accounts and eligibility">
              Placeholder. Age of majority, the capacity in which someone signs,
              and the fact that agreements involving minors are out of scope for
              the current product all need to be stated here properly.
            </Clause>

            <Clause heading="Acceptable use">
              Placeholder — prohibited uses, misrepresentation of identity, and
              the consequences of either.
            </Clause>

            <Clause heading="Liability">
              Placeholder. Limitations, exclusions and any cap require drafting
              against the states we operate in, and several of them constrain
              what can be limited at all.
            </Clause>

            <Clause heading="Disputes and governing law">
              Placeholder — venue, governing law, and any dispute-resolution
              mechanism, none of which should be drafted casually.
            </Clause>

            <Clause heading="Changes">
              Placeholder — how changes are notified, and from when they apply.
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
