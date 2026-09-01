"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

/**
 * The account corner of the header.
 *
 * Resolved on the client rather than in the root layout on purpose: reading
 * cookies in the layout would opt every marketing page out of static rendering to
 * decide the wording of one link. The signed-out state is the honest default while
 * it loads, and nothing behind it is protected by this component — the middleware
 * and the route handlers do that.
 */
export function AccountLink() {
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");

  useEffect(() => {
    let cancelled = false;

    try {
      const supabase = browserClient();
      supabase.auth.getUser().then(({ data }) => {
        if (!cancelled) setState(data.user ? "in" : "out");
      });

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setState(session ? "in" : "out");
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
  }, []);

  if (state === "in") {
    return (
      <div className="flex items-center gap-4">
        {/*
          Account, not "Your agreements". The three places inside the product are
          the AppNav's job; this corner is the one people go to looking for
          themselves — their details, and the way out.
        */}
        <Link
          href="/account"
          className="text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
        >
          Account
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-sm text-ink-muted transition-colors hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="text-sm text-ink-soft transition-colors hover:text-ink"
    >
      Sign in
    </Link>
  );
}
