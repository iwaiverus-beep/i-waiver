import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import { carrierClient } from "@/lib/coverage/carrier";
import type { CarrierQuote } from "@/lib/coverage/carrier";
import { availableProducts, groupByCarrier } from "@/lib/coverage/carriers";
import type { AvailableProduct } from "@/lib/coverage/carriers";
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

/**
 * Sandbox and live.
 *
 * Resolved from the credential in lib/coverage/auth.ts and never from anything
 * the caller sends. It is carried onto every row this module writes, so a
 * partner's test traffic can be excluded from reporting and deleted outright
 * without any statement ever having to distinguish it by inspection.
 */
export type ApiEnvironment = "sandbox" | "live";

export type Caller =
  | { source: "first_party"; environment: "live" }
  | {
      source: "partner";
      partnerId: string;
      integrationId: string;
      environment: ApiEnvironment;
      allowedJurisdictions: string[];
    };

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
 * What may actually be written here, or a refusal.
 *
 * Availability is a fact about a carrier's FILINGS, not about our appetite, so it
 * is checked before a price is ever shown: quoting in a state nobody has filed in
 * produces a number nobody can honour.
 *
 * Before 20260901000018 this asked `state_availability.carrier_admitted`, a
 * boolean that assumed one anonymous carrier forever. It now asks
 * `available_carrier_products`, which answers the question that actually matters —
 * WHO may write WHAT, here, today — and returns enough to route each product to
 * the client that priced it.
 */
async function openProducts(
  db: SupabaseClient,
  input: { state: string; activityClass: string; environment: ApiEnvironment },
): Promise<AvailableProduct[]> {
  const products = await availableProducts(db, {
    state: input.state,
    activityClass: input.activityClass,
    environment: input.environment,
  });

  if (products.length > 0) return products;

  // A sandbox call is allowed to quote where nothing is filed, and this is the
  // one place the two environments genuinely differ. The reason is that a partner
  // has to be able to finish their integration before their states open —
  // otherwise the sequencing is: sign the contract, wait for a filing, then start
  // building. What they must never get is a sandbox that lies about live: the
  // response says `sandbox`, every summary says so in words, and the policy
  // number the mock returns starts MOCK-.
  //
  // Reaching here in sandbox means something else is wrong — no mock product
  // exists for that activity class at all — so the message says so rather than
  // pretending the state is the problem.
  if (input.environment === "sandbox") {
    throw new CoverageRejection(
      `Nothing to quote for ${input.activityClass}. The sandbox has no product for that activity class.`,
      422,
      "no_sandbox_product",
    );
  }

  throw new CoverageRejection(
    `No admitted product for ${input.activityClass} in ${input.state}.`,
    422,
    "carrier_not_admitted",
  );
}

export async function createQuote(
  request: QuoteRequest,
  caller: Caller,
): Promise<QuoteResponse> {
  validateContext(request, caller);

  const db = serviceClient();
  const context = request.context;
  const environment = caller.environment;
  const products = await openProducts(db, {
    state: context.jurisdiction,
    activityClass: context.activity_class,
    environment,
  });

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
      environment,
      partner_id: caller.source === "partner" ? caller.partnerId : null,
      external_ref: originating,
      activity_class: context.activity_class,
      jurisdiction: context.jurisdiction,
      starts_at: context.starts_at,
      ends_at: context.ends_at,
      parties: context.parties,
      asset: context.asset ?? null,
      // Persisted so a quote can be reproduced from the row alone. Null for a
      // single item, which is what every context recorded before bundles
      // existed already looks like.
      assets: context.assets?.length ? context.assets : null,
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

  // Every carrier that filed something we were asked for, each quoted by its own
  // client. See lib/coverage/carriers.ts for why this is per product rather than
  // per carrier: physical damage on one carrier's paper and liability on
  // another's is an ordinary programme, not an edge case.
  const groups = groupByCarrier(products, kinds);

  const carrierQuotes: (CarrierQuote & { carrier_id: string })[] = [];

  for (const group of groups) {
    let produced: CarrierQuote[];
    try {
      produced = await group.client.quote({
        context,
        beneficiaryRef: request.beneficiary_external_ref,
        kinds: group.kinds,
      });
    } catch (error) {
      // One carrier being unreachable degrades the quote rather than failing it.
      // A signer looking at a screen is better served by the two options we could
      // price than by an error about the third.
      console.error(
        `carrier ${group.carrierName} failed to quote:`,
        (error as Error).message,
      );
      continue;
    }

    for (const quote of produced) {
      // A client may return more than it is filed for — the mock always returns
      // its full catalogue. The filing is the authority, so anything not filed in
      // this state is dropped here rather than shown and then refused at bind.
      if (!group.productCodes.has(quote.product_code)) continue;
      carrierQuotes.push({ ...quote, carrier_id: group.carrierId });
    }
  }

  if (carrierQuotes.length === 0) {
    return {
      coverage_context_id: contextRow.id,
      environment,
      beneficiary_external_ref: request.beneficiary_external_ref,
      options: [],
    };
  }

  const beneficiaryIsSigner =
    caller.source === "first_party" && UUID.test(request.beneficiary_external_ref);

  const rows = carrierQuotes.map((q) => ({
    coverage_context_id: contextRow.id,
    environment,
    // Written for first-party reporting. Never read back to make a decision.
    agreement_id: caller.source === "first_party" ? originating : null,
    beneficiary_signer_id: beneficiaryIsSigner ? request.beneficiary_external_ref : null,
    source: caller.source,
    // Whose paper this price is on. Binding follows it, so a multi-carrier quote
    // never has to guess which client to call.
    carrier_id: q.carrier_id,
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
    environment,
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
      // The label travels with the number. A partner rendering `summary` into
      // their own UI during development gets a screen that says out loud it is
      // not real, without having to read the environment field to find out.
      summary: sandboxLabelled(summaries.get(row.product_code) ?? "", environment),
    })),
  };
}

