import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { requireStaff } from "@/lib/platform/access";
import {
  approveApplication,
  declineApplication,
} from "@/lib/partners/applications";

export const runtime = "nodejs";

/**
 * POST /api/admin/applications/[id] — decide on a partner application.
 *
 * `{ "action": "approve" | "decline" | "in_review", "note": "..." }`.
 *
 * One route rather than three because the three are the same decision at
 * different values, and because approving something is a POST to the thing being
 * decided, not to a verb.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("partners.review");
    const body = await readJson<Record<string, unknown>>(request);
    const action = text(body.action, 20);
    const note = text(body.note, 2000);

    if (action === "approve") {
      const result = await approveApplication(staff, id, { note });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "decline") {
      await declineApplication(staff, id, note);
      return NextResponse.json({ ok: true });
    }

    if (action === "in_review") {
      // Not a decision, just a claim on the queue so two people do not read the
      // same application on the same morning. No email goes out.
      await staff.db
        .from("partner_applications")
        .update({ status: "in_review", status_note: note })
        .eq("id", id)
        .in("status", ["new", "in_review"]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
