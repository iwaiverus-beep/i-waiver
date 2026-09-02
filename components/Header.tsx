"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { PRIMARY_CTA } from "@/lib/launch";
import { Container } from "./ui";
import { AccountMenu } from "./AccountMenu";
import { PreviewChip, usePreview } from "./PreviewGate";
import { Mark } from "./Mark";

/**
 * Three audiences and then the company, which is the order they arrive in: a
 * person lending a jet ski, a business lending a hundred, and a platform whose
 * customers do both. `/partners` was reachable from the footer and from a link in
 * an email and nowhere else — which is a strange place to leave the pitch to the
 * one audience that brings the other two with it.
 */
const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/individuals", label: "For individuals" },
  { href: "/businesses", label: "For businesses" },
  { href: "/partners", label: "For partners" },
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
        the account menu, and the way out inside it, should not require opening a
        hamburger.
      */}
      {unlocked && (
        <div className="border-b border-line/50">
          <Container>
            {/* h-11, not the h-9 this strip used to be: the menu button is a
                32px circle with padding, and a 36px band clips it. */}
            <div className="flex h-11 items-center justify-end gap-4">
              <PreviewChip />
              <AccountMenu />
            </div>
          </Container>
        </div>
      )}

      <Container>
        <div className="flex h-16 items-center justify-between">
          {/*
            Still a real link home — the counting rides along with it. Clicking
            five times navigates to "/" each time, which is harmless: this header
            lives in the marketing group's layout, which is not remounted when one
            page in that group navigates to another, so the run of clicks survives.
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
