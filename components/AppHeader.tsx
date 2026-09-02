"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { Container } from "./ui";
import { Mark } from "./Mark";
import { PreviewChip } from "./PreviewGate";
import { AccountMenu } from "./AccountMenu";
import { AppNavMenu } from "./AppNavMenu";

/**
 * The masthead for everything behind a sign-in.
 *
 * The marketing header is not this. Once somebody is signed in, "How it works",
 * "For individuals" and "Get started" are answers to questions they have already
 * stopped asking, and a row of them across the top of the dashboard is four
 * chances to leave the product by accident. So the signed-in shell keeps only
 * the two things that stay useful — the way home and the way out — and leaves
 * the rest of the row empty.
 *
 * There is no "Account" link across the top. Signing in lands on the things you
 * lend, which is the home of this product, so a second word up here pointing
 * somewhere else only competed with it. The corner is the same `AccountMenu` the
 * marketing header uses: the picture is the button, and the profile, the
 * sign-out and the way back to the agreements all live behind it.
 *
 * The two corners answer the same shape of question on a phone. The right one
 * has held the account behind a picture for a while; the left one now holds the
 * lender's four places behind the mark, because four pills across a narrow
 * screen wrapped onto two lines and pushed every page down.
 */
export function AppHeader() {
  const pathname = usePathname();

  // The mark opens the lender nav on a phone — but only on the lender's own
  // screens. A staff member in the console or somebody in a partner account has
  // a different nav of their own, and offering them "Things you lend" from the
  // corner of it would be an invitation into a section that is not theirs.
  const lenderArea =
    !pathname.startsWith("/admin") && !pathname.startsWith("/partners");

  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/85 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          {/*
            Home is the section you are standing in, not the marketing front
            page. A partner clicking the mark in their console should land back
            on the console; sending everyone to the lender dashboard would drop
            staff and partners on a screen that is not theirs and holds nothing.

            On the lender's own screens the mark is the nav as well, on a phone.
            It still goes home from `sm` up, where the row of pills is visible
            and a menu would be a tap in front of links that already fit.
          */}
          {lenderArea ? (
            <AppNavMenu home={homeFor(pathname)} />
          ) : (
            <Link href={homeFor(pathname)} className="flex items-center gap-2.5">
              <Mark />
              <span className="font-serif text-lg tracking-tight">{BRAND.name}</span>
            </Link>
          )}

          <div className="flex items-center gap-4">
            <PreviewChip />
            <AccountMenu />
          </div>
        </div>
      </Container>
    </header>
  );
}

function homeFor(pathname: string): string {
  if (pathname.startsWith("/admin")) return "/admin";
  if (pathname.startsWith("/partners/console")) return "/partners/console";
  // `?as=lender` for the same reason AppNav carries it: a staff member standing
  // on a lender screen who clicks the mark means "back to the lender home", and
  // a bare /dashboard would answer that by throwing them into the console.
  return "/dashboard?as=lender";
}
