import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { exportFilename, lendersCsv, listLenders } from "@/lib/platform/reports";

export const runtime = "nodejs";

/**
 * GET /api/admin/reports/lenders — the lender report as a spreadsheet.
 *
 * The download is logged. Reading a list on screen and taking a copy of it off
 * the platform are different acts: the file outlives the session, is forwarded,
 * and is the thing somebody will one day have to account for. `staff_actions`
 * records who took one and when, and that record cannot be edited.
 */
export async function GET() {
  try {
    const staff = await requireStaff("reports.read");
    const rows = await listLenders(staff.db);

    await logStaffAction(staff, {
      action: "report.exported",
      subjectType: "platform_staff",
      subjectId: staff.userId,
      detail: { report: "lenders", rows: rows.length },
    });

    return new NextResponse(lendersCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename("lenders")}"`,
        // Personal data, and a cache is a copy nobody decided to make.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
