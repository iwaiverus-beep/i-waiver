"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toLocalInputValue } from "@/lib/format";
import { DeviceContactPicker } from "./DeviceContactPicker";
import type { Asset } from "./AssetsManager";
import type { Contact } from "./ContactsManager";

export type OpenState = {
  state: string;
  status: string;
  waiver_efficacy: string;
};

const ASSET_CLASSES = [
  { value: "pwc", label: "Jet ski / personal watercraft" },
  { value: "boat", label: "Boat" },
  { value: "trailer", label: "Trailer" },
  { value: "vehicle", label: "Vehicle" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Something else" },
];

export function NewAgreementForm({
  states,
  assets = [],
  contacts = [],
}: {
  states: OpenState[];
  assets?: Asset[];
  contacts?: Contact[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const defaultStart = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultEnd = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const [state, setState] = useState(states[0]?.state ?? "FL");

  // "" means "something new" — the saved lists are a shortcut, never a
  // requirement, so a first-time lender sees exactly the form they saw before.
  const [assetId, setAssetId] = useState("");
  const [contactId, setContactId] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerEmail, setBorrowerEmail] = useState("");
  const [saveContact, setSaveContact] = useState(true);

  function chooseContact(id: string) {
    setContactId(id);
    const found = contacts.find((c) => c.id === id);
    if (found) {
      setBorrowerName(found.display_name);
      setBorrowerEmail(found.email ?? "");
      // Already saved, so there is nothing to offer to save.
      setSaveContact(false);
    }
  }
  const chosen = states.find((s) => s.state === state);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      borrower_name: borrowerName,
      borrower_email: borrowerEmail,
      starts_at: new Date(String(form.get("starts_at"))).toISOString(),
      ends_at: new Date(String(form.get("ends_at"))).toISOString(),
      jurisdiction: form.get("jurisdiction"),
      activity_class: form.get("activity_class"),
      asset_id: assetId || undefined,
      asset: {
        asset_class: form.get("asset_class"),
        description: form.get("description"),
        identifier: form.get("identifier"),
        declared_value: form.get("declared_value"),
        year: form.get("year"),
        make: form.get("make"),
        model: form.get("model"),
      },
    };

    const response = await fetch("/api/agreements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(body.error ?? "Could not create the agreement.");
      setBusy(false);
      return;
    }

    if (saveContact && !contactId && borrowerEmail.trim()) {
      // Deliberately not awaited into the failure path: the agreement exists and
      // the user is on their way to it. A contact that did not save is a minor
      // annoyance, not a reason to hold up the screen or show an error.
      void fetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: borrowerName,
          email: borrowerEmail,
          source: "agreement",
        }),
      }).catch(() => {});
    }

    router.push(`/agreements/${body.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-10">
      <fieldset className="space-y-5">
        <Legend
          title="What are you lending?"
          hint="The declared value is what the damage clause and the cover are both based on, so it is worth getting right."
        />

        {assets.length > 0 && (
          <Field label="Something you have saved" wide>
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className={input}
            >
              <option value="">Something new…</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {[asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
                    asset.description}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Description" wide>
          <input
            name="description"
            required={!assetId}
            disabled={Boolean(assetId)}
            placeholder="Yamaha WaveRunner, blue, with trailer"
            className={input}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Kind">
            <select name="asset_class" defaultValue="pwc" className={input}>
              {ASSET_CLASSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Declared value">
            <input
              name="declared_value"
              required
              inputMode="decimal"
              placeholder="12500"
              className={input}
            />
          </Field>

          <Field label="Year">
            <input name="year" inputMode="numeric" placeholder="2021" className={input} />
          </Field>

          <Field label="Make">
            <input name="make" placeholder="Yamaha" className={input} />
          </Field>

          <Field label="Model">
            <input name="model" placeholder="VX Cruiser" className={input} />
          </Field>

          <Field label="HIN / VIN / serial">
            <input name="identifier" placeholder="YAMA1234A121" className={input} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <Legend
          title="Who is borrowing it?"
          hint="They will get an email with a link. They do not need an account and will never be asked to make one."
        />

        {contacts.length > 0 && (
          <Field label="Someone you have lent to before" wide>
            <select
              value={contactId}
              onChange={(e) => chooseContact(e.target.value)}
              className={input}
            >
              <option value="">Someone new…</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.display_name}
                  {contact.email ? ` — ${contact.email}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <DeviceContactPicker
          onPick={(picked) => {
            setBorrowerName(picked.name);
            if (picked.email) setBorrowerEmail(picked.email);
            setContactId("");
            setSaveContact(true);
          }}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Their name">
            <input
              value={borrowerName}
              onChange={(e) => setBorrowerName(e.target.value)}
              required
              placeholder="Marcus Reid"
              className={input}
            />
          </Field>

          <Field label="Their email">
            <input
              value={borrowerEmail}
              onChange={(e) => setBorrowerEmail(e.target.value)}
              type="email"
              required
              placeholder="marcus@example.com"
              className={input}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <Legend
          title="When and where?"
          hint="The state is where the activity happens — not where either of you lives. It decides which rules and which wording apply."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="From">
            <input
              name="starts_at"
              type="datetime-local"
              required
              defaultValue={toLocalInputValue(defaultStart)}
              className={input}
            />
          </Field>

          <Field label="Until">
            <input
              name="ends_at"
              type="datetime-local"
              required
              defaultValue={toLocalInputValue(defaultEnd)}
              className={input}
            />
          </Field>

          <Field label="State of activity">
            <select
              name="jurisdiction"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={input}
            >
              {states.map((s) => (
                <option key={s.state} value={s.state}>
                  {s.state}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Activity">
            <select name="activity_class" defaultValue="personal_watercraft" className={input}>
              <option value="personal_watercraft">Personal watercraft</option>
            </select>
          </Field>
        </div>

        {chosen?.waiver_efficacy === "void" && (
          <p className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4 text-sm leading-relaxed text-flag">
            {chosen.state} does not enforce pre-injury releases. You can still lend and
            still buy cover, but the document will be a record of the loan rather than a
            shield, and it will say so.
          </p>
        )}
      </fieldset>

      {error && (
        <p className="rounded-lg border border-flag/30 bg-flag/[0.06] px-4 py-3 text-sm text-flag">
          {error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create draft"}
        </button>
        <p className="text-xs text-ink-muted">
          Nothing is sent yet. You will see the whole document before anyone does.
        </p>
      </div>
    </form>
  );
}

const input =
  "w-full rounded-lg border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent";

function Legend({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-soft">{hint}</p>
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
