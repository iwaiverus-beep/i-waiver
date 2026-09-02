import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The time series behind the Trends screen.
 *
 * DELIBERATELY NOT THE COUNTS. `lib/platform/reports.ts` and
 * `lib/coverage/reporting.ts` own the standing totals and the lender and borrower
 * lists; this module owns the ninety-day series, the volume split and the signing
 * funnel. Two modules reading the same figure is how two screens end up quietly
 * disagreeing about how many agreements exist.
 *
 * All of it comes out of views (20260901000041). Nothing here pulls rows and adds
 * them up in Node — PostgREST truncates a `.select()` at a page boundary without
 * failing, so a dashboard built that way is correct until the day it silently is
 * not, and then it is confidently wrong.
 *
 * The views are revoked from anon and authenticated, so every read needs the
 * service client. `requireStaff("reports.read")` is the authorisation, at the
 * call site.
 */

export type AgreementDay = {
  day: string;
  created: number;
  sent: number;
  executed: number;
  voided: number;
};

export type LenderDay = {
  day: string;
  lenders: number;
  lenders_individual: number;
  lenders_organization: number;
};

export type CoverageDay = {
  day: string;
  quotes: number;
  quoted_premium_cents: number;
  policies: number;
  bound_premium_cents: number;
  payments_paid: number;
  collected_premium_cents: number;
  collected_fee_cents: number;
};

export type StateActivityVolume = {
  state: string;
  activity_class: string;
  agreements: number;
  executed: number;
  voided: number;
  open: number;
  lenders: number;
  cover_requested: number;
  first_at: string | null;
  last_at: string | null;
};

export type SigningFunnel = {
  links_issued: number;
  signed: number;
  declined: number;
  outstanding: number;
  borrower_links: number;
  participant_links: number;
  median_seconds_to_sign: number | null;
};

export type PlatformTrends = {
  agreementDaily: AgreementDay[];
  lenderDaily: LenderDay[];
  coverageDaily: CoverageDay[];
  byStateActivity: StateActivityVolume[];
  funnel: SigningFunnel | null;
};

/**
 * Five small reads in parallel rather than one wide join.
 *
 * The agreement series and the coverage series sit on two sides of a bounded
 * context (CLAUDE.md constraint 9). Joining them in SQL to save a round trip
 * would be the boundary quietly ceasing to exist; a person reading both on one
 * screen is two reports side by side, which was always allowed.
 */
export async function platformTrends(
  db: SupabaseClient,
): Promise<PlatformTrends> {
  const [agreementDaily, lenderDaily, coverageDaily, byStateActivity, funnel] =
    await Promise.all([
      db.from("platform_agreement_daily").select("*").order("day"),
      db.from("platform_lender_daily").select("*").order("day"),
      db.from("platform_coverage_daily").select("*").order("day"),
      db
        .from("platform_agreement_by_state_activity")
        .select("*")
        .order("agreements", { ascending: false }),
      db.from("platform_signing_funnel").select("*").maybeSingle(),
    ]);

  return {
    agreementDaily: (agreementDaily.data ?? []) as AgreementDay[],
    lenderDaily: (lenderDaily.data ?? []) as LenderDay[],
    coverageDaily: (coverageDaily.data ?? []) as CoverageDay[],
    byStateActivity: (byStateActivity.data ?? []) as StateActivityVolume[],
    funnel: (funnel.data ?? null) as SigningFunnel | null,
  };
}

/**
 * Sum a window off the end of a dense daily series.
 *
 * Safe ONLY because the series is dense — one row per day, zeros included
 * (20260901000041). Against a sparse series `slice(-30)` would reach back however
 * far it had to in order to find thirty rows, and quietly compare a quiet month
 * against a busy quarter.
 */
export function sumLast<T>(
  rows: T[],
  days: number,
  pick: (row: T) => number,
): number {
  return rows.slice(-days).reduce((total, row) => total + pick(row), 0);
}

/** The window before that one, so a delta has something to be a delta against. */
export function sumPrevious<T>(
  rows: T[],
  days: number,
  pick: (row: T) => number,
): number {
  const end = rows.length - days;
  if (end <= 0) return 0;
  return rows.slice(Math.max(0, end - days), end).reduce((t, r) => t + pick(r), 0);
}

/** "3 hours", "2 days" — how long a typical borrower takes to sign. */
export function humanDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
