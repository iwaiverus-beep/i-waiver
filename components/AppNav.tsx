"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation for the lender area.
 *
 * Rendered by the lender pages rather than by the root layout, so the marketing
 * site is untouched by it — and so nothing on a public page has to know whether
 * anyone is signed in.
 */
const LINKS = [
  { href: "/dashboard", label: "Agreements" },
  { href: "/assets", label: "Things you lend" },
  { href: "/contacts", label: "People" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-10 flex flex-wrap gap-2 border-b border-line pb-4">
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
