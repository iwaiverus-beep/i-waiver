"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import {
  STAFF_ROLE_DESCRIPTIONS,
  STAFF_ROLE_LABELS,
  type StaffRole,
} from "@/lib/platform/roles";

type Grant = {
  id: string;
  email: string;
  role: StaffRole;
  created_at: string;
  note: string | null;
};

/**
 * Granting and revoking staff access.
 *
 * The role description is shown under the picker rather than in a help page,
 * because the difference between `admin` and `support` is exactly the sort of
 * thing somebody guesses at and gets wrong, and the consequence of guessing wrong
 * is a person who can approve partners.
 */
export function StaffManager({
  grants,
  canManage,
  selfId,
}: {
  grants: Grant[];
  canManage: boolean;
  selfId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    setBusy(true);
    setError(null);
    const result = await send("/api/admin/staff", { body: { email, role } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/staff/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {grants.map((grant) => (
          <li
            key={grant.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-5 py-3.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{grant.email}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {STAFF_ROLE_LABELS[grant.role]} · since{" "}
                {new Date(grant.created_at).toLocaleDateString()}
                {grant.note ? ` · ${grant.note}` : ""}
              </p>
            </div>
            {canManage && grant.id !== selfId && (
              <button
                type="button"
                onClick={() => revoke(grant.id)}
                disabled={busy}
                className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-flag/40 hover:text-flag disabled:opacity-60"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="rounded-xl border border-dashed border-line p-5">
          <p className="text-sm font-semibold text-ink">Grant access</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            They need an account already — ask them to sign in once first. An
            address typed with a slip in it should fail now, not sit here as a live
            grant waiting for whoever eventually registers it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@i-waiver.com"
              className="min-w-[16rem] flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            >
              {(
                ["read_only", "support", "compliance", "admin", "super_admin"] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {STAFF_ROLE_LABELS[value]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={grant}
              disabled={busy || !email}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Working…" : "Grant"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            {STAFF_ROLE_DESCRIPTIONS[role]}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}
