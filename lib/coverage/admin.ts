import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { isStateCode } from "@/lib/jurisdictions";
import { registeredAdapters } from "@/lib/coverage/carrier";

/**
 * Managing carriers, their products, their filings and their credentials.
 *
 * WHY THIS LIVES UNDER lib/coverage/. Migration 20260901000018 says nothing
 * outside this directory reads the carrier tables, and that has to include the
 * admin console or the sentence means nothing. Note what this module does NOT
 * do: it never imports lib/coverage/service, never quotes, and never touches
 * `quotes` or `policies`. It is the operational face of the same bounded context,
 * not a second way into it.
 *
 * The one rule worth restating loudly: **no carrier secret is ever written to the
 * database.** `carrier_credentials.secret_env_var` holds the NAME of the
 * environment variable, and the database's own check constraint rejects anything
 * that is not shaped like one — so a secret pasted into that field fails visibly
 * rather than being stored.
 */

export type CarrierStatus =
  | "prospect"
  | "contracted"
  | "active"
  | "suspended"
  | "terminated";

export type CarrierKind = "carrier" | "mga" | "fronting" | "surplus_lines";

export type FilingStatus = "not_filed" | "filed" | "approved" | "withdrawn";

export const CARRIER_KINDS: CarrierKind[] = [
  "carrier",
  "mga",
  "fronting",
  "surplus_lines",
];

export const CARRIER_KIND_LABELS: Record<CarrierKind, string> = {
  carrier: "Admitted carrier",
  mga: "MGA / programme manager",
  fronting: "Fronting carrier",
  surplus_lines: "Surplus lines writer",
};

export const CARRIER_STATUSES: CarrierStatus[] = [
  "prospect",
  "contracted",
  "active",
  "suspended",
  "terminated",
];

export const CARRIER_STATUS_LABELS: Record<CarrierStatus, string> = {
  prospect: "Prospect",
  contracted: "Contracted",
  active: "Active — quoting",
  suspended: "Suspended",
  terminated: "Terminated",
};

export const FILING_STATUSES: FilingStatus[] = [
  "not_filed",
  "filed",
  "approved",
  "withdrawn",
];

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  not_filed: "Not filed",
  filed: "Filed, awaiting approval",
  approved: "Approved — may be quoted",
  withdrawn: "Withdrawn",
};

export class CarrierRefused extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export type Carrier = {
  id: string;
  name: string;
  slug: string;
  naic_code: string | null;
  kind: CarrierKind;
  status: CarrierStatus;
  am_best_rating: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  adapter: string;
  notes: string | null;
  created_at: string;
  activated_at: string | null;
};

export async function listCarriers(db: SupabaseClient): Promise<Carrier[]> {
  const { data } = await db
    .from("carriers")
    .select("*")
    .order("status")
    .order("name");
  return (data ?? []) as Carrier[];
}

