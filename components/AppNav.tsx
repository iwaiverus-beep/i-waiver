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
 * ON A PHONE THIS ROW IS NOT HERE AT ALL. Four pills across a narrow screen wrap
 * onto two lines and eat the top of every page before it has said anything, so
 * below `sm` all four move behind the mark in the header — see `AppNavMenu`.
 * This component still owns the list; the menu reads it from here, because two
 * copies of a nav are two navs that will disagree.
 *
 * Account is not here. It lives in the header's top-right corner with sign out,
 * where a browser-shaped habit expects to find it, and this row is left to the
 * three places inside the product.
 */

/** Lending something. First everywhere it appears, because it is the point. */
export const LEND_ACTION = { href: "/agreements/new", label: "Lend something" };

export const LENDER_LINKS = [
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

/**
 * Whether a tab is the page being looked at.
 *
 * Compared on the path alone. `usePathname` never carries a query string, so
 * matching the whole href would leave the Agreements tab permanently
 * unhighlighted now that it carries `?as=lender`.
 */
export function navActive(pathname: string, href: string): boolean {
  const path = href.split("?")[0];
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AppNav() {
  const pathname = usePathname();

  // Nothing stands in for this row on a phone, deliberately. The lender pages
  // set `pt-0` below `sm`, so the title starts immediately under the header —
  // which is the point of moving the nav into the corner: a short screen should
  // open on its content, not on a band of empty paper.
  return (
    <nav className="mb-10 hidden flex-wrap items-center gap-2 border-b border-line pb-4 sm:flex">
      <Link
        href={LEND_ACTION.href}
        className="inline-flex items-center rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
      >
        {LEND_ACTION.label}
      </Link>

      {/* Hard right, which is what puts enough space between the tabs and the
          pill that they do not read as a fourth one. */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {LENDER_LINKS.map((link) => {
          const active = navActive(pathname, link.href);
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
