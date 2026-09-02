"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { send } from "@/lib/client/request";
import {
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  blockers,
  stage,
  type InstrumentKind,
  type OriginatorKind,
  type ReadinessRow,
  type ReadinessStage,
} from "@/lib/readiness";
import type { ActivityClass } from "@/lib/activities";

export type StateRow = {
  state: string;
  carrier_admitted: boolean;
  product_codes: string[];
  clause_set_reviewed_at: string | null;
  waiver_efficacy: string;
  status: string;
  notes: string | null;
  updated_at: string;
};

const input =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2 text-sm text-ink outline-none transition-colors focus:border-accent";

const button =
  "rounded-full bg-accent px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50";

const quiet =
  "rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface disabled:opacity-50";

/**
 * How a readiness stage looks in a grid.
 *
 * Status colours, not the categorical chart palette: these mean good/partial/bad
 * rather than identity, and the two vocabularies must not be mixed. Each cell
 * also carries a letter, so the grid survives being read by somebody who cannot
 * separate the hues and by anybody printing it.
 */
const STAGE_STYLES: Record<ReadinessStage, { className: string; mark: string }> = {
  live: { className: "bg-accent text-paper border-accent", mark: "L" },
  specimen: {
    className: "bg-accent-soft text-accent border-accent/30",
    mark: "S",
  },
  no_cover: { className: "bg-flag/[0.12] text-flag border-flag/30", mark: "D" },
  blocked: { className: "bg-surface text-ink-soft border-line", mark: "·" },
  none: { className: "bg-paper text-ink-muted border-line/60", mark: "" },
};

/**
 * The whole product, as a grid.
 *
 * 51 jurisdictions down, activities across. Every cell is a combination somebody
 * could ask for, and most of them are empty — which is the point of drawing it.
 * Before this existed the only way to discover where a combination stood was to
 * attempt it on the lend form and read the refusal.
 */
