import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { AgreementsList } from "@/components/AgreementsList";
import { Note } from "@/components/app-ui";
import { userClient } from "@/lib/supabase/server";
import { requireActor } from "@/lib/agreements/access";
import { fetchAgreementPage, fetchListSummary } from "@/lib/agreements/list";
import { parseListParams } from "@/lib/agreements/list-types";
import { countFinishedBefore, defaultSweepCutoff } from "@/lib/agreements/archive";
import { retentionFloorYears } from "@/lib/env";
import { pendingRequests } from "@/lib/intake/requests";
import { staffFor } from "@/lib/platform/access";

export const metadata: Metadata = { title: "Your agreements" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard");

  // Filters survive a refresh and a shared link, so the first page rendered here
  // has to be the page the URL asks for — not the default one, briefly, followed
  // by a fetch that replaces it.
  const resolved = await searchParams;

  // Staff land in the console, not here.
  //
  // WHY THE REDIRECT IS HERE AND NOT AT THE SIGN-IN. There are four ways in —
  // password, passkey, an OAuth round trip, and arriving at /login with a live
  // session — and every one of them defaults to /dashboard. Three of the four
  // decide that destination BEFORE the session exists, so none of them can ask
  // whether the person signing in works here. The destination can. One check, at
  // the place they all arrive.
  //
  // `?as=lender` is the way back. A staff member may also lend their own things,
  // and a redirect with no exit would make their own agreements unreachable —
  // the account menu links here with that parameter for exactly this reason.
  if (resolved.as !== "lender") {
    // `staffFor` rather than `currentStaff`, because the session is already
    // resolved three lines up and re-resolving it is a wasted round trip.
    if (await staffFor(user)) redirect("/admin");
  }

  const params = parseListParams(
    new URLSearchParams(
      Object.entries(resolved).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  // Read as the signed-in user, not as the service role: the participation
  // policies decide what comes back, which is exactly the check we want here.
  const [page, counts] = await Promise.all([
    fetchAgreementPage(supabase, params),
    fetchListSummary(supabase),
  ]);

  // The inbound queue. Read on the service client through the actor's originators,
  // because agreement_requests is lender-side only and has no participation policy
  // to lean on — a request has no signers yet, which is the whole point of it.
  const actor = await requireActor();
  const waiting = await pendingRequests(actor.db, actor.originatorIds);
  const waitingCount = waiting.length;
  const firstRequestId = waiting[0]?.id;

  // How much of the list has run its course. Counted here rather than in the
  // browser so the offer to tidy up arrives with the page instead of appearing
  // under the reader's thumb a moment later.
  const sweepBefore = defaultSweepCutoff();
  const sweepCount = await countFinishedBefore(actor, sweepBefore);

  return (
    <Container className="py-14 sm:py-20">
      <AppNav />
      {/* No action button here: "Lend something" leads AppNav, so it sits in the
          same place on every lender screen rather than moving around. */}
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Your agreements</h1>
      </div>

      {/* Somebody has scanned a code and is, quite possibly, standing there.
          Deliberately a card and not a redirect: auto-opening the form on arrival
          would mean a lender with a pending request could never reach their own
          dashboard while it sat there. One waiting request still goes straight
          into the prefilled form in a single tap, which is the part that matters
          at a counter. */}
      {waitingCount > 0 && (
        <Link
          href={waitingCount === 1 ? `/agreements/new?request=${firstRequestId}` : "/requests"}
          className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-ink/15 bg-surface px-6 py-5 transition-colors hover:border-ink/30"
        >
          <span>
            <span className="block text-base font-semibold text-ink">
              {waitingCount === 1
                ? "Someone is waiting to borrow something"
                : `${waitingCount} people are waiting to borrow something`}
            </span>
            <span className="mt-1 block text-sm text-ink-soft">
              {waitingCount === 1
                ? "They scanned your code and filled in their side. Nothing is agreed yet."
                : "They scanned your codes and filled in their side. Nothing is agreed yet."}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-ink">
            {waitingCount === 1 ? "Set it up →" : "See them →"}
          </span>
        </Link>
      )}

      <AgreementsList
        initialPage={page}
        initialParams={params}
        initialCounts={counts}
        viewerEmail={user.email ?? null}
        sweep={{ count: sweepCount, before: sweepBefore.toISOString() }}
      />

      {counts.drafts > 0 && (
        <div className="mt-8">
          <Note>
            A draft is not an agreement. Nothing is frozen, nobody has been asked to
            sign, and the asset details can still change underneath it.
          </Note>
        </div>
      )}

      {counts.archived > 0 && (
        <p className="mt-6 text-xs leading-relaxed text-ink-muted">
          Filing an agreement away hides it from this list and nothing else. Every
          agreement, its signatures and its audit trail are kept for{" "}
          {retentionFloorYears()} years, and an archived one still opens, still
          downloads and still verifies.
        </p>
      )}
    </Container>
  );
}
