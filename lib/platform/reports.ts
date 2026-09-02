import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The lender and borrower reports, and the agreement-side headline counts.
 *
 * THE COUNTING HAPPENS IN SQL. Every function here reads a view defined in
 * 20260901000039 rather than pulling rows and adding them up. That is not
 * fastidiousness: PostgREST caps a `.select()` at a page and returns the page
 * without complaining, so a dashboard that sums in TypeScript is exactly correct
 * until the day it silently stops being, and nothing about the screen changes
 * when it does.
 *
 * WHAT IS NOT HERE. No insurance figure. Quotes and policies live on the other
 * side of the coverage boundary (CLAUDE.md constraint 9) and are read by
 * lib/coverage/reporting.ts. The dashboard page imports both and puts them on one
 * screen, which is a person reading two reports; a join between them here would
 * be the boundary quietly ceasing to exist.
 */

/** PostgREST hands back a page at a time. Ask until it stops. */
const PAGE = 1000;

async function everyRow<T>(
  db: SupabaseClient,
  view: string,
  order: { column: string; ascending: boolean },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(view)
      .select("*")
      .order(order.column, { ascending: order.ascending, nullsFirst: false })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`${view}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

// ---------------------------------------------------------------------------
// Lenders
// ---------------------------------------------------------------------------

export type LenderRow = {
  originator_id: string;
  lender_kind: "individual" | "organization";
  channel: "direct" | "partner";
  created_at: string;
  display_name: string;
  trading_name: string | null;
  home_state: string | null;
  plan_tier: string | null;
  managed_by_partner_id: string | null;
  managed_by_partner_name: string | null;
  partner_external_ref: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  agreements_total: number;
  agreements_executed: number;
  agreements_voided: number;
  agreements_open: number;
  distinct_borrowers: number;
  first_agreement_at: string | null;
  last_agreement_at: string | null;
  assets_active: number;
};

export async function listLenders(db: SupabaseClient): Promise<LenderRow[]> {
  // Newest first, because the question asked of this list most often is "who
  // signed up recently"; the console offers the other orderings client-side.
  return everyRow<LenderRow>(db, "platform_lender_report", {
    column: "created_at",
    ascending: false,
  });
}

// ---------------------------------------------------------------------------
// Borrowers
// ---------------------------------------------------------------------------

export type BorrowerRow = {
  email: string;
  display_name: string | null;
  phone: string | null;
  as_borrower: number;
  as_participant: number;
  signed: number;
  declined: number;
  has_account: boolean;
  lenders_used: number;
  states: string[] | null;
  first_seen_at: string | null;
  last_signed_at: string | null;
};

export async function listBorrowers(db: SupabaseClient): Promise<BorrowerRow[]> {
  return everyRow<BorrowerRow>(db, "platform_borrower_report", {
    column: "first_seen_at",
    ascending: false,
  });
}

// ---------------------------------------------------------------------------
// Headline counts
// ---------------------------------------------------------------------------

export type AgreementStats = {
  lenders: number;
  lenders_individual: number;
  lenders_organization: number;
  lenders_partner_managed: number;
  borrowers: number;
  borrowers_signed: number;
  agreements: number;
  agreements_draft: number;
  agreements_out: number;
  agreements_executed: number;
  agreements_voided: number;
  agreements_expired: number;
  agreements_on_hold: number;
  signatures: number;
  agreements_30d: number;
  executed_30d: number;
  assets_active: number;
  last_agreement_at: string | null;
};

const EMPTY_AGREEMENT_STATS: AgreementStats = {
  lenders: 0,
  lenders_individual: 0,
  lenders_organization: 0,
  lenders_partner_managed: 0,
  borrowers: 0,
  borrowers_signed: 0,
  agreements: 0,
  agreements_draft: 0,
  agreements_out: 0,
  agreements_executed: 0,
  agreements_voided: 0,
  agreements_expired: 0,
  agreements_on_hold: 0,
  signatures: 0,
  agreements_30d: 0,
  executed_30d: 0,
  assets_active: 0,
  last_agreement_at: null,
};

export async function agreementStats(db: SupabaseClient): Promise<AgreementStats> {
  const { data } = await db.from("platform_agreement_stats").select("*").maybeSingle();
  return { ...EMPTY_AGREEMENT_STATS, ...((data ?? {}) as Partial<AgreementStats>) };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A spreadsheet of it.
 *
 * Two details that look like fussiness and are not. The BOM is because Excel
 * reads a UTF-8 file as the system codepage without it, and turns every accented
 * name in the export into mojibake. The leading apostrophe guard is because Excel
 * reads a cell beginning `=`, `+`, `-` or `@` as a formula — a display name
 * somebody typed can therefore execute on the machine of whoever opens the
 * export, which is a real and boring way to get hurt.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null): string => {
    if (value === null || value === undefined) return "";
    const raw = String(value);
    const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };

  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `lenders-2026-09-01.csv`. Dated, because an undated export is unfileable. */
export function exportFilename(kind: string): string {
  return `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export function lendersCsv(rows: LenderRow[]): string {
  return toCsv(
    [
      "Lender",
      "Type",
      "Channel",
      "Trading name",
      "State",
      "Plan",
      "Email",
      "Phone",
      "Agreements",
      "Executed",
      "Open",
      "Voided",
      "Distinct borrowers",
      "Active assets",
      "Managed by partner",
      "Partner reference",
      "First agreement",
      "Last agreement",
      "Joined",
    ],
    rows.map((r) => [
      r.display_name,
      r.lender_kind === "organization" ? "Organization" : "Individual",
      r.channel === "partner" ? "Partner-managed" : "Direct",
      r.trading_name,
      r.home_state,
      r.plan_tier,
      r.contact_email,
      r.contact_phone,
      r.agreements_total,
      r.agreements_executed,
      r.agreements_open,
      r.agreements_voided,
      r.distinct_borrowers,
      r.assets_active,
      r.managed_by_partner_name,
      r.partner_external_ref,
      r.first_agreement_at?.slice(0, 10) ?? null,
      r.last_agreement_at?.slice(0, 10) ?? null,
      r.created_at.slice(0, 10),
    ]),
  );
}

export function borrowersCsv(rows: BorrowerRow[]): string {
  return toCsv(
    [
      "Borrower",
      "Email",
      "Phone",
      "As borrower",
      "As participant",
      "Signed",
      "Declined",
      "Lenders",
      "States",
      "Has account",
      "First seen",
      "Last signed",
    ],
    rows.map((r) => [
      r.display_name,
      r.email,
      r.phone,
      r.as_borrower,
      r.as_participant,
      r.signed,
      r.declined,
      r.lenders_used,
      (r.states ?? []).join(" "),
      r.has_account ? "yes" : "no",
      r.first_seen_at?.slice(0, 10) ?? null,
      r.last_signed_at?.slice(0, 10) ?? null,
    ]),
  );
}
