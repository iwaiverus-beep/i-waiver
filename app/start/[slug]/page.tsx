import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/service";
import { resolveIntakeLink } from "@/lib/intake/links";
import { StartRequestForm } from "@/components/StartRequestForm";
import { formatCents } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a scanned code lands.
 *
 * Deliberately not behind middleware, exactly like `/sign/[token]`: the person
 * reading this has no account and must never be asked for one. The difference is
 * that a signing page carries a capability in its URL and this one does not, so
 * there is nothing here worth stealing and nothing to expire.
 *
 * Two things are shown before anything is asked. Who the lender is, because
 * somebody who has just pointed a camera at a sticker deserves to know whose form
 * they are filling in. And, for an asset-level code, exactly what they are asking
 * to borrow — read from the lender's own record, never typed here.
 */

export default async function StartPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolveIntakeLink(serviceClient(), slug);

  if (!resolved) notFound();

  const { link, asset, lenderName } = resolved;
  const lender = lenderName ?? "this lender";

  if (link.revoked_at) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-2xl font-semibold text-ink">This code is no longer in use</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          It was withdrawn by {lender}. Printed codes outlive the decision to stop
          using them, so this one still scans — it just does not go anywhere any
          more. Ask them for a current code, or speak to someone there.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Borrowing from
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">{lender}</h1>

      {asset ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            What you are asking for
          </p>
          <p className="mt-2 text-base font-semibold text-ink">
            {[asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
              asset.description}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{asset.description}</p>
          {asset.declared_value_cents !== null && (
            <p className="mt-3 text-sm text-ink-soft">
              Declared value{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatCents(asset.declared_value_cents)}
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          Tell them who you are and when you need it. They will put the details
          together at their end.
        </p>
      )}

      <StartRequestForm slug={slug} lender={lender} />

      <p className="mt-8 text-xs leading-relaxed text-ink-muted">
        This does not commit you to anything. It puts a request in front of {lender};
        if they take it up, they will send you the agreement to read and sign. You
        do not need an account for any of it.
      </p>
    </main>
  );
}
