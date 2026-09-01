import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { Empty, Note, Panel } from "@/components/app-ui";
import { AdminNav } from "@/components/AdminNav";
import { StaffManager } from "@/components/StaffManager";
import { currentStaff } from "@/lib/platform/access";
import {
  STAFF_ROLE_DESCRIPTIONS,
  STAFF_ROLE_LABELS,
  capabilitiesFor,
  staffCan,
  type StaffRole,
} from "@/lib/platform/roles";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

const ROLES: StaffRole[] = [
  "super_admin",
  "admin",
  "compliance",
  "support",
  "read_only",
];

export default async function StaffPage() {
  const staff = await currentStaff();
  if (!staff) notFound();

  const [grants, recent] = await Promise.all([
    staff.db
      .from("platform_staff")
      .select("id, user_id, email, role, note, created_at")
      .is("revoked_at", null)
      .order("created_at"),
    staff.db
      .from("staff_actions")
      .select("id, actor_email, action, subject_type, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const self = (grants.data ?? []).find((g) => g.user_id === staff.userId);

  return (
    <Container className="py-14 sm:py-20">
      <AdminNav role={staff.role} email={staff.email} />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Staff</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Access is a row, not an attribute of an address. Revoking it ends the
        access on the next request — there is no cache and no second place it is
        remembered.
      </p>

      <div className="mt-10 space-y-8">
        <Panel title="Who works here">
          <StaffManager
            grants={(grants.data ?? []) as never}
            canManage={staffCan(staff.role, "staff.manage")}
            selfId={self?.id ?? ""}
          />
        </Panel>

        <Panel
          title="What each role can do"
          description="Defined in lib/platform/roles.ts. Changing it is a code change, reviewed like any other."
        >
          <div className="space-y-5">
            {ROLES.map((role) => (
              <div key={role}>
                <p className="text-sm font-semibold text-ink">
                  {STAFF_ROLE_LABELS[role]}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {STAFF_ROLE_DESCRIPTIONS[role]}
                </p>
                <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {capabilitiesFor(role).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Recent staff actions"
          description="Append-only. Nothing here can be edited or removed, including by a super admin."
        >
          {(recent.data ?? []).length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {(recent.data ?? []).map((action) => (
                <li key={action.id} className="text-sm text-ink-soft">
                  <span className="font-mono text-[11px] text-ink-muted">
                    {new Date(action.created_at).toLocaleString()}
                  </span>{" "}
                  · {action.actor_email} · {action.action} ({action.subject_type})
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Note tone="warn">
          Staff can read accounts and change how partners are configured. Nothing
          here opens a path into the evidence tables: signatures, consent records,
          documents, audit events and compliance checks have no write policy at
          all, and a super admin cannot alter what somebody signed. Support looks;
          it does not rewrite history.
        </Note>
      </div>
    </Container>
  );
}
