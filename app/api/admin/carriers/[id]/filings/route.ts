import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, NotStaff, requireStaff } from "@/lib/platform/access";
import {
  FILING_STATUSES,
  setFiling,
  type FilingStatus,
} from "@/lib/coverage/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/carriers/[id]/filings — record where a product may be written.
 *
 * GUARDED BY `carriers.filings`, WHICH ONLY COMPLIANCE AND SUPER ADMIN HOLD, and
 * that is the point of the whole capability. This row is a claim about a
 * regulator's decision, and it is the single input to whether a live quote may be
 * given in a state. Somebody under commercial pressure to open Texas should not
 * be able to assert that Texas is open.
 *
 * Saving it recomputes `state_availability.carrier_admitted` through a database
 * trigger, so nothing else has to be remembered.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: carrierId } = await params;
    const staff = await requireStaff("carriers.filings");
    const body = await readJson<Record<string, unknown>>(request);

    const productId = text(body.product_id, 40);
    const state = text(body.state, 2);
    const statusValue = text(body.status, 20) ?? "not_filed";

    if (!productId || !state) {
      return NextResponse.json(
        { error: "Which product, and which state?" },
        { status: 400 },
      );
    }
    if (!FILING_STATUSES.includes(statusValue as FilingStatus)) {
      return NextResponse.json({ error: "Unknown filing status." }, { status: 400 });
    }

    // The product has to belong to the carrier in the URL. Without this a valid
    // product id from any carrier would be accepted, and the screen you were
    // looking at would not be the one you changed.
    const { data: product } = await staff.db
      .from("carrier_products")
      .select("id, product_code, carrier_id")
      .eq("id", productId)
      .eq("carrier_id", carrierId)
      .maybeSingle();

    if (!product) throw new NotStaff("No such product for this carrier.");

    await setFiling(staff.db, {
      productId,
      state,
      status: statusValue as FilingStatus,
      admitted: body.admitted === true,
      filingRef: text(body.filing_ref, 120),
      effectiveFrom: text(body.effective_from, 10),
      effectiveTo: text(body.effective_to, 10),
      notes: text(body.notes, 1000),
      reviewedBy: staff.userId,
    });

    await logStaffAction(staff, {
      action: "carrier.filing.recorded",
      subjectType: "carrier_filing",
      subjectId: productId,
      detail: {
        carrier_id: carrierId,
        product_code: product.product_code,
        state: state.toUpperCase(),
        status: statusValue,
        admitted: body.admitted === true,
        filing_ref: text(body.filing_ref, 120),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
