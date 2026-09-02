"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DeliveryState = {
  status: string;
  detail: string | null;
  at: string | null;
};

/**
 * How the other party is being reached, and what became of the last attempt.
 *
 * Two things that only make sense together. A bounce is useless without somewhere
 * to fix it, and an edit form with no delivery state is a control nobody knows to
 * press — the whole failure this replaces was silent, and the lender's first clue
 * was the borrower not signing days later.
 *
 * Editing is unsigned-only, and the explanation for that is on the server in
 * lib/agreements/contact.ts: the address is inside the document hash. Here it is
 * enough to say so in a sentence rather than offer a control that will be
 * refused.
 */
export function SignerContact({
  agreementId,
  signerId,
  name,
  email,
  phone,
  delivery,
  canEdit,
  awaitingSend = false,
}: {
  agreementId: string;
  signerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  delivery: DeliveryState | null;
  canEdit: boolean;
  /** Still a draft — nothing has gone out, so there is no link to replace. */
  awaitingSend?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const failed =
    delivery?.status === "bounced" || delivery?.status === "complained";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(null);

    const response = await fetch(`/api/agreements/${agreementId}/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signer_id: signerId,
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
      }),
    });

    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not update.");
      return;
    }

    setOpen(false);
    setSaved(
      awaitingSend
        ? "Saved. This is where it will go when you send it."
        : body.links_revoked > 0
          ? "Saved. Any link already sent to the old address has stopped working — send a new one below."
          : "Saved. Send them a new link below.",
    );
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Reaching {name}
      </p>

      <p className="mt-2 break-all text-sm text-ink">
        {email ?? phone ?? "No contact details on file."}
      </p>
      {email && phone && (
        <p className="mt-0.5 break-all text-xs text-ink-muted">{phone}</p>
      )}

      {/* The failure, in the words the provider used. "Bounced" alone does not
          tell a lender whether to wait or to retype the address; "mailbox full"
          and "domain does not exist" need opposite responses. */}
      {failed && (
        <p className="mt-3 text-xs font-medium text-flag">
          {delivery?.status === "complained"
            ? "They marked the last email as spam. A new link to the same address will probably not be seen."
            : "The last email did not arrive."}
          {delivery?.detail ? ` ${delivery.detail}` : ""}
        </p>
      )}

      {delivery?.status === "delayed" && (
        <p className="mt-3 text-xs text-ink-muted">
          The provider is still trying to deliver the last email.
          {delivery.detail ? ` ${delivery.detail}` : ""}
        </p>
      )}

      {delivery?.status === "delivered" && (
        <p className="mt-3 text-xs text-ink-muted">The last email arrived.</p>
      )}

      {saved && <p className="mt-3 text-xs text-accent">{saved}</p>}
      {error && <p className="mt-3 text-xs text-flag">{error}</p>}

      {canEdit ? (
        open ? (
          <form onSubmit={save} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Email
              </span>
              <input
                name="email"
                type="email"
                defaultValue={email ?? ""}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>

            {/* Collected now, used when the SMS channel is built. Storing it is
                what makes that a delivery change rather than a data-gathering
                exercise across every agreement already out. */}
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Phone (optional)
              </span>
              <input
                name="phone"
                type="tel"
                defaultValue={phone ?? ""}
                placeholder="+1 555 010 0123"
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>

            <p className="text-xs text-ink-muted">
              {awaitingSend
                ? "Their address is part of what gets signed, so this changes the agreement itself. Nothing has gone out yet."
                : "This changes the agreement itself — their address is part of what gets signed — so any link already sent will stop working."}
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={busy}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className={`mt-4 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
              failed
                ? "bg-ink text-paper hover:bg-ink-soft"
                : "border border-line text-ink hover:border-ink/40"
            }`}
          >
            {failed ? "Fix the address" : "Change how they are reached"}
          </button>
        )
      ) : (
        <p className="mt-3 text-xs text-ink-muted">
          Somebody has signed, so this is now part of a signed record and cannot be
          edited. If the address is wrong, void this agreement and send a fresh
          one.
        </p>
      )}
    </div>
  );
}
