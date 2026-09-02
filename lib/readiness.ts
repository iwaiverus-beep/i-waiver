/**
 * What is actually open, and what is missing where it is not.
 *
 * No `server-only`. The lend form, the intake-code form and the admin console all
 * render from this, and `state_activity_readiness` is granted to `authenticated`
 * precisely so they can — see 20260901000040 for why exposing the booleans is
 * safe.
 *
 * THE POINT OF THIS MODULE. The state list has always been honest: it is built
 * from `state_availability` and only offers what is open. The activity list was
 * three hardcoded arrays in three files that disagreed with each other and with
 * the database. So a lender could pick a combination the product cannot produce a
 * document for, and find out at the moment they pressed the button — or worse, an
 * intake code could be printed and stuck to a jet ski for a combination that
 * refuses every borrower who scans it.
 *
 * The rule here is the one the state list already followed: offer what works, and
 * where something nearly works, say what is missing rather than hiding it.
 */

export type OriginatorKind = "individual" | "organization";
export type InstrumentKind = "rental" | "participant";

/** One row of `state_activity_readiness`. */
export type ReadinessRow = {
  state: string;
  activity_class: string;
  activity_label: string;
  activity_sort_order: number;
  state_status: string;
  waiver_efficacy: string;
  clause_set_reviewed_at: string | null;
  product_codes: string[];
  carrier_filed: boolean;
  rule_set_published: boolean;
  template_individual_rental: boolean;
  template_individual_participant: boolean;
  template_organization_rental: boolean;
  template_organization_participant: boolean;
  template_drafted_unpublished: boolean;
};

/** The columns to select. Kept here so the shape and the query cannot drift. */
export const READINESS_COLUMNS =
  "state, activity_class, activity_label, activity_sort_order, state_status, waiver_efficacy, clause_set_reviewed_at, product_codes, carrier_filed, rule_set_published, template_individual_rental, template_individual_participant, template_organization_rental, template_organization_participant, template_drafted_unpublished";

/**
 * Is the template for this exact combination published?
 *
 * Four booleans rather than one because template selection is exhaustive over
 * both kinds with no fallback between them (20260901000016, 20260901000023). A
 * single "has a template" flag would report Florida as ready and then refuse
 * every business lender who tried it.
 */
export function hasTemplate(
  row: ReadinessRow,
  originatorKind: OriginatorKind,
  instrumentKind: InstrumentKind,
): boolean {
  if (originatorKind === "individual") {
    return instrumentKind === "rental"
      ? row.template_individual_rental
      : row.template_individual_participant;
  }
  return instrumentKind === "rental"
    ? row.template_organization_rental
    : row.template_organization_participant;
}

/**
 * Can this lender create a draft for this combination right now?
 *
 * Deliberately NOT "is there a carrier filing". The two questions come apart, and
 * conflating them was the old mistake in the other direction: in a `cover_only`
 * state the document is still a real record of the loan and creating it is the
 * right thing to allow — what changes is that the cover is unavailable, which
 * `coverAvailable` answers separately and the form says out loud.
 *
 * These are the two conditions the code actually enforces: `createAgreement`
 * refuses without a published template, and the compliance gate refuses to send
 * or sign without an active rule set.
 */
export function canOriginate(
  row: ReadinessRow,
  originatorKind: OriginatorKind,
  instrumentKind: InstrumentKind = "rental",
): boolean {
  return row.rule_set_published && hasTemplate(row, originatorKind, instrumentKind);
}

/** Whether cover can be quoted and bound for this combination. */
export function coverAvailable(row: ReadinessRow): boolean {
  return row.carrier_filed;
}

/**
 * Why a combination is not open, in the words of whoever has to fix it.
 *
 * Ordered by who is blocking: the regulator, then counsel's reading, then
 * counsel's wording. A list read top to bottom is the order the work happens in.
 */
