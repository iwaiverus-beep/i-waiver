import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { carrierClient } from "@/lib/coverage/carrier";
import type {
  BindRequest,
  BindResponse,
  CoverageKind,
  QuoteRequest,
  QuoteResponse,
} from "@/lib/coverage/contract";

/**
 * The coverage service.
 *
 * This module owns `coverage_contexts`, `quotes`, `policies` and `payments`, and
 * nothing outside it may touch those tables. Everything else reaches it through
 * the HTTP routes under /api/coverage/v1, first-party callers included.
 *
 * On the two columns that do point back at the agreement graph
 * (`quotes.agreement_id`, `quotes.beneficiary_signer_id`): the schema keeps them
 * for first-party reporting, and the database's own check constraint requires
 * `agreement_id` when `source = 'first_party'`. They are WRITTEN here from a
 * reference the caller supplied and are never READ here to make a decision. If
 * you find yourself joining from a quote back into agreements to work out what to
 * do, the boundary has stopped being real.
 */

export type Caller =
  | { source: "first_party" }
  | { source: "partner"; partnerId: string; allowedJurisdictions: string[] };

export class CoverageRejection extends Error {
  constructor(
    message: string,
    readonly status: number = 422,
    readonly detail?: string,
  ) {
    super(message);
  }
}

