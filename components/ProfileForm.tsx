"use client";

import { useRef, useState } from "react";
import { initialsFor } from "@/lib/format";
import { US_STATES } from "@/lib/jurisdictions";
import { send } from "@/lib/client/request";
import { PROFILE_UPDATED_EVENT } from "./AccountMenu";
import { Field, Notice, inputClass, primaryButtonClass, quietButtonClass } from "./form-ui";

/**
 * Who you are, as the product uses it.
 *
 * Every field here already existed on `profiles` and had nowhere to be set. The
 * name is the one that matters most and is worth saying so on the screen: it is
 * not a display name, it is what `lib/agreements/create.ts` writes onto the
 * instrument as the lender's legal name, and it appears on every document this
 * account sends.
 */

export type ProfileValues = {
  full_name: string | null;
  phone: string | null;
  home_state: string | null;
  avatar_url: string | null;
  email: string | null;
};

const MAX_BYTES = 5 * 1024 * 1024;

export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const [fullName, setFullName] = useState(initial.full_name ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [homeState, setHomeState] = useState(initial.home_state ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  /** The header is showing the same name and picture. Tell it. */
  function announce() {
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await send<{ profile: ProfileValues }>("/api/profile", {
      method: "PATCH",
      body: {
        full_name: fullName,
        phone: phone || null,
        home_state: homeState || null,
      },
    });

    setBusy(false);
    if (!result.ok) return setError(result.error);

    // Read the saved values back rather than keeping what was typed: the phone
    // number goes in as "(555) 010-0123" and is stored as +15550100123, and a
    // field that keeps showing the typed version hides that it was rewritten.
    setPhone(result.data.profile.phone ?? "");
    setNotice("Saved.");
    announce();
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setNotice(null);

    // Checked here as well as in the route, because a 5MB upload that fails on
    // arrival wastes a phone's data to tell somebody what a sentence could have.
    if (file.size > MAX_BYTES) {
      setUploading(false);
      return setError("That picture is over 5MB. A smaller one will look the same in a circle this size.");
    }

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "That did not upload.");
      setAvatarUrl(payload.avatar_url ?? null);
      setNotice("Picture updated.");
      announce();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setUploading(false);
      if (filePicker.current) filePicker.current.value = "";
    }
  }

  async function removePicture() {
    setUploading(true);
    setError(null);
    setNotice(null);
    const result = await send("/api/profile/avatar", { method: "DELETE" });
    setUploading(false);
    if (!result.ok) return setError(result.error);
    setAvatarUrl(null);
    setNotice("Picture removed.");
    announce();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-5">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-20 w-20 rounded-full border border-line object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-xl font-semibold text-paper"
          >
            {initialsFor(fullName || initial.full_name, initial.email)}
          </span>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => filePicker.current?.click()}
              className={quietButtonClass}
            >
              {uploading ? "Working…" : avatarUrl ? "Change picture" : "Upload a picture"}
            </button>
            {avatarUrl && (
              <button
                type="button"
                disabled={uploading}
                onClick={removePicture}
                className={quietButtonClass}
              >
                Remove
              </button>
            )}
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-ink-muted">
            JPEG, PNG or WebP, up to 5MB. It is stored privately and is not published
            anywhere — it shows in your own header, not on an agreement.
          </p>
        </div>

        <input
          ref={filePicker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>

      <form onSubmit={save} className="space-y-5">
        <Field label="Your full name">
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Dave Okafor"
            autoComplete="name"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            This is the name that appears on every agreement you send, so it should be
            the one on your ID rather than a nickname.
          </p>
        </Field>

        <Field label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 010 0123"
            autoComplete="tel"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Optional, and nobody is texted today — we only send email. Include the
            country code.
          </p>
        </Field>

        <Field label="Home state">
          <select
            value={homeState}
            onChange={(e) => setHomeState(e.target.value)}
            className={inputClass}
          >
            <option value="">Not set</option>
            {US_STATES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink-muted">
            Only a starting point on the lend form. What governs an agreement is the
            state the activity happens in, which you pick each time.
          </p>
        </Field>

        {error && <Notice tone="bad">{error}</Notice>}
        {notice && <Notice tone="good">{notice}</Notice>}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
