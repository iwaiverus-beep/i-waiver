"use client";

import { useId, useState } from "react";

/**
 * A page heading whose explanation folds away.
 *
 * The paragraph under a heading earns its place the first time somebody reads a
 * screen and is furniture every time after. Collapsed by default for that
 * reason: a lender opening their list wants the list, and the sentence about
 * agreements freezing their details is there when they go looking for it.
 *
 * Not a native <details>, because the marker belongs on the right of the
 * heading rather than in front of it, and the whole heading has to stay an <h1>
 * for anything reading the page in outline form.
 *
 * `defaultOpen` exists because the two halves of the product want opposite
 * things. A lender's list screens are opened many times a day by somebody who
 * has read the sentence already, so they start closed. The console and the
 * partner screens are visited rarely, often once, and closing the explanation
 * there hides it from the only reader who was ever going to need it.
 */
export function PageIntro({
  title,
  children,
  defaultOpen = false,
  /** `mt-4` and friends, where a page needs the title to sit lower. */
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="group flex w-full items-center gap-3 text-left"
      >
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
          {title}
        </h1>
        <svg
          width="18"
          height="18"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`shrink-0 text-ink-muted transition-transform group-hover:text-ink ${
            open ? "rotate-180" : ""
          }`}
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sr-only">
          {open ? "Hide the explanation" : "What is this screen?"}
        </span>
      </button>

      {open && (
        <p id={bodyId} className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          {children}
        </p>
      )}
    </div>
  );
}
