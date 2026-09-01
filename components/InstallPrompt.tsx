"use client";

import { useEffect, useState } from "react";

/**
 * Offering to put this on the home screen.
 *
 * Two platforms, two completely different mechanics:
 *
 *   Android/Chrome fires `beforeinstallprompt`, which we hold onto and replay
 *   when the person presses our own button. Calling prompt() outside a user
 *   gesture is ignored, so the event has to be stored rather than acted on.
 *
 *   iOS/Safari fires nothing and exposes no API at all. Installing is Share →
 *   Add to Home Screen, and the only thing a web page can do is say so. That is
 *   not a gap to engineer around; it is Apple's deliberate position.
 *
 * WHEN it appears matters as much as whether. An install banner on first paint
 * is asking someone to commit before they know what this is, and it is the thing
 * people reflexively dismiss. This waits for a signed-in lender on a small
 * screen, and a dismissal is remembered for a month.
 */

const DISMISSED_KEY = "iwaiver:install-dismissed";
const DISMISS_DAYS = 30;

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already installed: standalone display mode, or Safari's own flag.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) return;

    try {
      const dismissed = window.localStorage.getItem(DISMISSED_KEY);
      if (dismissed && Date.now() - Number(dismissed) < DISMISS_DAYS * 86_400_000) {
        return;
      }
    } catch {
      // Storage unavailable. Showing it is the harmless direction.
    }

    const isPhone = window.matchMedia("(max-width: 820px)").matches;
    if (!isPhone) return;

    const isIos =
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
      // iPadOS reports itself as a Mac; the touch points give it away.
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

    if (isIos) {
      setIosHint(true);
      setVisible(true);
      return;
    }

    function onBeforeInstall(event: Event) {
      // Stop Chrome's own mini-infobar so there are not two competing offers.
      event.preventDefault();
      setDeferred(event as InstallEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* nothing to remember it with */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event is single use — Chrome will fire a fresh one if it still applies.
    setDeferred(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-line bg-paper/95 p-4 shadow-lg backdrop-blur sm:inset-x-auto sm:right-4 sm:max-w-sm">
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" width={40} height={40} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Keep this on your phone</p>
          {iosHint ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Tap the Share button, then <strong>Add to Home Screen</strong>. It
              opens like an app, and you stay signed in.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Opens like an app and keeps you signed in — useful when you are
              standing next to the thing you are lending.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {!iosHint && (
              <button
                onClick={install}
                className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-accent-hover"
              >
                Add to home screen
              </button>
            )}
            <button
              onClick={dismiss}
              className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              {iosHint ? "Got it" : "Not now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
