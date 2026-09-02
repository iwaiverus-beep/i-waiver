"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import { US_STATES } from "@/lib/jurisdictions";

/**
 * The staff-side controls on one carrier.
 *
 * Four separate panels for four decisions with four different consequences,
 * exactly as AdminPartnerTools is split. Making a carrier `active` and recording
 * a filing are not the same kind of act as typing a phone number, and one save
 * button over all of it would say they were.
 */

const COVERAGE_KINDS = [
  { value: "physical_damage", label: "Physical damage" },
  { value: "liability", label: "Liability" },
  { value: "accident_medical", label: "Accident medical" },
  { value: "deductible_reimbursement", label: "Deductible reimbursement" },
];

const FILING_STATUSES = [
  { value: "not_filed", label: "Not filed" },
  { value: "filed", label: "Filed, awaiting approval" },
  { value: "approved", label: "Approved — may be quoted" },
  { value: "withdrawn", label: "Withdrawn" },
];

export function CarrierStatusControl({
  carrierId,
  status,
  adapter,
  adapterRegistered,
  canManage,
}: {
  carrierId: string;
  status: string;
  adapter: string;
  adapterRegistered: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function move(next: string) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/carriers/${carrierId}`, {
      method: "PATCH",
      body: { status: next, reason: reason || null },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReason("");
    router.refresh();
  }

  if (!canManage) {
    return <p className="text-sm text-ink-muted">Your role cannot change this.</p>;
  }

  return (
    <div className="space-y-4">
      {!adapterRegistered && (
        <div className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4 text-sm leading-relaxed text-flag">
          <strong className="font-semibold">
            No client is registered for adapter &ldquo;{adapter}&rdquo;.
          </strong>{" "}
          This carrier cannot be made active until somebody writes a{" "}
          <code className="font-mono text-xs">CarrierClient</code> and adds it to{" "}
          <code className="font-mono text-xs">ADAPTERS</code> in
          lib/coverage/carrier.ts. Nothing falls back to the mock — that would put
          MOCK- policy numbers under this carrier&rsquo;s name.
        </div>
      )}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason, if suspending or terminating"
        className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
      />

      <div className="flex flex-wrap gap-3">
        {status !== "active" && (
          <button
            type="button"
            onClick={() => move("active")}
            disabled={busy || !adapterRegistered}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
          >
            Make active
          </button>
        )}
        {status !== "contracted" && status !== "active" && (
          <button
            type="button"
            onClick={() => move("contracted")}
            disabled={busy}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft disabled:opacity-60"
          >
            Mark contracted
          </button>
        )}
        {status === "active" && (
          <button
            type="button"
            onClick={() => move("suspended")}
            disabled={busy || !reason.trim()}
            className="rounded-full border border-flag/40 px-5 py-2.5 text-sm font-semibold text-flag transition-colors hover:bg-flag/[0.08] disabled:opacity-60"
          >
            Suspend
          </button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        Only an active carrier is offered when quoting. Suspending takes effect on
        the next quote and leaves every policy already bound alone, which is the
        correct split — a carrier we have stopped using still owes on what they
        wrote.
      </p>

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProductForm({
  carrierId,
  canManage,
  activities,
}: {
  carrierId: string;
  canManage: boolean;
  /**
   * The activity vocabulary, from `activity_classes`.
   *
   * This field was a free-text box until 20260901000040. A product filed under
   * `personal_watercaft` looked perfectly fine in this list, was returned by no
   * query anybody ran, and produced "we are not open in FL" for an activity we
   * were plainly open for. The database now refuses the typo; this list means
   * nobody has to make it.
   */
  activities: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await send(`/api/admin/carriers/${carrierId}/products`, {
      body: {
        product_code: form.get("product_code"),
        display_name: form.get("display_name"),
        activity_class: form.get("activity_class"),
        coverage_kind: form.get("coverage_kind"),
        description: form.get("description"),
        default_limit_cents: form.get("default_limit_cents"),
        default_deductible_cents: form.get("default_deductible_cents"),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    (event.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-dashed border-line p-5">
      <p className="text-sm font-semibold text-ink">Add a product</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        The product code is what appears in every quote written against it, and it
        is unique across all carriers — a quote records the code, not a reference,
        so a reused one makes an old quote ambiguous about who priced it.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Product code">
          <input name="product_code" required placeholder="PWC-DAY-01" className={mono} />
        </Field>
        <Field label="Shown to a customer as">
          <input
            name="display_name"
            required
            placeholder="Damage to the watercraft"
            className={input}
          />
        </Field>
        <Field label="Coverage kind">
          <select name="coverage_kind" defaultValue="physical_damage" className={input}>
            {COVERAGE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Activity class">
          <select
            name="activity_class"
            required
            defaultValue={activities[0]?.code ?? ""}
            className={input}
          >
            {activities.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default limit (cents)">
          <input name="default_limit_cents" inputMode="numeric" className={mono} />
        </Field>
        <Field label="Default deductible (cents)">
          <input name="default_deductible_cents" inputMode="numeric" className={mono} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Description">
          <input name="description" className={input} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Saving…" : "Add product"}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-flag">
          {error}
        </p>
      )}
    </form>
  );
}

export function FilingForm({
  carrierId,
  products,
  canFile,
}: {
  carrierId: string;
  products: { id: string; product_code: string; display_name: string }[];
  canFile: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("approved");

  if (!canFile) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        Recording a filing needs the compliance role. It is a claim about a
        regulator&rsquo;s decision and the only input to whether a live quote may
        be given in a state, so it does not sit with whoever is trying to open the
        state.
      </p>
    );
  }

  if (products.length === 0) {
    return <p className="text-sm text-ink-muted">Add a product first.</p>;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await send(`/api/admin/carriers/${carrierId}/filings`, {
      body: {
        product_id: form.get("product_id"),
        state: form.get("state"),
        status: form.get("status"),
        admitted: form.get("admitted") === "on",
        filing_ref: form.get("filing_ref"),
        effective_from: form.get("effective_from"),
        effective_to: form.get("effective_to"),
        notes: form.get("notes"),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-dashed border-line p-5">
      <p className="text-sm font-semibold text-ink">Record a filing</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Product">
          <select name="product_id" className={input}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.product_code} — {p.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="State">
          <select name="state" defaultValue="FL" className={input}>
            {US_STATES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={input}
          >
            {FILING_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Filing reference">
          <input name="filing_ref" className={mono} />
        </Field>
        <Field
          label="Effective from"
          hint={status === "approved" ? "Required for an approved filing." : undefined}
        >
          <input
            name="effective_from"
            type="date"
            required={status === "approved"}
            className={input}
          />
        </Field>
        <Field label="Effective to" hint="Leave blank if open-ended.">
          <input name="effective_to" type="date" className={input} />
        </Field>
      </div>

      <label className="mt-4 flex items-center gap-2.5 text-sm text-ink-soft">
        <input type="checkbox" name="admitted" className="h-4 w-4 accent-accent" />
        Admitted (not surplus lines)
      </label>

      <div className="mt-4">
        <Field label="Notes">
          <input name="notes" className={input} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save filing"}
      </button>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Saving an approved filing opens the state for this product immediately.
        state_availability updates itself from here.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-flag">
          {error}
        </p>
      )}
    </form>
  );
}

export function CredentialForm({
  carrierId,
  canManage,
}: {
  carrierId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  if (!canManage) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSecret(null);

    const form = new FormData(event.currentTarget);
    const result = await send<{ inbound_secret: string | null }>(
      `/api/admin/carriers/${carrierId}/credentials`,
      {
        body: {
          environment: form.get("environment"),
          base_url: form.get("base_url"),
          auth_kind: form.get("auth_kind"),
          secret_env_var: form.get("secret_env_var"),
          rotate_inbound_secret: form.get("rotate_inbound_secret") === "on",
        },
      },
    );

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSecret(result.data.inbound_secret);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-dashed border-line p-5">
      <p className="text-sm font-semibold text-ink">Set a credential</p>

      <div className="mt-4 rounded-lg border border-flag/30 bg-flag/[0.05] px-4 py-3">
        <p className="text-xs leading-relaxed text-flag">
          <strong className="font-semibold">Never paste a secret here.</strong> The
          field below takes the NAME of the environment variable holding the
          carrier&rsquo;s key — like{" "}
          <code className="font-mono">ACME_CARRIER_API_KEY</code>. We must send
          their key in clear on every call, so storing it would put a working
          production credential for someone else&rsquo;s insurance system into
          every backup. The database rejects anything not shaped like a variable
          name.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Environment">
          <select name="environment" defaultValue="sandbox" className={input}>
            <option value="sandbox">Sandbox</option>
            <option value="live">Live</option>
          </select>
        </Field>
        <Field label="Auth kind">
          <select name="auth_kind" defaultValue="bearer" className={input}>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic</option>
            <option value="hmac">HMAC signature</option>
            <option value="mtls">Mutual TLS</option>
          </select>
        </Field>
        <Field label="Base URL" hint="https only.">
          <input name="base_url" placeholder="https://api.carrier.example" className={input} />
        </Field>
        <Field label="Secret env var name">
          <input name="secret_env_var" placeholder="ACME_CARRIER_API_KEY" className={mono} />
        </Field>
      </div>

      <label className="mt-4 flex items-center gap-2.5 text-sm text-ink-soft">
        <input
          type="checkbox"
          name="rotate_inbound_secret"
          className="h-4 w-4 accent-accent"
        />
        Also mint a new inbound secret for them to sign webhooks with
      </label>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save credential"}
      </button>

      {secret && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-5 py-4">
          <p className="text-sm font-semibold text-accent">
            Give this to the carrier. It is not shown again.
          </p>
          <p className="mt-3 break-all rounded-lg border border-accent/25 bg-paper p-3 font-mono text-[12px] text-ink">
            {secret}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-flag">
          {error}
        </p>
      )}
    </form>
  );
}

export function NewCarrierForm({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await send("/api/admin/carriers", {
      body: {
        name: form.get("name"),
        kind: form.get("kind"),
        naic_code: form.get("naic_code"),
        adapter: form.get("adapter"),
        contact_name: form.get("contact_name"),
        contact_email: form.get("contact_email"),
        notes: form.get("notes"),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    (event.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-dashed border-line p-5">
      <p className="text-sm font-semibold text-ink">Add a carrier</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        Created as a prospect. Making one active is separate, and refused until a
        client exists for its adapter.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required className={input} />
        </Field>
        <Field label="Kind">
          <select name="kind" defaultValue="carrier" className={input}>
            <option value="carrier">Admitted carrier</option>
            <option value="mga">MGA / programme manager</option>
            <option value="fronting">Fronting carrier</option>
            <option value="surplus_lines">Surplus lines writer</option>
          </select>
        </Field>
        <Field label="NAIC code">
          <input name="naic_code" className={mono} />
        </Field>
        <Field label="Adapter" hint="The key in ADAPTERS that speaks to them.">
          <input name="adapter" defaultValue="mock" className={mono} />
        </Field>
        <Field label="Contact">
          <input name="contact_name" className={input} />
        </Field>
        <Field label="Contact email">
          <input name="contact_email" type="email" className={input} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Saving…" : "Add carrier"}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-flag">
          {error}
        </p>
      )}
    </form>
  );
}

const input =
  "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent";
const mono = `${input} font-mono text-[12px]`;

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
