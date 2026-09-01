import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/service";
import { resolveGroupLink } from "@/lib/agreements/groups";
import { JoinGroupForm } from "@/components/JoinGroupForm";
import { formatInstant, timeZoneFor } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a dock code lands.
 *
 * Not behind middleware, exactly like `/sign/[token]` and `/start/[slug]`: the
 * person reading this has no account and must never be asked for one.
 *
 * What it shows before it asks for anything: who the lender is, what the thing is,
 * and when it runs — all read from the booking, none of it typed by the person
 * standing here. What it deliberately does NOT show is who else has checked in. A
 * code on a counter should not let a passer-by read a list of the families aboard.
 */

const REFUSALS = {
  revoked: {
    title: "This code is no longer in use",
    body: "It was withdrawn. Printed codes outlive the decision to stop using them, so this one still scans — it just does not go anywhere any more. Ask whoever is running the booking.",
  },
  expired: {
    title: "This code has expired",
    body: "Check-in codes last a matter of hours, because a booking is an afternoon. Ask for a current one.",
  },
  full: {
    title: "This code is full",
    body: "It has been used as many times as it allows. That is a cap on the code, not on the booking — ask whoever is running it for another.",
  },
  closed: {
    title: "This booking is closed",
    body: "Nobody else is being added to it. If you are supposed to be aboard, speak to whoever is running it.",
  },
} as const;

export default async function JoinPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolveGroupLink(serviceClient(), slug);

  if (!resolved) notFound();

  const lender = resolved.lenderName ?? "the owner";

  if (resolved.refusal) {
    const { title, body } = REFUSALS[resolved.refusal];
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{body}</p>
      </main>
    );
  }

  const zone = timeZoneFor(resolved.jurisdiction);

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Checking in with
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">{lender}</h1>

      <div className="mt-6 rounded-2xl border border-line bg-surface/50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          What you are taking part in
        </p>
        <p className="mt-2 text-base font-semibold text-ink">
          {resolved.assetDescription}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          {formatInstant(resolved.startsAt, zone)} — {formatInstant(resolved.endsAt, zone)}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {resolved.activityClass.replace(/_/g, " ")} in {resolved.jurisdiction}
        </p>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-ink-soft">
        You are being asked to sign your own release — not to take the{" "}
        {resolved.assetDescription}, and not to be responsible for returning it.
        That sits with whoever booked it.
      </p>

      <JoinGroupForm slug={slug} lender={lender} />
    </main>
  );
}
