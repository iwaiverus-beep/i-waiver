"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The two screens inside Customer Support.
 *
 * WHY A SECOND ROW OF TABS AND NOT A THIRTEENTH IN AdminNav. The console's top
 * row answers "which part of the business", and every tab in it is a different
 * part. These two are one part seen from two ends: the tickets are the
 * conversations we are having, the listener is the mail we have not turned into
 * one yet. Promoting the mailbox to the top row would put a queue of untriaged
 * spam beside Carriers and Partners as though it were a peer of them, and would
 * hide the thing that actually matters about it — that it feeds the queue next
 * door.
 *
 * The count sits on the tab rather than on the page. A triage queue that has to
 * be opened to discover whether it is empty is a queue nobody opens.
 */
const LINKS = [
  { href: "/admin/support", label: "Tickets" },
  { href: "/admin/support/inbox", label: "Email listener" },
];

export function SupportNav({ untriaged }: { untriaged?: number }) {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex flex-wrap items-center gap-2">
      {LINKS.map((link) => {
        // Exact match on the tickets tab, because /admin/support/<uuid> is a
        // ticket and belongs to it, while /admin/support/inbox is not. A
        // `startsWith` here would light both tabs on the inbox.
        const active =
          link.href === "/admin/support"
            ? pathname === link.href || /^\/admin\/support\/[0-9a-f-]{20,}$/.test(pathname)
            : pathname.startsWith(link.href);

        const badge = link.href === "/admin/support/inbox" ? untriaged : undefined;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink-soft hover:bg-surface hover:text-ink"
            }`}
          >
            {link.label}
            {badge ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  active ? "bg-paper/20 text-paper" : "bg-flag/[0.1] text-flag"
                }`}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
