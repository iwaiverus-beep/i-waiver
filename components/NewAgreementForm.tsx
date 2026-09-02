"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatCents,
  timeZoneFor,
  utcToZonedInput,
  zonedInputToUtc,
  zoneAbbreviation,
  zoneDifferenceHours,
} from "@/lib/format";
import {
  activitiesOpenIn,
  coverAvailable,
  type OriginatorKind,
  type ReadinessRow,
} from "@/lib/readiness";
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

/**
 * A borrower's scanned request, opened for review.
 *
 * Everything here is a starting point, not a decision. The lender is looking at
 * what a stranger typed into a public form, so it arrives in the ordinary form
 * with the ordinary buttons rather than as a one-tap confirmation — the draft is
 * created by the same route, the same way, after somebody has actually read it.
 */
export type RequestPrefill = {
  requestId: string;
  borrowerName: string;
  borrowerEmail: string;
  assetIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  jurisdiction: string | null;
  note: string | null;
};

export function NewAgreementForm({
  states,
  readiness,
  originatorKind,
  assets = [],
  contacts = [],
  prefill,
  readerZone,
}: {
  states: OpenState[];
  /**
   * Every (state, activity) combination, including the ones that are not open.
   *
   * Passed whole rather than pre-filtered because the activity list has to be
   * recomputed on the client every time the state changes, and a round trip to do
   * that would put a spinner in the middle of a two-field question.
   */
  readiness: ReadinessRow[];
  /** Which wording this lender's documents come from. See the page for why it is fixed. */
  originatorKind: OriginatorKind;
  assets?: Asset[];
  contacts?: Contact[];
  prefill?: RequestPrefill;
  /**
   * The lender's own clock, from their profile. Null follows the browser.
   *
   * Only ever used to say how far this window sits from theirs. It has no bearing
   * on what the document says — that is `timeZone` below, which comes from the
   * state the activity happens in.
   */
  readerZone?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The borrower's request names a state, but only if it is still one we offer.
  // An intake code is a physical thing — printed, laminated, stuck to a jet ski —
  // and it long outlives the availability it was created under. A stale one
  // falling back to the first open state is better than a select bound to a value
  // that has no option, which renders blank and submits nothing.
  const [state, setState] = useState(
    states.some((s) => s.state === prefill?.jurisdiction)
      ? (prefill?.jurisdiction as string)
      : (states[0]?.state ?? "FL"),
  );

  // The activities this lender can actually get a document out of in this state.
  //
  // Recomputed per state rather than fixed, because it genuinely varies: opening
  // a state is done one activity at a time, and Florida being open for jet skis
  // says nothing about Florida being open for boating. Until this cascade existed
  // the list was four hardcoded options everywhere, and picking the wrong one
  // failed at the moment of pressing the button with "there is no boating
  // template for FL yet" — which is true, and is not a thing to learn there.
  const openActivities = activitiesOpenIn(readiness, state, originatorKind);

  const [activity, setActivity] = useState(
    () => openActivities[0]?.activity_class ?? "",
  );

  // Changing the state can strand the chosen activity: FL is open for jet skis,
  // and the next state along may not be. Snapping to the first available one is
  // the honest repair — leaving a stale value selected would submit a
  // combination the form has just stopped offering.
  useEffect(() => {
    if (openActivities.some((a) => a.activity_class === activity)) return;
    setActivity(openActivities[0]?.activity_class ?? "");
    // `openActivities` is derived from state and would be a new array each
    // render; the state code is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const chosenActivity = openActivities.find((a) => a.activity_class === activity);

  // The clock this window is written in. The state of activity decides it, not
  // the desk the form is filled in at: the jet ski is in Florida whoever is
  // arranging the loan, and the document says Florida time.
  const timeZone = timeZoneFor(state);
  const zoneLabel = zoneAbbreviation(timeZone);

  // Held as the wall clock the inputs display, not as instants. Changing the
  // state must not drag the numbers around — someone who typed 9am meant 9am,
  // and switching FL to TX makes that 9am Central, not 8am Central.
  const [window, setWindow] = useState({ starts: "", ends: "" });

  // How far the loan's clock is from the reader's own. Null until mounted, and
  // it has to be: the server has no idea what time it is where anyone is sitting,
  // so computing this during the render would print a number true of nobody and
  // then contradict itself on hydration. Re-run per state, because switching
  // Florida to Texas changes the answer.
  const [clockShift, setClockShift] = useState<number | null>(null);
  useEffect(() => {
    setClockShift(zoneDifferenceHours(timeZone, readerZone));
  }, [timeZone, readerZone]);

  // Seeded on mount rather than at render. This component is server-rendered
  // first, where `new Date()` is the deploy's clock — UTC on Vercel — and an
  // uncontrolled defaultValue computed there survives hydration. That is the
  // bug where the picker opened several hours off.
  useEffect(() => {
    const now = Date.now();
    // The borrower's dates when they gave them, ours when they did not. They chose
    // a window on their own phone; overwriting it with a default would quietly
    // discard the one piece of the request only they could supply.
    //
    // NOW, not an hour from now. The default used to start at now + 1h, which is
    // a fine guess and an unreadable one: a lender in Central arranging a Florida
    // loan saw 9:15 PM against a watch reading 7:15 and had no way to tell which
    // part of that gap was the time zone and which part was us being helpful.
    // Seeded at the current moment, the number is checkable — it is what the
    // clock says where the jet ski is — and the only difference left to explain
    // is the real one, which the field now explains.
    setWindow({
      starts: utcToZonedInput(
        prefill?.startsAt ? new Date(prefill.startsAt) : new Date(now),
        timeZone,
      ),
      ends: utcToZonedInput(
        prefill?.endsAt ? new Date(prefill.endsAt) : new Date(now + 8 * 60 * 60 * 1000),
        timeZone,
      ),
    });
    // Deliberately mount-only. Re-running on a state change would recompute
    // "an hour from now" and throw away whatever had been typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticked items from the saved list, in the order they were ticked — that
  // order becomes Schedule A on the document, so it is a list and not a Set.
  // An asset-level code names the item, so a scanned request arrives with it
  // already ticked. An originator-level one does not, and the lender picks.
  const [pickedIds, setPickedIds] = useState<string[]>(prefill?.assetIds ?? []);
  // Describing something not on the list. Open by default for a lender with an
  // empty list, so a first-timer sees exactly the form they saw before.
  const [addingNew, setAddingNew] = useState(
    assets.length === 0 && !(prefill?.assetIds.length ?? 0),
  );
  const [contactId, setContactId] = useState("");
  const [borrowerName, setBorrowerName] = useState(prefill?.borrowerName ?? "");
  const [borrowerEmail, setBorrowerEmail] = useState(prefill?.borrowerEmail ?? "");
  const [saveContact, setSaveContact] = useState(true);

  function chooseContact(id: string) {
    setContactId(id);
    const found = contacts.find((c) => c.id === id);
    if (found) {
      setBorrowerName(found.display_name);
      setBorrowerEmail(found.email ?? "");
      // Already saved, so there is nothing to offer to save.
      setSaveContact(false);
      return;
    }
    // Back to "Someone new…". The typed fields are left alone — they may have
    // been half-corrected on purpose — but the offer to save comes back.
    setSaveContact(true);
  }
  function togglePicked(id: string) {
    setPickedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  const picked = pickedIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => asset !== undefined);

  // What the schedule will total. Shown live because the declared value is what
  // the damage clause points at and what cover is priced against — a lender who
  // ticks four boxes should see the number they are about to be covered for
  // before they send it, not after.
  const pickedTotalCents = picked.reduce(
    (sum, asset) => sum + (asset.declared_value_cents ?? 0),
    0,
  );
  const missingValue = picked.filter(
    (asset) => asset.declared_value_cents === null,
  );

  // Nothing ticked and nothing being described. The API refuses this too, but
  // a disabled button says so before the round trip rather than after it.
  //
  // An empty activity is the second way to get here and only happens on a
  // prefilled draft: a scanned request carries the intake link's state, and a
  // code printed months ago can name a state that has since closed. Better to
  // refuse than to post an empty activity_class and let the API decide.
  const nothingSelected = (picked.length === 0 && !addingNew) || !activity;

  const chosen = states.find((s) => s.state === state);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      borrower_name: borrowerName,
      borrower_email: borrowerEmail,
      // Read in the activity's zone, not the browser's, so the instant stored
      // is the one the document will go on to print.
      starts_at: zonedInputToUtc(window.starts, timeZone).toISOString(),
      ends_at: zonedInputToUtc(window.ends, timeZone).toISOString(),
      time_zone: timeZone,
      jurisdiction: form.get("jurisdiction"),
      activity_class: form.get("activity_class"),
      asset_ids: pickedIds,
      // Present only when this draft came from a scanned request. The route closes
      // the request once the draft exists, never before: a failed create leaves it
      // pending and the lender simply sees it in the queue again.
      request_id: prefill?.requestId,
      // Only sent when the "something not on the list" panel is open. The API
      // treats a missing description as "no inline item", so a closed panel and
      // an empty one mean the same thing.
      asset: addingNew
        ? {
            asset_class: form.get("asset_class"),
            description: form.get("description"),
            identifier: form.get("identifier"),
            declared_value: form.get("declared_value"),
            year: form.get("year"),
            make: form.get("make"),
            model: form.get("model"),
          }
        : undefined,
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

    // Neither branch is awaited into the failure path: the agreement exists and
    // the user is on their way to it. An address book that did not update is a
    // minor annoyance, not a reason to hold up the screen or show an error.
    if (contactId) {
      // Floats the people actually lent to above the ones saved and forgotten.
      void fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ touched: true }),
      }).catch(() => {});
    } else if (saveContact && borrowerEmail.trim()) {
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
          hint="Lend several things at once and they go on one waiver with a numbered schedule, signed once. The declared value is what the damage clause and the cover are both based on, so it is worth getting right."
        />

        {assets.length > 0 && (
          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Tick everything going out
            </span>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
              {assets.map((asset) => {
                const checked = pickedIds.includes(asset.id);
                const position = pickedIds.indexOf(asset.id) + 1;
                return (
                  <label
                    key={asset.id}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
                      checked ? "bg-surface" : "hover:bg-surface/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePicked(asset.id)}
                      className="h-4 w-4 shrink-0 rounded border-line accent-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {[asset.year, asset.make, asset.model]
                          .filter(Boolean)
                          .join(" ") || asset.description}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {asset.description}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-soft">
                      {formatCents(asset.declared_value_cents)}
                    </span>
                    {/* The schedule is numbered in the order things were
                        ticked, so the order is shown while it can still be
                        changed rather than being a surprise on the document. */}
                    <span
                      className={`w-5 shrink-0 text-right text-xs font-semibold tabular-nums ${
                        checked ? "text-accent" : "text-transparent"
                      }`}
                      aria-hidden={!checked}
                    >
                      {checked ? position : "0"}
                    </span>
                  </label>
                );
              })}
            </div>

            {picked.length > 0 && (
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface/60 px-4 py-3">
                <span className="text-sm text-ink-soft">
                  {picked.length === 1
                    ? "1 item on this agreement"
                    : `${picked.length} items on this agreement — they go on one waiver, signed once`}
                </span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {formatCents(pickedTotalCents)}
                </span>
              </div>
            )}

            {missingValue.length > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-flag">
                {missingValue.map((a) => a.description).join(" and ")}{" "}
                {missingValue.length === 1 ? "has" : "have"} no declared value.
                You can create the draft, but it cannot be sent until you add one
                on Things you lend.
              </p>
            )}
          </div>
        )}

        {!addingNew && (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
          >
            + Something not on the list
          </button>
        )}

        {addingNew && (
          <div className="space-y-5 rounded-2xl border border-line bg-surface/40 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">
                {assets.length === 0
                  ? "What are you lending?"
                  : "Something else, not on the list"}
              </h3>
              {assets.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAddingNew(false)}
                  className="text-xs font-semibold text-ink-muted hover:text-ink"
                >
                  Remove
                </button>
              )}
            </div>

            <Field label="Description" wide>
              <input
                name="description"
                required={picked.length === 0}
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
                  required={picked.length === 0}
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

            <p className="text-xs leading-relaxed text-ink-muted">
              This is added to{" "}
              <strong className="font-semibold text-ink-soft">Things you lend</strong>
              , so next time it is one tick in the list above.
            </p>
          </div>
        )}
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

        {/* Saving them happens either way; this only makes it visible and
            refusable. A list that fills itself silently is a list people are
            surprised to find has their neighbour in it. */}
        {!contactId && (
          <label className="flex items-start gap-3 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={saveContact}
              onChange={(e) => setSaveContact(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-accent"
            />
            <span>
              Add them to{" "}
              <strong className="font-semibold text-ink">People</strong> so you can
              pick them next time.
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-5">
        <Legend
          title="When and where?"
          hint="The state is where the activity happens — not where either of you lives. It decides which rules and which wording apply."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={zoneLabel ? `From (${zoneLabel})` : "From"}>
            <input
              name="starts_at"
              type="datetime-local"
              required
              value={window.starts}
              onChange={(e) =>
                setWindow((w) => ({ ...w, starts: e.target.value }))
              }
              className={input}
            />
            {/*
              Said out loud, because the alternative is arithmetic done wrong.
              These fields are the clock in the state the activity happens in —
              that is the whole point, and it is on the document — but somebody
              two zones away reads a number that does not match their own watch
              and reasonably concludes the form is broken. The label already
              carries the abbreviation; an abbreviation is not an instruction.
            */}
            {clockShift !== null && clockShift !== 0 && zoneLabel && (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                {zoneLabel} is {describeShift(clockShift)}{" "}
                {readerZone ? zoneAbbreviation(readerZone) : "your own clock"}. The
                window belongs to where the activity happens, so this is the time
                the document will say.
              </p>
            )}
          </Field>

          <Field label={zoneLabel ? `Until (${zoneLabel})` : "Until"}>
            <input
              name="ends_at"
              type="datetime-local"
              required
              value={window.ends}
              onChange={(e) => setWindow((w) => ({ ...w, ends: e.target.value }))}
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
            <select
              name="activity_class"
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              className={input}
            >
              {openActivities.map((a) => (
                <option key={a.activity_class} value={a.activity_class}>
                  {a.activity_label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/*
          A state can be offered for one activity and closed for another, so the
          list above is not the same length in every state. Saying which ones are
          missing beats a silently shorter dropdown — the lender who wanted to
          lend a boat needs to know that is a gap and not an oversight.
        */}
        {openActivities.length === 1 && (
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            {state} is open for {openActivities[0].activity_label.toLowerCase()} only.
            Each activity is opened separately — it needs its own carrier filing and
            its own reviewed wording.
          </p>
        )}

        {chosenActivity && !coverAvailable(chosenActivity) && (
          <p className="mt-4 rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
            No carrier is filed for {chosenActivity.activity_label.toLowerCase()} in{" "}
            {state}, so there is nothing to insure this loan with. The agreement
            itself is unaffected — it will be signed, timestamped and kept the same
            way — but do not tell the borrower they are covered.
          </p>
        )}

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
          disabled={busy || nothingSelected}
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

/**
 * "an hour ahead of", "two hours behind" — the gap between two clocks, in words.
 *
 * Words rather than a signed number, because "-1" tells a reader nothing about
 * which way to count. Spelled out to two, which covers every pair of US zones a
 * lender and an activity can land in bar Alaska and Hawaii; past that the digit
 * is clearer than the word anyway. Half hours are formatted rather than rounded:
 * no state needs them today, and a zone that does should not silently lie.
 */
const SPELLED = ["", "an", "two"];

function describeShift(hours: number): string {
  const size = Math.abs(hours);
  const count =
    Number.isInteger(size) && size <= 2 ? SPELLED[size] : String(size);
  const unit = size === 1 ? "hour" : "hours";
  return `${count} ${unit} ${hours > 0 ? "ahead of" : "behind"}`;
}

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
