import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The compliance gate.
 *
 * Blocking, not advisory. If a lender is told their borrower is covered and the
 * claim later denies on an eligibility fact that was checkable at signing, the
 * lender looks at us, not at the carrier. So a failing blocking check stops the
 * send or the signature — it does not annotate it.
 *
 * Every check writes a row naming the rule set VERSION it applied, because the
 * question two years from now is not "what do the rules say" but "what did the
 * rules say on the day, and did you apply them".
 */

export type CheckKind =
  | "operator_age"
  | "education_cert"
  | "identity"
  | "jurisdiction_supported";

export type CheckResult = "pass" | "fail" | "warn" | "skipped";

export type Finding = {
  kind: CheckKind;
  result: CheckResult;
  blocking: boolean;
  message: string;
  evidence: Record<string, unknown>;
  signerId?: string | null;
};

export type GateOutcome = {
  ok: boolean;
  findings: Finding[];
  /** Only the ones that stop the operation. */
  blockers: Finding[];
  ruleSetId: string | null;
};

/** The product floor. Distinct from any statutory minimum in the rule set. */
export const MINIMUM_SIGNER_AGE = 18;

export type Attestations = {
  /** Borrower confirmed they are at least MINIMUM_SIGNER_AGE. */
  isAdult?: boolean;
  /** Borrower confirmed they hold the required education card. */
  holdsEducationCard?: boolean;
  educationCardRef?: string | null;
};

