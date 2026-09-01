import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import {
  CARRIER_STATUSES,
  setCarrierStatus,
  type CarrierStatus,
} from "@/lib/coverage/admin";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/carriers/[id] — move a carrier through its lifecycle.
 *
 * `active` is the only value that changes behaviour: it is what
 * `available_carrier_products` filters on, so promoting a carrier is the moment
 * their paper can be quoted. `setCarrierStatus` refuses it unless an adapter with
 * a real implementation is registered — a carrier row with no client behind it
 * would be selected and then dropped at quote time, with a log line nobody is
 * watching.
 *
 * Suspending is the emergency lever and it is immediate: the next quote will not
 * include them, and existing policies are untouched, which is the correct split.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("carriers.manage");
    const body = await readJson<Record<string, unknown>>(request);

    const value = text(body.status, 20);
    if (!value || !CARRIER_STATUSES.includes(value as CarrierStatus)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }

    const status = value as CarrierStatus;
    const reason = text(body.reason, 500);

    if ((status === "suspended" || status === "terminated") && !reason) {
      return NextResponse.json(
        { error: "Say why. It goes in the log." },
        { status: 400 },
      );
    }

    await setCarrierStatus(staff.db, id, status);

    await logStaffAction(staff, {
      action: `carrier.${status}`,
      subjectType: "carrier",
      subjectId: id,
      detail: { status, reason },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
