import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { Note } from "@/components/app-ui";
import { SigningFlow } from "@/components/SigningFlow";
import { serviceClient } from "@/lib/supabase/service";
import { InvalidLink, resolveSigningSession } from "@/lib/agreements/signing";
import { formatCents } from "@/lib/format";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Sign",
  // A signing link in a search index is a signing link in the wrong hands.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = serviceClient();
  const headerList = await headers();

  // Recording the open here — address, agent, timestamp — is what turns "we sent
  // it" into "it arrived". Written once; a refresh does not move it.
  const context = {
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerList.get("user-agent")?.slice(0, 400) ?? null,
  };

  let session;
  try {
    session = await resolveSigningSession(db, token, { touch: context });
  } catch (error) {
    if (error instanceof InvalidLink) {
      return (
        <Container className="py-24">
          <div className="mx-auto max-w-lg text-center">
            <h1 className="font-serif text-3xl tracking-tight">{error.message}</h1>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              {error.reason === "expired" || error.reason === "used"
                ? "Ask whoever sent it for a new one — it only takes them a moment, and a fresh link is safer than a long-lived one."
                : "If you were expecting to sign something, check the most recent email you were sent."}
            </p>
          </div>
        </Container>
      );
    }
    throw error;
  }

  const { document } = session;
  const other = document.signers.find((s) => s.id !== session.signerId);

  // The same page renders for any of the three, so it has to say which side of
  // the loan the reader is on. Told wrong, it hands the lender a document
  // claiming they are borrowing their own thing — or tells somebody who is only
  // riding along that a boat has been lent to them.
  const isLender = session.role === "lender";
  const isParticipant = session.role === "participant";
  const what =
    document.assets.length > 1
      ? `${document.assets.length} things`
      : `the ${document.asset.description}`;

  // The education card belongs to whoever operates the thing, which is the
  // borrower. The compliance gate takes the same view; this keeps the form from
  // asking a question the lender cannot answer — or from asking a passenger for
  // a licence to drive a boat they are not driving, which on a family outing is
  // the question that stops everybody signing.
  const askForEducationCard =
    session.educationRequired && !isLender && !isParticipant;

  return (
    <Container className="py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          For {session.displayName}
        </p>
        <h1 className="mt-3 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
          {isLender
            ? `You are lending ${other?.display_name ?? "someone"} ${what}.`
            : isParticipant
              ? `Your own release, before you take part.`
              : `${other?.display_name ?? "Someone"} is lending you ${what}.`}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-soft">
          {isLender
            ? "Read it, then sign at the bottom. This is your own signature, on your own agreement — the other side signs from their own link."
            : isParticipant
              ? `This covers you and nobody else — everyone else coming signs their own, and no signature stands in for another. You are not taking ${what} and you are not responsible for returning it; that sits with whoever booked it. Read it, then sign at the bottom. You do not need an account.`
              : "Read it, then sign at the bottom. You do not need an account, and you will not be asked to make one."}
        </p>

        <div className="mt-8 space-y-4">
          {document.specimen && (
            <Note tone="warn">
              <strong className="font-semibold">This is a specimen document.</strong> The
              wording has not been reviewed by a lawyer. Do not rely on it.
            </Note>
          )}

          {document.waiverEfficacy === "void" && (
            <Note tone="warn">
              {document.agreement.jurisdiction} does not enforce this kind of release, so
              treat this as a record of the loan rather than something that signs your
              rights away. The cover offered below is where the real protection is.
            </Note>
          )}
        </div>

        <dl className="mt-8 rounded-2xl border border-line bg-surface px-6 py-5">
          <Fact
            label="What"
            value={
              document.assets.length > 1
                ? `${document.assets.length} items — listed below`
                : document.mergeValues.asset_description
            }
          />
          {/* Not shown to a participant. "Worth" is the figure the damage clause
              is measured against, and they do not carry that clause — a number
              on the page invites the reading that they are answerable for it. */}
          {!isParticipant && (
            <Fact label="Worth" value={formatCents(document.totalDeclaredValueCents)} />
          )}
          <Fact label="From" value={document.mergeValues.starts_at} />
          <Fact label="Until" value={document.mergeValues.ends_at} />
          <Fact label="Where" value={document.agreement.jurisdiction} />
        </dl>

        {/* Above the clauses, not below them. The release the borrower is about
            to sign says "the items listed in Schedule A" — if the schedule sits
            after the clause that relies on it, the document tells them to read
            something they have already scrolled past. */}
        {document.assets.length > 1 && (
          <section className="mt-8 rounded-2xl border border-line px-6 py-5">
            <h2 className="font-serif text-lg tracking-tight">
              {isParticipant
                ? "Schedule A — what you are taking part in"
                : "Schedule A — what you are borrowing"}
            </h2>
            <ol className="mt-4 divide-y divide-line">
              {document.assets.map((item, index) => (
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
            <p className="mt-4 text-sm text-ink-soft">
              One signature covers all {document.assets.length}.
            </p>
          </section>
        )}

        <div className="mt-12 space-y-10">
          {document.clauses.map((clause) => (
            <article key={clause.clause_version_id}>
              <h2 className="font-serif text-xl tracking-tight">
                {clause.ordinal}. {clause.label}
              </h2>
              <div className="mt-4 space-y-4">
                {clause.body
                  .split(/\n{2,}/)
                  .map((paragraph) => paragraph.trim())
                  .filter(Boolean)
                  .map((paragraph, index) => {
                    const emphatic =
                      /^\*\*[\s\S]*\*\*$/.test(paragraph) ||
                      clause.conspicuous.bold === true;
                    return (
                      <p
                        key={index}
                        className={`leading-relaxed ${
                          emphatic
                            ? "text-[15px] font-semibold text-ink"
                            : "text-[15px] text-ink-soft"
                        }`}
                      >
                        {paragraph.replace(/\*\*/g, "")}
                      </p>
                    );
                  })}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-14">
          <SigningFlow
            token={token}
            signerName={session.displayName}
            consentText={session.consentText}
            coverRequested={document.agreement.cover_requested}
            documentHash={document.documentHash}
            educationRequired={askForEducationCard}
            educationAuthority={session.educationAuthority}
          />
        </div>

        {/*
          A borrower arrives here from an email and leaves the same way. The
          lender arrives from their own agreement page, so without this they sign
          and land in a room with no door.
        */}
        {isLender && (
          <p className="mt-10 text-center text-sm">
            <Link
              href={`/agreements/${session.agreementId}`}
              className="text-ink-soft underline underline-offset-4 transition-colors hover:text-ink"
            >
              Back to the agreement
            </Link>
          </p>
        )}
      </div>
    </Container>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2.5 last:border-0 sm:flex-row sm:gap-6">
      <dt className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
