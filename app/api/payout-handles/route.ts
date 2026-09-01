import { NextResponse } from "next/server";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { ensureIndividualOriginator, requireActor } from "@/lib/agreements/access";
import { jsonError, readJson, text } from "@/lib/http";
import {
  HANDLE_PATTERN,
  PROVIDER_FIELD_LABELS,
  isPayoutProvider,
  normaliseHandle,
} from "@/lib/payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where an individual lender would like to be reimbursed.
 *
 * `lender_payout_handles` is revoked from `authenticated` for everything but
 * SELECT (20260901000032), so writes come through here on the service client,
 * which resolves the caller's own originator first and never accepts one from the
 * request.
 *
 * The originator is created on first use. Somebody adding a Venmo handle before
 * they have ever sent an agreement is the ordinary case — it is one of the things
 * a person does while setting up an account — and `ensureIndividualOriginator`
 * exists for exactly that.
 */

const HANDLE_COLUMNS = "id, provider, handle, display_name, confirmed_at, created_at";

export async function GET() {
  try {
    const { db, userId } = await requireActor();
    const originatorId = await ensureIndividualOriginator(db, userId);

    const { data } = await db
      .from("lender_payout_handles")
      .select(HANDLE_COLUMNS)
      .eq("originator_id", originatorId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true });

    return NextResponse.json({ handles: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireActor();
    const body = await readJson<Record<string, unknown>>(request);

    const provider = text(body.provider, 20);
    if (!provider || !isPayoutProvider(provider)) {
      throw new TransitionRefused("Pick who you would like to be paid through.");
    }

    const raw = text(body.handle, 80);
    if (!raw) throw new TransitionRefused(`Add your ${PROVIDER_FIELD_LABELS[provider]}.`);

    const handle = normaliseHandle(provider, raw);
    if (!HANDLE_PATTERN.test(handle)) {
      // The database says the same thing in `payout_handle_is_a_handle`. Saying
      // it here means a lender who pasted a link gets told what to do instead of
      // a constraint violation — and pasting a link is the mistake this catches,
      // because the whole point of the character set is that a URL cannot pass.
      throw new TransitionRefused(
        `"${raw}" does not look like a ${PROVIDER_FIELD_LABELS[provider]}. Type the handle itself, not a link or a QR code — we draw the code for you.`,
      );
    }

    const originatorId = await ensureIndividualOriginator(db, userId);

    // One live handle per provider (`lender_payout_handles_live_key`). Adding a
    // second Venmo only ever means the first one is stale, so replacing is what a
    // lender means by it — and revoking rather than deleting keeps the record,
    // while agreements already sent keep the snapshot frozen onto their charge.
    await db
      .from("lender_payout_handles")
      .update({ revoked_at: new Date().toISOString() })
      .eq("originator_id", originatorId)
      .eq("provider", provider)
      .is("revoked_at", null);

    const { data, error } = await db
      .from("lender_payout_handles")
      .insert({
        originator_id: originatorId,
        provider,
        handle,
        display_name: text(body.display_name, 120),
        // The lender typed it and is looking at it. That is what this column
        // records — not that the account exists, which we have no way to check
        // and must never imply we did.
        confirmed_at: new Date().toISOString(),
      })
      .select(HANDLE_COLUMNS)
      .single();

    if (error) throw new TransitionRefused(`Could not save that: ${error.message}`);

    return NextResponse.json({ handle: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
