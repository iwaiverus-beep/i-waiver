import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { READINESS_COLUMNS, type ReadinessRow } from "@/lib/readiness";
import { listAllActivityClasses, type ActivityClass } from "@/lib/activities";

/**
 * Reads and writes for the configuration screen.
 *
 * WHAT IS EDITABLE HERE AND WHAT IS NOT, because the distinction is the whole
 * design of the screen. Three of the four gates on opening a state are facts
 * established somewhere else and are shown read-only:
 *
 *   * `carrier_admitted` is a CACHE of the filings, maintained by a trigger
 *     (20260901000018). A value written here is overwritten by the next filing
 *     change, so the screen sends people to the carrier instead.
 *   * A rule set is a versioned dataset with an effective date, published in a
 *     migration so that a compliance check two years from now can still name the
 *     version it applied. A form that let somebody edit one in place would
 *     destroy exactly the property it exists for.
 *   * A template version is immutable once published, for the same reason.
 *
 * What IS editable is the pair of judgements that genuinely belong to a person
 * with the `compliance.states` capability: whether counsel has reviewed a state's
 * clause set, and how enforceable a pre-injury release is there.
 */

export type StateRow = {
  state: string;
  carrier_admitted: boolean;
  product_codes: string[];
  clause_set_reviewed_at: string | null;
  waiver_efficacy: string;
  status: string;
  notes: string | null;
  updated_at: string;
};

export const STATE_COLUMNS =
  "state, carrier_admitted, product_codes, clause_set_reviewed_at, waiver_efficacy, status, notes, updated_at";

export const WAIVER_EFFICACIES = [
  {
    value: "standard",
    label: "Standard",
    description:
      "A properly drafted pre-injury release is generally enforced against an adult.",
  },
  {
    value: "limited",
    label: "Limited",
    description:
      "Enforced, but narrowed — by statute, by subject matter, or by a hostile line of cases. Needs counsel to say how far.",
  },
  {
    value: "void",
    label: "Void",
    description:
      "A pre-injury release of negligence is void. The state can never be more than cover-only, whatever else is done.",
  },
];

export const STATE_STATUS_LABELS: Record<string, string> = {
  live: "Live",
  cover_only: "Cover only",
  unavailable: "Unavailable",
};

export type ConfigView = {
  states: StateRow[];
  activities: ActivityClass[];
  readiness: ReadinessRow[];
};

export async function configView(db: SupabaseClient): Promise<ConfigView> {
  const [states, activities, readiness] = await Promise.all([
    db.from("state_availability").select(STATE_COLUMNS).order("state"),
    listAllActivityClasses(db),
    db.from("state_activity_readiness").select(READINESS_COLUMNS).order("state"),
  ]);

  return {
    states: (states.data ?? []) as StateRow[],
    activities,
    readiness: (readiness.data ?? []) as ReadinessRow[],
  };
}

export class ConfigRefused extends Error {}

/**
 * Record — or withdraw — counsel's sign-off on a state's clause set.
 *
 * A timestamp rather than a boolean, and set to now() rather than to whatever
 * date somebody types, because the question later is "when was this reviewed and
 * by whom", and the staff action log answers the second half. Withdrawing it is
 * allowed and is the reason this is not one-way: a statute changes, and the
 * honest response is for every document in that state to go back to printing as
 * a specimen until somebody has read it again.
 */
export async function setClauseReview(
  db: SupabaseClient,
  state: string,
  reviewed: boolean,
): Promise<StateRow> {
  const { data, error } = await db
    .from("state_availability")
    .update({
      clause_set_reviewed_at: reviewed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("state", state)
    .select(STATE_COLUMNS)
    .maybeSingle();

  if (error) throw new ConfigRefused(error.message);
  if (!data) throw new ConfigRefused(`${state} is not a state we hold a row for.`);
  return data as StateRow;
}

export async function updateState(
  db: SupabaseClient,
  state: string,
  patch: { waiverEfficacy?: string; notes?: string | null },
): Promise<StateRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.waiverEfficacy !== undefined) {
    if (!WAIVER_EFFICACIES.some((w) => w.value === patch.waiverEfficacy)) {
      throw new ConfigRefused("Unknown waiver efficacy.");
    }
    update.waiver_efficacy = patch.waiverEfficacy;
  }
  if (patch.notes !== undefined) update.notes = patch.notes;

  const { data, error } = await db
    .from("state_availability")
    .update(update)
    .eq("state", state)
    .select(STATE_COLUMNS)
    .maybeSingle();

  if (error) throw new ConfigRefused(error.message);
  if (!data) throw new ConfigRefused(`${state} is not a state we hold a row for.`);
  return data as StateRow;
}

/** The code is permanent once written — every FK in the schema points at it. */
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,58}[a-z0-9]$/;

export async function createActivity(
  db: SupabaseClient,
  input: { code: string; label: string; description: string | null; sortOrder: number },
): Promise<ActivityClass> {
  if (!CODE_PATTERN.test(input.code)) {
    throw new ConfigRefused(
      "The code must be lower case letters, digits and underscores — it is what the rule sets and templates will point at, and it cannot be changed afterwards.",
    );
  }

  const { data, error } = await db
    .from("activity_classes")
    .insert({
      code: input.code,
      label: input.label,
      description: input.description,
      sort_order: input.sortOrder,
    })
    .select("code, label, description, sort_order, retired_at")
    .single();

  if (error) {
    // 23505 is a unique violation, which here can only be the code.
    throw new ConfigRefused(
      error.code === "23505"
        ? `There is already an activity called ${input.code}. If it is retired, bring it back rather than making a second one.`
        : error.message,
    );
  }

  return data as ActivityClass;
}

/**
 * Rename, re-describe, reorder, retire, un-retire.
 *
 * The code is not in the list, deliberately. It is referenced by carrier
 * products, rule sets, template versions and intake links, and by
 * `agreements.activity_class`, which is a snapshot with no foreign key at all —
 * so a rename would leave every historical agreement pointing at a value that no
 * longer exists. The label is what people read; change that.
 */
export async function updateActivity(
  db: SupabaseClient,
  code: string,
  patch: {
    label?: string;
    description?: string | null;
    sortOrder?: number;
    retired?: boolean;
  },
): Promise<ActivityClass> {
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.retired !== undefined) {
    update.retired_at = patch.retired ? new Date().toISOString() : null;
  }

  if (Object.keys(update).length === 0) {
    throw new ConfigRefused("Nothing to change.");
  }

  const { data, error } = await db
    .from("activity_classes")
    .update(update)
    .eq("code", code)
    .select("code, label, description, sort_order, retired_at")
    .maybeSingle();

  if (error) throw new ConfigRefused(error.message);
  if (!data) throw new ConfigRefused("No such activity.");
  return data as ActivityClass;
}
