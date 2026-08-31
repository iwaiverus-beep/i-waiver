"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
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
            {unlocked && <AccountLink />}
            <PreviewChip />
            <Link
              href="/#waitlist"
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
            >
              Request early access
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
              {unlocked && <AccountLink onNavigate={() => setOpen(false)} />}
              <Link
                href="/#waitlist"
                onClick={() => setOpen(false)}
                className="text-sm font-semibold text-accent"
              >
                Request early access
              </Link>
            </nav>
          </div>
        )}
      </Container>
    </header>
  );
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="24" height="24" rx="7" className="fill-ink" />
      <path
        d="M8 13.4l3 3 7-7"
        stroke="#FAF9F6"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