async function activeRuleSet(
  db: SupabaseClient,
  state: string,
  activityClass: string,
) {
  const { data } = await db
    .from("jurisdiction_rule_sets")
    .select("*")
    .eq("state", state)
    .eq("activity_class", activityClass)
    .lte("effective_from", new Date().toISOString())
    .or(`effective_to.is.null,effective_to.gt.${new Date().toISOString()}`)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

/**
 * Runs the gate and records what it found.
 *
 * `phase` matters. At `send` the borrower has not yet said anything about
 * themselves, so the facts that depend on them are recorded as skipped and asked
 * for at `sign`. Recording them as passing at send would be a lie with a
 * timestamp on it.
 */
export async function runComplianceGate(
  db: SupabaseClient,
  input: {
    agreementId: string;
    phase: "send" | "sign";
    signerId?: string | null;
    /** Which side is signing. Some facts are the operator's alone. */
    signerRole?: string | null;
    attestations?: Attestations;
  },
): Promise<GateOutcome> {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, jurisdiction, activity_class")
    .eq("id", input.agreementId)
    .single();

  if (!agreement) {
    return {
      ok: false,
      ruleSetId: null,
      findings: [],
      blockers: [
        {
          kind: "jurisdiction_supported",
          result: "fail",
          blocking: true,
          message: "Agreement not found.",
          evidence: {},
        },
      ],
    };
  }

  const findings: Finding[] = [];

  const { data: availability } = await db
    .from("state_availability")
    .select("state, status, waiver_efficacy, product_codes, clause_set_reviewed_at")
    .eq("state", agreement.jurisdiction)
    .maybeSingle();

  const ruleSet = await activeRuleSet(
    db,
    agreement.jurisdiction,
    agreement.activity_class,
  );

  // --- Is this state open at all? -----------------------------------------
  if (!availability || availability.status === "unavailable") {
    findings.push({
      kind: "jurisdiction_supported",
      result: "fail",
      blocking: true,
      message: `We are not open in ${agreement.jurisdiction} for ${agreement.activity_class.replace(/_/g, " ")} yet.`,
      evidence: { state: agreement.jurisdiction, status: availability?.status ?? "unknown" },
    });
  } else if (!ruleSet) {
    findings.push({
      kind: "jurisdiction_supported",
      result: "fail",
      blocking: true,
      message: `No rule set has been published for ${agreement.jurisdiction} / ${agreement.activity_class}.`,
      evidence: { state: agreement.jurisdiction, activity_class: agreement.activity_class },
    });
  } else if (availability.status === "cover_only") {
    // Not a blocker. The cover is sellable and the document is still a record of
    // the loan — it just must not be presented as a shield. The banner on the
    // rendered document is the other half of this.
    findings.push({
      kind: "jurisdiction_supported",
      result: "warn",
      blocking: false,
      message:
        availability.waiver_efficacy === "void"
          ? `${agreement.jurisdiction} does not enforce pre-injury releases. The cover is the protection here; the document is a record.`
          : `The clause set for ${agreement.jurisdiction} has not been through counsel yet, so this is a specimen document.`,
      evidence: {
        status: availability.status,
        waiver_efficacy: availability.waiver_efficacy,
        clause_set_reviewed: false,
      },
    });
  } else {
    findings.push({
      kind: "jurisdiction_supported",
      result: "pass",
      blocking: false,
      message: `${agreement.jurisdiction} is open for ${agreement.activity_class.replace(/_/g, " ")}.`,
      evidence: { status: availability.status, product_codes: availability.product_codes },
    });
  }

  // --- Capacity: adults only ----------------------------------------------
  // A parental pre-injury release is void or near-void in most states, so the
  // minor path is a different product, not a flag. Until it is deliberately
  // built, the gate refuses the capacity outright.
  const { data: signers } = await db
    .from("signers")
    .select("id, role, display_name, capacity")
    .eq("agreement_id", input.agreementId);

  const minors = (signers ?? []).filter((s) => s.capacity !== "adult");
  if (minors.length > 0) {
    findings.push({
      kind: "operator_age",
      result: "fail",
      blocking: true,
      message:
        "This agreement includes a signer who is not an adult. Minors are out of scope until the insurance-first minor product ships.",
      evidence: {
        signers: minors.map((s) => ({ id: s.id, capacity: s.capacity })),
      },
    });
  } else if (input.phase === "sign") {
    const attested = input.attestations?.isAdult === true;
    findings.push({
      kind: "operator_age",
      result: attested ? "pass" : "fail",
      blocking: !attested,
      signerId: input.signerId ?? null,
      message: attested
        ? `Signer confirmed they are ${MINIMUM_SIGNER_AGE} or older.`
        : `Signer must confirm they are ${MINIMUM_SIGNER_AGE} or older.`,
      evidence: {
        attested,
        minimum_age: MINIMUM_SIGNER_AGE,
        statutory_minimum: ruleSet?.min_operator_age ?? null,
        basis: "self-attestation",
      },
    });
  } else {
    findings.push({
      kind: "operator_age",
      result: "skipped",
      blocking: false,
      message: "Age is attested by the signer at signing, not by the lender now.",
      evidence: { deferred_to: "sign" },
    });
  }

  // --- Education certificate ----------------------------------------------
  if (ruleSet?.education_required) {
    // The card belongs to whoever operates the thing, which is the borrower.
    //
    // Put to anybody else it is a question they cannot answer honestly, and a
    // blocking one: for the lender it would lock the only person who can complete
    // the agreement out of signing it, and for a participant riding along it
    // would mean a boat full of families where only the licensed adults are
    // allowed to sign a release — which is precisely the group the release exists
    // to cover.
    // Written as an exclusion rather than as `=== "borrower"` on purpose. A
    // caller that does not name a role still gets asked, which is the old
    // behaviour and the safe direction: asking somebody who does not need the
    // card is a nuisance, not asking somebody who does is a compliance hole.
    const operator =
      input.signerRole !== "lender" && input.signerRole !== "participant";

    if (input.phase === "sign" && !operator) {
      findings.push({
        kind: "education_cert",
        result: "skipped",
        blocking: false,
        signerId: input.signerId ?? null,
        message:
          input.signerRole === "participant"
            ? "The education card is the operator's to hold. This signer is riding along, not driving."
            : "The education card is the borrower's to hold, not the lender's.",
        evidence: {
          role: input.signerRole ?? "unknown",
          authority: ruleSet.education_authority,
          basis: "not-the-operator",
        },
      });
    } else if (input.phase === "sign") {
      const holds = input.attestations?.holdsEducationCard === true;
      findings.push({
        kind: "education_cert",
        result: holds ? "pass" : "fail",
        blocking: !holds,
        signerId: input.signerId ?? null,
        message: holds
          ? `Signer confirmed they hold the required ${ruleSet.education_authority ?? "boating safety"} card.`
          : `${agreement.jurisdiction} requires a boating safety education card for this activity.`,
        evidence: {
          attested: holds,
          authority: ruleSet.education_authority,
          card_ref: input.attestations?.educationCardRef ?? null,
          basis: "self-attestation",
        },
      });
    } else {
      findings.push({
        kind: "education_cert",
        result: "skipped",
        blocking: false,
        message: "Education card is attested by the signer at signing.",
        evidence: { deferred_to: "sign", authority: ruleSet.education_authority },
      });
    }
  }

  // --- Identity ------------------------------------------------------------
  // No IDV vendor is wired yet. Recorded as skipped rather than passed, so the
  // record says what actually happened: nobody checked.
  findings.push({
    kind: "identity",
    result: "skipped",
    blocking: false,
    signerId: input.signerId ?? null,
    message: "Identity verification is not enabled on this deployment.",
    evidence: { vendor: null, reason: "not_configured" },
  });

  // --- Persist -------------------------------------------------------------
  // Rows can only be written against a rule set version. Without one, the
  // jurisdiction check above has already failed blocking, so nothing is lost.
  if (ruleSet) {
    const rows = findings.map((f) => ({
      agreement_id: input.agreementId,
      signer_id: f.signerId ?? null,
      rule_set_id: ruleSet.id,
      check_kind: f.kind,
      result: f.result,
      blocking: f.blocking,
      evidence: { ...f.evidence, phase: input.phase, message: f.message },
    }));

    const { error } = await db.from("compliance_checks").insert(rows);
    if (error) throw new Error(`compliance checks not recorded: ${error.message}`);
  }

  const blockers = findings.filter((f) => f.blocking && f.result === "fail");

  return {
    ok: blockers.length === 0,
    findings,
    blockers,
    ruleSetId: ruleSet?.id ?? null,
  };
}
