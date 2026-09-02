import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The activity vocabulary.
 *
 * One read, in one place, so that the lend form, the intake-code form, the
 * carrier product form and the admin console cannot drift apart again. They did
 * drift: before 20260901000040 the same question had three different answers
 * depending on which screen you asked it on, and a fourth if you counted the
 * free-text box on the carrier form.
 *
 * No `server-only`. Callers pass their own client, and both the user client and
 * the service client can read this table — `activity_classes` is granted to anon
 * for the same reason `state_availability` is.
 */

export type ActivityClass = {
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
  retired_at: string | null;
};

export const ACTIVITY_COLUMNS = "code, label, description, sort_order, retired_at";

/**
 * Everything currently on offer, in display order.
 *
 * Retired activities are excluded. They still exist, and every agreement, rule
 * set and template ever written against one still resolves — a retired activity
 * stops being OFFERED, which is a different thing from ceasing to be.
 */
export async function listActivityClasses(
  db: SupabaseClient,
): Promise<ActivityClass[]> {
  const { data } = await db
    .from("activity_classes")
    .select(ACTIVITY_COLUMNS)
    .is("retired_at", null)
    .order("sort_order")
    .order("label");

  return (data ?? []) as ActivityClass[];
}

/** Including the retired ones, for the admin screen that manages them. */
export async function listAllActivityClasses(
  db: SupabaseClient,
): Promise<ActivityClass[]> {
  const { data } = await db
    .from("activity_classes")
    .select(ACTIVITY_COLUMNS)
    .order("sort_order")
    .order("label");

  return (data ?? []) as ActivityClass[];
}

/**
 * `personal_watercraft` -> `Jet ski / personal watercraft`, falling back to a
 * readable version of the code itself.
 *
 * The fallback matters on historical records. `agreements.activity_class` is a
 * snapshot with no foreign key, so a document written under an activity that has
 * since been renamed or removed still has to render its own name rather than a
 * blank space where one used to be.
 */
export function activityLabel(
  code: string,
  known: { code: string; label: string }[],
): string {
  return (
    known.find((a) => a.code === code)?.label ?? code.replace(/_/g, " ")
  );
}
