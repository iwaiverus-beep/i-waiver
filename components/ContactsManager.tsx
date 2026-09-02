"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DeviceContactPicker } from "./DeviceContactPicker";
import { ContactHistory } from "./ContactHistory";

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
 *
 * Editing is safe here for the same reason it is safe for an asset: the contact
 * is an input to a form, never a party to a record. Signer name and address are
 * copied onto the agreement at creation, so correcting a typo two years later
 * cannot rewrite who a signed agreement says was on it.
 */
export function ContactsManager({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = useState(initial);
  const [adding, setAdding] = useState(initial.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) =>
      [contact.display_name, contact.email, contact.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [contacts, query]);

  function absorb(saved: Contact) {
    setContacts((current) => {
      const without = current.filter((c) => c.id !== saved.id);
      return [saved, ...without];
    });
  }

  async function archive(contact: Contact) {
    const confirmed = window.confirm(
      `Remove ${contact.display_name} from your list?\n\n` +
        "Agreements they have already signed are not affected.",
    );
    if (!confirmed) return;

    setContacts((current) => current.filter((c) => c.id !== contact.id));
    if (editingId === contact.id) setEditingId(null);
    await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-10">
      {!adding && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setAdding(true)}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
          >
            Add someone
          </button>
          {contacts.length > 0 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email or phone"
              type="search"
              aria-label="Search people"
              className="w-full max-w-xs rounded-full border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
          )}
        </div>
      )}

      {adding && (
        <ContactForm
          heading="Add someone"
          submitLabel="Save"
          cancellable={contacts.length > 0}
          onCancel={() => setAdding(false)}
          onSaved={(contact) => {
            absorb(contact);
            setAdding(false);
          }}
        />
      )}

      <div className="mt-8 space-y-3">
        {visible.map((contact) =>
          editingId === contact.id ? (
            <ContactForm
              key={contact.id}
              contact={contact}
              heading={`Edit ${contact.display_name}`}
              submitLabel="Save changes"
              cancellable
              onCancel={() => setEditingId(null)}
              onSaved={(updated) => {
                setContacts((current) =>
                  current.map((c) => (c.id === updated.id ? updated : c)),
                );
                setEditingId(null);
              }}
            />
          ) : (
            <div
              key={contact.id}
              className="rounded-2xl border border-line bg-paper px-5 py-4"
            >
              {/* The name and the one thing anybody comes to this screen to do,
                  on the same line. Lending to the same handful of people again is
                  the whole reason the list exists, so it leads rather than sitting
                  in a row of equal-weight buttons underneath. */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {contact.display_name}
                  </p>
                  <p className="truncate text-sm text-ink-soft">
                    {[contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Link
                  href={`/agreements/new?contact=${contact.id}`}
                  className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-accent-hover"
                >
                  Lend again
                </Link>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    setHistoryId(historyId === contact.id ? null : contact.id)
                  }
                  aria-expanded={historyId === contact.id}
                  className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                >
                  {historyId === contact.id ? "Hide history" : "History"}
                </button>
                {/* A plain link, not fetch(): the download only becomes an OS
                    Add Contact sheet if the browser handles the response itself. */}
                <a
                  href={`/api/contacts/${contact.id}/vcard`}
                  className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                >
                  Save to phone
                </a>
                <button
                  onClick={() => {
                    setAdding(false);
                    setEditingId(contact.id);
                  }}
                  className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                >
                  Edit
                </button>
                <button
                  onClick={() => archive(contact)}
                  className="rounded-full px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-flag"
                >
                  Remove
                </button>
              </div>

              {historyId === contact.id && (
                <ContactHistory contactId={contact.id} />
              )}
            </div>
          ),
        )}

        {query.trim() && visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
            Nobody matches that.
          </p>
        )}
      </div>
    </div>
  );
}

/** One field set, used both to add someone and to correct someone. */
function ContactForm({
  contact,
  heading,
  submitLabel,
  cancellable,
  onSaved,
  onCancel,
}: {
  contact?: Contact;
  heading: string;
  submitLabel: string;
  cancellable: boolean;
  onSaved: (contact: Contact) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contact?.display_name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [source, setSource] = useState<"manual" | "device">("manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch(
      contact ? `/api/contacts/${contact.id}` : "/api/contacts",
      {
        method: contact ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          contact
            ? { display_name: name, email, phone }
            : { display_name: name, email, phone, source },
        ),
      },
    );
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

    onSaved(body.contact as Contact);
  }

  return (
    <div className="rounded-2xl border border-line bg-surface/50 p-6">
      <h2 className="text-base font-semibold text-ink">{heading}</h2>

      {/* Only when adding. Overwriting an existing entry from the phone book is
          a different intent than filling a blank one, and conflating them is how
          someone loses the email they carefully corrected last week. */}
      {!contact && (
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
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Name"
          className={input}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          type="email"
          inputMode="email"
          className={input}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          aria-label="Phone"
          type="tel"
          inputMode="tel"
          className={input}
        />
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        An email or a phone number — otherwise there is no way to send them a
        signing link.
        {contact
          ? " Corrections apply to the next agreement you write, never one already signed."
          : ""}
      </p>

      {error && <p className="mt-3 text-sm text-flag">{error}</p>}

      <div className="mt-5 flex gap-3">
        <button
          onClick={save}
          disabled={busy || !name.trim()}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {cancellable && (
          <button
            onClick={onCancel}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
