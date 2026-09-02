import type { ReactNode } from "react";

/** Shared furniture for the lender area. */

const STATUS_TONE: Record<string, string> = {
  draft: "border-line bg-surface text-ink-soft",
  sent: "border-accent/30 bg-accent-soft text-accent",
  partially_signed: "border-accent/30 bg-accent-soft text-accent",
  executed: "border-accent bg-accent text-paper",
  expired: "border-line bg-surface text-ink-muted",
  voided: "border-flag/30 bg-flag/[0.08] text-flag",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Waiting for signatures",
  partially_signed: "Partly signed",
  executed: "Signed by everyone",
  expired: "Expired",
  voided: "Voided",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
        STATUS_TONE[status] ?? "border-line bg-surface text-ink-soft"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-paper">
      <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>
        {action}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/60 py-2.5 last:border-0 sm:flex-row sm:gap-6">
      <dt className="w-48 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="break-all font-mono text-[11px] leading-relaxed text-ink-soft">
      {children}
    </code>
  );
}

export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: ReactNode;
}) {
  const styles =
    tone === "warn"
      ? "border-flag/30 bg-flag/[0.06] text-flag"
      : "border-accent/25 bg-accent-soft text-accent";
  return (
    <div className={`rounded-xl border px-5 py-4 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

/**
 * One number, and what it is.
 *
 * `hint` is not decoration. A count with no denominator is the easiest thing on a
 * dashboard to misread — "6 policies" means nothing until you know it is six out
 * of fifteen quotes — so the tile has a place to say so, and the dashboard is
 * written to use it.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "plain" | "accent";
}) {
  return (
    <div
      className={`rounded-2xl border px-5 py-4 ${
        tone === "accent" ? "border-accent/30 bg-accent-soft" : "border-line bg-paper"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-2 font-serif text-3xl tracking-tight tabular-nums ${
          tone === "accent" ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-ink-muted">{children}</p>
  );
}
