"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/request";
import { PARTNER_ROLE_DESCRIPTIONS, PARTNER_ROLE_LABELS } from "@/lib/partners/roles";

/**
 * Who at the partner can sign in.
 *
 * The invitation is the email address and the copy says so, because the obvious
 * question — "where is the invite link?" — otherwise becomes a support ticket for
 * every single partner.
 */

type Member = {
  id: string;
  email: string;
  role: "owner" | "admin" | "developer" | "viewer";
  accepted_at: string | null;
};

export function PartnerTeam({
  partnerId,
  members,
  canManage,
  isOwner,
}: {
  partnerId: string;
  members: Member[];
  canManage: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("developer");

  async function invite() {
    setBusy(true);
    setError(null);
    const result = await send("/api/partners/members", {
      body: { partner_id: partnerId, email, role },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/partners/members/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-5 py-3.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{member.email}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {PARTNER_ROLE_LABELS[member.role]} ·{" "}
                {member.accepted_at ? "signed in" : "has not signed in yet"}
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => remove(member.id)}
                disabled={busy}
                className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-flag/40 hover:text-flag disabled:opacity-60"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="rounded-xl border border-dashed border-line p-5">
          <p className="text-sm font-semibold text-ink">Add somebody</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            There is no invitation link to send on. They sign in with this exact
            address and their access is waiting — which also means a forwarded
            email gives nobody anything.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@yourcompany.com"
              className="min-w-[16rem] flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Member["role"])}
              className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            >
              {(["developer", "admin", "viewer", "owner"] as const)
                // Only an owner may create another owner; the server refuses it
                // too, and hiding the option keeps that from being a surprise.
                .filter((value) => value !== "owner" || isOwner)
                .map((value) => (
                  <option key={value} value={value}>
                    {PARTNER_ROLE_LABELS[value]}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={invite}
              disabled={busy || !email}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Working…" : "Add"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            {PARTNER_ROLE_DESCRIPTIONS[role]}
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
