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

export const resendApiKey = () => optional("RESEND_API_KEY");
export const emailFrom = () =>
  optional("EMAIL_FROM") ?? "iWaiver <onboarding@resend.dev>";

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
