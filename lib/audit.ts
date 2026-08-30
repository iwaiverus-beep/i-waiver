import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEventType =
  | "created"
  | "sent"
  | "delivered"
  | "opened"
  | "consented"
  | "viewed_clause"
  | "identity_verified"
  | "compliance_checked"
  | "signed"
  | "quoted"
  | "bound"
  | "paid"
  | "voided";

export type AuditActor = "lender" | "borrower" | "system" | "carrier";

export type RequestContext = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * Pulls the caller's address and user agent off the request.
 *
 * These end up in the evidence record, so the order matters: Vercel's
 * x-forwarded-for is the one to trust behind the platform's proxy, and the first
 * entry is the client. Anything further right in that list is an intermediary.
 */
export function requestContext(request: Request): RequestContext {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  return {
    ip: ip && ip.length <= 45 ? ip : null,
    userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
  };
}

/**
 * Appends one event to an agreement's chain.
 *
 * `prev_hash` and `hash` are set by the database trigger, never here. An
 * application that computes its own chain hash is an application that can be
 * talked into computing a convenient one.
 */
export async function recordAuditEvent(
  db: SupabaseClient,
  event: {
    agreementId: string;
    signerId?: string | null;
    type: AuditEventType;
    actor: AuditActor;
    payload?: Record<string, unknown>;
    context?: RequestContext;
  },
): Promise<void> {
  const { error } = await db.from("audit_events").insert({
    agreement_id: event.agreementId,
    signer_id: event.signerId ?? null,
    event_type: event.type,
    actor: event.actor,
    payload: event.payload ?? {},
    ip: event.context?.ip ?? null,
    user_agent: event.context?.userAgent ?? null,
  });

  if (error) {
    // An agreement whose audit trail has a hole is worth less than one that
    // failed to advance, so this propagates rather than being swallowed.
    throw new Error(`audit event (${event.type}) failed: ${error.message}`);
  }
}

export type ChainRow = {
  event_id: number;
  occurred_at: string;
  event_type: AuditEventType;
  link_ok: boolean;
  hash_ok: boolean;
  stored_hash: string;
  expected_hash: string;
};

export type ChainVerdict = {
  intact: boolean;
  events: number;
  firstBreakAt: number | null;
  rows: ChainRow[];
};

/**
 * Re-derives the chain in the database, using the same function the insert
 * trigger uses.
 *
 * Verifying in SQL rather than in TypeScript is deliberate. The hash covers a
 * Postgres jsonb rendering and an epoch with microsecond precision; a TypeScript
 * reimplementation would eventually disagree with the generator for reasons that
 * have nothing to do with tampering, and a verifier that cries wolf is not a
 * verifier.
 */
export async function verifyAuditChain(
  db: SupabaseClient,
  agreementId: string,
): Promise<ChainVerdict> {
  const { data, error } = await db.rpc("verify_audit_chain", {
    p_agreement_id: agreementId,
  });

  if (error) throw new Error(`chain verification failed: ${error.message}`);

  const rows = (data ?? []) as ChainRow[];
  const broken = rows.find((r) => !r.link_ok || !r.hash_ok);

  return {
    intact: !broken,
    events: rows.length,
    firstBreakAt: broken ? broken.event_id : null,
    rows,
  };
}
