"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { initialsFor } from "@/lib/format";

/**
 * The account corner of the header.
 *
 * Resolved on the client rather than in the root layout on purpose: reading
 * cookies in the layout would opt every marketing page out of static rendering to
 * decide the wording of one link. The signed-out state is the honest default
 * while it loads, and nothing behind this is protected by it — the middleware and
 * the route handlers do that.
 *
 * WHY A MENU AND NOT TWO LINKS. There used to be "Account" and "Sign out" sitting
 * side by side, which was two of the six things a person actually comes to this
 * corner for and no room for the other four. A picture is the affordance every
 * other product on the web has trained people to click, so the picture is the
 * button — and until somebody uploads one, their initials stand in rather than a
 * grey silhouette that looks like a failed image.
 */

type Me = {
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  /** Whether this account works here. Decided by the server; see /api/profile. */
  is_staff: boolean;
};

/** Fired by the account screen when a name or picture changes, so this restacks without a reload. */
export const PROFILE_UPDATED_EVENT = "iwaiver:profile-updated";

/**
 * WHAT IS AND IS NOT IN HERE.
 *
 * "Your agreements" used to sit at the top and no longer does. This corner is
 * about the account — who you are, how you sign in, where money lands. The list
 * of agreements is the product itself, it is the first tab of AppNav on every
 * screen behind a sign-in, and a second route to it from a menu headed by your
 * own face made the menu read as a site map rather than as an account.
 *
 * `indent` marks the four settings that are sections OF the profile screen
 * rather than destinations beside it — every one of them is an anchor into
 * /account. The indent is what says so, and it is what lets Help sit flush in the
 * same list without being read as a fifth profile setting: it is a page of its
 * own, and the only item here that is not about this account.
 */
const LINKS: { href: string; label: string; indent?: boolean }[] = [
  { href: "/account", label: "Your profile" },
  { href: "/account#email", label: "Email address", indent: true },
  { href: "/account#password", label: "Password", indent: true },
  { href: "/account#passkeys", label: "Face ID and passkeys", indent: true },
  { href: "/account#paid", label: "Getting paid", indent: true },
  { href: "/help", label: "Help" },
];

export function AccountMenu() {
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/profile");
      if (!response.ok) return;
      const body = await response.json();
      setMe({
        full_name: body.profile?.full_name ?? null,
        email: body.profile?.email ?? null,
        avatar_url: body.profile?.avatar_url ?? null,
        is_staff: body.is_staff === true,
      });
    } catch {
      // The badge falls back to initials from whatever the session knows. A
      // header is not the place to report a failed fetch.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    try {
      const supabase = browserClient();

      supabase.auth.getUser().then(({ data }) => {
        if (cancelled) return;
        setState(data.user ? "in" : "out");
        if (data.user) {
          setMe({
            full_name: null,
            email: data.user.email ?? null,
            avatar_url: null,
            // Assumed false until /api/profile says otherwise. A link that flickers
            // into existence is better than one that flickers out.
            is_staff: false,
          });
          void loadProfile();
        }
      });

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        setState(session ? "in" : "out");
        if (session) {
          setMe({
            full_name: null,
            email: session.user.email ?? null,
            avatar_url: null,
            is_staff: false,
          });
          void loadProfile();
        } else {
          setMe(null);
        }
      });

      return () => {
        cancelled = true;
        listener.subscription.unsubscribe();
      };
    } catch {
      // No Supabase configuration in this deployment. The marketing site still
      // works; the lender area simply is not reachable.
      setState("out");
      return () => {
        cancelled = true;
      };
    }
  }, [loadProfile]);

  // The account screen saves; this corner is showing the same name and picture.
  useEffect(() => {
    const handler = () => void loadProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
  }, [loadProfile]);

  // A menu left open across a navigation is a menu covering the page somebody
  // just asked for. Every item in it navigates, so this closes all of them.
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

  if (state !== "in") {
    // "unknown" renders as signed out. It is the state the page starts in, it is
    // right for everybody who is not signed in, and it settles within a frame.
    return (
      <Link
        href="/login"
        className="text-sm text-ink-soft transition-colors hover:text-ink"
      >
        Sign in
      </Link>
    );
  }

  const name = me?.full_name?.trim() || null;
  const email = me?.email ?? null;

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={name ? `Account menu for ${name}` : "Account menu"}
        className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-surface"
      >
        <Avatar url={me?.avatar_url ?? null} name={name} email={email} />
        {/*
          The name is a courtesy on a wide screen and noise on a phone, where the
          picture alone is the whole convention. Hidden below `sm` rather than
          truncated, so the tap target stays the circle.
        */}
        <span className="hidden max-w-[10rem] truncate text-sm font-semibold text-ink-soft sm:inline">
          {name ?? email ?? "Account"}
        </span>
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
          aria-label="Account"
          /*
            21rem is not a taste about menu width. It is the width of the lender
            nav's three tabs — Agreements, Things you lend, People — which sit
            hard right against the same container edge this menu does. At w-64
            the menu was 77px narrower than that row, so opening it drew a second
            ragged left edge a little inside the first, and the two of them
            arguing was the only thing the eye saw.

            Matching them puts the tabs a hair inside this panel and turns the
            two into one line down the right of the page. The tabs are 333px in
            Inter at this size, so 336 leaves them 3px in — deliberately not
            exact, because a font that renders a shade wider should still land
            inside the menu rather than poke out of it.

            Only from `sm`, on both counts: below it AppNav drops `ml-auto` and
            the tabs are not right-aligned to align with, and 336px would run off
            the side of a phone.
          */
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-paper shadow-lg shadow-ink/5 sm:w-[21rem]"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <Avatar url={me?.avatar_url ?? null} name={name} email={email} size="lg" />
            <div className="min-w-0">
              {name && <p className="truncate text-sm font-semibold text-ink">{name}</p>}
              {email && <p className="truncate text-xs text-ink-muted">{email}</p>}
            </div>
          </div>

          {/*
            The way into the console, for the people who work here.

            First and above a rule, because for a staff member it is the reason
            they signed in — and because until it existed there was no link to
            /admin anywhere in the product. A super admin had to know to type the
            URL, which is a poor way to find out you have the widest grant the
            product has.

            Rendered only when the server says so. That is presentation, not
            authorisation: /admin answers `notFound()` to anybody who is not
            staff whether or not this link is on their screen.
          */}
          {me?.is_staff && (
            <div className="border-b border-line py-1.5">
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-surface"
              >
                Admin console
              </Link>
            </div>
          )}

          <div className="py-1.5">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block py-2 pr-4 text-sm text-ink-soft transition-colors hover:bg-surface hover:text-ink ${
                  link.indent ? "pl-9" : "pl-4"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/*
            Last, and behind a rule. Sign out is the one item here that is not a
            navigation, and it is the one nobody wants to hit by accident on the
            way to something else.
          */}
          <form action="/auth/signout" method="post" className="border-t border-line">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Avatar({
  url,
  name,
  email,
  size = "sm",
}: {
  url: string | null;
  name: string | null;
  email: string | null;
  size?: "sm" | "lg";
}) {
  const dimension = size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";

  if (url) {
    return (
      // A plain <img>: the URL is signed and short-lived, so it is not a stable
      // asset the Next image optimiser could cache, and running somebody's face
      // through a caching proxy to save a few kilobytes is a poor trade.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className={`${dimension} shrink-0 rounded-full border border-line object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-paper`}
    >
      {initialsFor(name, email)}
    </span>
  );
}
