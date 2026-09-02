"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";

/**
 * The onboarding panel: send a carrier the details form, and review what comes
 * back.
 *
 * Both halves live in one panel because they are one conversation. Splitting
 * "invite" from "review" puts the question "did we ever ask them?" two panels
 * away from its answer, and that question is the whole reason somebody opens
 * this.
 *
 * Accepting is deliberately not a single unlabelled click. What a carrier typed
 * is a claim until a person reads it, so the panel shows every field their answer
 * would write before offering the button — a review screen that hides what it is
 * about to overwrite is a review in name only.
 */

export type CarrierSubmissionRow = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  legal_name: string | null;
  naic_code: string | null;
  am_best_rating: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  states: string[];
  api_base_url: string | null;
  api_docs_url: string | null;
  products: string | null;
  notes: string | null;
  submitted_at: string;
  review_note: string | null;
};

export type OnboardingLinkRow = {
  sent_to: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export function CarrierOnboardingPanel({
  carrierId,
  contactEmail,
  link,
  submissions,
  canManage,
}: {
  carrierId: string;
  contactEmail: string | null;
  link: OnboardingLinkRow | null;
  submissions: CarrierSubmissionRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [to, setTo] = useState(contactEmail ?? "");
  const [note, setNote] = useState("");

  const pending = submissions.find((s) => s.status === "pending") ?? null;
  const history = submissions.filter((s) => s.status !== "pending");
  const expired = link ? new Date(link.expires_at) < new Date() : false;

  async function sendLink() {
    setBusy(true);
    setError(null);
    const result = await send<{ sentTo: string }>(
      `/api/admin/carriers/${carrierId}/onboarding`,
      { body: { to: to.trim() || null } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(result.data.sentTo);
    router.refresh();
  }

  async function review(decision: "accept" | "reject") {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const result = await send(
      `/api/admin/carriers/${carrierId}/submissions/${pending.id}`,
      { method: "PATCH", body: { decision, note: note.trim() || null } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {pending ? (
        <div className="rounded-xl border border-accent/25 bg-accent-soft p-5">
          <p className="text-sm font-semibold text-ink">
            They filled it in on{" "}
            {new Date(pending.submitted_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
            . Nothing has been written to the record yet.
          </p>

          <dl className="mt-4 space-y-1.5 text-sm">
            <DetailRow label="Legal name" value={pending.legal_name} />
            <DetailRow label="NAIC" value={pending.naic_code} />
            <DetailRow label="AM Best" value={pending.am_best_rating} />
            <DetailRow label="Contact" value={pending.contact_name} />
            <DetailRow label="Email" value={pending.contact_email} />
            <DetailRow label="Phone" value={pending.contact_phone} />
            <DetailRow label="Sandbox" value={pending.api_base_url} mono />
            <DetailRow label="Docs" value={pending.api_docs_url} mono />
          </dl>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
              States they claim ({pending.states.length})
            </p>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">
              {pending.states.length ? pending.states.join(" ") : "—"}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Accepting does not record these as filings. A filing is a claim
              about a regulator&rsquo;s decision and the only thing that opens a
              state — record them yourself, product by product, below.
            </p>
          </div>

          {pending.products && (
            <Block label="Products" value={pending.products} />
          )}
          {pending.notes && <Block label="Notes" value={pending.notes} />}

          {canManage && (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note — required to reject"
                className="mt-5 w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => review("accept")}
                  disabled={busy}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
                >
                  Accept onto the record
                </button>
                <button
                  type="button"
                  onClick={() => review("reject")}
                  disabled={busy || !note.trim()}
                  className="rounded-full border border-flag/40 px-5 py-2.5 text-sm font-semibold text-flag transition-colors hover:bg-flag/[0.08] disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-ink-soft">
          {link
            ? link.used_at
              ? "They have sent their details, and everything they gave us has been reviewed."
              : "Sent, and not filled in yet."
            : "They have never been asked for their details."}
        </p>
      )}

      {link && (
        <dl className="space-y-1.5 border-t border-line pt-5 text-sm">
          <DetailRow label="Link sent to" value={link.sent_to} />
          <DetailRow
            label={expired ? "Expired" : "Expires"}
            value={new Date(link.expires_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          />
        </dl>
      )}

      {canManage && (
        <div className="border-t border-line pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
            {link ? "Send a fresh link" : "Send the details form"}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            A new link replaces the old one immediately. Send it to whoever holds
            the answers — often somebody technical rather than the person who
            applied.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              type="email"
              placeholder="them@carrier.com"
              className="min-w-[16rem] flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={sendLink}
              disabled={busy}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft disabled:opacity-60"
            >
              {busy ? "Sending…" : link ? "Re-send" : "Send"}
            </button>
          </div>
          {sent && <p className="mt-3 text-sm text-ink-soft">Sent to {sent}.</p>}
        </div>
      )}

      {history.length > 0 && (
        <div className="border-t border-line pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
            Earlier submissions
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
            {history.map((s) => (
              <li key={s.id}>
                {new Date(s.submitted_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                — {s.status}
                {s.review_note ? `: ${s.review_note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-0.5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-ink ${mono ? "break-all font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {label}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
        {value}
      </p>
    </div>
  );
}
