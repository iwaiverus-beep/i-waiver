import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mintApiKey, mintWebhookSecret } from "@/lib/partners/keys";
import { completeStep } from "@/lib/partners/onboarding";
import { SANDBOX_JURISDICTIONS, isStateCode } from "@/lib/jurisdictions";

/**
 * Issuing, listing and revoking the credentials a partner integrates with.
 *
 * One module so that the rule about live keys is stated once. A live key may be
 * created only by a caller that has already been checked for
 * `partners.key.live` — the route does that — and its jurisdictions are the
 * states somebody confirmed against the carrier's filings, passed in explicitly.
 * A sandbox key gets every state, for the reason in lib/jurisdictions.ts.
 */

export type IntegrationKind = "widget" | "api" | "redirect";

export const INTEGRATION_KINDS: IntegrationKind[] = ["widget", "api", "redirect"];

export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = {
  widget: "Embedded widget",
  api: "Direct API",
  redirect: "Hosted redirect",
};

export const INTEGRATION_KIND_NOTES: Record<IntegrationKind, string> = {
  widget:
    "Our surface, framed inside yours. We make the offer, take the consent and handle the money — you host the frame and get the attach.",
  api: "You call quote and bind yourself. Fastest to build, and the arrangement with the most compliance weight on you: talk to us before choosing it.",
  redirect:
    "You send the signer to us and we send them back. Least code, and the customer briefly leaves your product.",
};

export type Integration = {
  id: string;
  partner_id: string;
  integration_kind: IntegrationKind;
  environment: "sandbox" | "live";
  label: string | null;
  key_prefix: string | null;
  allowed_jurisdictions: string[];
  allowed_origins: string[];
  compensation_model: string;
  webhook_url: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export async function listIntegrations(
  db: SupabaseClient,
  partnerId: string,
): Promise<Integration[]> {
  const { data } = await db
    .from("partner_integrations")
    .select(
      "id, partner_id, integration_kind, environment, label, key_prefix, allowed_jurisdictions, allowed_origins, compensation_model, webhook_url, created_at, last_used_at, revoked_at",
    )
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Integration[];
}

export type IssuedKey = {
  integration: Integration;
  /** Shown once, by the route that called this. Never stored, never logged. */
  raw: string;
};

export async function issueKey(
  db: SupabaseClient,
  input: {
    partnerId: string;
    environment: "sandbox" | "live";
    kind: IntegrationKind;
    label: string | null;
    createdBy: string | null;
    /** Required for live. Ignored for sandbox, which always gets every state. */
    jurisdictions?: string[];
    allowedOrigins?: string[];
  },
): Promise<IssuedKey> {
  const jurisdictions =
    input.environment === "sandbox"
      ? SANDBOX_JURISDICTIONS
      : [...new Set((input.jurisdictions ?? []).map((s) => s.toUpperCase()).filter(isStateCode))];

  if (jurisdictions.length === 0) {
    // The database says the same thing, via `integration_names_its_jurisdictions`.
    // Saying it here first turns a constraint violation into a sentence.
    throw new Error("A live key must name at least one state.");
  }

  const key = mintApiKey(input.environment);

  const { data, error } = await db
    .from("partner_integrations")
    .insert({
      partner_id: input.partnerId,
      integration_kind: input.kind,
      environment: input.environment,
      api_key_hash: key.hash,
      key_prefix: key.prefix,
      label: input.label,
      allowed_jurisdictions: jurisdictions,
      allowed_origins: input.allowedOrigins ?? [],
      created_by: input.createdBy,
    })
    .select(
      "id, partner_id, integration_kind, environment, label, key_prefix, allowed_jurisdictions, allowed_origins, compensation_model, webhook_url, created_at, last_used_at, revoked_at",
    )
    .single();

  if (error || !data) {
    throw new Error(`Could not issue the key: ${error?.message}`);
  }

  await completeStep(db, {
    partnerId: input.partnerId,
    step: input.environment === "sandbox" ? "sandbox_key_issued" : "live_key_issued",
    completedBy: input.createdBy,
  });

  return { integration: data as Integration, raw: key.raw };
}

export async function revokeKey(
  db: SupabaseClient,
  input: { integrationId: string; partnerId: string; revokedBy: string | null },
): Promise<void> {
  const { error } = await db
    .from("partner_integrations")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.revokedBy,
    })
    // Scoped to the partner as well as the id. The caller has already been
    // authorised for this partner; this makes the query itself unable to reach
    // another one, which is the difference between a check and a guarantee.
    .eq("id", input.integrationId)
    .eq("partner_id", input.partnerId)
    .is("revoked_at", null);

  if (error) throw new Error(`Could not revoke the key: ${error.message}`);
}

/**
 * Set where we call the partner back, and mint a fresh signing secret.
 *
 * The secret changes every time the URL does. A webhook secret that survives a
 * change of endpoint is a secret that has been shared with whatever was at the
 * old address.
 */
export async function setWebhook(
  db: SupabaseClient,
  input: { integrationId: string; partnerId: string; url: string | null },
): Promise<{ secret: string | null }> {
  if (!input.url) {
    await db
      .from("partner_integrations")
      .update({ webhook_url: null, webhook_secret_hash: null })
      .eq("id", input.integrationId)
      .eq("partner_id", input.partnerId);
    return { secret: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("That is not a URL.");
  }
  // No plaintext callbacks. We sign the body, but the body is a policy record and
  // it is not going out over http.
  if (parsed.protocol !== "https:") {
    throw new Error("A webhook endpoint has to be https.");
  }

  const secret = mintWebhookSecret();

  const { error } = await db
    .from("partner_integrations")
    .update({
      webhook_url: parsed.toString(),
      webhook_secret_hash: secret.hash,
    })
    .eq("id", input.integrationId)
    .eq("partner_id", input.partnerId);

  if (error) throw new Error(`Could not save the webhook: ${error.message}`);

  return { secret: secret.raw };
}
