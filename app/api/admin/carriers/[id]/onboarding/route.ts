import { NextResponse } from "next/server";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { carrierOnboardingLink } from "@/lib/coverage/emails";
import { createOnboardingLink } from "@/lib/coverage/onboarding";
import { CarrierRefused } from "@/lib/coverage/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/carriers/[id]/onboarding — send (or re-send) the details form.
 *
 * `carriers.manage`, not `carriers.filings`: this asks a carrier a question, it
 * does not record an answer, and nothing it does can make anything quotable.
 *
 * The address is an input rather than always being `carrier.contact_email`,
 * because the person who fills this in is frequently not the person who applied
 * — an application comes from a business development contact and the NAIC code
 * and sandbox URL live with somebody technical. Defaulting to the contact on
 * file and letting staff override it is the honest version of that.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("carriers.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const { data: carrier } = await staff.db
      .from("carriers")
      .select("id, name, contact_name, contact_email")
      .eq("id", id)
      .maybeSingle();

    if (!carrier) throw new CarrierRefused("No such carrier.", 404);

    const to = text(body.to, 320)?.toLowerCase() ?? carrier.contact_email ?? null;

    if (!to || !EMAIL_PATTERN.test(to)) {
      return NextResponse.json(
        { error: "Who should it go to? There is no contact address on this carrier." },
        { status: 400 },
      );
    }

    const { url, expiresAt } = await createOnboardingLink(staff.db, {
      carrierId: id,
      sentTo: to,
      createdBy: staff.userId,
    });

    await carrierOnboardingLink({
      to,
      contactName: carrier.contact_name,
      companyName: carrier.name,
      onboardingUrl: url,
      expiresAt,
    });

    // The address is logged; the token is not, and must never be. A staff action
    // log is read by more people than the carrier's own inbox is.
    await logStaffAction(staff, {
      action: "carrier.onboarding_link_sent",
      subjectType: "carrier",
      subjectId: id,
      detail: { to, expires_at: expiresAt.toISOString() },
    });

    return NextResponse.json({ ok: true, sentTo: to });
  } catch (error) {
    return jsonError(error);
  }
}
