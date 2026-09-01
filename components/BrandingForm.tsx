"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";

type Branding = {
  display_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  theme: string;
  support_email: string | null;
  support_url: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  review_note: string | null;
};

/**
 * Co-branding for the embedded widget.
 *
 * The preview is a rough one on purpose — enough to see that a colour is too dark
 * behind white text, not a promise that the widget looks exactly like this. A
 * pixel-accurate preview would be a second implementation of the widget that
 * drifts from the first.
 */
export function BrandingForm({
  partnerId,
  branding,
  canSubmit,
}: {
  partnerId: string;
  branding: Branding | null;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(branding?.display_name ?? "");
  const [logoUrl, setLogoUrl] = useState(branding?.logo_url ?? "");
  const [primary, setPrimary] = useState(branding?.primary_color ?? "#1B4332");
  const [accent, setAccent] = useState(branding?.accent_color ?? "#2D6A4F");
  const [theme, setTheme] = useState(branding?.theme ?? "auto");
  const [supportEmail, setSupportEmail] = useState(branding?.support_email ?? "");
  const [supportUrl, setSupportUrl] = useState(branding?.support_url ?? "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await send<{ notice?: string }>("/api/partners/branding", {
      body: {
        partner_id: partnerId,
        display_name: displayName || null,
        logo_url: logoUrl || null,
        primary_color: primary || null,
        accent_color: accent || null,
        theme,
        support_email: supportEmail || null,
        support_url: supportUrl || null,
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(result.data.notice ?? "Submitted.");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Status branding={branding} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Display name" hint="Leave blank to use your company name.">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Logo URL" hint="https only. SVG or a transparent PNG.">
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…/logo.svg"
            className={inputClass}
          />
        </Field>

        <Field label="Primary colour">
          <div className="flex gap-2">
            <input
              type="color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className="h-[42px] w-14 shrink-0 cursor-pointer rounded-lg border border-line bg-paper p-1"
            />
            <input
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
        </Field>

        <Field label="Accent colour">
          <div className="flex gap-2">
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-[42px] w-14 shrink-0 cursor-pointer rounded-lg border border-line bg-paper p-1"
            />
            <input
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
        </Field>

        <Field label="Theme">
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className={inputClass}
          >
            <option value="auto">Follow the device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>

        <Field label="Your support email" hint="Shown next to ours, never instead of it.">
          <input
            type="email"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Your support page">
          <input
            value={supportUrl}
            onChange={(e) => setSupportUrl(e.target.value)}
            placeholder="https://…/help"
            className={inputClass}
          />
        </Field>
      </div>

      <Preview
        displayName={displayName || "Your company"}
        logoUrl={logoUrl}
        primary={primary}
        accent={accent}
      />

      {canSubmit && (
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Sending…" : "Submit for review"}
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-accent">{notice}</p>}
    </form>
  );
}

function Status({ branding }: { branding: Branding | null }) {
  if (!branding?.submitted_at) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        Nothing submitted yet. Until it is, the widget renders without your mark.
      </p>
    );
  }

  if (branding.approved_at) {
    return (
      <div className="rounded-xl border border-accent/25 bg-accent-soft px-5 py-4 text-sm text-accent">
        Approved and live in the widget. Any change puts it back in the queue, and
        the approved version keeps rendering until the new one is looked at.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-ink-soft">
      Submitted and waiting for review.
      {branding.review_note && (
        <span className="mt-2 block text-flag">
          Last review: {branding.review_note}
        </span>
      )}
    </div>
  );
}

function Preview({
  displayName,
  logoUrl,
  primary,
  accent,
}: {
  displayName: string;
  logoUrl: string;
  primary: string;
  accent: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
        Roughly
      </p>
      <div
        className="max-w-sm rounded-2xl border p-6"
        style={{ borderColor: `${primary}33`, background: `${primary}0A` }}
      >
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-6 w-auto" />
          ) : (
            <span
              className="inline-block h-6 w-6 rounded"
              style={{ background: primary }}
            />
          )}
          <span className="text-sm font-semibold" style={{ color: primary }}>
            {displayName}
          </span>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          Cover for this rental, for the hours you have it.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 rounded-full px-5 py-2 text-sm font-semibold text-white"
          style={{ background: accent }}
        >
          Add cover — $24
        </button>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
          Offered and administered by I-Waiver. {displayName} is not the insurer.
        </p>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
