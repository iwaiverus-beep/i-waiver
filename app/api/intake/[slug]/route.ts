import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service";
import { submitRequest } from "@/lib/intake/requests";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A borrower's side of the transaction, opened by scanning a printed code.
 *
 * Unauthenticated, like `/api/sign/...`, and for the same reason: the person here
 * has no account and should never be asked for one. Unlike the signing routes,
 * there is no token to validate, because there is no capability to check. The slug
 * names a lender; it grants nothing.
 *
 * What this endpoint can do is therefore bounded on purpose. It writes exactly one
 * row, to a table that is not part of the agreement graph, and it reads nothing
 * back that the scanner did not already have. It cannot see the queue, cannot see
 * other requests against the same code, and cannot learn whether anybody ever
 * looked at theirs.
 */

type Body = {
  borrower_name?: unknown;
  borrower_email?: unknown;
  borrower_phone?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  note?: unknown;
};

function firstAddress(header: string | null): string | null {
  // x-forwarded-for is a client-controlled list; the left-most entry is the one
  // the edge saw. Kept only for abuse triage, so a spoofed value costs nothing.
  if (!header) return null;
  const first = header.split(",")[0]?.trim();
  return first && first.length <= 45 ? first : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await readJson<Body>(request);

    const borrowerName = text(body.borrower_name, 120);
    if (!borrowerName) {
      return NextResponse.json({ error: "Tell them your name." }, { status: 400 });
    }

    const borrowerEmail = text(body.borrower_email, 200);
    if (borrowerEmail && !EMAIL_PATTERN.test(borrowerEmail)) {
      return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
    }

    const created = await submitRequest(serviceClient(), {
      slug,
      borrowerName,
      borrowerEmail,
      borrowerPhone: text(body.borrower_phone, 30),
      startsAt: text(body.starts_at, 40),
      endsAt: text(body.ends_at, 40),
      note: text(body.note, 500),
      ip: firstAddress(request.headers.get("x-forwarded-for")),
      userAgent: text(request.headers.get("user-agent"), 300),
    });

    // Only the id and nothing else. There is no status endpoint to poll it with,
    // deliberately: a public handle that reported back whether a lender had acted
    // would let anyone outside a shop watch its queue move.
    return NextResponse.json({ request_id: created.id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
