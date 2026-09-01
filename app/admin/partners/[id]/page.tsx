import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Panel, Row } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import {
  BrandingReview,
  DangerZone,
  LiveKeyIssuer,
  OnboardingControls,
} from "@/components/AdminPartnerTools";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import { listIntegrations } from "@/lib/partners/integrations";
import { blockersFor, onboardingFor } from "@/lib/partners/onboarding";
import { PARTNER_KIND_LABELS, type PartnerKind } from "@/lib/partners/applications";

export const metadata: Metadata = { title: "Partner" };
export const dynamic = "force-dynamic";

export default async function AdminPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const staff = await currentStaff();
  if (!staff) notFound();

  const { data: partner } = await staff.db
    .from("partners")
    .select("id, name, slug, kind, website, contact_email, approved_at, disabled_at")
    .eq("id", id)
    .maybeSingle();

  if (!partner) notFound();

  const [integrations, progress, members, branding, application, actions] =
    await Promise.all([
      listIntegrations(staff.db, id),
      onboardingFor(staff.db, id),
      staff.db
        .from("partner_members")
        .select("id, email, role, accepted_at")
        .eq("partner_id", id)
        .is("revoked_at", null)
        .order("invited_at"),
      staff.db
        .from("partner_branding")
        .select("display_name, logo_url, primary_color, submitted_at, approved_at")
        .eq("partner_id", id)
        .maybeSingle(),
      staff.db
        .from("partner_applications")
        .select("id, jurisdictions")
        .eq("partner_id", id)
        .maybeSingle(),
      staff.db
        .from("staff_actions")
        .select("id, actor_email, action, detail, created_at")
        .eq("subject_type", "partner")
        .eq("subject_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const blockers = blockersFor(progress);
  const liveKeys = integrations.filter(
    (i) => i.environment === "live" && !i.revoked_at,
  );

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <Link href="/admin" className="text-xs text-ink-muted hover:text-ink">
        ← Queues
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
            {partner.name}
          </h1>
          <p className="mt-2 font-mono text-xs text-ink-muted">{partner.slug}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold ${
            partner.disabled_at
              ? "border-flag/40 bg-flag/[0.08] text-flag"
              : liveKeys.length > 0
                ? "border-accent bg-accent text-paper"
                : "border-line bg-surface text-ink-soft"
          }`}
        >
          {partner.disabled_at ? "Disabled" : liveKeys.length > 0 ? "Live" : "Sandbox"}
        </span>
      </div>

      <div className="mt-10 space-y-8">
        <Panel title="Who they are">
          <dl>
            <Row
              label="Kind"
              value={PARTNER_KIND_LABELS[partner.kind as PartnerKind] ?? partner.kind}
            />
            <Row label="Website" value={partner.website ?? "—"} />
            <Row label="Contact" value={partner.contact_email ?? "—"} />
            <Row
              label="Approved"
              value={
                partner.approved_at
                  ? new Date(partner.approved_at).toLocaleDateString()
                  : "—"
              }
            />
            <Row
              label="People"
              value={
                (members.data ?? []).length === 0
                  ? "Nobody"
                  : (members.data ?? [])
                      .map(
                        (m) =>
                          `${m.email} (${m.role}${m.accepted_at ? "" : ", not signed in"})`,
                      )
                      .join(", ")
              }
            />
          </dl>
        </Panel>

        <Panel
          title="Onboarding"
          description={
            blockers.length === 0
              ? "Complete. A live key can be issued."
              : `${blockers.length} outstanding before a live key can be issued.`
          }
        >
          <OnboardingControls
            partnerId={id}
            steps={progress.map((p) => ({
              key: p.step.key,
              title: p.step.title,
              description: p.step.description,
              kind: p.step.kind,
              owner: p.step.owner,
              blocksGoLive: p.step.blocksGoLive,
              completedAt: p.completedAt,
              note: p.note,
            }))}
            canManage={staffCan(staff.role, "partners.manage")}
          />
        </Panel>

        <Panel
          title="Keys"
          description="Sandbox keys are minted by the partner. Live keys are issued here."
        >
          {integrations.length === 0 ? (
            <Empty>No keys yet.</Empty>
          ) : (
            <ul className="mb-6 space-y-2.5">
              {integrations.map((integration) => (
                <li
                  key={integration.id}
                  className="flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                        integration.environment === "live"
                          ? "border-accent bg-accent text-paper"
                          : "border-line bg-surface text-ink-soft"
                      }`}
                    >
                      {integration.environment}
                    </span>
                    <code className="font-mono text-[12px] text-ink-muted">
                      {integration.key_prefix ?? "—"}
                    </code>
                    <span className="text-ink">
                      {integration.label ?? integration.integration_kind}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {integration.revoked_at
                      ? `revoked ${new Date(integration.revoked_at).toLocaleDateString()}`
                      : `${integration.allowed_jurisdictions.length} states · ${
                          integration.last_used_at ? "in use" : "never used"
                        }`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-line pt-6">
            <LiveKeyIssuer
              partnerId={id}
              suggestedStates={application.data?.jurisdictions ?? []}
              canIssue={staffCan(staff.role, "partners.key.live")}
              blockers={blockers.map((b) => b.title)}
            />
          </div>
        </Panel>

        <Panel
          title="Branding"
          description="Reviewed before it renders — the offer beside it is made in our name."
        >
          {branding.data && (
            <dl className="mb-5">
              <Row label="Display name" value={branding.data.display_name ?? "—"} />
              <Row label="Logo" value={branding.data.logo_url ?? "—"} />
              <Row label="Primary" value={branding.data.primary_color ?? "—"} />
            </dl>
          )}
          <BrandingReview
            partnerId={id}
            submitted={Boolean(branding.data?.submitted_at)}
            approved={Boolean(branding.data?.approved_at)}
            canReview={staffCan(staff.role, "branding.review")}
          />
        </Panel>

        <Panel
          title="Careful"
          description="Both of these are logged with your name on them."
        >
          <DangerZone
            partnerId={id}
            slug={partner.slug}
            disabled={Boolean(partner.disabled_at)}
            canDisable={staffCan(staff.role, "partners.manage")}
            canPurge={staffCan(staff.role, "sandbox.purge")}
          />
        </Panel>

        <Panel title="What we did" description="Append-only. Corrections are new rows.">
          {(actions.data ?? []).length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {(actions.data ?? []).map((action) => (
                <li key={action.id} className="text-sm text-ink-soft">
                  <span className="font-mono text-[11px] text-ink-muted">
                    {new Date(action.created_at).toLocaleString()}
                  </span>{" "}
                  · {action.actor_email} · {action.action}
                  {(action.detail as { reason?: string })?.reason
                    ? ` — ${(action.detail as { reason?: string }).reason}`
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Container>
  );
}