export function ReadinessMatrix({
  readiness,
  activities,
}: {
  readiness: ReadinessRow[];
  activities: ActivityClass[];
}) {
  const [originatorKind, setOriginatorKind] = useState<OriginatorKind>("individual");
  const [instrumentKind, setInstrumentKind] = useState<InstrumentKind>("rental");
  const [onlyStarted, setOnlyStarted] = useState(true);
  const [picked, setPicked] = useState<ReadinessRow | null>(null);

  const live = activities.filter((a) => !a.retired_at);

  const byState = useMemo(() => {
    const map = new Map<string, Map<string, ReadinessRow>>();
    for (const row of readiness) {
      if (!map.has(row.state)) map.set(row.state, new Map());
      map.get(row.state)!.set(row.activity_class, row);
    }
    return map;
  }, [readiness]);

  const states = useMemo(() => {
    const all = [...byState.keys()].sort();
    if (!onlyStarted) return all;
    // Somewhere between "we have done nothing" and "this is open" — the states
    // worth looking at. Fifty rows of empty cells is a true picture and an
    // unreadable one, so it is behind a toggle rather than the default.
    return all.filter((s) =>
      [...(byState.get(s)?.values() ?? [])].some(
        (r) => stage(r, originatorKind, instrumentKind) !== "none",
      ),
    );
  }, [byState, onlyStarted, originatorKind, instrumentKind]);

  return (
    <div>
      {/* Filters in one row above the grid. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Lender</span>
          <select
            value={originatorKind}
            onChange={(e) => setOriginatorKind(e.target.value as OriginatorKind)}
            className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-ink"
          >
            <option value="individual">Private</option>
            <option value="organization">Business</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Instrument</span>
          <select
            value={instrumentKind}
            onChange={(e) => setInstrumentKind(e.target.value as InstrumentKind)}
            className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-ink"
          >
            <option value="rental">Loan</option>
            <option value="participant">Participant release</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-ink-soft">
          <input
            type="checkbox"
            checked={onlyStarted}
            onChange={(e) => setOnlyStarted(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Hide states nothing has been done for
        </label>
      </div>

      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-soft">
        {(Object.keys(STAGE_LABELS) as ReadinessStage[]).map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold ${STAGE_STYLES[key].className}`}
            >
              {STAGE_STYLES[key].mark}
            </span>
            {STAGE_LABELS[key]}
          </li>
        ))}
      </ul>

      {states.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing has been started anywhere. Untick the box above to see the whole
          country.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-paper px-2 py-2 text-left font-medium text-ink-muted">
                  State
                </th>
                {live.map((a) => (
                  <th
                    key={a.code}
                    className="px-1.5 py-2 text-left font-medium text-ink-muted"
                  >
                    <span className="block max-w-[7rem] truncate" title={a.label}>
                      {a.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {states.map((s) => (
                <tr key={s}>
                  <th className="sticky left-0 z-10 bg-paper px-2 py-1 text-left font-mono text-[11px] font-semibold text-ink">
                    {s}
                  </th>
                  {live.map((a) => {
                    const row = byState.get(s)?.get(a.code);
                    if (!row) return <td key={a.code} className="px-1.5 py-1" />;
                    const st = stage(row, originatorKind, instrumentKind);
                    const style = STAGE_STYLES[st];
                    return (
                      <td key={a.code} className="px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => setPicked(row)}
                          title={`${s} · ${a.label} — ${STAGE_LABELS[st]}`}
                          className={`flex h-7 w-full min-w-[3.5rem] items-center justify-center rounded border text-[10px] font-bold transition-opacity hover:opacity-80 ${style.className}`}
                        >
                          {style.mark}
                          <span className="sr-only">
                            {s} {a.label}: {STAGE_LABELS[st]}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked && (
        <div className="mt-6 rounded-2xl border border-line bg-surface/40 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold text-ink">
              {picked.state} · {picked.activity_label}
            </h4>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {STAGE_DESCRIPTIONS[stage(picked, originatorKind, instrumentKind)]}
          </p>

          {(() => {
            const missing = blockers(picked, originatorKind, instrumentKind);
            return missing.length === 0 ? (
              <p className="mt-3 text-sm text-accent">
                Nothing is missing. This combination is fully open.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {missing.map((m) => (
                  <li key={m} className="flex gap-2.5 text-sm leading-relaxed text-ink-soft">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-flag" />
                    {m}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * The two judgements about a state that belong to a person.
 *
 * Everything else about a state is derived — the status is a generated column,
 * and `carrier_admitted` under it is a cache of the filings. So the panel shows
 * those and does not offer to edit them, and says where they actually come from.
 */
export function StateEditor({
  states,
  canEdit,
  efficacies,
  statusLabels,
}: {
  states: StateRow[];
  canEdit: boolean;
  efficacies: { value: string; label: string; description: string }[];
  statusLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);

  const shown = onlyOpen
    ? states.filter((s) => s.status !== "unavailable" || s.notes)
    : states;

  async function patch(state: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/states/${state}`, { method: "PATCH", body });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <label className="mb-4 flex items-center gap-2 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={onlyOpen}
          onChange={(e) => setOnlyOpen(e.target.checked)}
          className="h-4 w-4 rounded border-line accent-accent"
        />
        Only states that are open or have a note on them
      </label>

      {error && (
        <p className="mb-4 rounded-lg border border-flag/30 bg-flag/[0.06] px-4 py-3 text-sm text-flag">
          {error}
        </p>
      )}

      <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line">
        {shown.map((s) => (
          <li key={s.state} className="bg-paper px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => setOpen(open === s.state ? null : s.state)}
                className="text-left"
              >
                <span className="font-mono text-sm font-semibold text-ink">
                  {s.state}
                </span>
                <span className="ml-3 text-xs text-ink-soft">
                  {statusLabels[s.status] ?? s.status}
                  {" · "}
                  {efficacies.find((e) => e.value === s.waiver_efficacy)?.label ??
                    s.waiver_efficacy}
                </span>
              </button>
              <span className="text-xs text-ink-muted">
                {s.clause_set_reviewed_at
                  ? `Clause set reviewed ${new Date(s.clause_set_reviewed_at).toLocaleDateString("en-US")}`
                  : "Clause set not reviewed"}
              </span>
            </div>

            {open === s.state && (
              <div className="mt-4 space-y-4 border-t border-line/60 pt-4">
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-muted">Carrier admitted</dt>
                    <dd className="text-ink-soft">
                      {s.carrier_admitted ? "Yes" : "No"} — derived from the filings,
                      not editable here. Record a filing on the carrier.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Products filed</dt>
                    <dd className="font-mono text-ink-soft">
                      {s.product_codes.length ? s.product_codes.join(", ") : "—"}
                    </dd>
                  </div>
                </dl>

                {canEdit ? (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        patch(s.state, {
                          waiver_efficacy: form.get("waiver_efficacy"),
                          notes: form.get("notes") || null,
                        });
                      }}
                      className="space-y-3"
                    >
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                          Is a pre-injury release enforceable here
                        </span>
                        <select
                          name="waiver_efficacy"
                          defaultValue={s.waiver_efficacy}
                          className={input}
                        >
                          {efficacies.map((e) => (
                            <option key={e.value} value={e.value}>
                              {e.label}
                            </option>
                          ))}
                        </select>
                        <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
                          {
                            efficacies.find((e) => e.value === s.waiver_efficacy)
                              ?.description
                          }
                        </span>
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                          What counsel said
                        </span>
                        <textarea
                          name="notes"
                          rows={3}
                          defaultValue={s.notes ?? ""}
                          className={input}
                        />
                      </label>

                      <button type="submit" disabled={busy} className={button}>
                        Save
                      </button>
                    </form>

                    <div className="rounded-xl border border-line bg-paper p-4">
                      <p className="text-xs font-semibold text-ink">
                        Clause set review
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        Until this is recorded, every document produced in {s.state}
                        {" "}prints the specimen banner saying it is not for use with a
                        real signer. Withdrawing it puts the banner back.
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          patch(s.state, {
                            clause_set_reviewed: !s.clause_set_reviewed_at,
                          })
                        }
                        className={`mt-3 ${s.clause_set_reviewed_at ? quiet : button}`}
                      >
                        {s.clause_set_reviewed_at
                          ? "Withdraw the review"
                          : "Record that counsel has reviewed it"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-ink-muted">
                    Changing a state needs the compliance capability. Yours does not
                    include it.
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The vocabulary. Adding one opens nothing; it just gives the matrix a column. */
export function ActivityManager({
  activities,
  canEdit,
  usage,
}: {
  activities: ActivityClass[];
  canEdit: boolean;
  /** How many (state, activity) combinations are live for each, for context. */
  usage: Record<string, number>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(url: string, method: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await send(url, { method, body });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAdding(false);
    router.refresh();
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-lg border border-flag/30 bg-flag/[0.06] px-4 py-3 text-sm text-flag">
          {error}
        </p>
      )}

      <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line">
        {activities.map((a) => (
          <li key={a.code} className="bg-paper px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {a.label}
                  {a.retired_at && (
                    <span className="ml-2 text-xs font-normal text-flag">retired</span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{a.code}</p>
                {a.description && (
                  <p className="mt-1 max-w-prose text-xs leading-relaxed text-ink-soft">
                    {a.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-ink-muted">
                <span>
                  {usage[a.code] ?? 0} state{(usage[a.code] ?? 0) === 1 ? "" : "s"} open
                </span>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      act(`/api/admin/activities/${a.code}`, "PATCH", {
                        retired: !a.retired_at,
                      })
                    }
                    className="font-semibold text-accent underline"
                  >
                    {a.retired_at ? "Bring back" : "Retire"}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {canEdit &&
        (adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              act("/api/admin/activities", "POST", {
                code: form.get("code"),
                label: form.get("label"),
                description: form.get("description"),
                sort_order: Number(form.get("sort_order")) || 100,
              });
            }}
            className="mt-5 space-y-4 rounded-2xl border border-line bg-surface/40 p-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Code — permanent
                </span>
                <input
                  name="code"
                  required
                  placeholder="paddle_craft"
                  className={`${input} font-mono text-xs`}
                />
                <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
                  Lower case, underscores. Rule sets, templates and every agreement
                  ever written will point at this, so it cannot be changed later.
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  What a lender calls it
                </span>
                <input
                  name="label"
                  required
                  placeholder="Kayaks and paddleboards"
                  className={input}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Description
              </span>
              <input name="description" className={input} />
            </label>
            <label className="block max-w-[10rem]">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Sort order
              </span>
              <input name="sort_order" defaultValue={100} className={input} />
            </label>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy} className={button}>
                Add it
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className={quiet}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`mt-5 ${quiet}`}
          >
            Add an activity
          </button>
        ))}
    </div>
  );
}