async function uniqueSlug(db: SupabaseClient, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "carrier";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await db
      .from("carriers")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createCarrier(
  db: SupabaseClient,
  input: {
    name: string;
    kind: CarrierKind;
    naicCode?: string | null;
    adapter?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    notes?: string | null;
  },
): Promise<Carrier> {
  // A carrier is created as a PROSPECT, never active. Only
  // `setCarrierStatus` promotes one, and only once an adapter exists — see the
  // check there. Creating an active carrier in one step is how a row with no
  // client behind it ends up selected to quote.
  const adapter = input.adapter?.trim() || "mock";

  const { data, error } = await db
    .from("carriers")
    .insert({
      name: input.name,
      slug: await uniqueSlug(db, input.name),
      kind: input.kind,
      naic_code: input.naicCode || null,
      adapter,
      contact_name: input.contactName ?? null,
      contact_email: input.contactEmail ?? null,
      notes: input.notes ?? null,
      status: "prospect",
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new CarrierRefused("A carrier with that NAIC code already exists.", 409);
    }
    throw new CarrierRefused(`Could not create the carrier: ${error?.message}`, 500);
  }

  return data as Carrier;
}

/**
 * Promote or demote a carrier.
 *
 * Going `active` is the only transition with a gate on it, because `active` is
 * the word `available_carrier_products` reads. A carrier whose adapter has no
 * implementation would be selected, then dropped at quote time with a log line
 * nobody is watching — so it is refused here, where somebody is looking at it.
 */
export async function setCarrierStatus(
  db: SupabaseClient,
  carrierId: string,
  status: CarrierStatus,
): Promise<void> {
  const { data: carrier } = await db
    .from("carriers")
    .select("id, adapter, activated_at")
    .eq("id", carrierId)
    .maybeSingle();

  if (!carrier) throw new CarrierRefused("No such carrier.", 404);

  if (status === "active" && !registeredAdapters().includes(carrier.adapter)) {
    throw new CarrierRefused(
      `No client is registered for adapter "${carrier.adapter}". Write it and add it to ADAPTERS in lib/coverage/carrier.ts before making this carrier active.`,
      409,
    );
  }

  const { error } = await db
    .from("carriers")
    .update({
      status,
      // Set once, on first activation, and kept — the check constraint requires
      // it and the history of when a carrier first went live is worth keeping.
      activated_at:
        status === "active"
          ? (carrier.activated_at ?? new Date().toISOString())
          : carrier.activated_at,
      suspended_at: status === "suspended" ? new Date().toISOString() : null,
    })
    .eq("id", carrierId);

  if (error) throw new CarrierRefused(`Could not update: ${error.message}`, 500);
}

export type CarrierProduct = {
  id: string;
  carrier_id: string;
  product_code: string;
  coverage_kind: string;
  activity_class: string;
  display_name: string;
  description: string | null;
  default_limit_cents: number | null;
  default_deductible_cents: number | null;
  retired_at: string | null;
};

export async function createProduct(
  db: SupabaseClient,
  input: {
    carrierId: string;
    productCode: string;
    coverageKind: string;
    activityClass: string;
    displayName: string;
    description?: string | null;
    limitCents?: number | null;
    deductibleCents?: number | null;
  },
): Promise<CarrierProduct> {
  const { data, error } = await db
    .from("carrier_products")
    .insert({
      carrier_id: input.carrierId,
      product_code: input.productCode.trim().toUpperCase(),
      coverage_kind: input.coverageKind,
      activity_class: input.activityClass,
      display_name: input.displayName,
      description: input.description ?? null,
      default_limit_cents: input.limitCents ?? null,
      default_deductible_cents: input.deductibleCents ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      // Globally unique on purpose — see the column comment in the migration. A
      // reused code would make an old quote ambiguous about who priced it.
      throw new CarrierRefused(
        "That product code is already in use. Codes are unique across every carrier, because a quote records the code and not a reference.",
        409,
      );
    }
    throw new CarrierRefused(`Could not create the product: ${error?.message}`, 500);
  }

  return data as CarrierProduct;
}

/**
 * Record where a product may be written.
 *
 * The database trigger recomputes `state_availability.carrier_admitted` from this,
 * so nothing else has to be kept in step.
 */
export async function setFiling(
  db: SupabaseClient,
  input: {
    productId: string;
    state: string;
    status: FilingStatus;
    admitted: boolean;
    filingRef?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    notes?: string | null;
    reviewedBy: string;
  },
): Promise<void> {
  const state = input.state.toUpperCase();
  if (!isStateCode(state)) {
    throw new CarrierRefused(`${input.state} is not a state.`, 400);
  }

  if (input.status === "approved" && !input.effectiveFrom) {
    // The database says this too. Saying it here makes it a sentence rather than
    // a constraint violation, and the date is the only thing that lets a quote be
    // checked against the filings in force when it was given.
    throw new CarrierRefused(
      "An approved filing needs the date it took effect.",
      400,
    );
  }

  const { error } = await db.from("carrier_state_filings").upsert(
    {
      product_id: input.productId,
      state,
      status: input.status,
      admitted: input.admitted,
      filing_ref: input.filingRef ?? null,
      effective_from: input.effectiveFrom ?? null,
      effective_to: input.effectiveTo ?? null,
      notes: input.notes ?? null,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id,state" },
  );

  if (error) throw new CarrierRefused(`Could not save the filing: ${error.message}`, 500);
}

/**
 * Point us at a carrier's API, and mint the secret THEY will present to US.
 *
 * Two directions, two treatments, and the asymmetry is the whole point:
 *
 *   * outbound — their key, which we must send in clear on every call. It lives
 *     in the deploy config. We store only the variable's name.
 *   * inbound — the secret they sign webhooks with. We only ever verify it, so we
 *     store a hash and hand back the raw value once, exactly like a partner key.
 */
export async function setCredential(
  db: SupabaseClient,
  input: {
    carrierId: string;
    environment: "sandbox" | "live";
    baseUrl: string | null;
    authKind: "bearer" | "basic" | "hmac" | "mtls";
    secretEnvVar: string | null;
    createdBy: string;
    rotateInboundSecret: boolean;
  },
): Promise<{ inboundSecret: string | null }> {
  if (input.baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(input.baseUrl);
    } catch {
      throw new CarrierRefused("That is not a URL.", 400);
    }
    if (parsed.protocol !== "https:") {
      throw new CarrierRefused("A carrier endpoint has to be https.", 400);
    }
  }

  if (input.secretEnvVar && !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.secretEnvVar)) {
    throw new CarrierRefused(
      "That field takes the NAME of an environment variable (like ACME_CARRIER_API_KEY), never the secret itself.",
      400,
    );
  }

  let inbound: { raw: string; hash: string } | null = null;
  if (input.rotateInboundSecret) {
    const raw = `iwc_${randomBytes(32).toString("base64url")}`;
    inbound = { raw, hash: createHash("sha256").update(raw).digest("hex") };
  }

  // Revoke the current one rather than editing it: what a carrier was reachable
  // at, and with which credential, is the sort of thing a claims dispute asks
  // about a year later.
  await db
    .from("carrier_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("carrier_id", input.carrierId)
    .eq("environment", input.environment)
    .is("revoked_at", null);

  const { error } = await db.from("carrier_credentials").insert({
    carrier_id: input.carrierId,
    environment: input.environment,
    base_url: input.baseUrl,
    auth_kind: input.authKind,
    secret_env_var: input.secretEnvVar,
    inbound_secret_hash: inbound?.hash ?? null,
    created_by: input.createdBy,
    rotated_at: new Date().toISOString(),
  });

  if (error) {
    throw new CarrierRefused(`Could not save the credential: ${error.message}`, 500);
  }

  return { inboundSecret: inbound?.raw ?? null };
}

/** Everything the carrier detail screen shows. Never a secret. */
export async function carrierDetail(db: SupabaseClient, carrierId: string) {
  const [carrier, products, credentials, events] = await Promise.all([
    db.from("carriers").select("*").eq("id", carrierId).maybeSingle(),
    db
      .from("carrier_products")
      .select(
        "id, carrier_id, product_code, coverage_kind, activity_class, display_name, description, default_limit_cents, default_deductible_cents, retired_at, carrier_state_filings(state, status, admitted, effective_from, effective_to, filing_ref, notes)",
      )
      .eq("carrier_id", carrierId)
      .order("product_code"),
    db
      .from("carrier_credentials")
      // Deliberately no `inbound_secret_hash`. There is nothing a screen can do
      // with a hash except leak the fact that one exists in a screenshot.
      .select("id, environment, base_url, auth_kind, secret_env_var, created_at, rotated_at")
      .eq("carrier_id", carrierId)
      .is("revoked_at", null),
    db
      .from("carrier_events")
      .select("id, event_type, external_ref, signature_verified, received_at, processed_at, error")
      .eq("carrier_id", carrierId)
      .order("received_at", { ascending: false })
      .limit(20),
  ]);

  return {
    carrier: (carrier.data ?? null) as Carrier | null,
    products: products.data ?? [],
    credentials: credentials.data ?? [],
    events: events.data ?? [],
  };
}
