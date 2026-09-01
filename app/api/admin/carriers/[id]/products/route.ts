import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { createProduct } from "@/lib/coverage/admin";

export const runtime = "nodejs";

const COVERAGE_KINDS = [
  "physical_damage",
  "liability",
  "accident_medical",
  "deductible_reimbursement",
];

/**
 * POST /api/admin/carriers/[id]/products — add something a carrier will write.
 *
 * `product_code` is the value that ends up in `quotes.product_code`, which is a
 * snapshot with no foreign key. That is why the code is unique across every
 * carrier and not just within one: a reused code makes an old quote ambiguous
 * about who priced it, and "who priced this" is the first question asked about
 * any claim.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: carrierId } = await params;
    const staff = await requireStaff("carriers.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const productCode = text(body.product_code, 40);
    const displayName = text(body.display_name, 120);
    const activityClass = text(body.activity_class, 60);
    const coverageKind = text(body.coverage_kind, 40);

    if (!productCode) {
      return NextResponse.json({ error: "Give it a product code." }, { status: 400 });
    }
    if (!displayName) {
      return NextResponse.json(
        { error: "What does a customer call this?" },
        { status: 400 },
      );
    }
    if (!activityClass) {
      return NextResponse.json({ error: "Which activity class?" }, { status: 400 });
    }
    if (!coverageKind || !COVERAGE_KINDS.includes(coverageKind)) {
      return NextResponse.json({ error: "Unknown coverage kind." }, { status: 400 });
    }

    const cents = (value: unknown): number | null => {
      const n = typeof value === "number" ? value : Number(text(value, 20) ?? "");
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    };

    const product = await createProduct(staff.db, {
      carrierId,
      productCode,
      coverageKind,
      activityClass,
      displayName,
      description: text(body.description, 1000),
      limitCents: cents(body.default_limit_cents),
      deductibleCents: cents(body.default_deductible_cents),
    });

    await logStaffAction(staff, {
      action: "carrier.product.created",
      subjectType: "carrier_product",
      subjectId: product.id,
      detail: {
        carrier_id: carrierId,
        product_code: product.product_code,
        coverage_kind: coverageKind,
        activity_class: activityClass,
      },
    });

    return NextResponse.json({ ok: true, product }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
