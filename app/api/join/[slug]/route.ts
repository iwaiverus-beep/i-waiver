import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { requestContext } from "@/lib/audit";
import { joinGroupByLink } from "@/lib/agreements/groups";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { TransitionRefused } from "@/lib/agreements/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checking in at the dock.
 *
 * Unauthenticated, like `/api/sign/...` and `/api/intake/...`, and for the same
 * reason: the person here has no account and must never be asked for one.
 *
 * Unlike the intake route, this one DOES create an agreement, which
 * 20260901000017 refused to allow off a printed code. The difference is what the
 * caller gets to choose, and the answer is: their own name and nothing else. The
 * lender, the boat, the window, the state and the wording are all fixed by the
 * booking before the code exists, and they are read from it here rather than from
 * this request body. The worst available outcome is a release of the lender by
 * somebody who typed a name into a form — which is what the person standing at the
 * counter came to do.
 *
 * What comes back is a signing link, and it is a bearer capability for that one
 * person's signature. That is the point: they are holding the phone.
 */

type Body = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await readJson<Body>(request);

    const name = text(body.name, 120);
    const email = text(body.email, 320)?.toLowerCase() ?? null;

    if (!name) throw new TransitionRefused("Type your name.");
    if (!email || !EMAIL_PATTERN.test(email)) {
      throw new TransitionRefused(
        "We need an email address — your signed copy is sent there, and it is the only copy you get.",
      );
    }

    const joined = await joinGroupByLink(serviceClient(), {
      slug,
      name,
      email,
      phone: text(body.phone, 30),
      context: requestContext(request),
    });

    // The signing url and nothing else. Not the booking id, not who else has
    // checked in, not how many slots are left: a code on a counter should not let
    // a stranger read the list of families aboard.
    return NextResponse.json({ url: joined.url }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