const DEFAULT_KINDS: CoverageKind[] = [
  "physical_damage",
  "liability",
  "accident_medical",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateContext(request: QuoteRequest, caller: Caller) {
  const c = request.context;

  if (!c || typeof c !== "object") {
    throw new CoverageRejection("A coverage context is required.", 400);
  }
  if (!/^[A-Z]{2}$/.test(c.jurisdiction ?? "")) {
    throw new CoverageRejection("jurisdiction must be a two-letter state code.", 400);
  }
  if (!c.activity_class) {
    throw new CoverageRejection("activity_class is required.", 400);
  }
  if (!c.starts_at || !c.ends_at) {
    throw new CoverageRejection("starts_at and ends_at are required.", 400);
  }
  if (new Date(c.ends_at) <= new Date(c.starts_at)) {
    throw new CoverageRejection("ends_at must be after starts_at.", 400);
  }
  if (!Array.isArray(c.parties) || c.parties.length === 0) {
    throw new CoverageRejection("At least one party is required.", 400);
  }
  if (!c.parties.some((p) => p.external_ref === request.beneficiary_external_ref)) {
    throw new CoverageRejection(
      "beneficiary_external_ref must name one of the parties.",
      400,
    );
  }
  if (
    caller.source === "partner" &&
    caller.allowedJurisdictions.length > 0 &&
    !caller.allowedJurisdictions.includes(c.jurisdiction)
  ) {
    throw new CoverageRejection(
      `This integration is not enabled for ${c.jurisdiction}.`,
      403,
    );
  }
}

/**
 * Is the carrier actually admitted here?
 *
 * Availability is a fact about the carrier's filings, not about our appetite, so
 * it is checked before a price is ever shown. Quoting in a state the carrier
 * cannot write in produces a number nobody can honour.
 */
async function assertStateOpen(db: SupabaseClient, state: string) {
  const { data } = await db
    .from("state_availability")
    .select("state, status, carrier_admitted, product_codes")
    .eq("state", state)
    .maybeSingle();

  if (!data || !data.carrier_admitted) {
    throw new CoverageRejection(
      `No admitted product in ${state}.`,
      422,
      "carrier_not_admitted",
    );
  }
  return data;
}

export async function createQuote(
  request: QuoteRequest,
  caller: Caller,
): Promise<QuoteResponse> {
  validateContext(request, caller);

  const db = serviceClient();
  const context = request.context;
  await assertStateOpen(db, context.jurisdiction);

  // First-party quotes must carry the reference the schema's check constraint
  // requires. Partner quotes must not: they have no agreement at all.
  const originating =
    caller.source === "first_party" ? request.context.originating_reference : null;

  if (caller.source === "first_party" && (!originating || !UUID.test(originating))) {
    throw new CoverageRejection(
      "First-party callers must supply originating_reference.",
      400,
    );
  }

  const { data: contextRow, error: contextError } = await db
    .from("coverage_contexts")
    .insert({
      source: caller.source,
      partner_id: caller.source === "partner" ? caller.partnerId : null,
      external_ref: originating,
      activity_class: context.activity_class,
      jurisdiction: context.jurisdiction,
      starts_at: context.starts_at,
      ends_at: context.ends_at,
      parties: context.parties,
      asset: context.asset ?? null,
      supplemental: context.supplemental ?? {},
    })
    .select("id")
    .single();

  if (contextError || !contextRow) {
    throw new CoverageRejection(
      "Could not record the coverage context.",
      500,
      contextError?.message,
    );
  }

  const kinds = (request.kinds?.length ? request.kinds : DEFAULT_KINDS).filter(
    (k): k is CoverageKind =>
      ["physical_damage", "liability", "accident_medical", "deductible_reimbursement"].includes(k),
  );

  const carrier = carrierClient();
  const carrierQuotes = await carrier.quote({
    context,
    beneficiaryRef: request.beneficiary_external_ref,
    kinds,
  });

  if (carrierQuotes.length === 0) {
    return {
      coverage_context_id: contextRow.id,
      beneficiary_external_ref: request.beneficiary_external_ref,
      options: [],
    };
  }

  const beneficiaryIsSigner =
    caller.source === "first_party" && UUID.test(request.beneficiary_external_ref);

  const rows = carrierQuotes.map((q) => ({
    coverage_context_id: contextRow.id,
    // Written for first-party reporting. Never read back to make a decision.
    agreement_id: caller.source === "first_party" ? originating : null,
    beneficiary_signer_id: beneficiaryIsSigner ? request.beneficiary_external_ref : null,
    source: caller.source,
    product_code: q.product_code,
    coverage_kind: q.coverage_kind,
    limit_cents: q.limit_cents,
    deductible_cents: q.deductible_cents,
    premium_cents: q.premium_cents,
    // Snapshot every input: any quote ever shown must be reproducible.
    rating_inputs: q.rating_inputs,
    rate_plan_version: q.rate_plan_version,
    carrier_quote_ref: q.carrier_quote_ref,
    expires_at: q.expires_at,
  }));

  const { data: saved, error: quoteError } = await db
    .from("quotes")
    .insert(rows)
    .select("id, product_code, coverage_kind, limit_cents, deductible_cents, premium_cents, rate_plan_version, expires_at");

  if (quoteError || !saved) {
    throw new CoverageRejection("Could not record quotes.", 500, quoteError?.message);
  }

  const summaries = new Map(carrierQuotes.map((q) => [q.product_code, q.summary]));

  return {
    coverage_context_id: contextRow.id,
    beneficiary_external_ref: request.beneficiary_external_ref,
    options: saved.map((row) => ({
      quote_id: row.id,
      product_code: row.product_code,
      coverage_kind: row.coverage_kind,
      limit_cents: row.limit_cents,
      deductible_cents: row.deductible_cents,
      premium_cents: row.premium_cents,
      rate_plan_version: row.rate_plan_version,
      expires_at: row.expires_at,
      summary: summaries.get(row.product_code) ?? "",
    })),
  };
}

export async function bindQuotes(
  request: BindRequest,
  caller: Caller,
): Promise<BindResponse> {
  if (!Array.isArray(request.quote_ids) || request.quote_ids.length === 0) {
    throw new CoverageRejection("quote_ids is required.", 400);
  }

  const db = serviceClient();

  const { data: quotes, error } = await db
    .from("quotes")
    .select(
      "id, coverage_context_id, agreement_id, beneficiary_signer_id, source, product_code, coverage_kind, premium_cents, expires_at, carrier_quote_ref, coverage_contexts(id, partner_id, activity_class, jurisdiction, starts_at, ends_at, parties, asset, supplemental)",
    )
    .in("id", request.quote_ids);

  if (error) throw new CoverageRejection("Could not load quotes.", 500, error.message);
  if (!quotes || quotes.length !== request.quote_ids.length) {
    throw new CoverageRejection("One or more quotes could not be found.", 404);
  }

  const collector = request.collector ?? "carrier";
  const carrier = carrierClient();
  const bound: BindResponse["policies"] = [];
  let total = 0;

  for (const quote of quotes) {
    // A caller may only bind its own quotes. For a partner that is its partner_id;
    // for first-party it is any quote the coverage service recorded as first-party.
    const ctx = (Array.isArray(quote.coverage_contexts)
      ? quote.coverage_contexts[0]
      : quote.coverage_contexts) as any;

    if (caller.source === "partner" && ctx?.partner_id !== caller.partnerId) {
      throw new CoverageRejection("That quote belongs to another integration.", 403);
    }
    if (caller.source === "first_party" && quote.source !== "first_party") {
      throw new CoverageRejection("That quote belongs to a partner integration.", 403);
    }

    if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
      throw new CoverageRejection(
        "That quote has expired. Request a new one.",
        409,
        quote.id,
      );
    }

    const { data: existing } = await db
      .from("policies")
      .select("id, carrier_policy_number, status, effective_at, expires_at")
      .eq("quote_id", quote.id)
      .maybeSingle();

    // Binding twice is a network retry, not a second policy.
    if (existing) {
      bound.push({
        policy_id: existing.id,
        quote_id: quote.id,
        carrier_policy_number: existing.carrier_policy_number,
        coverage_kind: quote.coverage_kind,
        premium_cents: quote.premium_cents,
        effective_at: existing.effective_at,
        expires_at: existing.expires_at,
        status: existing.status,
      });
      total += quote.premium_cents;
      continue;
    }

    const result = await carrier.bind({
      quoteRef: quote.carrier_quote_ref ?? quote.id,
      context: {
        activity_class: ctx.activity_class,
        jurisdiction: ctx.jurisdiction,
        starts_at: ctx.starts_at,
        ends_at: ctx.ends_at,
        parties: ctx.parties,
        asset: ctx.asset,
      },
      coverageKind: quote.coverage_kind,
    });

    const { data: policy, error: policyError } = await db
      .from("policies")
      .insert({
        quote_id: quote.id,
        insured_signer_id: quote.beneficiary_signer_id,
        source: quote.source,
        carrier_policy_number: result.carrier_policy_number,
        status: "bound",
        effective_at: result.effective_at,
        expires_at: result.expires_at,
        // Kept verbatim. The claims conversation happens in their language.
        carrier_payload: result.payload,
      })
      .select("id, carrier_policy_number, status, effective_at, expires_at")
      .single();

    if (policyError || !policy) {
      throw new CoverageRejection(
        "The carrier bound the cover but it could not be recorded.",
        500,
        policyError?.message,
      );
    }

    // Premium and platform fee are split from day one. `carrier` as collector
    // keeps us out of fiduciary trust accounting; `platform` sits behind the same
    // interface for when that changes.
    await db.from("payments").insert({
      agreement_id: quote.agreement_id,
      quote_id: quote.id,
      payer_signer_id: quote.beneficiary_signer_id,
      premium_cents: quote.premium_cents,
      platform_fee_cents: 0,
      collector,
      fiduciary: collector === "platform",
      processor: collector === "carrier" ? "carrier-direct" : null,
      status: "pending",
    });

    total += quote.premium_cents;
    bound.push({
      policy_id: policy.id,
      quote_id: quote.id,
      carrier_policy_number: policy.carrier_policy_number,
      coverage_kind: quote.coverage_kind,
      premium_cents: quote.premium_cents,
      effective_at: policy.effective_at,
      expires_at: policy.expires_at,
      status: policy.status,
    });
  }

  return { policies: bound, total_premium_cents: total, collector };
}
