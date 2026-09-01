import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Note, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { NewCarrierForm } from "@/components/CarrierTools";
import { currentStaff } from "@/lib/platform/access";
import { staffCan } from "@/lib/platform/roles";
import {
  CARRIER_KIND_LABELS,
  CARRIER_STATUS_LABELS,
  listCarriers,
  type CarrierKind,
  type CarrierStatus,
} from "@/lib/coverage/admin";
import { registeredAdapters } from "@/lib/coverage/carrier";

export const metadata: Metadata = { title: "Carriers" };
export const dynamic = "force-dynamic";

/**
 * Whose paper sits behind the quotes.
 *
 * Separate from /admin/partners on purpose, and the separation is the point of
 * the whole model: a partner CALLS us and holds an inbound key; a carrier is
 * called BY us and holds nothing of ours. Putting them in one list would be the
 * console asserting they are the same kind of relationship.
 */
export default async function CarriersPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const carriers = await listCarriers(staff.db);
  const adapters = registeredAdapters();

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Carriers</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Insurers and MGAs whose paper we write on. Not partners — we hold their
        credential and call them, not the reverse.
      </p>

      <div className="mt-10 space-y-8">
        <Panel title="Everyone" description="Only an active carrier is offered when quoting.">
          {carriers.length === 0 ? (
            <Empty>No carriers yet.</Empty>
          ) : (
            <ul className="divide-y divide-line/60">
              {carriers.map((carrier) => {
                const orphaned = !adapters.includes(carrier.adapter);
                return (
                  <li key={carrier.id}>
                    <Link
                      href={`/admin/carriers/${carrier.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:text-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {carrier.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {CARRIER_KIND_LABELS[carrier.kind as CarrierKind] ??
                            carrier.kind}
                          {carrier.naic_code ? ` · NAIC ${carrier.naic_code}` : ""} ·
                          adapter <code className="font-mono">{carrier.adapter}</code>
                          {orphaned && (
                            <span className="ml-2 font-semibold text-flag">
                              no client registered
                            </span>
                          )}
                        </span>
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                          carrier.status === "active"
                            ? "border-accent bg-accent text-paper"
                            : carrier.status === "suspended" ||
                                carrier.status === "terminated"
                              ? "border-flag/40 bg-flag/[0.08] text-flag"
                              : "border-line bg-surface text-ink-soft"
                        }`}
                      >
                        {CARRIER_STATUS_LABELS[carrier.status as CarrierStatus] ??
                          carrier.status}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Add one">
          <NewCarrierForm canManage={staffCan(staff.role, "carriers.manage")} />
        </Panel>

        <Note>
          Registered adapters:{" "}
          {adapters.map((a) => (
            <code key={a} className="mr-2 font-mono text-xs">
              {a}
            </code>
          ))}
          . A carrier whose adapter is not on this list cannot be made active, and
          is never quietly served by the mock — that would put MOCK- policy numbers
          under a real insurer&rsquo;s name.
        </Note>
      </div>
    </Container>
  );
}
