import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { CarrierOnboardingForm } from "@/components/CarrierOnboardingForm";
import { serviceClient } from "@/lib/supabase/service";
import { resolveOnboardingLink } from "@/lib/coverage/onboarding";
import { partnerTeamEmail } from "@/lib/env";

export const metadata: Metadata = {
  title: "Your details",
  // Same reasoning as the signing page: a link that identifies one carrier and
  // accepts text attributed to them does not belong in a search index.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The one page in this product a carrier ever sees.
 *
 * No account, no password, no navigation into anything else — the token is the
 * whole of the authorisation and it reaches exactly one carrier's own record.
 * That constraint is why the page can be this plain: there is nothing else here
 * to get to.
 */
export default async function CarrierOnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveOnboardingLink(serviceClient(), token);

  if (!resolved.ok) {
    // Three different sentences for three different situations, because they
    // need different actions. Sending someone to support to be told to open the
    // newer email already in their inbox is a waste of both their afternoons.
    const message =
      resolved.reason === "expired"
        ? "This link has expired."
        : resolved.reason === "revoked"
          ? "This link has been replaced."
          : "This link is not valid.";

    const detail =
      resolved.reason === "expired"
        ? "Links are good for two weeks. Write to us and we will send a fresh one."
        : resolved.reason === "revoked"
          ? "We sent a newer one — check your inbox for a more recent email from us before asking for another."
          : "Check that the whole address was copied across; they are long and email clients sometimes break them over two lines.";

    return (
      <Container className="py-24">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="font-serif text-3xl tracking-tight">{message}</h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">{detail}</p>
          <p className="mt-6 text-sm text-ink-soft">
            <a
              className="font-semibold text-accent underline-offset-4 hover:underline"
              href={`mailto:${partnerTeamEmail()}`}
            >
              {partnerTeamEmail()}
            </a>
          </p>
        </div>
      </Container>
    );
  }

  const { carrier, previous } = resolved.link;

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
          {carrier.name}
        </p>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">
          Tell us about your paper.
        </h1>
        <p className="mt-5 leading-relaxed text-ink-soft">
          You have been approved, and this is the first of three steps before
          anything can be quoted on your paper — this form, then your filings
          recorded state by state, then an adapter written against your API and
          tested in your sandbox.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          Nothing here is published or acted on automatically. A person reads it
          and accepts it onto your record, and you can reopen this link to correct
          anything you send.
        </p>

        <CarrierOnboardingForm
          token={token}
          carrier={carrier}
          previous={previous}
          contactEmail={partnerTeamEmail()}
        />
      </div>
    </Container>
  );
}
