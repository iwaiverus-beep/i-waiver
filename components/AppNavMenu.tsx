"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import { Mark } from "./Mark";
import { LEND_ACTION, LENDER_LINKS, navActive } from "./AppNav";

/**
 * The mark in the top-left corner, and on a phone the whole lender nav behind it.
 *
 * WHY THE LOGO AND NOT A HAMBURGER. There is exactly one thing in this corner
 * and it is already the way home, so putting a second control beside it would
 * mean two targets a thumb-width apart that both mean "go somewhere". The mark
 * keeps its job — it is still the way back to your agreements — and gains the
 * three other places plus the action, which is what the row across the top used
 * to hold before four pills started wrapping onto two lines on a narrow screen.
 *
 * Phones only. From `sm` the row in `AppNav` is back and this is a plain link
 * again, because a menu hiding four things that already fit is a tap in the way.
 *
 * The list is `AppNav`'s. This screen and that row must never be able to differ.
 */
export function AppNavMenu({ home }: { home: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Every item navigates, so a menu left open across one is a menu covering the
  // page that was just asked for.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      {/* From `sm`: the mark, doing only what it has always done. */}
      <Link href={home} className="hidden items-center gap-2.5 sm:flex">
        <Mark />
        <span className="font-serif text-lg tracking-tight">{BRAND.name}</span>
      </Link>

      {/* Below `sm`: the same mark, now the handle for the nav. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu"
        className="flex items-center gap-2.5 sm:hidden"
      >
        <Mark />
        <span className="font-serif text-lg tracking-tight">{BRAND.name}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={BRAND.name}
          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-paper shadow-lg shadow-ink/5 sm:hidden"
        >
          {/*
            The action first and above a rule, wearing the accent it wears in the
            row it came from. It is not one of the places you can go; it is the
            thing the places are for.
          */}
          <Link
            href={LEND_ACTION.href}
            role="menuitem"
            className="block border-b border-line bg-accent px-4 py-3.5 text-sm font-semibold text-paper"
          >
            {LEND_ACTION.label}
          </Link>

          {LENDER_LINKS.map((link) => {
            const active = navActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className={`block px-4 py-3.5 text-sm font-semibold transition-colors ${
                  active ? "bg-surface text-ink" : "text-ink-soft hover:bg-surface"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
