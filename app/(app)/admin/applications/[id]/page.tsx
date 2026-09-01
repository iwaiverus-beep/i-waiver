import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Panel, Row } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { ApplicationDecision } from "@/components/ApplicationDecision";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  PARTNER_KIND_LABELS,
  VOLUME_BAND_LABELS,
  isCarrierApplication,
  type PartnerKind,
} from "@/lib/partners/applications";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const staff = await currentStaff();
  if (!staff) notFound();

  const { data: application } = await staff.db
    .from("partner_applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!application) notFound();

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <Link href="/admin" className="text-xs text-ink-muted hover:text-ink">
        ← Queues
      </Link>

      <h1 className="mt-4 font-serif text-3xl tracking-tight sm:text-4xl">
        {application.company_name}
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        Applied {new Date(application.created_at).toLocaleDateString()} ·{" "}
        {application.status}
      </p>

      <div className="mt-10 space-y-8">
        <Panel title="What they told us">
          <dl>
            <Row
              label="Kind"
              value={
                PARTNER_KIND_LABELS[application.partner_kind as PartnerKind] ??
                application.partner_kind
              }
            />
            <Row
              label="Website"
              value={
                application.website ? (
                  <a
                    href={application.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent underline"
                  >
                    {application.website}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row
              label="Contact"
              value={
                <>
                  {application.contact_name}{" "}
                  <a
                    href={`mailto:${application.contact_email}`}
                    className="text-accent underline"
                  >
                    {application.contact_email}
                  </a>
                  {application.contact_phone ? ` · ${application.contact_phone}` : ""}
                </>
              }
            />
            <Row
              label="States"
              value={
                application.jurisdictions?.length
                  ? application.jurisdictions.join(", ")
                  : "None given"
              }
            />
            <Row
              label="Volume"
              value={
                application.volume_band
                  ? (VOLUME_BAND_LABELS[application.volume_band] ??
                    application.volume_band)
                  : "—"
              }
            />
            <Row
              label="Integration"
              value={application.integration_interest ?? "Not sure yet"}
            />
            <Row
              label="Notes"
              value={
                <span className="whitespace-pre-wrap">
                  {application.notes ?? "—"}
                </span>
              }
            />
          </dl>
        </Panel>

        {application.partner_id ? (
          <Panel title="Approved" description="This application created a partner.">
            <Link
              href={`/admin/partners/${application.partner_id}`}
              className="text-sm font-semibold text-accent underline"
            >
              Open the partner →
            </Link>
          </Panel>
        ) : (
          <Panel
            title="Decision"
            description="Where this goes depends on what they are."
          >
            <ApplicationDecision
              applicationId={application.id}
              status={application.status}
              canDecide={staffCan(staff.role, "partners.review")}
              isCarrier={isCarrierApplication(application.partner_kind)}
            />
          </Panel>
        )}
      </div>
    </Container>
  );
}
