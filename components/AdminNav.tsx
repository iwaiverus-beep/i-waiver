"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  STAFF_ROLE_LABELS,
  staffCan,
  type StaffCapability,
  type StaffRole,
} from "@/lib/platform/roles";

/**
 * Navigation for the i-Waiver admin console.
 *
 * The role is on display at all times, deliberately. Half the confusion in a
 * tool like this is somebody clicking a thing that is refused and not knowing
 * why; seeing "Support" in the corner answers it before they ask.
 *
 * A tab whose page would 404 for this role is not shown at all, for the same
 * reason: a link that always refuses is worse than no link. The page still checks
 * — hiding a tab is presentation, never authorisation.
 */
const LINKS: { href: string; label: string; needs?: StaffCapability }[] = [
  // Queues first, because it is the screen with work in it. Overview is the one
  // people ask for and the one nobody has to act on, so it comes second.
  { href: "/admin", label: "Queues" },
  { href: "/admin/overview", label: "Overview" },
  // Overview is where things stand; Trends is which way they are moving. Kept
  // apart rather than stacked on one screen because the counts are what somebody
  // checks daily and the charts are what somebody studies — and because a page
  // that answers both questions tends to answer neither well.
  { href: "/admin/trends", label: "Trends", needs: "reports.read" },
  // Where the product is open, and what is missing where it is not. Separate from
  // Carriers even though a filing is what opens a state: the carrier screen is
  // about one company, this one is about the whole map.
  { href: "/admin/config", label: "Configuration" },
  { href: "/admin/partners", label: "Partners" },
  // Carriers get their own tab rather than sitting under partners. They are the
  // other side of the coverage boundary — we call them — and a console that
  // listed them together would assert the two are the same relationship.
  { href: "/admin/carriers", label: "Carriers" },
  { href: "/admin/lenders", label: "Lenders", needs: "reports.read" },
  { href: "/admin/borrowers", label: "Borrowers", needs: "reports.read" },
  // Lenders and borrowers are parties to documents and have their own tabs above.
  // This one is everybody else: people who raised a hand, and the named humans at
  // the companies we work with. Deliberately not merged with those two — see the
  // header of lib/platform/contacts.ts.
  { href: "/admin/contacts", label: "Contacts", needs: "reports.read" },
  { href: "/admin/support", label: "Support" },
  // The brand kit. Last but one, beside Staff, because it is a cupboard rather
  // than a queue — nobody opens it as part of a day's work, they open it when
  // somebody outside asks for the logo.
  { href: "/admin/marketing", label: "Marketing", needs: "marketing.read" },
  { href: "/admin/staff", label: "Staff" },
];

export function AdminNav({ role, email }: { role: StaffRole; email: string }) {
  const pathname = usePathname();

  return (
    <nav className="mb-10 flex flex-wrap items-center gap-2 border-b border-line pb-4">
      {LINKS.filter((link) => !link.needs || staffCan(role, link.needs)).map((link) => {
        const active =
          link.href === "/admin" ? pathname === link.href : pathname.startsWith(link.href);
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

      <span className="ml-auto flex items-center gap-3 text-xs text-ink-muted">
        <span className="hidden sm:inline">{email}</span>
        <span className="rounded-full border border-line bg-surface px-3 py-1 font-semibold text-ink-soft">
          {STAFF_ROLE_LABELS[role]}
        </span>
      </span>
    </nav>
  );
}
