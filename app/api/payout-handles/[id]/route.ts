import { NextResponse } from "next/server";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { requireActor } from "@/lib/agreements/access";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Taking a payment handle off the account.
 *
 * A soft delete, because `revoked_at` is what 20260901000032 gave this table
 * instead of a delete. Agreements already sent carry their own `payout_snapshot`,
 * so removing this never rewrites what a borrower was told they were paying.
 *
 * Scoped to the caller's own originators, on the service client, because the
 * service client will happily revoke somebody else's otherwise.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, originatorIds } = await requireActor();
    const { id } = await params;

    if (originatorIds.length === 0) {
      throw new TransitionRefused("That is not on your account.");
    }

    const { data, error } = await db
      .from("lender_payout_handles")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .in("originator_id", originatorIds)
      .is("revoked_at", null)
      .select("id");

    if (error) throw new TransitionRefused(`Could not remove it: ${error.message}`);
    if (!data || data.length === 0) {
      throw new TransitionRefused("That is not on your account.");
    }

    return NextResponse.json({ removed: id });
  } catch (error) {
    return jsonError(error);
  }
}
