"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activitiesOpenIn,
  type OriginatorKind,
  type ReadinessRow,
} from "@/lib/readiness";
import { QrCode } from "./QrCode";
import type { Asset } from "./AssetsManager";
import type { OpenState } from "./NewAgreementForm";

export type IntakeLinkRow = {
  id: string;
  asset_id: string | null;
  slug: string;
  label: string | null;
  activity_class: string;
  jurisdiction: string;
  created_at: string;
};

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-ink/40";

/**
 * Making and showing the codes.
 *
 * The QR is drawn in the browser, reusing the component the signing flow already
 * uses — but for a different reason. There, client-side rendering keeps a live
 * capability from travelling anywhere new. Here there is no capability to protect:
 * the URL is meant to be printed and stuck to a trailer. It is drawn locally
 * because it is the same picture either way, not because it is a secret.
 */
export function CodesManager({
  links,
  assets,
  states,
  readiness,
  originatorKind,
}: {
  links: IntakeLinkRow[];
  assets: Asset[];
  states: OpenState[];
  readiness: ReadinessRow[];
  originatorKind: OriginatorKind;
}) {
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);

  // The state on the form, held rather than left uncontrolled, because the
  // activity list below it depends on the answer. Same cascade as the lend form:
  // a code names a state AND an activity, and the pair has to be one the product
  // can actually produce a document for.
  const [state, setState] = useState(states[0]?.state ?? "FL");
  const openActivities = activitiesOpenIn(readiness, state, originatorKind);
  const [activity, setActivity] = useState(
    () => openActivities[0]?.activity_class ?? "",
  );

  useEffect(() => {
    if (openActivities.some((a) => a.activity_class === activity)) return;
    setActivity(openActivities[0]?.activity_class ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function nameOf(link: IntakeLinkRow): string {
    if (link.label) return link.label;
    if (!link.asset_id) return "Anything — general code";
    const asset = assets.find((a) => a.id === link.asset_id);
    if (!asset) return "An item you no longer list";
    return (
      [asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
      asset.description
    );
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/intake-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_id: form.get("asset_id") || null,
          label: form.get("label") || null,
          activity_class: form.get("activity_class"),
          jurisdiction: form.get("jurisdiction"),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");
      setMaking(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/intake-links/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 space-y-8">
      {links.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {links.map((link) => (
            <li key={link.id} className="bg-paper px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-base font-semibold text-ink">{nameOf(link)}</span>
                <span className="text-xs uppercase tracking-wider text-ink-muted">
                  {link.asset_id ? "This item" : "General"} · {link.jurisdiction}
                </span>
              </div>

              <p className="mt-1 break-all text-xs text-ink-muted">
                {origin}/start/{link.slug}
              </p>

              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowing(showing === link.id ? null : link.id)}
                  className="text-sm font-semibold text-ink hover:underline"
                >
                  {showing === link.id ? "Hide the code" : "Show the code"}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(link.id)}
                  disabled={busy}
                  className="text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  Stop using it
                </button>
              </div>

              {showing === link.id && (
                <div className="mt-4">
                  <QrCode
                    url={`${origin}/start/${link.slug}`}
                    label="Print this, or show it on a screen. It keeps working until you stop using it."
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!making ? (
        <button
          type="button"
          onClick={() => setMaking(true)}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
        >
          + Make a code
        </button>
      ) : openActivities.length === 0 ? (
        /*
          No state we are open in can produce a document for this lender, so there
          is nothing a code could lead to. Refusing here rather than rendering two
          empty dropdowns matters more on this screen than on the lend form: a code
          is printed and stuck to a trailer, and one made against a combination
          that refuses every scan is discovered by a borrower standing at a counter.
        */
        <div className="rounded-2xl border border-line bg-surface/40 p-5">
          <p className="text-sm leading-relaxed text-ink-soft">
            There is nowhere a code could lead yet. A code names a state and an
            activity, and that pair needs a rule set and wording counsel has
            published before anyone scanning it could be given a document.
          </p>
          <button
            type="button"
            onClick={() => setMaking(false)}
            className="mt-4 text-xs font-semibold text-accent underline"
          >
            Back
          </button>
        </div>
      ) : (
        <form onSubmit={create} className="space-y-5 rounded-2xl border border-line bg-surface/40 p-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
              For which item
            </span>
            <select name="asset_id" defaultValue="" className={input}>
              <option value="">Anything — a general code</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {[asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
                    asset.description}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
              Pick an item and whoever scans it is asking for that specific thing, so
              their side arrives complete. A general code just starts a conversation.
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Name it, for your own list
            </span>
            <input name="label" maxLength={80} placeholder="Front counter" className={input} />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Where it happens
              </span>
              <select
                name="jurisdiction"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className={input}
              >
                {states.map((option) => (
                  <option key={option.state} value={option.state}>
                    {option.state}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                What kind of activity
              </span>
              <select
                name="activity_class"
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                className={input}
              >
                {openActivities.map((option) => (
                  <option key={option.activity_class} value={option.activity_class}>
                    {option.activity_label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs leading-relaxed text-ink-muted">
            Both are yours to set, not the borrower&apos;s. The state is where the
            activity happens, which decides the wording, and neither should be
            something a stranger can choose.
          </p>

          {error && <p className="text-sm text-flag">{error}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper disabled:opacity-50"
            >
              {busy ? "Making…" : "Make it"}
            </button>
            <button
              type="button"
              onClick={() => setMaking(false)}
              className="text-sm font-semibold text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
