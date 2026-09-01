import "server-only";

import type { Actor } from "@/lib/agreements/access";
import { agreementForActor, NotAuthorised } from "@/lib/agreements/access";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

/**
 * Filing an agreement away, and getting it back.
 *
 * This is a shelf, not a bin. Archiving hides a row from the lender's working
 * list and does nothing else: the agreement is still fetchable by id, its PDF
 * still renders, its audit chain still verifies, and it is still kept for the
 * full retention floor. Nothing in this file deletes anything, and nothing in
 * this file may ever be given a code path that does — a lender clicking "file
 * this away" has not asked to destroy evidence and must not be able to.
 *
 * It is also not a lifecycle transition, which is why it lives here and not in
 * `lifecycle.ts`. That file moves an agreement between states the two parties
 * caused — sent, signed, voided — and every move it makes is an event on the
 * audit chain. Archiving is a filing decision one party makes about their own
 * desk. It says nothing about the agreement, so it appends nothing to the record
 * of what happened to the agreement: `audit_event_type` has no value for it, and
 * adding one would put a lender's screen preferences into the evidence.
 *
 * The writes are on the service client, per constraint 2, and authorisation is
 * this module's own job — `agreementForActor` first, every time.
 */

/** Statuses a bulk sweep will file. Never `draft`: see `archiveFinishedBefore`. */
const FINISHED = ["sent", "partially_signed", "executed", "expired", "voided"];

/**
 * How long after a loan ends before the record stops being day-to-day.
 *
 * Ninety days rather than thirty: a dispute about a scratch on a hull surfaces
 * weeks later, and the season a rental shop is still in is the one it wants on
 * the screen. Nothing turns on the number — filing is reversible and the sweep is
 * offered, never applied — so it is a sensible default rather than a policy.
 */
export const SWEEP_AGE_DAYS = 90;

export function defaultSweepCutoff(): Date {
  return new Date(Date.now() - SWEEP_AGE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Files one agreement away.
 *
 * A legal hold refuses. Constraint 8 makes the hold override retention, and the
 * same reasoning applies here with more force: the agreement somebody has raised
 * a claim about is the exact one that must not go quiet. The database says so too
 * — `agreements_hold_unarchives` clears the column if a hold lands later — but
 * the refusal happens here as well so the lender is told why rather than watching
 * the row reappear.
 */
export async function archiveAgreement(actor: Actor, agreementId: string) {
  const agreement = await agreementForActor(actor, agreementId);

  if (agreement.legal_hold_at) {
    throw new TransitionRefused(
      "This agreement is under legal hold. It stays on your list until the hold is lifted.",
    );
  }

  const { error } = await actor.db
    .from("agreements")
    .update({ archived_at: new Date().toISOString(), archived_by: actor.userId })
    .eq("id", agreementId);

  if (error) throw new Error(`Could not file that away: ${error.message}`);
}

/** Puts one back on the working list. */
export async function restoreAgreement(actor: Actor, agreementId: string) {
  await agreementForActor(actor, agreementId);

  const { error } = await actor.db
    .from("agreements")
    .update({ archived_at: null, archived_by: null })
    .eq("id", agreementId);

  if (error) throw new Error(`Could not restore that: ${error.message}`);
}

/**
 * How many agreements have run their course and are older than `before`.
 *
 * Asked before the sweep so the lender is offered a number rather than a button
 * whose effect they find out about afterwards.
 */
export async function countFinishedBefore(
  actor: Actor,
  before: Date,
): Promise<number> {
  if (actor.originatorIds.length === 0) return 0;

  const { count } = await actor.db
    .from("agreements")
    .select("id", { count: "exact", head: true })
    // SWEEP SCOPE. Identical to the one in archiveFinishedBefore, and it has to
    // stay identical — the number a lender is shown and the number that moves
    // are the same promise made twice. Change one, change the other.
    .in("originator_id", actor.originatorIds)
    .in("status", FINISHED)
    .is("archived_at", null)
    .is("legal_hold_at", null)
    .lt("ends_at", before.toISOString());

  return count ?? 0;
}

/**
 * Files away everything whose loan window closed before `before`.
 *
 * The cutoff is the END OF THE LOAN, not when the agreement was created or
 * signed. A waiver signed in March for a boat borrowed in July is current in
 * June, and dating the sweep from the signature would file it before the trip it
 * covers.
 *
 * Drafts are left alone. A draft has never been in front of anybody and clearing
 * one out is a decision about unfinished work rather than about finished
 * business, so it stays a one-at-a-time act. Agreements sent but never signed are
 * swept: once the window they cover has closed, an unsigned release is not an
 * outstanding task, it is a thing that did not happen.
 *
 * Held agreements are excluded here as well as by the trigger, so the count the
 * lender was shown is the count that moves.
 */
export async function archiveFinishedBefore(
  actor: Actor,
  before: Date,
): Promise<number> {
  if (actor.originatorIds.length === 0) throw new NotAuthorised();

  const { data, error } = await actor.db
    .from("agreements")
    .update({ archived_at: new Date().toISOString(), archived_by: actor.userId })
    // SWEEP SCOPE, the counterpart of the one in countFinishedBefore. Written out
    // rather than shared: a helper that takes a query and adds filters to it has
    // to be generic over PostgrestFilterBuilder, whose type differs between a
    // select and an update, and the compiler gives up on inferring it. Five
    // legible lines twice beats a cast.
    .in("originator_id", actor.originatorIds)
    .in("status", FINISHED)
    .is("archived_at", null)
    .is("legal_hold_at", null)
    .lt("ends_at", before.toISOString())
    .select("id");

  if (error) throw new Error(`Could not file those away: ${error.message}`);
  return (data ?? []).length;
}
