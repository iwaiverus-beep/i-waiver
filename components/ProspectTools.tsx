"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import { inputClass, primaryButtonClass, quietButtonClass } from "@/components/form-ui";
import {
  PARTNER_KINDS,
  PARTNER_KIND_LABELS,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_DESCRIPTIONS,
  PROSPECT_STATUS_LABELS,
  type PartnerKind,
  type Prospect,
  type ProspectStatus,
} from "@/lib/partners/vocabulary";

/**
 * The channel target list.
 *
 * One control per row rather than an edit page per prospect. The whole value of
 * this screen is that somebody can look down it and see where six conversations
 * stand at once; a list that has to be clicked into six times to learn that is a
 * list that stops being read.
 */

const STATUS_TONE: Record<ProspectStatus, string> = {
  identified: "border-line bg-surface text-ink-soft",
  contacted: "border-accent/30 bg-accent-soft text-accent",
  in_conversation: "border-accent/30 bg-accent-soft text-accent",
  applied: "border-accent bg-accent text-paper",
  won: "border-accent bg-accent text-paper",
  lost: "border-flag/30 bg-flag/[0.08] text-flag",
};

type PartnerOption = { id: string; name: string };

export function ProspectList({
  prospects,
  partners,
  canManage,
}: {
  prospects: Prospect[];
  partners: PartnerOption[];
  canManage: boolean;
}) {
  return (
    <ul className="divide-y divide-line/60">
      {prospects.map((prospect) => (
        <ProspectRow
          key={prospect.id}
          prospect={prospect}
          partners={partners}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function ProspectRow({
  prospect,
  partners,
  canManage,
}: {
  prospect: Prospect;
  partners: PartnerOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held here rather than sent on every keystroke. A note is a thought in
  // progress until somebody decides it is finished.
  const [notes, setNotes] = useState(prospect.notes ?? "");
  const [contactName, setContactName] = useState(prospect.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(prospect.contact_email ?? "");
  const [website, setWebsite] = useState(prospect.website ?? "");
  const [lostReason, setLostReason] = useState(prospect.lost_reason ?? "");
  const [partnerId, setPartnerId] = useState(prospect.partner_id ?? "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/prospects/${prospect.id}`, {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/prospects/${prospect.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const host = prospect.website
    ? prospect.website.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{prospect.name}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {PARTNER_KIND_LABELS[prospect.kind as PartnerKind] ?? prospect.kind}
            {host && (
              <>
                {" · "}
                <a
                  href={prospect.website ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:text-accent"
                >
                  {host}
                </a>
              </>
            )}
            {prospect.contact_email ? ` · ${prospect.contact_email}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${STATUS_TONE[prospect.status]}`}
          >
            {PROSPECT_STATUS_LABELS[prospect.status]}
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-semibold text-accent underline"
          >
            {open ? "Close" : canManage ? "Update" : "Details"}
          </button>
        </div>
      </div>

      {prospect.notes && !open && (
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-soft">
          {prospect.notes}
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-4 rounded-xl border border-line bg-surface/40 p-5">
          {error && (
            <p className="rounded-lg border border-flag/30 bg-flag/[0.06] px-4 py-3 text-sm text-flag">
              {error}
            </p>
          )}

          {!canManage ? (
            <p className="text-sm text-ink-muted">
              Your role can read this list but not change it.
            </p>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Where it stands
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PROSPECT_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={busy || status === prospect.status}
                      title={PROSPECT_STATUS_DESCRIPTIONS[status]}
                      onClick={() =>
                        patch({
                          status,
                          ...(status === "lost" ? { lost_reason: lostReason } : {}),
                          ...(status === "won" ? { partner_id: partnerId || null } : {}),
                        })
                      }
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                        status === prospect.status
                          ? STATUS_TONE[status]
                          : "border-line text-ink-soft hover:border-ink-muted hover:text-ink"
                      }`}
                    >
                      {PROSPECT_STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {PROSPECT_STATUS_DESCRIPTIONS[prospect.status]}
                </p>
              </div>

              {/* Both of these are required by the database for their status, so
                  they are offered before the button rather than after the error. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    If lost, why
                  </span>
                  <input
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="Built their own · no appetite · went quiet"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    If won, which partner
                  </span>
                  <select
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Website
                  </span>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Who we talk to
                  </span>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Their email
                  </span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Notes
                </span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputClass}
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    patch({
                      website: website || null,
                      contact_name: contactName || null,
                      contact_email: contactEmail || null,
                      notes: notes || null,
                      lost_reason: lostReason || null,
                    })
                  }
                  className={primaryButtonClass}
                >
                  {busy ? "Saving…" : "Save"}
                </button>

                {!prospect.partner_id && !prospect.application_id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={remove}
                    className={quietButtonClass}
                  >
                    Remove from list
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function NewProspectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [kind, setKind] = useState<PartnerKind>("waiver_platform");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await send("/api/admin/prospects", {
      body: { name, website: website || null, kind, notes: notes || null },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setWebsite("");
    setNotes("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-flag/30 bg-flag/[0.06] px-4 py-3 text-sm text-flag">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Company"
          className={inputClass}
        />
        <input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="website.com"
          className={inputClass}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PartnerKind)}
          className={inputClass}
        >
          {PARTNER_KINDS.filter((k) => k !== "carrier" && k !== "mga").map((k) => (
            <option key={k} value={k}>
              {PARTNER_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What they are, and why they are on the list"
        className={inputClass}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={add}
          className={primaryButtonClass}
        >
          {busy ? "Adding…" : "Add to the list"}
        </button>
        {/* Carriers are the other direction — we call them — so they are added on
            the Carriers tab and cannot be created here by mistake. */}
        <p className="text-xs text-ink-muted">
          An insurer or MGA goes on the Carriers tab instead.
        </p>
      </div>
    </div>
  );
}
