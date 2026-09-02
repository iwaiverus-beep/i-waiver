import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Panel, Row } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { CarrierOnboardingPanel } from "@/components/CarrierOnboardingPanel";
import {
  CarrierStatusControl,
  CredentialForm,
  FilingForm,
  ProductForm,
} from "@/components/CarrierTools";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  CARRIER_KIND_LABELS,
  carrierStageLabel,
  FILING_STATUS_LABELS,
  carrierDetail,
  type CarrierKind,
  type CarrierStatus,
  type FilingStatus,
} from "@/lib/coverage/admin";
import { registeredAdapters } from "@/lib/coverage/carrier";
import { listActivityClasses } from "@/lib/activities";

export const metadata: Metadata = { title: "Carrier" };
export const dynamic = "force-dynamic";

type Filing = {
  state: string;
  status: string;
  admitted: boolean;
  effective_from: string | null;
  effective_to: string | null;
  filing_ref: string | null;
};

export default async function CarrierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const staff = await currentStaff();
  if (!staff) notFound();

  const { carrier, products, credentials, events, submissions, link } =
    await carrierDetail(staff.db, id);
  if (!carrier) notFound();

  const activities = await listActivityClasses(staff.db);

  const canManage = staffCan(staff.role, "carriers.manage");
  const canFile = staffCan(staff.role, "carriers.filings");
  const adapterRegistered = registeredAdapters().includes(carrier.adapter);

  // Which states this carrier can actually be quoted in right now — the same
  // condition available_carrier_products applies, shown so nobody has to infer it
  // from a table of filings.
  const openStates = new Set<string>();
  for (const product of products as { carrier_state_filings?: Filing[] }[]) {
    for (const filing of product.carrier_state_filings ?? []) {
      if (filing.status === "approved") openStates.add(filing.state);
    }
  }

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <Link href="/admin/carriers" className="text-xs text-ink-muted hover:text-ink">
        ← Carriers
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
            {carrier.name}
          </h1>
          <p className="mt-2 font-mono text-xs text-ink-muted">{carrier.slug}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold ${
            carrier.status === "active"
              ? "border-accent bg-accent text-paper"
              : carrier.status === "suspended" || carrier.status === "terminated"
                ? "border-flag/40 bg-flag/[0.08] text-flag"
                : "border-line bg-surface text-ink-soft"
          }`}
        >
          {carrierStageLabel(carrier)}
        </span>
      </div>

      <div className="mt-10 space-y-8">
        <Panel title="Who they are">
          <dl>
            <Row
              label="Kind"
              value={CARRIER_KIND_LABELS[carrier.kind as CarrierKind] ?? carrier.kind}
            />
            <Row label="NAIC" value={carrier.naic_code ?? "—"} />
            <Row label="AM Best" value={carrier.am_best_rating ?? "—"} />
            <Row
              label="Adapter"
              value={
                <>
                  <code className="font-mono text-xs">{carrier.adapter}</code>
                  {!adapterRegistered && (
                    <span className="ml-2 text-flag">no client registered</span>
                  )}
                </>
              }
            />
            <Row
              label="Contact"
              value={
                carrier.contact_email ? (
                  <>
                    {carrier.contact_name ? `${carrier.contact_name} · ` : ""}
                    <a
                      href={`mailto:${carrier.contact_email}`}
                      className="text-accent underline"
                    >
                      {carrier.contact_email}
                    </a>
                  </>
                ) : (
                  (carrier.contact_name ?? "—")
                )
              }
            />
            <Row
              label="Quoting in"
              value={
                carrier.status !== "active"
                  ? "Nowhere — not active"
                  : openStates.size === 0
                    ? "Nowhere — no approved filing"
                    : [...openStates].sort().join(", ")
              }
            />
            <Row
              label="Notes"
              value={<span className="whitespace-pre-wrap">{carrier.notes ?? "—"}</span>}
            />
          </dl>
        </Panel>

        <Panel title="Status">
          <CarrierStatusControl
            carrierId={id}
            status={carrier.status}
            adapter={carrier.adapter}
            adapterRegistered={adapterRegistered}
            canManage={canManage}
          />
        </Panel>

        <Panel
          title="Onboarding"
          description="What we asked them for, and what they sent back."
        >
          <CarrierOnboardingPanel
            carrierId={carrier.id}
            contactEmail={carrier.contact_email}
            link={link}
            submissions={submissions}
            canManage={canManage}
          />
        </Panel>

        <Panel
          title="Products and filings"
          description="A product may only be quoted in a state with an approved filing that is in force today."
        >
          {products.length === 0 ? (
            <Empty>No products yet.</Empty>
          ) : (
            <ul className="mb-6 space-y-5">
              {products.map((product) => {
                const filings = (product.carrier_state_filings ?? []) as Filing[];
                return (
                  <li key={product.id} className="border-b border-line/60 pb-5 last:border-0">
                    <p className="text-sm font-semibold text-ink">
                      <code className="font-mono text-xs">{product.product_code}</code>{" "}
                      · {product.display_name}
                      {product.retired_at && (
                        <span className="ml-2 text-xs font-normal text-flag">retired</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {product.coverage_kind} · {product.activity_class}
                    </p>
                    {filings.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-muted">
                        Not filed anywhere, so it cannot be quoted.
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {filings
                          .slice()
                          .sort((a, b) => a.state.localeCompare(b.state))
                          .map((filing) => (
                            <li
                              key={filing.state}
                              title={`${
                                FILING_STATUS_LABELS[filing.status as FilingStatus] ??
                                filing.status
                              }${filing.filing_ref ? ` · ${filing.filing_ref}` : ""}${
                                filing.effective_from
                                  ? ` · from ${filing.effective_from}`
                                  : ""
                              }`}
                              className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                                filing.status === "approved"
                                  ? "border-accent/40 bg-accent-soft text-accent"
                                  : "border-line bg-surface text-ink-muted"
                              }`}
                            >
                              {filing.state}
                              {filing.status === "approved" && !filing.admitted
                                ? " (S/L)"
                                : ""}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-5">
            <ProductForm carrierId={id} canManage={canManage} activities={activities} />
            <FilingForm
              carrierId={id}
              products={products as { id: string; product_code: string; display_name: string }[]}
              canFile={canFile}
            />
          </div>
        </Panel>

        <Panel
          title="Credentials"
          description="How we reach them, and how they prove a webhook came from them."
        >
          {credentials.length === 0 ? (
            <Empty>Nothing set.</Empty>
          ) : (
            <ul className="mb-6 space-y-2.5">
              {credentials.map((credential) => (
                <li key={credential.id} className="text-sm text-ink-soft">
                  <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider">
                    {credential.environment}
                  </span>{" "}
                  {credential.base_url ?? "no base URL"} · {credential.auth_kind} ·{" "}
                  <code className="font-mono text-[11px]">
                    {credential.secret_env_var ?? "no secret variable set"}
                  </code>
                </li>
              ))}
            </ul>
          )}
          <CredentialForm carrierId={id} canManage={canManage} />
        </Panel>

        <Panel
          title="What they told us"
          description="Inbound events. An unverified signature is recorded and not acted on."
        >
          {events.length === 0 ? (
            <Empty>Nothing received.</Empty>
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="text-sm text-ink-soft">
                  <span className="font-mono text-[11px] text-ink-muted">
                    {new Date(event.received_at).toLocaleString()}
                  </span>{" "}
                  · {event.event_type}
                  {!event.signature_verified && (
                    <span className="ml-2 font-semibold text-flag">unverified</span>
                  )}
                  {event.error && <span className="ml-2 text-flag">{event.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Container>
  );
}
