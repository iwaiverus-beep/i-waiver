import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import {
  CARRIER_KINDS,
  createCarrier,
  type CarrierKind,
} from "@/lib/coverage/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/carriers — add a carrier.
 *
 * Always created as a `prospect`. Making one `active` is a separate call with its
 * own check (an adapter that actually exists), because `active` is the word
 * `available_carrier_products` reads when deciding who may quote.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff("carriers.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const name = text(body.name, 160);
    if (!name) {
      return NextResponse.json({ error: "What are they called?" }, { status: 400 });
    }

    const kindValue = text(body.kind, 20) ?? "carrier";
    const kind: CarrierKind = CARRIER_KINDS.includes(kindValue as CarrierKind)
      ? (kindValue as CarrierKind)
      : "carrier";

    const carrier = await createCarrier(staff.db, {
      name,
      kind,
      naicCode: text(body.naic_code, 20),
      adapter: text(body.adapter, 60),
      contactName: text(body.contact_name, 120),
      contactEmail: text(body.contact_email, 320)?.toLowerCase() ?? null,
      notes: text(body.notes, 2000),
    });

    await logStaffAction(staff, {
      action: "carrier.created",
      subjectType: "carrier",
      subjectId: carrier.id,
      detail: { name: carrier.name, slug: carrier.slug, kind, adapter: carrier.adapter },
    });

    return NextResponse.json({ ok: true, carrier }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