/** Prefixes a customer-facing string so a test can never be mistaken for a sale. */
function sandboxLabelled(summary: string, environment: ApiEnvironment): string {
  return environment === "sandbox" ? `[SANDBOX — not real cover] ${summary}` : summary;
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
      "id, coverage_context_id, agreement_id, beneficiary_signer_id, source, environment, carrier_id, product_code, coverage_kind, premium_cents, expires_at, carrier_quote_ref, carriers(id, adapter), coverage_contexts(id, partner_id, activity_class, jurisdiction, starts_at, ends_at, parties, asset, assets, supplemental)",
    )
    .in("id", request.quote_ids);

  if (error) throw new CoverageRejection("Could not load quotes.", 500, error.message);
  if (!quotes || quotes.length !== request.quote_ids.length) {
    throw new CoverageRejection("One or more quotes could not be found.", 404);
  }

  const collector = request.collector ?? "carrier";
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

    // A key binds only what a key of its own environment quoted. Without this,
    // the first mistake anyone makes in integration — sandbox key in one config
    // file, live key in another — turns a test into a real policy, or a real
    // quote into a row that a sandbox purge would silently delete.
    if (quote.environment !== caller.environment) {
      throw new CoverageRejection(
        `That quote was created in ${quote.environment}. Bind it with a ${quote.environment} key.`,
        409,
        "environment_mismatch",
      );
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

    // Bind with whoever priced it. `carriers(adapter)` comes along on the quote
    // rather than being looked up, so a bind can never be routed to a different
    // carrier from the one whose number the customer was shown.
    //
    // A null carrier_id is a quote written before 20260901000018, when there was
    // one anonymous carrier and it was the mock. Reading it as the mock is what
    // actually happened; guessing anything else would be inventing history.
    const quoteCarrier = (Array.isArray(quote.carriers)
      ? quote.carriers[0]
      : quote.carriers) as { id: string; adapter: string } | null;

    const carrier = carrierClient(quoteCarrier?.adapter ?? "mock");

    const result = await carrier.bind({
      quoteRef: quote.carrier_quote_ref ?? quote.id,
      context: {
        activity_class: ctx.activity_class,
        jurisdiction: ctx.jurisdiction,
        starts_at: ctx.starts_at,
        ends_at: ctx.ends_at,
        parties: ctx.parties,
        asset: ctx.asset,
        // Bind against the same schedule the quote was priced against. Rebuilt
        // from the stored context, never from the agreement it came from.
        assets: ctx.assets,
      },
      coverageKind: quote.coverage_kind,
    });

    const { data: policy, error: policyError } = await db
      .from("policies")
      .insert({
        quote_id: quote.id,
        insured_signer_id: quote.beneficiary_signer_id,
        source: quote.source,
        environment: quote.environment,
        carrier_id: quote.carrier_id,
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
      environment: quote.environment,
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

  return {
    policies: bound,
    total_premium_cents: total,
    collector,
    environment: caller.environment,
  };
}
