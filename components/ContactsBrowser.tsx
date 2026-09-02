"use client";

import { useMemo, useState } from "react";
import type { CompanyContact, InboundContact } from "@/lib/platform/contacts";

/**
 * Search and display for the two contact groups.
 *
 * Filtering happens in the browser over a capped list rather than by round trips.
 * At a few hundred rows that is instant and a query per keystroke is not.
 */

const SOURCE_LABELS: Record<InboundContact["source"], string> = {
  waitlist: "Waitlist",
  application: "Partner application",
  prospect: "Prospect",
  support: "Support",
};

function SearchBox({
  value,
  onChange,
  placeholder,
  count,
  capped,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: number;
  capped?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full max-w-sm rounded-lg border border-line bg-paper px-3.5 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
      />
      <span className="text-xs text-ink-muted">
        {count.toLocaleString("en-US")} shown
        {capped && " · most recent only, use the export for everything"}
      </span>
    </div>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="py-2.5 pr-4 align-top">{children}</td>;
}

function Head({ children }: { children: React.ReactNode }) {
  return <th className="py-2 pr-4 text-left font-medium">{children}</th>;
}

function matches(haystack: (string | null | undefined)[], needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return haystack.some((v) => v && v.toLowerCase().includes(q));
}

export function InboundList({ rows }: { rows: InboundContact[] }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | InboundContact["source"]>("all");

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (source === "all" || r.source === source) &&
          matches([r.name, r.email, r.company, r.note, r.state], q),
      ),
    [rows, q, source],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", "waitlist", "application", "prospect", "support"] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                source === s
                  ? "bg-ink text-paper"
                  : "border border-line text-ink-soft hover:bg-surface"
              }`}
            >
              {s === "all" ? "Everyone" : SOURCE_LABELS[s]}
              <span className="ml-1.5 font-normal opacity-70">
                {s === "all"
                  ? rows.length
                  : rows.filter((r) => r.source === s).length}
              </span>
            </button>
          ),
        )}
      </div>

      <SearchBox
        value={q}
        onChange={setQ}
        placeholder="Name, address, company…"
        count={shown.length}
      />

      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">Nobody matches that.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <Head>Who</Head>
                <Head>Where from</Head>
                <Head>Company</Head>
                <Head>Status</Head>
                <Head>When</Head>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.source}-${r.id}`} className="border-b border-line/60">
                  <Cell>
                    <span className="block font-medium text-ink">
                      {r.name ?? "—"}
                    </span>
                    {r.email ? (
                      <a
                        href={`mailto:${r.email}`}
                        className="text-xs text-accent underline"
                      >
                        {r.email}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-muted">no address</span>
                    )}
                    {r.phone && (
                      <span className="ml-2 text-xs text-ink-muted">{r.phone}</span>
                    )}
                  </Cell>
                  <Cell>
                    <span className="text-xs text-ink-soft">
                      {SOURCE_LABELS[r.source]}
                    </span>
                    {r.href && (
                      <a
                        href={r.href}
                        className="ml-2 text-xs text-accent underline"
                      >
                        open
                      </a>
                    )}
                  </Cell>
                  <Cell>
                    <span className="text-ink-soft">{r.company ?? "—"}</span>
                    {r.state && (
                      <span className="ml-2 font-mono text-xs text-ink-muted">
                        {r.state}
                      </span>
                    )}
                  </Cell>
                  <Cell>
                    <span className="text-xs text-ink-soft">{r.status ?? "—"}</span>
                    {r.note && (
                      <span
                        className="mt-0.5 block max-w-xs truncate text-xs text-ink-muted"
                        title={r.note}
                      >
                        {r.note}
                      </span>
                    )}
                  </Cell>
                  <Cell>
                    <span className="text-xs tabular-nums text-ink-muted">
                      {new Date(r.createdAt).toLocaleDateString("en-US")}
                    </span>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CompanyList({ rows }: { rows: CompanyContact[] }) {
  const [q, setQ] = useState("");

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          matches([r.company, r.status], q) ||
          r.people.some((p) => matches([p.name, p.email, p.role], q)),
      ),
    [rows, q],
  );

  return (
    <div>
      <SearchBox
        value={q}
        onChange={setQ}
        placeholder="Company or person…"
        count={shown.length}
      />

      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing matches that.</p>
      ) : (
        <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line">
          {shown.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="bg-paper px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-semibold text-ink">
                  {r.company}
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {r.kind === "carrier" ? "Carrier" : "Partner"}
                    {r.status ? ` · ${r.status}` : ""}
                  </span>
                </p>
                <a href={r.href} className="text-xs font-semibold text-accent underline">
                  Open
                </a>
              </div>

              {r.people.length === 0 ? (
                <p className="mt-1.5 text-xs text-ink-muted">
                  Nobody named. {r.kind === "carrier"
                    ? "Add a contact on the carrier."
                    : "Nobody has been invited yet."}
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {r.people.map((p, i) => (
                    <li key={`${p.email}-${i}`} className="text-xs text-ink-soft">
                      {p.name && <span className="text-ink">{p.name} · </span>}
                      {p.email && (
                        <a href={`mailto:${p.email}`} className="text-accent underline">
                          {p.email}
                        </a>
                      )}
                      {p.phone && <span className="ml-2">{p.phone}</span>}
                      {p.role && <span className="ml-2 text-ink-muted">{p.role}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

