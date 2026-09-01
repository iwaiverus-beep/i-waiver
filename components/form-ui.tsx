import type { ReactNode } from "react";

/**
 * The form furniture the account screens share with the sign-in form.
 *
 * Lifted out of components/AuthForm.tsx, which owned the only copy, at the point
 * where four more forms wanted the same label and the same input. Nothing here is
 * new — it is the same markup, in one place, so a field on the account screen and
 * a field on the sign-in screen cannot drift into looking like two products.
 */

export const inputClass =
  "w-full rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent";

export const primaryButtonClass =
  "rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50";

/** Secondary actions: upload, remove, cancel. Reads as a control, not as the answer. */
export const quietButtonClass =
  "rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-ink-muted hover:text-ink disabled:opacity-50";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * What just happened, said in the place it happened.
 *
 * Two tones only. A form either did the thing or refused to, and a third
 * "warning" state on a screen this small is a decision nobody can act on.
 */
export function Notice({
  tone,
  children,
}: {
  tone: "good" | "bad";
  children: ReactNode;
}) {
  const styles =
    tone === "bad"
      ? "border-flag/30 bg-flag/[0.06] text-flag"
      : "border-accent/30 bg-accent-soft text-accent";
  return (
    <p className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </p>
  );
}
