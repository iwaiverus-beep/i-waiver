import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container, PAGE_PADDING } from "@/components/ui";
import { Note } from "@/components/app-ui";
import { requireActor } from "@/lib/agreements/access";
import { addOnsForRequests, pendingRequests } from "@/lib/intake/requests";
import { formatRate, type RateUnit } from "@/lib/assets/fields";
import { DeclineRequest } from "@/components/DeclineRequest";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

/**
 * What came in off the printed codes.
 *
 * The behaviour that matters is the count. One waiting request goes straight into
 * the form with the borrower's details already in it, because a lender standing at
 * a counter with one person in front of them should not have to pick that person
 * out of a list of one. Several means a genuine choice, so it shows the list and
 * lets them choose.
 *
 * A request is not an agreement and nothing here creates one. Every route out of
 * this page leads to the ordinary draft form, which is where a human being reads
 * what a stranger typed before anything is brought into existence.
 */

function when(value: string | null): string {
  if (!value) return "not said";
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function RequestsPage() {
  const { db, originatorIds } = await requireActor();
  const waiting = await pendingRequests(db, originatorIds);
  const addOns = await addOnsForRequests(
    db,
    waiting.map((request) => request.id),
  );

  // Exactly one: skip the list entirely. Nothing is created by this redirect —
  // it opens the form, prefilled, and the lender still presses the button.
  if (waiting.length === 1) redirect(`/agreements/new?request=${waiting[0].id}`);

  return (
    <Container className={PAGE_PADDING}>
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
          ← Back
        </Link>
        <h1 className="mt-4 font-serif text-3xl tracking-tight">Requests</h1>

        {waiting.length === 0 ? (
          <div className="mt-8">
            <Note>
              Nothing waiting. When somebody scans one of your codes and fills in
              their side, it appears here — and if there is only one, you go
              straight into it.
            </Note>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-ink-soft">
              {waiting.length} people have asked to borrow something. Opening one
              fills in the form with what they told you; nothing is agreed until you
              send it and they sign.
            </p>

            <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {waiting.map((request) => (
                <li key={request.id} className="bg-paper px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-base font-semibold text-ink">
                      {request.borrower_name}
                    </span>
                    <span className="text-xs text-ink-muted">
                      asked {when(request.created_at)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-ink-soft">
                    {request.borrower_email || request.borrower_phone}
                  </p>

                  <p className="mt-2 text-sm text-ink-soft">
                    {request.starts_at || request.ends_at
                      ? `${when(request.starts_at)} → ${when(request.ends_at)}`
                      : "No dates given — you set them."}
                  </p>

                  {(addOns.get(request.id)?.length ?? 0) > 0 && (
                    <div className="mt-2 rounded-xl bg-surface/60 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                        They also asked for
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {addOns.get(request.id)?.map((item) => {
                          const rate = formatRate(
                            item.rate_cents,
                            item.rate_unit as RateUnit | null,
                          );
                          return (
                            <li
                              key={item.id}
                              className="flex items-baseline justify-between gap-4 text-sm text-ink-soft"
                            >
                              <span>{item.description}</span>
                              {rate && (
                                <span className="shrink-0 tabular-nums">{rate}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-xs text-ink-muted">
                        These open on the form with the main item, ready for you to
                        confirm or take off.
                      </p>
                    </div>
                  )}

                  {request.note && (
                    <p className="mt-2 rounded-xl bg-surface/60 px-4 py-3 text-sm leading-relaxed text-ink-soft">
                      {request.note}
                    </p>
                  )}

                  <div className="mt-4 flex items-center gap-3">
                    <Link
                      href={`/agreements/new?request=${request.id}`}
                      className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper"
                    >
                      Set this up
                    </Link>
                    <DeclineRequest requestId={request.id} />
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-xs leading-relaxed text-ink-muted">
              Requests are what a stranger typed into a public form, so treat the
              names as unverified until you have seen who turned up. They age out on
              their own after a fortnight.
            </p>
          </>
        )}
      </div>
    </Container>
  );
}
