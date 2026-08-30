import "server-only";

import { createHash } from "node:crypto";
import type {
  CoverageContextInput,
  CoverageKind,
} from "@/lib/coverage/contract";

/**
 * The anti-corruption layer around the carrier.
 *
 * The carrier's semantics must never reach the domain model. Everything they send
 * back is kept verbatim in `policies.carrier_payload` for the claims conversation,
 * and everything the rest of the system reads goes through the shapes below.
 *
 * Coverage is mocked for this milestone — behind the real interface, which is the
 * part that matters. When the quote-and-bind API arrives, a second implementation
 * of `CarrierClient` is written and the mock stops being selected. Nothing else
 * changes.
 */

export type CarrierQuote = {
  product_code: string;
  coverage_kind: CoverageKind;
  limit_cents: number | null;
  deductible_cents: number | null;
  premium_cents: number;
  rate_plan_version: string;
  /** The inputs that produced this number, snapshotted for reproduction. */
  rating_inputs: Record<string, unknown>;
  carrier_quote_ref: string;
  expires_at: string;
  summary: string;
};

export type CarrierBind = {
  carrier_policy_number: string;
  effective_at: string;
  expires_at: string;
  payload: Record<string, unknown>;
};

export interface CarrierClient {
  readonly name: string;
  quote(input: {
    context: CoverageContextInput;
    beneficiaryRef: string;
    kinds: CoverageKind[];
  }): Promise<CarrierQuote[]>;
  bind(input: {
    quoteRef: string;
    context: CoverageContextInput;
    coverageKind: CoverageKind;
  }): Promise<CarrierBind>;
}

const RATE_PLAN_VERSION = "mock-2026.08";

function loanDays(startsAt: string, endsAt: string): number {
  const hours =
    (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000;
  return Math.max(1, Math.ceil(hours / 24));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A deterministic stand-in for a real rate plan.
 *
 * Deterministic on purpose: the same inputs must give the same premium every time,
 * because "reproduce the quote you showed" is a question regulators and carriers
 * both ask, and answering it with a random number is not an answer.
 */
export class MockCarrier implements CarrierClient {
  readonly name = "mock-carrier";

  async quote(input: {
    context: CoverageContextInput;
    beneficiaryRef: string;
    kinds: CoverageKind[];
  }): Promise<CarrierQuote[]> {
    const { context } = input;
    const days = loanDays(context.starts_at, context.ends_at);
    const declared = context.asset?.declared_value_cents ?? 0;

    const quotes: CarrierQuote[] = [];

    for (const kind of input.kinds) {
      const ratingInputs = {
        rate_plan_version: RATE_PLAN_VERSION,
        coverage_kind: kind,
        loan_days: days,
        declared_value_cents: declared,
        activity_class: context.activity_class,
        jurisdiction: context.jurisdiction,
        beneficiary_external_ref: input.beneficiaryRef,
        asset_class: context.asset?.asset_class ?? null,
      };

      if (kind === "physical_damage") {
        if (declared <= 0) continue;
        quotes.push({
          product_code: "PWC-DAY-01",
          coverage_kind: kind,
          limit_cents: declared,
          deductible_cents: 25_000,
          premium_cents: clamp(Math.round(declared * 0.004 * days), 2_000, 25_000),
          rate_plan_version: RATE_PLAN_VERSION,
          rating_inputs: { ...ratingInputs, factor: 0.004, deductible_cents: 25_000 },
          carrier_quote_ref: this.ref("PDQ", ratingInputs),
          expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
          summary: `Damage to the watercraft up to its declared value, $250 excess, for the ${days === 1 ? "day" : `${days} days`} of the loan.`,
        });
      }

      if (kind === "liability") {
        quotes.push({
          product_code: "PWC-LIA-01",
          coverage_kind: kind,
          limit_cents: 30_000_000,
          deductible_cents: 0,
          premium_cents: clamp(1_900 * days, 1_900, 15_000),
          rate_plan_version: RATE_PLAN_VERSION,
          rating_inputs: { ...ratingInputs, per_day_cents: 1_900 },
          carrier_quote_ref: this.ref("LIQ", ratingInputs),
          expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
          summary: `Injury or damage you cause to someone else, up to $300,000, for the ${days === 1 ? "day" : `${days} days`} of the loan.`,
        });
      }

      if (kind === "accident_medical") {
        quotes.push({
          product_code: "PWC-MED-01",
          coverage_kind: kind,
          limit_cents: 1_000_000,
          deductible_cents: 0,
          premium_cents: clamp(900 * days, 900, 7_500),
          rate_plan_version: RATE_PLAN_VERSION,
          rating_inputs: { ...ratingInputs, per_day_cents: 900 },
          carrier_quote_ref: this.ref("MEDQ", ratingInputs),
          expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
          summary: `Your own medical costs after an accident on the water, up to $10,000.`,
        });
      }
    }

    return quotes;
  }

  async bind(input: {
    quoteRef: string;
    context: CoverageContextInput;
    coverageKind: CoverageKind;
  }): Promise<CarrierBind> {
    // A real bind is a network call that can fail. The shape here is the shape a
    // real one has to fit into, including keeping the raw response.
    const serial = createHash("sha256")
      .update(input.quoteRef)
      .digest("hex")
      .slice(0, 10)
      .toUpperCase();

    return {
      carrier_policy_number: `MOCK-${input.context.jurisdiction}-${serial}`,
      effective_at: input.context.starts_at,
      expires_at: input.context.ends_at,
      payload: {
        carrier: this.name,
        note: "Mocked bind. No policy exists with any carrier.",
        quote_ref: input.quoteRef,
        coverage_kind: input.coverageKind,
        bound_at: new Date().toISOString(),
      },
    };
  }

  private ref(prefix: string, inputs: Record<string, unknown>): string {
    const digest = createHash("sha256")
      .update(JSON.stringify(inputs, Object.keys(inputs).sort()))
      .digest("hex")
      .slice(0, 12);
    return `${prefix}-${digest.toUpperCase()}`;
  }
}

let client: CarrierClient | null = null;

export function carrierClient(): CarrierClient {
  if (!client) client = new MockCarrier();
  return client;
}
