import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { borrowersCsv, exportFilename, listBorrowers } from "@/lib/platform/reports";

export const runtime = "nodejs";

/**
 * GET /api/admin/reports/borrowers — the borrower report as a spreadsheet.
 *
 * Logged for the same reason as the lender export, and more so. A borrower never
 * agreed to an account with us — they signed a document from a link — so a file
 * of their names and addresses leaving the platform is the export that most needs
 * somebody's name against it.
 */
export async function GET() {
  try {
    const staff = await requireStaff("reports.read");
    const rows = await listBorrowers(staff.db);

    await logStaffAction(staff, {
      action: "report.exported",
      subjectType: "platform_staff",
      subjectId: staff.userId,
      detail: { report: "borrowers", rows: rows.length },
    });

    return new NextResponse(borrowersCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename("borrowers")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
