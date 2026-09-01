import { NextResponse } from "next/server";
import { requireActor } from "@/lib/agreements/access";
import {
  archiveFinishedBefore,
  countFinishedBefore,
  defaultSweepCutoff,
} from "@/lib/agreements/archive";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bulk sweep: everything that has run its course, filed in one go.
 *
 * A lender who has been at this for two seasons has hundreds of finished
 * agreements and will not archive them one at a time — they will leave them all
 * on the list instead, and the list stops being useful. So the tidy-up has to be
 * one action.
 *
 * It is NOT automatic, which is the deliberate part. Hiding somebody's records
 * on a timer they never set is the kind of helpfulness that ends with a lender
 * swearing an agreement was deleted. They ask, they are told how many will move
 * and from when, and nothing moves until then.
 */

function cutoffFrom(value: string | null): Date {
  if (value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TransitionRefused("That is not a date.");
    }
    // A cutoff in the future would sweep loans that have not happened yet.
    if (parsed.getTime() > Date.now()) {
      throw new TransitionRefused("Pick a date that has already passed.");
    }
    return parsed;
  }

  return defaultSweepCutoff();
}

/** GET — how many would move, so the button can say so before it is pressed. */
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const before = cutoffFrom(new URL(request.url).searchParams.get("before"));
    return NextResponse.json({
      count: await countFinishedBefore(actor, before),
      before: before.toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** POST — move them. */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await readJson<{ before?: unknown }>(request);
    const before = cutoffFrom(text(body.before, 40));
    return NextResponse.json({
      archived: await archiveFinishedBefore(actor, before),
    });
  } catch (error) {
    return jsonError(error);
  }
}
