"use client";

import { useEffect, useState } from "react";

/**
 * Pulling someone out of the phone's own address book.
 *
 * KNOW WHAT THIS IS BEFORE RELYING ON IT. `navigator.contacts` is the Contact
 * Picker API, and it exists on Chrome for Android and essentially nowhere else.
 * It is not in Safari on iOS, not behind a flag, not shimmable — Apple has
 * declined to ship it, and reading a user's address book from a web page is
 * exactly the capability they have been most reluctant about. For a product
 * people will mostly open on a phone by a boat ramp, that means a large share of
 * users will never see this button.
 *
 * So it is built as pure progressive enhancement: where the API exists it saves
 * real typing, and where it does not the form underneath is untouched and the
 * button simply is not there. It is never the only way to fill the fields.
 *
 * The user still picks the contact in the platform's own sheet. The page cannot
 * enumerate the address book, and nothing is read until they choose someone.
 */

type PickedContact = { name: string; email: string | null; phone: string | null };

type ContactsManager = {
  select: (
    properties: string[],
    options?: { multiple?: boolean },
  ) => Promise<{ name?: string[]; email?: string[]; tel?: string[] }[]>;
  getProperties: () => Promise<string[]>;
};

export function DeviceContactPicker({
  onPick,
}: {
  onPick: (contact: PickedContact) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const manager = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
    // `select` is checked explicitly: some browsers expose a `contacts` object
    // that is not this API at all.
    setSupported(Boolean(manager && typeof manager.select === "function"));
  }, []);

  async function pick() {
    setBusy(true);
    setError(null);
    try {
      const manager = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
      if (!manager) return;

      // Ask only for what the form needs. The API requires the caller to name
      // the properties, and asking for more than that would be helping ourselves
      // to data we have no use for.
      const available = await manager.getProperties();
      const wanted = ["name", "email", "tel"].filter((p) => available.includes(p));

      const picked = await manager.select(wanted, { multiple: false });
      if (!picked || picked.length === 0) return; // they cancelled

      const entry = picked[0];
      onPick({
        name: entry.name?.[0]?.trim() || "",
        email: entry.email?.[0]?.trim() || null,
        phone: entry.tel?.[0]?.trim() || null,
      });
    } catch (caught) {
      const message = (caught as Error).message ?? "";
      setError(
        /cancel|abort/i.test(message)
          ? null
          : "Your browser would not open the contact list. Type their details instead.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
      >
        <BookMark />
        {busy ? "Opening…" : "Choose from contacts"}
      </button>
      {error && <p className="mt-2 text-xs text-flag">{error}</p>}
    </div>
  );
}

function BookMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5V4ZM5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 16c.6-1.2 1.7-1.8 3-1.8s2.4.6 3 1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
