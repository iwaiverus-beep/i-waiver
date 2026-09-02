import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Mono, Note, Panel, Row, StatusBadge } from "@/components/app-ui";
import { AgreementActions } from "@/components/AgreementActions";
import { BookingPanel } from "@/components/BookingPanel";
import { SignerContact } from "@/components/SignerContact";
import { SigningLinks } from "@/components/SigningLinks";
import { VerifyChain } from "@/components/VerifyChain";
import {
  agreementForActor,
  NotAuthorised,
  requireActor,
} from "@/lib/agreements/access";
import { assembleAgreement, type AssembledDocument } from "@/lib/render/agreement";
import { formatCents, formatDateTime, shortHash } from "@/lib/format";

export const metadata: Metadata = { title: "Agreement" };
export const dynamic = "force-dynamic";

export default async function AgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let actor;
  let agreement;
  try {
    actor = await requireActor();
    agreement = await agreementForActor(actor, id);
  } catch (error) {
    if (error instanceof NotAuthorised) notFound();
    throw error;
  }

  const { db } = actor;

  const [{ data: signers }, { data: auditRows }, { data: checks }, { data: documents }] =
    await Promise.all([
      db
        .from("signers")
        .select("id, role, display_name, email, phone, capacity, signed_at, declined_at")
        .eq("agreement_id", id)
        .order("order_index"),
      db
        .from("audit_events")
        .select("id, occurred_at, event_type, actor, payload, hash")
        .eq("agreement_id", id)
        .order("id"),
      db
        .from("compliance_checks")
        .select("check_kind, result, blocking, evidence, checked_at")
        .eq("agreement_id", id)
        .order("checked_at", { ascending: false }),
      db
        .from("documents")
        .select("id, kind, sha256, rendered_at")
        .eq("agreement_id", id)
        .order("rendered_at", { ascending: false }),
    ]);

  // The render guard lives in the database, so the honest thing to do when it
  // refuses is show the refusal rather than an empty page.
  let document: AssembledDocument | null = null;
  let renderProblem: string | null = null;
  try {
    document = await assembleAgreement(db, id);
  } catch (error) {
    renderProblem = (error as Error).message;
  }

  const lender = (signers ?? []).find((s) => s.role === "lender");
  // Borrower on a loan, participant on a release from a booking. One counterparty
  // either way; only what the page calls them differs, and it has to differ —
  // heading somebody "Borrower" who never had the boat is the one line on the
  // screen that would be quoted back.
  const borrower = (signers ?? []).find(
    (s) => s.role === "borrower" || s.role === "participant",
  );
  const participantRelease = borrower?.role === "participant";

  // What became of the last email to the other party.
  //
  // Newest link only. Older ones are the record of previous attempts and belong
  // in the audit trail, not on a panel whose job is "is this getting through
  // right now". `signing_links` is revoked from both client roles, so this is read
  // here on the service client and passed down as a status, never as a token.
  const { data: lastLink } = borrower
    ? await db
        .from("signing_links")
        .select("delivery_status, delivery_detail, delivery_status_at, created_at")
        .eq("signer_id", borrower.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // The edit is only safe while nothing is bound to the current document hash —
  // see lib/agreements/contact.ts. The server enforces it; this decides whether
  // to offer the control at all.
  const nobodyHasSigned = (signers ?? []).every((s) => !s.signed_at);

  // False when the render failed, which is right: with no assembled document
  // there is no schedule to show, and the refusal above is the useful thing.
  const bundled = (document?.assets.length ?? 0) > 1;

  // What the agreements app knows about cover comes from its own audit trail, not
  // from reading the coverage service's tables. That boundary is the whole point of
  // constraint 9, and a "just this once" join here would quietly undo it.
  const coverEvents = (auditRows ?? []).filter((e) =>
    ["quoted", "bound", "paid"].includes(e.event_type),
  );
  const boundPolicies = coverEvents
    .filter((e) => e.event_type === "bound")
    .map((e) => e.payload as Record<string, unknown>);

  return (
    <Container className="py-14 sm:py-20">
      <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
        ← All agreements
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">
            {borrower?.display_name ?? "Agreement"}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {agreement.activity_class.replace(/_/g, " ")} in {agreement.jurisdiction} ·{" "}
            created {formatDateTime(agreement.created_at)}
          </p>
        </div>
        <StatusBadge status={agreement.status} />
      </div>

      <div className="mt-8 space-y-4">
        {document?.specimen && (
          <Note tone="warn">
            <strong className="font-semibold">Specimen clause set.</strong> The wording for{" "}
            {agreement.jurisdiction} has not been reviewed by counsel, so every document
            produced here is labelled as a specimen and must not be relied on. This is
            the guard working, not a bug.
          </Note>
        )}

        {document?.waiverEfficacy === "void" && (
          <Note tone="warn">
            {agreement.jurisdiction} does not enforce pre-injury releases. This document
            is a record of the loan and of what both of you understood — the cover is
            where the protection actually sits.
          </Note>
        )}

        {agreement.legal_hold_at && (
          <Note tone="warn">
            <strong className="font-semibold">Under legal hold</strong> since{" "}
            {formatDateTime(agreement.legal_hold_at)}. Retention rules do not apply and
            this agreement cannot be voided or removed.
          </Note>
        )}

        {agreement.status === "voided" && (
          <Note tone="warn">
            Voided {formatDateTime(agreement.voided_at)}
            {agreement.voided_reason ? ` — ${agreement.voided_reason}` : ""}.
          </Note>
        )}

        {renderProblem && (
          <Note tone="warn">
            <strong className="font-semibold">This will not render yet.</strong>{" "}
            {renderProblem}
          </Note>
        )}
      </div>

      <div className="mt-8">
        <AgreementActions
          agreementId={id}
          status={agreement.status}
          underLegalHold={Boolean(agreement.legal_hold_at)}
        />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Panel title={participantRelease ? "The activity" : "The loan"}>
            <dl>
              <Row label="Lender" value={`${lender?.display_name ?? "—"} · ${lender?.email ?? ""}`} />
              <Row
                label={participantRelease ? "Participant" : "Borrower"}
                value={`${borrower?.display_name ?? "—"} · ${borrower?.email ?? ""}`}
              />
              <Row
                label={bundled ? "Items" : "Asset"}
                value={
                  bundled
                    ? `${document!.assets.length}, listed below`
                    : (document?.mergeValues.asset_description ?? "—")
                }
              />
              {/* No declared value on a participant release. It is the figure the
                  damage clause is measured against, and they do not carry that
                  clause — a number beside their name invites the reading that
                  they do. */}
              {!participantRelease && (
                <Row
                  label={bundled ? "Total declared value" : "Declared value"}
                  value={formatCents(document?.totalDeclaredValueCents)}
                />
              )}
              <Row label="From" value={document?.mergeValues.starts_at ?? "—"} />
              <Row label="Until" value={document?.mergeValues.ends_at ?? "—"} />
              <Row
                label={bundled ? "Item details" : "Asset details"}
                value={
                  agreement.asset_snapshot
                    ? "Frozen onto this agreement when it was sent"
                    : "Still reading the live list — frozen when you send"
                }
              />
            </dl>
          </Panel>

          <BookingPanel
            agreementId={id}
            groupId={agreement.group_id ?? null}
            groupRole={agreement.group_role ?? null}
            borrowerName={borrower?.display_name ?? "They"}
          />

          {/* The schedule, only where there is one. A single-item agreement
              already said everything in the panel above, and repeating it as a
              one-row table would be furniture. */}
          {bundled && (
            <Panel
              title={
                participantRelease
                  ? "Schedule A — items involved"
                  : "Schedule A — items lent"
              }
              description={
                participantRelease
                  ? "What this person is taking part in. Nothing here is lent to them — the numbering is what appears on the document."
                  : "These go on one waiver, signed once. The numbering is what appears on the document."
              }
            >
              <ol className="divide-y divide-line">
                {document!.assets.map((item, index) => (
                  <li
                    key={`${item.description}-${index}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {index + 1}.{" "}
                        {[item.year, item.make, item.model]
                          .filter(Boolean)
                          .join(" ") || item.description}
                      </p>
                      <p className="text-sm text-ink-soft">
                        {item.description}
                        {item.identifier ? ` · ${item.identifier}` : ""}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums text-ink-soft">
                      {formatCents(item.declared_value_cents)}
                    </p>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {document && (
            <Panel
              title="What they will sign"
              description={`${document.clauses.length} clauses from ${document.templateLabel}. This is the exact text, with your details filled in.`}
            >
              <div className="space-y-8">
                {document.clauses.map((clause) => (
                  <article key={clause.clause_version_id}>
                    <h3 className="text-sm font-semibold text-ink">
                      {clause.ordinal}. {clause.label}
                    </h3>
                    <div className="mt-3 space-y-3">
                      {clause.body
                        .split(/\n{2,}/)
                        .map((paragraph) => paragraph.trim())
                        .filter(Boolean)
                        .map((paragraph, index) => (
                          <p
                            key={index}
                            className={`text-sm leading-relaxed ${
                              /^\*\*[\s\S]*\*\*$/.test(paragraph)
                                ? "font-semibold text-ink"
                                : "text-ink-soft"
                            }`}
                          >
                            {paragraph.replace(/\*\*/g, "")}
                          </p>
                        ))}
                    </div>
                    <p className="mt-3">
                      <Mono>sha256 {clause.body_hash}</Mono>
                    </p>
                  </article>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title="Audit trail"
            description="Append-only and hash-chained. Each entry is hashed together with the one before it."
            action={<VerifyChain agreementId={id} />}
          >
            {(auditRows ?? []).length === 0 ? (
              <Empty>Nothing recorded yet.</Empty>
            ) : (
              <ol className="space-y-3">
                {(auditRows ?? []).map((event) => (
                  <li key={event.id} className="border-b border-line/60 pb-3 last:border-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {event.event_type.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {formatDateTime(event.occurred_at)} · by {event.actor}
                      </span>
                    </div>
                    <p className="mt-1">
                      <Mono>{shortHash(event.hash)}</Mono>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          {/*
            Drafts too, which is the whole of why the condition is not the same
            one that governs the links. `updateSignerContact` has always allowed
            `draft` — the address is only frozen once somebody signs — but the
            editor lived inside a panel that appeared at send. So a lender who
            spotted their own typo before sending had no way to correct it and
            the only remedy for gmial.com was to throw the draft away and build
            it again, which is the exact "start over" this feature exists to
            avoid. It just happened one step earlier than anybody tested.
          */}
          {["draft", "sent", "partially_signed"].includes(agreement.status) &&
            borrower && (
            <Panel
              title={agreement.status === "draft" ? "Reaching them" : "Signing links"}
              description={
                agreement.status === "draft"
                  ? "Where this goes when you send it."
                  : "Tokenised, single use, 48 hours."
              }
            >
              <div className="space-y-6">
                {agreement.status !== "draft" && (
                  <SigningLinks
                    agreementId={id}
                    lenderSigned={Boolean(lender?.signed_at)}
                    borrowerSigned={Boolean(borrower.signed_at)}
                    borrowerName={borrower.display_name}
                  />
                )}

                {/* Below the buttons, not above them. The ordinary visit is
                    "send this to them"; the address is only interesting once
                    that has failed, and the panel says so loudly when it has. */}
                {!borrower.signed_at && (
                  <SignerContact
                    agreementId={id}
                    signerId={borrower.id}
                    name={borrower.display_name}
                    email={borrower.email}
                    phone={borrower.phone}
                    canEdit={nobodyHasSigned}
                    awaitingSend={agreement.status === "draft"}
                    delivery={
                      lastLink
                        ? {
                            status: lastLink.delivery_status,
                            detail: lastLink.delivery_detail,
                            at: lastLink.delivery_status_at,
                          }
                        : null
                    }
                  />
                )}
              </div>
            </Panel>
          )}

          <Panel title="Signatures">
            <ul className="space-y-3">
              {(signers ?? []).map((signer) => (
                <li key={signer.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{signer.display_name}</p>
                    <p className="text-xs text-ink-muted">{signer.role}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      signer.signed_at ? "text-accent" : "text-ink-muted"
                    }`}
                  >
                    {signer.signed_at
                      ? `Signed ${formatDateTime(signer.signed_at)}`
                      : signer.declined_at
                        ? "Declined"
                        : "Not yet"}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Cover"
            description="Reported from this agreement's own audit trail — the coverage service is a separate context and is not read from here."
          >
            {coverEvents.length === 0 ? (
              <Empty>Nothing quoted yet. Cover is offered at signing.</Empty>
            ) : (
              <ul className="space-y-3">
                {boundPolicies.map((policy, index) => (
                  <li key={index} className="text-sm">
                    <p className="font-semibold text-ink">
                      {String(policy.coverage_kind ?? "cover").replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {String(policy.policy_number ?? "")} ·{" "}
                      {formatCents(Number(policy.premium_cents ?? 0))}
                    </p>
                  </li>
                ))}
                {boundPolicies.length === 0 && (
                  <Empty>Quoted, but nothing bound.</Empty>
                )}
              </ul>
            )}
          </Panel>

          <Panel title="Documents">
            {(documents ?? []).length === 0 ? (
              <Empty>Produced once everyone has signed.</Empty>
            ) : (
              <ul className="space-y-3">
                {(documents ?? []).map((doc) => (
                  <li key={doc.id}>
                    <p className="text-sm font-semibold text-ink">
                      {doc.kind.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {formatDateTime(doc.rendered_at)}
                    </p>
                    <p className="mt-1">
                      <Mono>sha256 {doc.sha256}</Mono>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Compliance"
            description="Blocking, not advisory. Each check names the rule set version it applied."
          >
            {(checks ?? []).length === 0 ? (
              <Empty>Runs when you send.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {(checks ?? []).slice(0, 10).map((check, index) => (
                  <li key={index} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-ink-soft">
                      {check.check_kind.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        check.result === "pass"
                          ? "text-accent"
                          : check.result === "fail"
                            ? "text-flag"
                            : "text-ink-muted"
                      }`}
                    >
                      {check.result}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {document && (
            <Panel title="Fingerprint">
              <p className="text-xs leading-relaxed text-ink-muted">
                The hash of the exact wording above. Every signature on this agreement is
                bound to it.
              </p>
              <p className="mt-2">
                <Mono>{document.documentHash}</Mono>
              </p>
            </Panel>
          )}
        </div>
      </div>
    </Container>
  );
}
