"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { PRIMARY_CTA } from "@/lib/launch";
import { Container } from "./ui";
import { AccountLink } from "./AccountLink";
import { PreviewChip, usePreview } from "./PreviewGate";

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/individuals", label: "For individuals" },
  { href: "/businesses", label: "For businesses" },
  { href: "/about", label: "About" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const { unlocked, noteLogoClick } = usePreview();

  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/85 backdrop-blur">
      {/*
        The account strip, above the masthead and hard right, where a browser-
        shaped habit goes looking for it. Rendered only once the preview is
        unlocked — both things inside it are gated, so leaving it in would put an
        empty ruled band across the top of every public page.

        It is deliberately outside the `md:` breakpoint that hides the main nav:
        signing out should not require opening a hamburger.
      */}
      {unlocked && (
        <div className="border-b border-line/50">
          <Container>
            <div className="flex h-9 items-center justify-end gap-4">
              <PreviewChip />
              <AccountLink />
            </div>
          </Container>
        </div>
      )}

      <Container>
        <div className="flex h-16 items-center justify-between">
          {/*
            Still a real link home — the counting rides along with it. Clicking
            five times navigates to "/" each time, which is harmless: this header
            lives in the root layout, so it is not remounted by that navigation
            and the run of clicks survives.
          */}
          <Link
            href="/"
            onClick={noteLogoClick}
            className="flex items-center gap-2.5"
          >
            <Mark />
            <span className="font-serif text-lg tracking-tight">
              {BRAND.name}
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-ink-soft transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={PRIMARY_CTA.href}
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
            >
              {PRIMARY_CTA.label}
            </Link>
          </nav>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Toggle navigation"
            className="md:hidden"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {open && (
          <div className="border-t border-line py-4 md:hidden">
            <nav className="flex flex-col gap-4">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="text-sm text-ink-soft"
                >
                  {item.label}
                </Link>
              ))}
              {/*
                No account link here. The strip above the masthead carries it at
                every width, so repeating it inside the hamburger would give the
                same page two sign-out buttons.
              */}
              <Link
                href={PRIMARY_CTA.href}
                onClick={() => setOpen(false)}
                className="text-sm font-semibold text-accent"
              >
                {PRIMARY_CTA.label}
              </Link>
            </nav>
          </div>
        )}
      </Container>
    </header>
  );
}

/** Where the accent dot sits: on the perforation radius, above the left tick. */
const DOT = { x: 19, y: 17.1, r: 4.2 };

const PERF_RADIUS = 19.8;
const PERF_COUNT = 20;
const BEAD_RADIUS = 1.2;

/**
 * The perforation, generated rather than hand-placed so this and the same
 * numbers in `scripts/make-icons.mjs` cannot drift apart.
 *
 * Beads that fall under the accent dot are dropped, so the dot reads as one
 * enlarged bead standing in for them rather than a blob covering them — left
 * in, they poke out from underneath as white slivers.
 */
const PERFORATION = Array.from({ length: PERF_COUNT }, (_, i) => {
  const angle = (i / PERF_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 32 + PERF_RADIUS * Math.cos(angle),
    y: 32 + PERF_RADIUS * Math.sin(angle),
  };
}).filter(
  ({ x, y }) => Math.hypot(x - DOT.x, y - DOT.y) > DOT.r + BEAD_RADIUS + 0.6,
);

/**
 * The seal: a perforated stamp around two ticks, with a dot on the perforation
 * that doubles as the tittle over an i — so the mark spells iW.
 *
 * Bigger than the old rounded square on purpose. The beads are 2.4 units across
 * in a 64-unit box, so below roughly 30px they stop resolving and turn into a
 * grey haze. `scripts/make-icons.mjs` draws a simplified version — no ring, no
 * perforation — for anything smaller, which is why the favicon and this are
 * deliberately not the same artwork.
 */
function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="26.5" className="stroke-ink" strokeWidth="3.6" />
      {PERFORATION.map((bead) => (
        <circle
          key={`${bead.x}-${bead.y}`}
          cx={bead.x}
          cy={bead.y}
          r={BEAD_RADIUS}
          className="fill-ink"
        />
      ))}
      <g
        className="stroke-ink"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 33l5 9 9-16" />
        <path d="M29 29l5 9 10-15" />
      </g>
      {/*
        Not `accent` (#1B5E4F). The dot has to contrast with the ink strokes, not
        with the paper behind them, and against ink the brand green reads as an
        off-colour smudge rather than a separate mark. Lifted for legibility.
      */}
      <circle cx={DOT.x} cy={DOT.y} r={DOT.r} fill="#1B8A72" />
    </svg>
  );
}
