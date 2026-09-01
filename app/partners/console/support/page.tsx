import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { Panel } from "@/components/app-ui";
import { PartnerNav } from "@/components/PartnerNav";
import { SupportPanel, type Thread } from "@/components/SupportPanel";
import { NoPartnerAccess } from "@/components/NoPartnerAccess";
import { currentPartnerActor } from "@/lib/partners/access";
import { partnerCan } from "@/lib/partners/roles";
import { customerMessages } from "@/lib/support/tickets";
import { currentUser } from "@/lib/supabase/server";
import { supportEmail } from "@/lib/env";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function PartnerSupportPage() {
  const actor = await currentPartnerActor();

  if (!actor) {
    const user = await currentUser();
    return <NoPartnerAccess email={user?.email ?? null} />;
  }

  const membership = actor.memberships[0];

  const { data: tickets } = await actor.db
    .from("support_tickets")
    .select("id, reference, subject, category, status, created_at")
    .eq("partner_id", membership.partnerId)
    .order("created_at", { ascending: false })
    .limit(50);

  // Threads are assembled here rather than fetched from the client: the page
  // already has an authorised connection, and customerMessages is the only reader
  // that strips internal notes.
  const threads: Thread[] = await Promise.all(
    (tickets ?? []).map(async (ticket) => ({
      ...ticket,
      messages: await customerMessages(actor.db, ticket.id),
    })),
  );

  return (
    <Container className="py-14 sm:py-20">
      <PartnerNav partnerName={membership.partnerName} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Support</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Anything about the integration, the sandbox, a state, or a policy. Tickets
        raised here are visible to everyone on your team, so a colleague can pick
        one up without being forwarded a thread.
      </p>

      <div className="mt-10 space-y-8">
        <Panel
          title="Your tickets"
          description={`Or write to ${supportEmail()} — it reaches the same people.`}
        >
          <SupportPanel
            partnerId={membership.partnerId}
            threads={threads}
            canWrite={partnerCan(membership.role, "support.write")}
          />
        </Panel>
      </div>
    </Container>
  );
}
