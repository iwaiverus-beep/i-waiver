import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The top and bottom of a signed-in page, said once.
 *
 * Every screen behind the sign-in used to carry its own copy of this, and they
 * drifted: some opened 56px below the header, one of them 80px, and after the
 * phone's nav moved into the corner a few sat flush against it. On a small
 * screen that gap is the first thing anybody sees, and four screens disagreeing
 * about it reads as four different products.
 *
 * `pt-4` is deliberately small. The header is sticky and already draws a line
 * under itself, so the title needs separating from it, not launching off it —
 * and a phone has no room to spend on empty paper above the fold. A wide screen
 * gets 40px rather than a phone's 16, which is enough to breathe and half what
 * it used to be: 80px put the nav row a thumb's width down the page for no
 * reason a reader could see.
 *
 * The bottom is smaller than it looks here. `AppFooter` used to add 80px of its
 * own margin on top of this, which is what made the space under a short page
 * read as a gap rather than an ending; it adds none now, and this is the whole
 * distance from the last thing on the page to the rule above the small print.
 */
export const PAGE_PADDING = "pb-10 pt-4 sm:pb-14 sm:pt-10";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  children,
  className = "",
  tone = "paper",
}: {
  children: ReactNode;
  className?: string;
  tone?: "paper" | "surface" | "ink";
}) {
  const tones = {
    paper: "bg-paper",
    surface: "bg-surface",
    ink: "bg-ink text-paper",
  };
  return (
    <section className={`py-20 sm:py-28 ${tones[tone]} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
      {children}
    </p>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-serif text-4xl leading-[1.08] tracking-tightest sm:text-5xl lg:text-6xl">
      {children}
    </h1>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
      {children}
    </h2>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 max-w-prose text-lg leading-relaxed text-ink-soft sm:text-xl">
      {children}
    </p>
  );
}

export function Button({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const styles =
    variant === "primary"
      ? "bg-accent text-paper hover:bg-accent-hover"
      : "border border-line bg-transparent text-ink hover:border-ink/40";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-colors ${styles}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  title,
  children,
  step,
}: {
  title: string;
  children: ReactNode;
  step?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-7">
      {step && (
        <span className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {step}
        </span>
      )}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

/**
 * Visible marker for copy that has not been through legal review. The whole
 * product rests on being able to show what a signer saw, so unreviewed language
 * should never be able to pass silently as final.
 */
export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
      <p className="text-sm leading-relaxed text-flag">
        <strong className="font-semibold">Draft — pending legal review.</strong>{" "}
        {children}
      </p>
    </div>
  );
}

export function Disclosure({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 max-w-prose text-xs leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}
