"use client";

import { useMemo, useRef, useState } from "react";

import { send } from "@/lib/client/request";
import {
  buildCandidates,
  contactKey,
  detectMapping,
  FIELD_LABELS,
  looksLikeHeader,
  summarise,
  type Field,
  type Mapping,
} from "@/lib/contacts/import";
import { dropEmptyRows, parseDelimited } from "@/lib/import/delimited";

/**
 * Importing a list of people.
 *
 * THREE STEPS, AND THE MIDDLE ONE IS THE FEATURE. Choose a source, check the
 * columns, import. It would be less work to skip the middle step and trust the
 * header row — and it would be wrong, because no two exports agree on what the
 * columns are called and the failure mode is silent. A phone column read as an
 * email does not error; it produces a hundred contacts that look fine on this
 * screen and cannot be sent anything.
 *
 * So nothing is written until somebody has seen a table of their own data under
 * our column names and pressed the button.
 *
 * WHY PASTE IS OFFERED FIRST-CLASS AND NOT AS A FALLBACK. Google Sheets has no
 * "export to our importer" and neither does Excel; what both have is select,
 * copy. The clipboard carries tab-separated text, which is a format, so pasting
 * is a first-class route rather than a consolation — and it parses in the
 * browser, so nothing leaves the machine until the import itself.
 */

type Grid = string[][];
type Stage = "choose" | "mapping" | "done";

const FIELDS: Field[] = ["name", "first", "last", "email", "phone", "notes", "skip"];

