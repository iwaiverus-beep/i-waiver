"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation for the partner console.
 *
 * Same furniture as AppNav, different audience, and kept as its own component
 * rather than parameterised because the two will diverge — a partner has no
 * "lend something" action, and a lender has no sandbox.
 */
const LINKS = [
  { href: "/partners/console", label: "Overview" },
  { href: "/partners/console/sandbox", label: "Sandbox" },
  { href: "/partners/console/branding", label: "Branding" },
  { href: "/partners/console/support", label: "Support" },
];

export function PartnerNav({ partnerName }: { partnerName: string }) {
  const pathname = usePathname();

  return (
    <nav className="mb-10 flex flex-wrap items-center gap-2 border-b border-line pb-4">
      <span className="mr-3 text-sm font-semibold text-ink">{partnerName}</span>

      {LINKS.map((link) => {
        // Exact match on the overview, so it does not light up on every child.
        const active =
          link.href === "/partners/console"
            ? pathname === link.href
            : pathname.startsWith(link.href);
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

      <Link
        href="/partners/docs"
        className="ml-auto text-sm text-ink-soft transition-colors hover:text-ink"
      >
        Integration docs →
      </Link>
    </nav>
  );
}
