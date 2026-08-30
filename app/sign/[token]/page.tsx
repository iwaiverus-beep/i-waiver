import type { Metadata } from "next";
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

  return (
    <Container className="py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          For {session.displayName}
        </p>
        <h1 className="mt-3 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
          {other?.display_name ?? "Someone"} is lending you the{" "}
          {document.asset.description}.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-soft">
          Read it, then sign at the bottom. You do not need an account, and you will not
          be asked to make one.
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
          <Fact label="What" value={document.mergeValues.asset_description} />
          <Fact label="Worth" value={formatCents(document.asset.declared_value_cents)} />
          <Fact label="From" value={document.mergeValues.starts_at} />
          <Fact label="Until" value={document.mergeValues.ends_at} />
          <Fact label="Where" value={document.agreement.jurisdiction} />
        </dl>

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
            educationRequired={session.educationRequired}
            educationAuthority={session.educationAuthority}
          />
        </div>
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
