/**
 * The coverage service's public contract.
 *
 * CLAUDE.md constraint 9: coverage is a separate bounded context. This file is the
 * whole of what crosses the boundary, and it is deliberately written as though the
 * caller were a stranger — because one day it will be. It imports nothing from the
 * agreement side and names nothing from it. There is no `agreement_id` in a
 * request and no `signer_id`; a party is described, not referenced.
 *
 * The first-party agreements app calls the same HTTP endpoints, with a credential
 * of its own, and gets no privileges a partner would not get. A shortcut here
 * would mean the contract had never actually been tested by anyone.
 */

export type CoverageKind =
  | "physical_damage"
  | "liability"
  | "accident_medical"
  | "deductible_reimbursement";

export type PartyRole = "lender" | "borrower" | "co_signer" | "witness";

/** How a party is described across the boundary. No account, no foreign key. */
export type CoverageParty = {
  /** The caller's own handle for this person. Opaque to the coverage service. */
  external_ref: string;
  name: string;
  role: PartyRole;
  email?: string | null;
  phone?: string | null;
  /** Bands, not birthdays. The carrier's bind payload wants a band. */
  age_band?: "18-24" | "25-34" | "35-49" | "50-64" | "65+" | null;
  identity_verified?: boolean;
};

export type CoverageAsset = {
  asset_class: string;
  description: string;
  declared_value_cents: number | null;
  identifier?: string | null;
  year?: number | null;
};

/** The normalised description of what is being covered. */
export type CoverageContextInput = {
  activity_class: string;
  /** State where the activity happens. */
  jurisdiction: string;
  starts_at: string;
  ends_at: string;
  parties: CoverageParty[];
  asset?: CoverageAsset | null;
  /**
   * Anything the caller knows that the core does not ask for. A wrong guess about
   * the carrier's bind payload lands here rather than forcing a schema change or a
   * renegotiated partner contract.
   */
  supplemental?: Record<string, unknown>;
  /** First-party reporting only. Never read across the boundary. */
  originating_reference?: string | null;
};

export type QuoteRequest = {
  context: CoverageContextInput;
  /** Which party the cover is for. Both parties may buy — two policies, not one. */
  beneficiary_external_ref: string;
  kinds?: CoverageKind[];
};

export type QuoteOption = {
  quote_id: string;
  product_code: string;
  coverage_kind: CoverageKind;
  limit_cents: number | null;
  deductible_cents: number | null;
  premium_cents: number;
  rate_plan_version: string;
  expires_at: string;
  /** Plain-language summary for the signing screen. */
  summary: string;
};

export type QuoteResponse = {
  coverage_context_id: string;
  beneficiary_external_ref: string;
  options: QuoteOption[];
};

export type BindRequest = {
  quote_ids: string[];
  /** Who pays, and how. `carrier` avoids fiduciary trust accounting entirely. */
  collector?: "carrier" | "platform";
};

export type BoundPolicy = {
  policy_id: string;
  quote_id: string;
  carrier_policy_number: string;
  coverage_kind: CoverageKind;
  premium_cents: number;
  effective_at: string;
  expires_at: string;
  status: string;
};

export type BindResponse = {
  policies: BoundPolicy[];
  total_premium_cents: number;
  collector: "carrier" | "platform";
};

export type CoverageError = { error: string; detail?: string };

/** Age band from a date of birth, for callers that hold one. */
export function ageBand(age: number): CoverageParty["age_band"] {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 50) return "35-49";
  if (age < 65) return "50-64";
  return "65+";
}
