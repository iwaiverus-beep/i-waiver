"use client";

import { useState } from "react";
import { DeviceContactPicker } from "./DeviceContactPicker";

export type Contact = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  source: string;
  last_used_at: string | null;
};

const input =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-accent";

/**
 * The address book screen.
 *
 * Three ways in, because the phone-only route does not exist on every phone:
 * type it, pull it from the device picker where that API exists, or let it be
 * saved automatically when an agreement is created. And one way out that works
 * everywhere — the vCard download, which the OS turns into its own Add Contact
 * sheet.
 */
export function ContactsManager({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = useState(initial);
  const [open, setOpen] = useState(initial.length === 0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<"manual" | "device">("manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: name, email, phone, source }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not save them.");
      return;
    }
    if (body.duplicate) {
      setError("You already have someone saved with that email.");
      return;
    }

    setContacts((current) => [body.contact, ...current]);
    setName("");
    setEmail("");
    setPhone("");
    setSource("manual");
    setOpen(false);
  }

  async function archive(id: string) {
    setContacts((current) => current.filter((c) => c.id !== id));
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-10">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
        >
          Add someone
        </button>
      )}

      {open && (
        <div className="rounded-2xl border border-line bg-surface/50 p-6">
          <h2 className="text-base font-semibold text-ink">Add someone</h2>

          <DeviceContactPicker
            onPick={(picked) => {
              setName(picked.name);
              setEmail(picked.email ?? "");
              setPhone(picked.phone ?? "");
              // Recorded so it is later clear which rows arrived unverified from
              // a device rather than being typed deliberately.
              setSource("device");
              setError(null);
            }}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className={input}
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              inputMode="email"
              className={input}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              type="tel"
              inputMode="tel"
              className={input}
            />
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            An email or a phone number — otherwise there is no way to send them a
            signing link.
          </p>

          {error && <p className="mt-3 text-sm text-flag">{error}</p>}

          <div className="mt-5 flex gap-3">
            <button
              onClick={save}
              disabled={busy || !name.trim()}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {contacts.length > 0 && (
              <button
                onClick={() => setOpen(false)}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 space-y-3">
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{contact.display_name}</p>
              <p className="truncate text-sm text-ink-soft">
                {[contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* A plain link, not fetch(): the download only becomes an OS
                  Add Contact sheet if the browser handles the response itself. */}
              <a
                href={`/api/contacts/${contact.id}/vcard`}
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
              >
                Save to phone
              </a>
              <button
                onClick={() => archive(contact.id)}
                className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
