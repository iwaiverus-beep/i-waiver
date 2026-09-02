/**
 * Environment access.
 *
 * Every value is read through a function, never a module-level constant. Next
 * evaluates modules at build time, and a missing variable should fail the request
 * that needed it with a message naming the variable — not fail the build with a
 * stack trace pointing at an import.
 *
 * The one rule from .env.local holds here too: NEXT_PUBLIC_ is shipped to
 * the browser. Nothing in this file that lacks that prefix may ever be read from a
 * client component.
 */

import { createHash } from "node:crypto";

import { BRAND } from "@/lib/brand";

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `Missing environment variable ${name}. Add it to .env.local.`,
    );
    this.name = "MissingEnvError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new MissingEnvError(name);
  return value;
}

function optional(name: string): string | null {
  return process.env[name] || null;
}

/** Safe in the browser. */
export const supabaseUrl = () => required("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/** Server only. Bypasses RLS — never import into a client component. */
export const supabaseServiceRoleKey = () =>
  required("SUPABASE_SERVICE_ROLE_KEY");

/**
 * Mixed into every signing-link token hash. Rotating it invalidates every
 * outstanding link at once, which is the intended emergency lever.
 */
export const signingLinkPepper = () => required("SIGNING_LINK_TOKEN_PEPPER");

/**
 * The credential the first-party app presents to the coverage service.
 *
 * Coverage is a separate bounded context reached over HTTP, so the agreements app
 * needs a credential of its own — it is a caller like any other. Deriving a
 * default from the service role key keeps a fresh checkout working without a
 * second secret to set, while still being a real secret rather than a constant.
 * Set COVERAGE_INTERNAL_KEY explicitly to rotate it independently.
 */
export function coverageInternalKey(): string {
  const explicit = optional("COVERAGE_INTERNAL_KEY");
  if (explicit) return explicit;
  return createHash("sha256")
    .update(`coverage-internal:${supabaseServiceRoleKey()}`)
    .digest("hex");
}

/**
 * The addresses that may grant themselves staff access on first sign-in.
 *
 * Comma-separated, lower-cased. Read the long note in lib/platform/access.ts
 * before adding one: this is the only way into an empty admin console, and an
 * address left in it cannot be revoked from inside the product. Empty it once
 * real `platform_staff` rows exist.
 */
export function bootstrapAdminEmails(): string[] {
  return (optional("IWAIVER_BOOTSTRAP_ADMINS") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * How long a signed record is kept, in years.
 *
 * Constraint 8: a floor in config, never a hardcoded TTL. Launch setting is three
 * years — see docs/data-model.md for where that number comes from and why it is
 * the floor rather than the target. Read here so the number a lender is shown on
 * screen and the number any future purge job obeys are the same number.
 *
 * Floors lengthen and deletions do not reverse, so a value below the launch
 * setting is ignored: shortening retention is a decision that has to be made in
 * this file, deliberately, not by a typo in an environment variable.
 */
export function retentionFloorYears(): number {
  const configured = Number(optional("RETENTION_FLOOR_YEARS"));
  return Number.isFinite(configured) && configured > 3 ? Math.trunc(configured) : 3;
}

/** Where a new partner application is announced internally. */
export const partnerNotificationEmail = () =>
  optional("PARTNER_NOTIFICATIONS_EMAIL");

/** The address a partner or a lender is told to write to. */
export const supportEmail = () =>
  optional("SUPPORT_EMAIL") ?? `support@${BRAND.domain}`;

/**
 * The address a partner or a carrier is told to write to, and the name that
 * signs the mail we send them.
 *
 * Separate from `supportEmail` on purpose. Support answers questions about an
 * account that already works; a carrier being onboarded has no account and no
 * question a support queue can answer — theirs are about contracts, filings and
 * an integration, and they belong with the people running the pipeline. Pointing
 * a carrier at support is how a question about a filing ends up behind a queue of
 * password resets.
 */
export const partnerTeamEmail = () =>
  optional("PARTNER_TEAM_EMAIL") ?? `partners@${BRAND.domain}`;

export const PARTNER_TEAM_NAME = "i-Waiver Partner Team";

export const resendApiKey = () => optional("RESEND_API_KEY");

/**
 * Verifies Resend's delivery webhooks.
 *
 * Optional, and the endpoint refuses every request while it is unset rather than
 * accepting unsigned ones. A bounce webhook writes to the evidence-adjacent
 * `signing_links` row, so an open endpoint would let anyone on the internet mark
 * a borrower's link as bounced and send a lender chasing an address that was
 * fine. Off is a safe state; trusting is not.
 */
export const resendWebhookSecret = () => optional("RESEND_WEBHOOK_SECRET");
/**
 * The From line a borrower sees.
 *
 * The display name comes from BRAND rather than being spelled out here, because
 * this string and the site header are the same claim about who is writing. When
 * they drift, the email looks like it came from someone adjacent to the company
 * rather than the company — which is exactly the smell people are taught to
 * watch for in a phishing message.
 *
 * The fallback address is Resend's shared test domain, usable before
 * i-waiver.com is verified and wrong for anything real.
 */
export const emailFrom = () =>
  optional("EMAIL_FROM") ?? `${BRAND.name} <onboarding@resend.dev>`;

/**
 * Absolute origin for links that leave the building. A signing link with a
 * relative path is not a link.
 */
export function siteOrigin(): string {
  const explicit = optional("NEXT_PUBLIC_SITE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = optional("VERCEL_PROJECT_PRODUCTION_URL") ?? optional("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** True when the deployment is missing the pieces the signing flow needs. */
export function configurationProblems(): string[] {
  const problems: string[] = [];
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SIGNING_LINK_TOKEN_PEPPER",
  ]) {
    if (!process.env[name]) problems.push(name);
  }
  return problems;
}
