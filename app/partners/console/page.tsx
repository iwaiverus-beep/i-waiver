import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { Note, Panel } from "@/components/app-ui";
import { PartnerNav } from "@/components/PartnerNav";
import { PartnerKeys } from "@/components/PartnerKeys";
import { PartnerTeam } from "@/components/PartnerTeam";
import { NoPartnerAccess } from "@/components/NoPartnerAccess";
import { currentPartnerActor } from "@/lib/partners/access";
import { listIntegrations } from "@/lib/partners/integrations";
import { blockersFor, onboardingFor } from "@/lib/partners/onboarding";
import { partnerCan } from "@/lib/partners/roles";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Partner console" };
export const dynamic = "force-dynamic";

/**
 * The partner's home.
 *
 * Ordered by what somebody actually needs: where they are in onboarding, then the
 * credentials, then who else has access. The checklist is first because the most
 * common question a partner has is "what are we waiting for" — and half the time
 * the answer is us, which the list says out loud rather than leaving them to
 * guess.
 */
export default async function PartnerConsolePage() {
  const actor = await currentPartnerActor();

  if (!actor) {
    const user = await currentUser();
    return <NoPartnerAccess email={user?.email ?? null} />;
  }

  // One company for almost everybody. Somebody with two sees the first here and
  // switches with the picker below; a full workspace switcher is not worth
  // building until more than a handful of people need it.
  const membership = actor.memberships[0];

  const [integrations, progress, membersResult] = await Promise.all([
    listIntegrations(actor.db, membership.partnerId),
    onboardingFor(actor.db, membership.partnerId),
    actor.db
      .from("partner_members")
      .select("id, email, role, accepted_at")
      .eq("partner_id", membership.partnerId)
      .is("revoked_at", null)
      .order("invited_at"),
  ]);

  const members = membersResult.data ?? [];
  const blockers = blockersFor(progress);
  const hasLiveKey = integrations.some(
    (i) => i.environment === "live" && !i.revoked_at,
  );

  return (
    <Container className="py-14 sm:py-20">
      <PartnerNav partnerName={membership.partnerName} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
            {membership.partnerName}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {actor.email} · {membership.role}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold ${
            hasLiveKey
              ? "border-accent bg-accent text-paper"
              : "border-line bg-surface text-ink-soft"
          }`}
        >
          {hasLiveKey ? "Live" : "Sandbox"}
        </span>
      </div>

      {actor.memberships.length > 1 && (
        <p className="mt-4 text-xs text-ink-muted">
          You also have access to{" "}
          {actor.memberships
            .slice(1)
            .map((m) => m.partnerName)
            .join(", ")}
          . Ask support to switch which one this console shows.
        </p>
      )}

      <div className="mt-12 space-y-8">
        <Panel
          title="Getting to live"
          description={
            blockers.length === 0
              ? "Everything on the list is done."
              : `${blockers.length} outstanding before a live key can be issued.`
          }
        >
          <ol className="space-y-3">
            {progress.map(({ step, completedAt, note }) => (
              <li key={step.key} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                    completedAt
                      ? "border-accent bg-accent text-paper"
                      : "border-line text-ink-muted"
                  }`}
                >
                  {completedAt ? "✓" : ""}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-semibold ${
                      completedAt ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    {step.title}
                    {!completedAt && step.owner === "staff" && (
                      <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                        with us
                      </span>
                    )}
                    {!completedAt && !step.blocksGoLive && (
                      <span className="ml-2 text-[11px] font-normal text-ink-muted">
                        optional
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    {note ?? step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="API keys"
          description="Shown once when minted. We store a hash, so a lost key is minted again rather than recovered."
          action={
            <Link
              href="/partners/console/sandbox"
              className="text-xs font-semibold text-accent underline"
            >
              Test a key →
            </Link>
          }
        >
          <PartnerKeys
            partnerId={membership.partnerId}
            integrations={integrations}
            canCreate={partnerCan(membership.role, "keys.create")}
            canRevoke={partnerCan(membership.role, "keys.revoke")}
          />
        </Panel>

        <Panel
          title="Your team"
          description="Everyone here can sign in to this console."
        >
          <PartnerTeam
            partnerId={membership.partnerId}
            members={members}
            canManage={partnerCan(membership.role, "members.manage")}
            isOwner={membership.role === "owner"}
          />
        </Panel>

        <Note>
          Coverage runs against a mock carrier for this milestone, in live as well
          as sandbox. The interface is the real one and nothing you build against
          it changes when a carrier is wired in — but you should know which it is.
        </Note>
      </div>
    </Container>
  );
}
