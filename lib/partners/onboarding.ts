import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The path from "approved" to "live".
 *
 * The steps live here rather than in the database — see the note in migration
 * 20260901000015 for why — and `partner_onboarding` records only which of them a
 * given partner has completed.
 *
 * Two kinds of step, and the difference is the whole design. An `observed` step
 * is one the system can see happen: a key was issued, a sandbox quote returned
 * options, a bind succeeded. Nobody ticks those, and nobody can tick them early.
 * An `attested` step is a person saying yes — the contract is signed, the states
 * have been checked, counsel is happy. Recording those two kinds identically
 * would let a checklist look complete when the only thing that had happened was
 * that somebody clicked.
 *
 * Order is the order a partner meets them, and `blocksGoLive` marks the ones that
 * are not negotiable before a live key is issued.
 */

export type OnboardingKind = "observed" | "attested";

export type OnboardingStep = {
  key: string;
  title: string;
  /** What the partner sees. Written to them, not about them. */
  description: string;
  kind: OnboardingKind;
  /** Who completes it: the partner, our staff, or the system. */
  owner: "partner" | "staff" | "system";
  blocksGoLive: boolean;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "application_approved",
    title: "Application approved",
    description: "We have reviewed your application and opened an account.",
    kind: "attested",
    owner: "staff",
    blocksGoLive: true,
  },
  {
    key: "team_invited",
    title: "Your team has access",
    description:
      "Invite whoever is doing the integration. They sign in with their own email address — there is no shared login.",
    kind: "observed",
    owner: "partner",
    blocksGoLive: false,
  },
  {
    key: "sandbox_key_issued",
    title: "Sandbox key issued",
    description:
      "A sandbox key quotes and binds against a mock carrier. Nothing it produces is a real policy, and it can be wiped at any time.",
    kind: "observed",
    owner: "partner",
    blocksGoLive: true,
  },
  {
    key: "sandbox_quote_ok",
    title: "First sandbox quote",
    description:
      "You have called POST /api/coverage/v1/quote successfully and got options back.",
    kind: "observed",
    owner: "partner",
    blocksGoLive: true,
  },
  {
    key: "sandbox_bind_ok",
    title: "First sandbox bind",
    description:
      "You have turned a quote into a policy. This is the whole integration; everything after it is presentation.",
    kind: "observed",
    owner: "partner",
    blocksGoLive: true,
  },
  {
    key: "branding_approved",
    title: "Branding approved",
    description:
      "Your logo and colours appear alongside ours in the embedded surface. We check them because the offer is made in our name.",
    kind: "attested",
    owner: "staff",
    blocksGoLive: false,
  },
  {
    key: "webhook_verified",
    title: "Webhook receiving",
    description:
      "Your endpoint acknowledged a signed test delivery, so you will hear about a policy that changes after it was bound.",
    kind: "observed",
    owner: "partner",
    blocksGoLive: false,
  },
  {
    key: "agreement_signed",
    title: "Partner agreement signed",
    description:
      "The commercial terms, including how you are compensated. Never a share of premium — see the note in the data model.",
    kind: "attested",
    owner: "staff",
    blocksGoLive: true,
  },
  {
    key: "jurisdictions_confirmed",
    title: "States confirmed",
    description:
      "The states your live key may quote in. Set by us against the carrier's filings, not by appetite.",
    kind: "attested",
    owner: "staff",
    blocksGoLive: true,
  },
  {
    key: "compliance_review",
    title: "Compliance sign-off",
    description:
      "Somebody with the compliance role has looked at how the offer is presented in your product.",
    kind: "attested",
    owner: "staff",
    blocksGoLive: true,
  },
  {
    key: "live_key_issued",
    title: "Live key issued",
    description: "You are in production.",
    kind: "observed",
    owner: "staff",
    blocksGoLive: false,
  },
];

export const ONBOARDING_STEP_KEYS = ONBOARDING_STEPS.map((s) => s.key);

export type OnboardingProgress = {
  step: OnboardingStep;
  completedAt: string | null;
  note: string | null;
};

export async function onboardingFor(
  db: SupabaseClient,
  partnerId: string,
): Promise<OnboardingProgress[]> {
  const { data } = await db
    .from("partner_onboarding")
    .select("step, completed_at, note")
    .eq("partner_id", partnerId);

  const done = new Map(
    (data ?? []).map((row) => [row.step as string, row]),
  );

  return ONBOARDING_STEPS.map((step) => ({
    step,
    completedAt: done.get(step.key)?.completed_at ?? null,
    note: done.get(step.key)?.note ?? null,
  }));
}

/** What is still outstanding before a live key may be issued. */
export function blockersFor(progress: OnboardingProgress[]): OnboardingStep[] {
  return progress
    .filter((p) => p.step.blocksGoLive && !p.completedAt)
    .map((p) => p.step);
}

/**
 * Record a step as done.
 *
 * Idempotent, because the observed steps are recorded from the middle of other
 * operations — a partner's tenth sandbox quote should not fail because their
 * first one already ticked the box. `ignoreDuplicates` turns the unique index
 * into "the first time is the one that counts", which is the honest reading of
 * "first sandbox quote".
 */
export async function completeStep(
  db: SupabaseClient,
  input: {
    partnerId: string;
    step: string;
    completedBy?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { error } = await db.from("partner_onboarding").upsert(
    {
      partner_id: input.partnerId,
      step: input.step,
      completed_by: input.completedBy ?? null,
      note: input.note ?? null,
    },
    { onConflict: "partner_id,step", ignoreDuplicates: true },
  );

  if (error) {
    console.error(`onboarding step ${input.step} not recorded:`, error.message);
  }
}
