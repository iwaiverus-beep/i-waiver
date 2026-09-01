"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation for the lender area.
 *
 * Rendered by the lender pages rather than by the root layout, so the marketing
 * site is untouched by it — and so nothing on a public page has to know whether
 * anyone is signed in.
 *
 * The action leads. Everything on these three screens exists to serve lending
 * something, and a reader starting at the left should hit the thing they came to
 * do before the places they can go. The tabs follow it, separated so the pill
 * does not read as a fourth tab.
 */
const LINKS = [
  { href: "/dashboard", label: "Agreements" },
  { href: "/assets", label: "Things you lend" },
  { href: "/contacts", label: "People" },
  { href: "/account", label: "Account" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-10 flex flex-wrap items-center gap-2 border-b border-line pb-4">
      <Link
        href="/agreements/new"
        className="inline-flex items-center rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
      >
        Lend something
      </Link>

      <span
        className="mx-2 hidden h-6 w-px shrink-0 bg-line sm:block"
        aria-hidden="true"
      />

      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              active
                ? "bg-ink text-paper"
                : "text-ink-soft hover:bg-surface hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
