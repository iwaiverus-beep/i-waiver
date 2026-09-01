"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";

/**
 * Minting, showing-once and revoking API keys.
 *
 * The "shown once" is not a UX flourish. There is no endpoint that returns a raw
 * key, because we do not have one to return — the database holds a hash. So this
 * component is the only place the value ever exists outside the partner's own
 * config, and it says so plainly rather than letting somebody assume they can
 * come back for it.
 */

type Integration = {
  id: string;
  integration_kind: string;
  environment: "sandbox" | "live";
  label: string | null;
  key_prefix: string | null;
  allowed_jurisdictions: string[];
  webhook_url: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const KIND_LABELS: Record<string, string> = {
  widget: "Embedded widget",
  api: "Direct API",
  redirect: "Hosted redirect",
};

export function PartnerKeys({
  partnerId,
  integrations,
  canCreate,
  canRevoke,
}: {
  partnerId: string;
  integrations: Integration[];
  canCreate: boolean;
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("api");

  async function create() {
    setBusy(true);
    setError(null);
    const result = await send<{ key: string }>("/api/partners/keys", {
      body: { partner_id: partnerId, label: label || null, integration_kind: kind },
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFresh(result.data.key);
    setLabel("");
    router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/partners/keys/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const live = integrations.filter((i) => !i.revoked_at);
  const revoked = integrations.filter((i) => i.revoked_at);

  return (
    <div className="space-y-6">
      {fresh && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft px-5 py-4">
          <p className="text-sm font-semibold text-accent">
            Copy this now — it is not shown again.
          </p>
          <p className="mt-3 break-all rounded-lg border border-accent/25 bg-paper p-3 font-mono text-[12px] text-ink">
            {fresh}
          </p>
          <button
            type="button"
            onClick={() => setFresh(null)}
            className="mt-3 text-xs font-semibold text-accent underline"
          >
            I have it — hide this
          </button>
        </div>
      )}

      {live.length === 0 && (
        <p className="text-sm text-ink-muted">
          No keys yet. Mint a sandbox one and you can make a real call in about a
          minute.
        </p>
      )}

      {live.map((integration) => (
        <Row
          key={integration.id}
          integration={integration}
          canRevoke={canRevoke}
          busy={busy}
          onRevoke={() => revoke(integration.id)}
        />
      ))}

      {canCreate && (
        <div className="rounded-xl border border-dashed border-line p-5">
          <p className="text-sm font-semibold text-ink">Mint a sandbox key</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Sandbox keys quote in every state against a mock carrier. Live keys are
            issued by us once onboarding is complete — see the checklist above.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="What is it for? e.g. staging"
              className="min-w-[14rem] flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            >
              <option value="api">Direct API</option>
              <option value="widget">Embedded widget</option>
              <option value="redirect">Hosted redirect</option>
            </select>
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Working…" : "Mint key"}
            </button>
          </div>
        </div>
      )}

      {revoked.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted">
            {revoked.length} revoked {revoked.length === 1 ? "key" : "keys"}
          </summary>
          <div className="mt-4 space-y-3 opacity-60">
            {revoked.map((integration) => (
              <Row
                key={integration.id}
                integration={integration}
                canRevoke={false}
                busy={busy}
                onRevoke={() => undefined}
              />
            ))}
          </div>
        </details>
      )}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

function Row({
  integration,
  canRevoke,
  busy,
  onRevoke,
}: {
  integration: Integration;
  canRevoke: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  const isLive = integration.environment === "live";

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
              isLive
                ? "border-accent bg-accent text-paper"
                : "border-line bg-surface text-ink-soft"
            }`}
          >
            {integration.environment}
          </span>
          <span className="text-sm font-semibold text-ink">
            {integration.label ?? KIND_LABELS[integration.integration_kind] ?? "Key"}
          </span>
          <code className="font-mono text-[12px] text-ink-muted">
            {integration.key_prefix ?? "—"}
          </code>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          {KIND_LABELS[integration.integration_kind] ?? integration.integration_kind} ·{" "}
          {isLive
            ? `${integration.allowed_jurisdictions.length} state${
                integration.allowed_jurisdictions.length === 1 ? "" : "s"
              }: ${integration.allowed_jurisdictions.join(", ")}`
            : "every state"}
          {" · "}
          {integration.revoked_at
            ? `revoked ${new Date(integration.revoked_at).toLocaleDateString()}`
            : integration.last_used_at
              ? `last used ${new Date(integration.last_used_at).toLocaleDateString()}`
              : "never used"}
        </p>
      </div>

      {canRevoke && !integration.revoked_at && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          className="rounded-full border border-flag/40 px-4 py-1.5 text-xs font-semibold text-flag transition-colors hover:bg-flag/[0.08] disabled:opacity-60"
        >
          Revoke
        </button>
      )}
    </div>
  );
}
