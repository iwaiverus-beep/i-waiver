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
 * do before the places they can go. The tabs sit hard right, which is what puts
 * enough space between them and the pill that it does not read as a fourth tab —
 * a divider used to do that job and is no longer needed.
 *
 * Account is not here. It lives in the header's top-right corner with sign out,
 * where a browser-shaped habit expects to find it, and this row is left to the
 * three places inside the product.
 */
const LINKS = [
  // `?as=lender` is what tells /dashboard not to bounce a staff member into the
  // console. Without it, somebody who works here and also lends their own things
  // could reach the other two tabs and never get back to the first.
  //
  // Carried for everyone rather than only for staff: this component does not know
  // who is reading it, the parameter does nothing for anybody else, and a nav with
  // two versions of the same link is a nav that will disagree with itself.
  { href: "/dashboard?as=lender", label: "Agreements" },
  { href: "/assets", label: "Things you lend" },
  { href: "/contacts", label: "People" },
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

      {/*
        Right on a wide screen, and straight under the pill on a narrow one.
        `ml-auto` only from `sm`, because pushing three tabs to the right edge of
        a phone leaves them stranded away from the thumb with a gap where the
        eye expects the next thing.
      */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {LINKS.map((link) => {
          // Compared on the path alone. `usePathname` never carries a query
          // string, so matching the whole href would leave the Agreements tab
          // permanently unhighlighted now that it carries `?as=lender`.
          const path = link.href.split("?")[0];
          const active = pathname === path || pathname.startsWith(`${path}/`);
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
      </div>
    </nav>
  );
}
