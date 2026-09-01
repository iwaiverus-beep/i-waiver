import { NextResponse } from "next/server";
import { requestContext } from "@/lib/audit";
import { requireActor } from "@/lib/agreements/access";
import { addParticipant, groupForActor } from "@/lib/agreements/groups";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  /** False leaves the release a draft for the lender to look at first. */
  send?: unknown;
};

/**
 * POST /api/groups/[id]/participants — add one adult to a booking.
 *
 * One person per call, deliberately. A bulk endpoint would have to decide what to
 * do when the fourth of six fails — and the honest answers are all worse than
 * letting the lender see four green rows and try the fifth again.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, originatorIds } = await requireActor();
    const body = await readJson<Body>(request);

    const name = text(body.name, 120);
    const email = text(body.email, 320)?.toLowerCase() ?? null;

    if (!name) throw new TransitionRefused("Who is coming?");
    if (!email || !EMAIL_PATTERN.test(email)) {
      throw new TransitionRefused(
        "They need a valid email address — that is how their release reaches them, and it is the only copy they get.",
      );
    }

    const group = await groupForActor(db, originatorIds, id);

    const added = await addParticipant(db, {
      group,
      name,
      email,
      phone: text(body.phone, 30),
      send: body.send !== false,
      context: requestContext(request),
      auditExtra: { added_by: "lender" },
    });

    return NextResponse.json(added, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
