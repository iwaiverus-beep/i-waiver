"use client";

import { useId, useState } from "react";

/**
 * A page title and the paragraph that explains it, which can be zipped shut.
 *
 * The explanation under a title is written for somebody's first visit and read by
 * somebody on their fiftieth. On a wide screen that costs nothing; on a phone it
 * is the band above the fold, so the reader scrolls past the same three sentences
 * every time to reach the thing they came for.
 *
 * Open by default, everywhere. The alternative — collapsed on small screens —
 * hides the explanation from exactly the reader most likely to need it, since a
 * first visit is as likely to happen on a phone as anywhere else. A chevron
 * costs one tap and asks nothing of anybody who does not want it.
 *
 * Deliberately not remembered between visits. A heading that is open on one page
 * and shut on another, for reasons the reader cannot reconstruct, is worse than
 * one that behaves the same way every time.
 */
export function PageHeading({
  title,
  children,
  className,
  /** `mt-4` and friends, where the page needs the title to sit lower. */
  titleClassName = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();

  return (
    <div className={className}>
      {/* The chevron sits against the title rather than out at the container's
          right edge. Pushed to the edge it reads as a control for the page as a
          whole — on a wide screen it can end up half a metre from the words it
          hides, which is a different promise from the one it keeps. */}
      <div className={`flex items-start gap-1 ${titleClassName}`}>
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">{title}</h1>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-1.5 shrink-0 rounded-full p-2 text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:mt-2.5"
        >
          {/* The button's whole label, not a decoration beside one: the chevron
              is the only visible content, so a screen reader gets nothing at all
              without this. */}
          <span className="sr-only">
            {open ? "Hide what this page is for" : "Show what this page is for"}
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform duration-200 ${
              open ? "" : "-rotate-90"
            }`}
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </button>
      </div>

      {/* `hidden` rather than unmounting, so the text stays in the document for
          find-in-page and so reopening it costs no layout work. */}
      <div id={id} hidden={!open}>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          {children}
        </p>
      </div>
    </div>
  );
}