export function blockers(
  row: ReadinessRow,
  originatorKind: OriginatorKind,
  instrumentKind: InstrumentKind = "rental",
): string[] {
  const missing: string[] = [];

  if (!row.carrier_filed) {
    missing.push(
      `No approved carrier filing for ${row.activity_label.toLowerCase()} in ${row.state}. Cover cannot be quoted.`,
    );
  }
  if (!row.rule_set_published) {
    missing.push(
      `No rule set for ${row.state} / ${row.activity_label.toLowerCase()}. The compliance gate refuses to send or sign without one.`,
    );
  }
  if (!hasTemplate(row, originatorKind, instrumentKind)) {
    missing.push(
      row.template_drafted_unpublished
        ? `Wording for the ${originatorKind === "organization" ? "business" : "private"} ${instrumentKind === "participant" ? "participant release" : "loan"} exists in draft but is not published. It is waiting on counsel.`
        : `No published ${originatorKind === "organization" ? "business" : "private"} ${instrumentKind === "participant" ? "participant release" : "loan"} wording for ${row.state}.`,
    );
  }
  if (!row.clause_set_reviewed_at) {
    missing.push(
      `Counsel has not signed off the ${row.state} clause set, so every document prints as a specimen.`,
    );
  }

  return missing;
}

/**
 * How far along a combination is, as one word.
 *
 * `live` is the only one that means a real document with real cover. The
 * intermediate words exist so a matrix can be read at a glance without anybody
 * having to remember which of four booleans is the important one.
 */
export type ReadinessStage = "live" | "specimen" | "no_cover" | "blocked" | "none";

export function stage(
  row: ReadinessRow,
  originatorKind: OriginatorKind = "individual",
  instrumentKind: InstrumentKind = "rental",
): ReadinessStage {
  const canWrite = canOriginate(row, originatorKind, instrumentKind);
  const nothingAtAll =
    !row.carrier_filed &&
    !row.rule_set_published &&
    !row.template_drafted_unpublished &&
    !canWrite;

  if (nothingAtAll) return "none";
  if (!canWrite) return "blocked";
  if (!row.carrier_filed) return "no_cover";
  if (!row.clause_set_reviewed_at) return "specimen";
  return "live";
}

export const STAGE_LABELS: Record<ReadinessStage, string> = {
  live: "Live",
  specimen: "Specimen",
  no_cover: "No cover",
  blocked: "Blocked",
  none: "Not started",
};

export const STAGE_DESCRIPTIONS: Record<ReadinessStage, string> = {
  live: "A real document with real cover behind it.",
  specimen:
    "The document can be produced and cover can be bound, but counsel has not signed off the wording, so it prints as a specimen.",
  no_cover:
    "The document can be produced. There is no approved carrier filing, so nothing can be insured.",
  blocked:
    "Some of the pieces exist and a lender cannot get a document out of it yet.",
  none: "Nothing has been done for this combination.",
};

/**
 * The activities worth offering in a state, in display order.
 *
 * Everything a lender can actually get a document out of. A combination that
 * would refuse them is not in the list, which is the whole change: the form can
 * no longer promise something that fails two screens later.
 */
export function activitiesOpenIn(
  rows: ReadinessRow[],
  state: string,
  originatorKind: OriginatorKind,
  instrumentKind: InstrumentKind = "rental",
): ReadinessRow[] {
  return rows
    .filter((r) => r.state === state && canOriginate(r, originatorKind, instrumentKind))
    .sort((a, b) => a.activity_sort_order - b.activity_sort_order);
}

/**
 * The states worth offering, given that the activity list cascades off them.
 *
 * A state where nothing at all can be written is not offered, even if
 * `state_availability` says it is open: an admitted carrier with no template
 * behind it is a state that looks available and refuses everything. This is
 * stricter than the old `status <> 'unavailable'` filter, and deliberately so.
 */
export function statesOpenFor(
  rows: ReadinessRow[],
  originatorKind: OriginatorKind,
  instrumentKind: InstrumentKind = "rental",
): { state: string; status: string; waiverEfficacy: string }[] {
  const seen = new Map<string, { state: string; status: string; waiverEfficacy: string }>();

  for (const row of rows) {
    if (!canOriginate(row, originatorKind, instrumentKind)) continue;
    if (seen.has(row.state)) continue;
    seen.set(row.state, {
      state: row.state,
      status: row.state_status,
      waiverEfficacy: row.waiver_efficacy,
    });
  }

  return [...seen.values()].sort((a, b) => a.state.localeCompare(b.state));
}
