"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * "More than one family is coming."
 *
 * Lives on the loan, not on a screen of its own, because that is where the
 * realisation happens: somebody has filled in one agreement for the person who
 * booked, and then three more households turn up. Making them go and find a
 * different part of the product to say so is how a boat leaves with eleven people
 * covered by one signature.
 *
 * Nothing here touches the loan. Starting a booking hangs a grouping off it and
 * changes not one byte of the document, which is what makes it safe to offer on an
 * agreement that has already been signed — and that is the common case, since the
 * renter signs at nine and the rest arrive at ten.
 */
export function BookingPanel({
  agreementId,
  groupId,
  groupRole,
  borrowerName,
}: {
  agreementId: string;
  groupId: string | null;
  groupRole: "rental" | "participant" | null;
  borrowerName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);

  if (groupId) {
    return (
      <div className="rounded-2xl border border-line bg-surface/50 p-6">
        <p className="text-sm font-semibold text-ink">Part of a booking</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {groupRole === "participant"
            ? "This is one person's release from a booking with several households on it. It covers them and nobody else, and it says nothing about returning the thing — that sits on the loan."
            : "Other households are on this one. Their releases are separate documents — this page is only the loan itself."}
        </p>
        <Link
          href={`/groups/${groupId}`}
          className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper"
        >
          Open the booking
        </Link>
      </div>
    );
  }

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = new FormData(event.currentTarget).get("label");
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agreement_id: agreementId, label }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");
      router.push(`/groups/${payload.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface/50 p-6">
      <p className="text-sm font-semibold text-ink">Is anyone else coming?</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        {borrowerName} has signed for taking it. Anybody else aboard needs their own
        release — one adult cannot sign one for another, so a single waiver covers
        exactly one person.
      </p>

      {naming ? (
        <form onSubmit={start} className="mt-4 space-y-3">
          <input
            name="label"
            required
            maxLength={120}
            defaultValue={`${borrowerName}'s party`}
            placeholder="What to call this booking"
            className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-ink/40"
          />
          {error && <p className="text-sm text-flag">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-50"
            >
              {busy ? "Starting…" : "Start the booking"}
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink-soft"
            >
              Not now
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="mt-4 rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
        >
          Add other people
        </button>
      )}
    </div>
  );
}
