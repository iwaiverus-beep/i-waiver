"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import { US_STATES } from "@/lib/jurisdictions";

/**
 * The staff-side controls on one partner.
 *
 * Split into four small components rather than one big form, because they are
 * four different decisions with four different blast radii, and a single "save"
 * button over all of them would make issuing a live key feel like editing a
 * profile.
 */

export function OnboardingControls({
  partnerId,
  steps,
  canManage,
}: {
  partnerId: string;
  steps: {
    key: string;
    title: string;
    description: string;
    kind: "observed" | "attested";
    owner: string;
    blocksGoLive: boolean;
    completedAt: string | null;
    note: string | null;
  }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(step: string, undo: boolean) {
    setBusy(step);
    setError(null);
    const result = await send(`/api/admin/partners/${partnerId}/onboarding`, {
      body: { step, undo },
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div
          key={step.key}
          className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 pb-3 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {step.completedAt ? "✓ " : ""}
              {step.title}
              {step.blocksGoLive && (
                <span className="ml-2 text-[11px] font-normal text-flag">
                  blocks go-live
                </span>
              )}
              {step.kind === "observed" && (
                <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                  automatic
                </span>
              )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {step.completedAt
                ? `Completed ${new Date(step.completedAt).toLocaleDateString()}${
                    step.note ? ` — ${step.note}` : ""
                  }`
                : step.description}
            </p>
          </div>

          {/* Observed steps have no button at all. The server refuses them, and a
              disabled button that explains itself beats a click that fails. */}
          {canManage && step.kind === "attested" && (
            <button
              type="button"
              onClick={() => toggle(step.key, Boolean(step.completedAt))}
              disabled={busy === step.key}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-ink/40 disabled:opacity-60"
            >
              {busy === step.key ? "…" : step.completedAt ? "Undo" : "Mark done"}
            </button>
          )}
        </div>
      ))}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

export function LiveKeyIssuer({
  partnerId,
  suggestedStates,
  canIssue,
  blockers,
}: {
  partnerId: string;
  suggestedStates: string[];
  canIssue: boolean;
  blockers: string[];
}) {
  const router = useRouter();
  const [states, setStates] = useState<string[]>(suggestedStates);
  const [kind, setKind] = useState("widget");
  // Never on by default. Granting `agreements` lets a platform create a release
  // in a third party's name and send it to a signer.
  const [agreementsScope, setAgreementsScope] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  if (!canIssue) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        Issuing a live key needs the super admin role. It is the narrowest
        permission in the product on purpose — it is the moment a partner can bind
        real cover.
      </p>
    );
  }

  if (blockers.length > 0) {
    return (
      <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
        <p className="text-sm font-semibold text-flag">Not ready to go live.</p>
        <ul className="mt-2 space-y-1 text-sm text-flag">
          {blockers.map((title) => (
            <li key={title}>· {title}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-flag">
          The server refuses this too — the checklist is a gate, not a reminder.
        </p>
      </div>
    );
  }

  async function issue() {
    setBusy(true);
    setError(null);
    const result = await send<{ key: string }>(
      `/api/admin/partners/${partnerId}/keys`,
      {
        body: {
          environment: "live",
          integration_kind: kind,
          jurisdictions: states,
          scopes: agreementsScope ? ["coverage", "agreements"] : ["coverage"],
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFresh(result.data.key);
    setArmed(false);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {fresh && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft px-5 py-4">
          <p className="text-sm font-semibold text-accent">
            Give this to the partner over a channel you trust. It is not shown
            again.
          </p>
          <p className="mt-3 break-all rounded-lg border border-accent/25 bg-paper p-3 font-mono text-[12px] text-ink">
            {fresh}
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
          States this key may quote in
        </p>
        <p className="mb-3 text-xs leading-relaxed text-ink-muted">
          Only the states you have checked against the carrier&rsquo;s filings.
          There is no &ldquo;all states&rdquo; and the database will not accept an
          empty list.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {US_STATES.map((code) => {
            const on = states.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() =>
                  setStates((current) =>
                    current.includes(code)
                      ? current.filter((c) => c !== code)
                      : [...current, code],
                  )
                }
                className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                  on
                    ? "border-accent bg-accent text-paper"
                    : "border-line text-ink-soft hover:border-ink/40"
                }`}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-line p-4">
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={agreementsScope}
            onChange={(e) => setAgreementsScope(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            Also open the <strong className="font-semibold">agreements API</strong>
            <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
              Lets this platform register its own customers as lenders and
              originate a release in their name, which we then send to a signer.
              A much larger power than pricing cover, so it is off unless they
              asked for it and somebody agreed. The signing page is still ours, so
              the insurance offer is still made by us.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
        >
          <option value="widget">Embedded widget</option>
          <option value="api">Direct API</option>
          <option value="redirect">Hosted redirect</option>
        </select>

        {armed ? (
          <>
            <button
              type="button"
              onClick={issue}
              disabled={busy || states.length === 0}
              className="rounded-full bg-flag px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
            >
              {busy
                ? "Issuing…"
                : `Yes — issue a live key for ${states.length} state${states.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setArmed(true)}
            disabled={states.length === 0}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
          >
            Issue a live key
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

export function BrandingReview({
  partnerId,
  submitted,
  approved,
  canReview,
}: {
  partnerId: string;
  submitted: boolean;
  approved: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!submitted) {
    return <p className="text-sm text-ink-muted">Nothing submitted yet.</p>;
  }
  if (!canReview) {
    return <p className="text-sm text-ink-muted">Your role cannot review branding.</p>;
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/partners/${partnerId}/branding`, {
      body: { approve, note: note || null },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {approved && (
        <p className="text-sm text-accent">Approved and rendering in the widget.</p>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="If you are sending it back, say what needs changing — the partner sees this."
        className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={busy}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={busy || !note.trim()}
          className="rounded-full border border-flag/40 px-5 py-2.5 text-sm font-semibold text-flag disabled:opacity-60"
        >
          Send back
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

export function DangerZone({
  partnerId,
  slug,
  disabled,
  canDisable,
  canPurge,
}: {
  partnerId: string;
  slug: string;
  disabled: boolean;
  canDisable: boolean;
  canPurge: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmSlug, setConfirmSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function setDisabled(next: boolean) {
    setBusy(true);
    setError(null);
    const response = await send(`/api/admin/partners/${partnerId}`, {
      method: "PATCH",
      body: { disabled: next, reason: reason || null },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setReason("");
    router.refresh();
  }

  async function purge() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await send<{ deleted: Record<string, number> | null }>(
      `/api/admin/partners/${partnerId}/sandbox`,
      { method: "DELETE", body: { confirm_slug: confirmSlug } },
    );
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setConfirmSlug("");
    setResult(
      response.data.deleted
        ? Object.entries(response.data.deleted)
            .map(([key, value]) => `${value} ${key.replace("_deleted", "")}`)
            .join(", ")
        : "Nothing to delete.",
    );
  }

  return (
    <div className="space-y-8">
      {canDisable && (
        <div>
          <p className="text-sm font-semibold text-ink">
            {disabled ? "This partner is switched off" : "Switch this partner off"}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Every key they hold stops authenticating immediately and their console
            closes. Reversible, and logged either way.
          </p>
          {!disabled && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why. It goes in the log."
              className="mt-3 w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
          )}
          <button
            type="button"
            onClick={() => setDisabled(!disabled)}
            disabled={busy || (!disabled && !reason.trim())}
            className={`mt-3 rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60 ${
              disabled
                ? "bg-accent text-paper"
                : "border border-flag/40 text-flag hover:bg-flag/[0.08]"
            }`}
          >
            {busy ? "Working…" : disabled ? "Switch back on" : "Switch off"}
          </button>
        </div>
      )}

      {canPurge && (
        <div className="border-t border-line pt-6">
          <p className="text-sm font-semibold text-ink">Empty their sandbox</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Deletes every sandbox context, quote, policy and payment for this
            partner. Live data is untouchable from here — the database function
            filters on environment and takes no argument that widens it.
          </p>
          <input
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            placeholder={`Type ${slug} to confirm`}
            className="mt-3 w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 font-mono text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={purge}
            disabled={busy || confirmSlug !== slug}
            className="mt-3 rounded-full border border-flag/40 px-5 py-2.5 text-sm font-semibold text-flag transition-colors hover:bg-flag/[0.08] disabled:opacity-60"
          >
            {busy ? "Working…" : "Empty the sandbox"}
          </button>
          {result && <p className="mt-3 text-sm text-ink-soft">Deleted: {result}</p>}
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
