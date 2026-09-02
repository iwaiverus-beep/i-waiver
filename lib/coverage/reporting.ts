import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What was quoted, what was bought, and what it cost.
 *
 * WHY THIS IS A SEPARATE FILE FROM lib/platform/reports.ts. The coverage domain
 * is its own bounded context (CLAUDE.md constraint 9): the agreements side learns
 * what cover exists from its own audit events, never by querying `quotes`. If the
 * insurance numbers lived in the platform report module, the first person needing
 * "executed agreements that also bought cover" would write that join in an
 * afternoon and the boundary would be gone.
 *
 * So the two modules do not import each other, and neither view underneath them
 * joins across. The admin dashboard reads both and puts the numbers side by side,
 * which is a person comparing two reports — the thing the boundary was always
 * meant to allow.
 *
 * LIVE ONLY. `platform_coverage_stats` filters `environment = 'live'` in SQL.
 * Sandbox quotes exist so a partner can build against us before a filing lands;
 * counting them as business would make every figure on this screen fiction. The
 * sandbox total is carried in its own field so it is visible as what it is.
 */

export type CoverageStats = {
  quotes: number;
  quotes_partner: number;
  quoted_premium_cents: number;
  policies: number;
  policies_bound: number;
  policies_active: number;
  policies_cancelled: number;
  bound_premium_cents: number;
  collected_premium_cents: number;
  collected_fee_cents: number;
  payments_paid: number;
  payments_refunded: number;
  coverage_contexts: number;
  sandbox_quotes: number;
  last_quote_at: string | null;
};

const EMPTY: CoverageStats = {
  quotes: 0,
  quotes_partner: 0,
  quoted_premium_cents: 0,
  policies: 0,
  policies_bound: 0,
  policies_active: 0,
  policies_cancelled: 0,
  bound_premium_cents: 0,
  collected_premium_cents: 0,
  collected_fee_cents: 0,
  payments_paid: 0,
  payments_refunded: 0,
  coverage_contexts: 0,
  sandbox_quotes: 0,
  last_quote_at: null,
};

export async function coverageStats(db: SupabaseClient): Promise<CoverageStats> {
  const { data } = await db.from("platform_coverage_stats").select("*").maybeSingle();
  return { ...EMPTY, ...((data ?? {}) as Partial<CoverageStats>) };
}

export type ProductStats = {
  product_code: string;
  coverage_kind: string;
  display_name: string | null;
  carrier_name: string | null;
  quotes: number;
  policies: number;
  quoted_premium_cents: number;
  bound_premium_cents: number;
};

export async function coverageByProduct(db: SupabaseClient): Promise<ProductStats[]> {
  const { data } = await db
    .from("platform_coverage_by_product")
    .select("*")
    .order("quotes", { ascending: false });
  return (data ?? []) as ProductStats[];
}

/**
 * How much of what we offered was taken.
 *
 * Measured per quote, not per agreement, for the reason `quotes` is commented
 * with in the schema: both parties may buy, so two policies against one agreement
 * are two sales. An attach rate divided by agreements understates it by half in
 * exactly the case worth understanding.
 *
 * Null rather than zero when nothing has been quoted. A brand new platform has no
 * attach rate; showing "0%" says we offered cover and nobody wanted it.
 */
export function attachRate(stats: CoverageStats): number | null {
  if (stats.quotes === 0) return null;
  return stats.policies / stats.quotes;
}

/** `$136.00`. Cents in the database, always; formatting only at the edge. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