export function ContactImport({
  existing,
  onImported,
  onClose,
}: {
  /** Everyone already saved, so the preview can say who is not new. */
  existing: { display_name: string; email: string | null; phone: string | null }[];
  /** Called after a successful import so the list behind this can restock. */
  onImported: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("choose");
  const [grid, setGrid] = useState<Grid>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({});
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; failed: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const held = useMemo(() => new Set(existing.map(contactKey)), [existing]);

  const columns = useMemo(
    () => grid.reduce((widest, row) => Math.max(widest, row.length), 0),
    [grid],
  );

  const candidates = useMemo(
    () => (grid.length ? buildCandidates(grid, mapping, { hasHeader, existingKeys: held }) : []),
    [grid, mapping, hasHeader, held],
  );

  const counts = useMemo(() => summarise(candidates), [candidates]);

  function accept(next: Grid) {
    const cleaned = dropEmptyRows(next);
    if (cleaned.length === 0) {
      setError("There are no rows in that.");
      return;
    }
    const header = looksLikeHeader(cleaned[0]);
    setGrid(cleaned);
    setHasHeader(header);
    setMapping(detectMapping(cleaned, header));
    setError(null);
    setStage("mapping");
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch("/api/contacts/import/parse", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "That file could not be read.");
        return;
      }
      accept(payload.grid as Grid);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function usePasted() {
    if (!pasted.trim()) {
      setError("Paste some rows first.");
      return;
    }
    accept(parseDelimited(pasted));
  }

  /**
   * The mapping is a set of dropdowns over one field each, so choosing a column
   * for Email necessarily takes it from wherever it was. Two fields pointing at
   * one column is not a thing anybody means, and letting it happen produces an
   * import where the name and the phone number are the same string.
   */
  function assign(column: number, field: Field) {
    setMapping((current) => {
      const next: Mapping = { ...current };
      for (const key of Object.keys(next) as Exclude<Field, "skip">[]) {
        if (next[key] === column) delete next[key];
      }
      if (field !== "skip") next[field] = column;
      return next;
    });
  }

  function fieldAt(column: number): Field {
    const found = (Object.keys(mapping) as Exclude<Field, "skip">[]).find(
      (key) => mapping[key] === column,
    );
    return found ?? "skip";
  }

  async function runImport() {
    const ready = candidates.filter((c) => c.status === "ready");
    if (ready.length === 0) return;

    setBusy(true);
    setError(null);

    const outcome = await send<{ imported: number; duplicates: number; failed: number }>(
      "/api/contacts/import",
      {
        body: {
          contacts: ready.map((c) => ({
            display_name: c.display_name,
            email: c.email,
            phone: c.phone,
            notes: c.notes,
          })),
        },
      },
    );

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    setResult(outcome.data);
    setStage("done");
    onImported();
  }

  // -------------------------------------------------------------------------

  if (stage === "done" && result) {
    return (
      <section className="mt-8 rounded-2xl border border-accent/25 bg-accent-soft p-6">
        <h3 className="text-base font-semibold text-accent">
          {result.imported === 1 ? "1 person added." : `${result.imported} people added.`}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {result.duplicates > 0 &&
            `${result.duplicates} ${result.duplicates === 1 ? "was" : "were"} already in your list and ${result.duplicates === 1 ? "was" : "were"} left alone. `}
          {result.failed > 0 && `${result.failed} could not be saved. `}
          They are saved as imported, so you can tell later which details nobody
          has checked.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
        >
          Done
        </button>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-paper p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">Import a list</h3>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-soft">
            A spreadsheet from Excel, Numbers or Google Sheets, a CSV out of
            whatever you used before this, or rows copied straight from a sheet.
            You will see what is going to be saved before anything is.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {stage === "choose" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            className="flex flex-col items-start justify-center rounded-xl border border-dashed border-line px-6 py-8"
          >
            <p className="text-sm font-semibold text-ink">Drop a file here</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              .xlsx, .csv, .tsv or plain text. Up to 4MB.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                // Cleared so choosing the same file twice fires again — the
                // obvious thing to do after fixing a column and re-exporting.
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Reading…" : "Choose a file"}
            </button>
          </div>

          <div>
            <label
              htmlFor="import-paste"
              className="block text-sm font-semibold text-ink"
            >
              Or paste rows
            </label>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              Select the cells in Google Sheets or Excel, copy, and paste here.
              This never leaves your browser until you import.
            </p>
            <textarea
              id="import-paste"
              rows={6}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={"Marcus Okafor\tmarcus@example.com\t816-555-0142"}
              className="mt-3 w-full rounded-xl border border-line bg-paper px-4 py-3 font-mono text-xs text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={usePasted}
              className="mt-3 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            >
              Use these rows
            </button>
          </div>
        </div>
      )}

      {stage === "mapping" && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(event) => {
                  const next = event.target.checked;
                  setHasHeader(next);
                  // Re-guess: with the header row now counted as data (or not),
                  // the content-based detection has different rows to look at.
                  setMapping(detectMapping(grid, next));
                }}
                className="h-4 w-4 rounded border-line text-accent"
              />
              The first row is column headings
            </label>

            <button
              type="button"
              onClick={() => {
                setStage("choose");
                setGrid([]);
                setPasted("");
              }}
              className="text-xs text-ink-muted underline transition-colors hover:text-ink"
            >
              Use a different file
            </button>
          </div>

          <p className="mt-4 text-sm text-ink-soft">
            Check each column is going to the right place. Anything set to{" "}
            <span className="font-semibold">Do not import</span> is left behind.
          </p>

          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface/70">
                  {Array.from({ length: columns }, (_, column) => (
                    <th key={column} className="px-3 py-2.5 align-top">
                      <select
                        aria-label={`What is in column ${column + 1}`}
                        value={fieldAt(column)}
                        onChange={(event) => assign(column, event.target.value as Field)}
                        className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs font-semibold text-ink outline-none focus:border-accent"
                      >
                        {FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {FIELD_LABELS[field]}
                          </option>
                        ))}
                      </select>
                      {hasHeader && (
                        <span className="mt-1.5 block truncate font-normal text-ink-muted">
                          {grid[0]?.[column] || "—"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.slice(hasHeader ? 1 : 0, hasHeader ? 7 : 6).map((row, index) => (
                  <tr key={index} className="border-b border-line/60 last:border-0">
                    {Array.from({ length: columns }, (_, column) => (
                      <td
                        key={column}
                        className="max-w-[14rem] truncate px-3 py-2 text-ink-soft"
                      >
                        {row[column] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-ink">
            <span className="font-semibold">{counts.ready}</span> ready to import
            {counts.existing > 0 && ` · ${counts.existing} already in your list`}
            {counts.duplicate > 0 && ` · ${counts.duplicate} repeated in the file`}
            {counts.skipped > 0 && ` · ${counts.skipped} skipped`}
          </p>

          {/*
            The rows that will not import, with the reason on each. Shown rather
            than counted, because "3 skipped" invites the assumption that they
            were junk — and sometimes the three are real people whose email
            column landed in the wrong place, which is fixable from here.
          */}
          {counts.skipped + counts.duplicate + counts.existing > 0 && (
            <details className="mt-3 rounded-xl border border-line px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-soft">
                What is not being imported, and why
              </summary>
              <ul className="mt-3 space-y-1.5">
                {candidates
                  .filter((candidate) => candidate.status !== "ready")
                  .slice(0, 60)
                  .map((candidate) => (
                    <li key={candidate.line} className="text-xs text-ink-muted">
                      <span className="font-mono">Row {candidate.line}</span>
                      {candidate.display_name ? ` · ${candidate.display_name}` : ""} —{" "}
                      {candidate.reason}
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <button
            type="button"
            onClick={runImport}
            disabled={busy || counts.ready === 0}
            className="mt-5 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {busy
              ? "Importing…"
              : counts.ready === 0
                ? "Nothing to import"
                : `Import ${counts.ready} ${counts.ready === 1 ? "person" : "people"}`}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-flag">
          {error}
        </p>
      )}
    </section>
  );
}
