"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAFF_ROLE_LABELS, type StaffRole } from "@/lib/platform/roles";

/**
 * Navigation for the i-Waiver admin console.
 *
 * The role is on display at all times, deliberately. Half the confusion in a
 * tool like this is somebody clicking a thing that is refused and not knowing
 * why; seeing "Support" in the corner answers it before they ask.
 */
const LINKS = [
  { href: "/admin", label: "Queues" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/staff", label: "Staff" },
];

export function AdminNav({ role, email }: { role: StaffRole; email: string }) {
  const pathname = usePathname();

  return (
    <nav className="mb-10 flex flex-wrap items-center gap-2 border-b border-line pb-4">
      {LINKS.map((link) => {
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
