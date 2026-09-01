"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LIVE } from "@/lib/launch";

/**
 * The preview gate.
 *
 * While the product is being shown to a handful of people, the marketing site is
 * the front door and the application behind it is not advertised. Clicking the
 * logo five times reveals the way in.
 *
 * BE CLEAR ABOUT WHAT THIS IS. It hides a link, not a route. Anyone who types
 * /login, reads the JavaScript bundle, or follows a stale URL still arrives. It
 * keeps a casual visitor from wandering into a half-built lender area; it is not
 * access control, and it must not be described to anyone as though it were. The
 * real protections are elsewhere: Supabase auth on the lender routes, signing
 * tokens on the borrower route, and noindex so none of it is discoverable by
 * search.
 */

const STORAGE_KEY = "iwaiver:preview-unlocked";
const CLICKS_REQUIRED = 5;
/** Clicks must be deliberate and consecutive, not five over a long browse. */
const WINDOW_MS = 3_000;

type PreviewState = {
  unlocked: boolean;
  /** How many more clicks are needed, once the run is underway. */
  remaining: number;
  noteLogoClick: () => void;
  lock: () => void;
};

const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  // Always starts locked so that server and first client render agree. The
  // stored value is applied in an effect, which is a frame later but avoids a
  // hydration mismatch on every page of the site.
  //
  // Once LIVE, it starts unlocked instead — and that is still true on both
  // renders, so the hydration bargain above holds either way.
  const [unlocked, setUnlocked] = useState(LIVE);
  const [remaining, setRemaining] = useState(CLICKS_REQUIRED);
  const clicks = useRef<number[]>([]);

  useEffect(() => {
    if (LIVE) return;
    try {
      setUnlocked(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing, or storage disabled. Staying locked is the right
      // failure direction.
    }
  }, []);

  const noteLogoClick = useCallback(() => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < WINDOW_MS), now];

    if (clicks.current.length >= CLICKS_REQUIRED) {
      clicks.current = [];
      setRemaining(CLICKS_REQUIRED);
      setUnlocked(true);
      try {
        window.localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Unlocked for this page view only. Acceptable.
      }
      return;
    }

    setRemaining(CLICKS_REQUIRED - clicks.current.length);
  }, []);

  const lock = useCallback(() => {
    clicks.current = [];
    setRemaining(CLICKS_REQUIRED);
    setUnlocked(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  const value = useMemo(
    () => ({ unlocked, remaining, noteLogoClick, lock }),
    [unlocked, remaining, noteLogoClick, lock],
  );

  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}

export function usePreview(): PreviewState {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error("usePreview must be used inside PreviewProvider");
  }
  return context;
}

/** Shown once the app is revealed, so nobody mistakes a preview for a launch. */
export function PreviewChip() {
  const { unlocked, lock } = usePreview();
  // Nothing to warn about when the site is presenting itself as live, and a
  // chip offering to "hide the app again" would be a puzzle rather than a hint.
  if (LIVE || !unlocked) return null;

  return (
    <button
      type="button"
      onClick={lock}
      title="Preview mode is on. Click to hide the app again."
      className="rounded-full border border-flag/40 bg-flag/[0.08] px-3 py-1 text-xs font-semibold text-flag transition-colors hover:bg-flag/[0.14]"
    >
      Preview
    </button>
  );
}
