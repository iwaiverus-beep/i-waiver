import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { PageHeading } from "@/components/PageHeading";
import { Note, Panel } from "@/components/app-ui";
import { PartnerNav } from "@/components/PartnerNav";
import { BrandingForm } from "@/components/BrandingForm";
import { NoPartnerAccess } from "@/components/NoPartnerAccess";
import { currentPartnerActor } from "@/lib/partners/access";
import { partnerCan } from "@/lib/partners/roles";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Branding" };
export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const actor = await currentPartnerActor();

  if (!actor) {
    const user = await currentUser();
    return <NoPartnerAccess email={user?.email ?? null} />;
  }

  const membership = actor.memberships[0];

  const { data: branding } = await actor.db
    .from("partner_branding")
    .select(
      "display_name, logo_url, primary_color, accent_color, theme, support_email, support_url, submitted_at, approved_at, review_note",
    )
    .eq("partner_id", membership.partnerId)
    .maybeSingle();

  return (
    <Container className="py-14 sm:py-20">
      <PartnerNav partnerName={membership.partnerName} />

      <PageHeading title="Branding">
        Your mark alongside ours in the embedded widget, so a customer who is
        halfway through your checkout does not feel handed off to a stranger.
      </PageHeading>

      <div className="mt-10 space-y-8">
        <Panel
          title="Your marks"
          description="Reviewed before it renders, because the offer beside it is made in our name."
        >
          <BrandingForm
            partnerId={membership.partnerId}
            branding={branding ?? null}
            canSubmit={partnerCan(membership.role, "branding.submit")}
          />
        </Panel>

        <Note tone="warn">
          This is co-branding, not white label, and that is a licensing position
          rather than a preference. Our surface presents the offer, gives the
          disclosures, takes the consent and handles the payment — which is what
          keeps you from looking like an unlicensed producer. Removing our identity
          from the frame would take that structure apart, so it is not something we
          can switch on. If a white-label arrangement is genuinely what you need,
          say so in a support ticket and we will have the real conversation.
        </Note>
      </div>
    </Container>
  );
}
