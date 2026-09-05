"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { Contact } from "./ContactsManager";

/**
 * Choosing somebody you have lent to before.
 *
 * TWO CONTROLS, ONE JOB, AND THE LIST LENGTH DECIDES WHICH. A native `<select>`
 * is the right control for a handful of people: it is one tap on a phone, it
 * uses the operating system's own picker, and nothing about it needs explaining.
 * It is the wrong control for two hundred — a scroll through an alphabetical
 * list looking for a name you already know is slower than typing three letters
 * of it, and on a phone it is a great deal slower.
 *
 * So the select stays for short lists and a type-ahead takes over past
 * SEARCH_THRESHOLD. Not a preference and not a setting: somebody with eight
 * contacts never sees the search box, and somebody with eighty never sees the
 * dropdown, and neither has to be told which they are getting.
 *
 * WHY NOT ALWAYS THE SEARCH BOX. Because a search box over six names is worse
 * than a dropdown over six names. It has an empty state, it needs a placeholder
 * explaining what to type, and it asks somebody to recall a name that a dropdown
 * would simply have shown them. Recall is harder than recognition; the dropdown
 * is the one that trades on recognition, and it should not be given up until the
 * list is long enough that recognition stops working.
 */

/**
 * Where a list stops being scannable.
 *
 * Ten is roughly where a dropdown outgrows one screen of a phone, which is the
 * point at which finding a name in it becomes scrolling rather than looking.
 */
const SEARCH_THRESHOLD = 10;

/**
 * How many matches are drawn at once.
 *
 * Not for correctness — the filter is over an array already in memory and it is
 * fast at any size a person's address book reaches. It is so that an empty query
 * against a thousand contacts does not put a thousand rows into the DOM to be
 * scrolled past. Anybody past the cap types another letter, which is what they
 * were going to do anyway.
 */
const MAX_VISIBLE = 50;

export function ContactPicker({
  contacts,
  value,
  onChange,
  label,
  wide,
  className,
}: {
  contacts: Contact[];
  /** The chosen contact's id, or "" for nobody. */
  value: string;
  onChange: (id: string) => void;
  label: string;
  wide?: boolean;
  /** The form's shared input styling, passed in so this matches its neighbours. */
  className: string;
}) {
  const selected = contacts.find((contact) => contact.id === value) ?? null;

  // ---------------------------------------------------------------------------
  // The short list: the control this has always been.
  // ---------------------------------------------------------------------------
  if (contacts.length <= SEARCH_THRESHOLD) {
    return (
      <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        >
          <option value="">Someone new…</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.display_name}
              {contact.email ? ` — ${contact.email}` : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <ContactSearch
      contacts={contacts}
      selected={selected}
      onChange={onChange}
      label={label}
      wide={wide}
      className={className}
    />
  );
}

function ContactSearch({
  contacts,
  selected,
  onChange,
  label,
  wide,
  className,
}: {
  contacts: Contact[];
  selected: Contact | null;
  onChange: (id: string) => void;
  label: string;
  wide?: boolean;
  className: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const wrapper = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fieldId = useId();
  const listId = `${fieldId}-list`;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;

    // Every whitespace-separated word has to appear somewhere, in any order.
    // "oka mar" finds Marcus Okafor, and so does "mar oka" — which matters
    // because half of any address book is stored surname-first and the person
    // typing does not know which half this one is in.
    const words = needle.split(/\s+/);
    return contacts.filter((contact) => {
      const haystack = [contact.display_name, contact.email, contact.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [contacts, query]);

  const visible = matches.slice(0, MAX_VISIBLE);

  // A filtered list is a different list, so the highlight goes back to the top of
  // it. Leaving it where it was points at whoever happens to be in that position
  // now, and Enter then picks somebody the person never looked at.
  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row on screen when it is moved by the keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (wrapper.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery("");
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  function pick(contact: Contact) {
    onChange(contact.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((current) => Math.min(current + 1, visible.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      // ALWAYS prevented while the list is open, even when nothing is
      // highlighted. This sits inside the lend form, and an unhandled Enter in a
      // text input submits it — so the keystroke that means "pick this person"
      // would otherwise send a half-filled agreement.
      if (open) {
        event.preventDefault();
        const choice = visible[active];
        if (choice) pick(choice);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }

    if (event.key === "Tab") setOpen(false);
  }

  return (
    <div ref={wrapper} className={`relative ${wide ? "sm:col-span-2" : ""}`}>
      {/*
        A plain <label>, not the form's `Field`, which wraps its children in one.
        A click on an option inside a label is forwarded to the labelled control,
        so the listbox would fight the input for the click.
      */}
      <label
        htmlFor={fieldId}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={fieldId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          // Open, the box shows what is being typed. Closed, it shows who is
          // chosen — so the field reads as an answer rather than as a search
          // somebody has to remember the result of.
          value={open ? query : (selected?.display_name ?? "")}
          placeholder={
            selected ? "" : `Search ${contacts.length} saved people, or leave blank`
          }
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`${className} ${selected && !open ? "pr-24" : ""}`}
        />

        {selected && !open && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Someone new
          </button>
        )}
      </div>

      {selected && !open && selected.email && (
        <p className="mt-1.5 text-xs text-ink-muted">{selected.email}</p>
      )}

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-paper py-1 shadow-lg shadow-ink/5"
        >
          {visible.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">
              Nobody saved matches that. Leave the box empty and fill in the name
              and email below to lend to somebody new.
            </li>
          )}

          {visible.map((contact, index) => (
            <li
              key={contact.id}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              // Mouse down rather than click: a click fires after the input has
              // already lost focus, and the outside-click handler has closed the
              // list by then.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(contact);
              }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-4 py-2.5 ${
                index === active ? "bg-surface" : ""
              }`}
            >
              <span className="block truncate text-sm text-ink">
                {contact.display_name}
              </span>
              {(contact.email || contact.phone) && (
                <span className="mt-0.5 block truncate text-xs text-ink-muted">
                  {[contact.email, contact.phone].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}

          {matches.length > visible.length && (
            <li className="px-4 py-2.5 text-xs text-ink-muted">
              {matches.length - visible.length} more. Keep typing to narrow it
              down.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
