import { NextResponse } from "next/server";
import { NotAuthorised } from "@/lib/agreements/access";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { InvalidLink } from "@/lib/agreements/signing";
import { RenderError } from "@/lib/render/agreement";
import { MissingEnvError } from "@/lib/env";
import { NotPartner } from "@/lib/partners/access";
import { NotStaff } from "@/lib/platform/access";
import { ApplicationRefused } from "@/lib/partners/applications";
import { TicketRefused } from "@/lib/support/tickets";

/**
 * One place that decides what a caller is told when something goes wrong.
 *
 * The rule is the same one the waitlist route already follows: loud in the logs,
 * specific to the caller only where the specifics are theirs to act on. A misconfigured
 * deployment is our problem and its shape is not something to advertise; a failing
 * compliance check is the lender's problem and they need to read it.
 */
export function jsonError(error: unknown): NextResponse {
  // Same rule as NotAuthorised below, applied to the two consoles: whether a
  // partner account or an admin console exists here is itself information, so a
  // caller who is not entitled to one is told it is not there.
  if (error instanceof NotPartner || error instanceof NotStaff) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof ApplicationRefused || error instanceof TicketRefused) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof NotAuthorised) {
    // 404, not 403: whether an agreement exists is itself information.
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof InvalidLink) {
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: 410 },
    );
  }

  if (error instanceof TransitionRefused) {
    return NextResponse.json(
      { error: error.message, reasons: error.reasons },
      { status: 422 },
    );
  }

  if (error instanceof RenderError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  if (error instanceof MissingEnvError) {
    console.error(error.message);
    return NextResponse.json(
      { error: "This deployment is not fully configured." },
      { status: 503 },
    );
  }

  console.error("unhandled route error:", error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new TransitionRefused("Invalid request body.");
  }
}

export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
