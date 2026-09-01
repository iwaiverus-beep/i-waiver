import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { setCredential } from "@/lib/coverage/admin";

export const runtime = "nodejs";

const AUTH_KINDS = ["bearer", "basic", "hmac", "mtls"];

/**
 * POST /api/admin/carriers/[id]/credentials — how we reach a carrier, and how
 * they reach us.
 *
 * READ THIS BEFORE ADDING A FIELD. There is no parameter here that takes a
 * carrier's secret, and there must never be one. `secret_env_var` takes the NAME
 * of the environment variable holding it — the database enforces that shape, so a
 * secret pasted into the box fails visibly instead of being written.
 *
 * The reason it differs from a partner key: a partner key is something we hash
 * and never need back. A carrier's key is something we must SEND in clear on
 * every call, so storing it would put a working production credential for
 * somebody else's insurance system into every backup and onto every support
 * engineer's screen.
 *
 * The inbound secret is the opposite direction and is treated like a partner key:
 * generated here, hashed, and returned exactly once.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: carrierId } = await params;
    const staff = await requireStaff("carriers.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const authKind = text(body.auth_kind, 20) ?? "bearer";
    if (!AUTH_KINDS.includes(authKind)) {
      return NextResponse.json({ error: "Unknown auth kind." }, { status: 400 });
    }

    const result = await setCredential(staff.db, {
      carrierId,
      environment: text(body.environment, 10) === "live" ? "live" : "sandbox",
      baseUrl: text(body.base_url, 400),
      authKind: authKind as "bearer" | "basic" | "hmac" | "mtls",
      secretEnvVar: text(body.secret_env_var, 64),
      createdBy: staff.userId,
      rotateInboundSecret: body.rotate_inbound_secret === true,
    });

    await logStaffAction(staff, {
      action: "carrier.credential.set",
      subjectType: "carrier_credential",
      subjectId: carrierId,
      detail: {
        environment: text(body.environment, 10) === "live" ? "live" : "sandbox",
        auth_kind: authKind,
        // The variable's name, which is not a secret and is the useful thing to
        // see in a log when a call starts failing.
        secret_env_var: text(body.secret_env_var, 64),
        rotated_inbound: body.rotate_inbound_secret === true,
      },
    });

    return NextResponse.json({
      ok: true,
      inbound_secret: result.inboundSecret,
      notice: result.inboundSecret
        ? "Give this to the carrier for signing their webhooks. It is not shown again."
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
