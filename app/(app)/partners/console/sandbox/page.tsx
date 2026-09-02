import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { PageIntro } from "@/components/PageIntro";
import { Note, Panel } from "@/components/app-ui";
import { PartnerNav } from "@/components/PartnerNav";
import { SandboxTester } from "@/components/SandboxTester";
import { NoPartnerAccess } from "@/components/NoPartnerAccess";
import { currentPartnerActor } from "@/lib/partners/access";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sandbox" };
export const dynamic = "force-dynamic";

export default async function SandboxPage() {
  const actor = await currentPartnerActor();

  if (!actor) {
    const user = await currentUser();
    return <NoPartnerAccess email={user?.email ?? null} />;
  }

  const membership = actor.memberships[0];

  return (
    <Container className="py-14 sm:py-20">
      <PartnerNav partnerName={membership.partnerName} />

      <PageIntro title="Sandbox" defaultOpen>
        A sandbox key quotes and binds against a mock carrier, in every state,
        including the ones we are not admitted in yet — so you can finish the
        integration before your states open rather than after.
      </PageIntro>

      <div className="mt-10 space-y-8">
        <Panel
          title="Try a call"
          description="Runs a real request through the same endpoint your code will use, and shows you both halves."
        >
          <SandboxTester />
        </Panel>

        <Panel title="What makes it a sandbox">
          <ul className="space-y-2.5">
            {[
              "Premiums are deterministic and the carrier is a mock. Policy numbers start MOCK-.",
              "Every response carries environment: \"sandbox\", and every summary string starts [SANDBOX — not real cover].",
              "Sandbox quotes bind only with sandbox keys. Crossing environments is a 409, not a surprise policy.",
              "Nothing here reaches a report, a bordereau, or a payment processor.",
              "We can wipe it at any time. Ask support if you want a clean slate.",
            ].map((line) => (
              <li
                key={line}
                className="flex gap-3 text-sm leading-relaxed text-ink-soft"
              >
                <span
                  aria-hidden="true"
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Note tone="warn">
          Two things the sandbox will not tell you. It does not check whether we
          are admitted in a state — a live key will, and will refuse. And it does
          not price like a real carrier, because there is not one yet. Build
          against the shapes, not the numbers.
        </Note>
      </div>
    </Container>
  );
}
