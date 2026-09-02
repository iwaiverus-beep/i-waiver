import { jsonError } from "@/lib/http";
import { logStaffAction, requireStaff } from "@/lib/platform/access";
import { companyContacts, inboundContacts, toCsv } from "@/lib/platform/contacts";

export const runtime = "nodejs";

/**
 * GET /api/admin/contacts/export?tab=… — the list as a file.
 *
 * Inbound and companies only. The lender and borrower exports are their own
 * routes under /api/admin/reports — same capability, same logging, and there is
 * no reason for a second implementation of either.
 *
 * `reports.read`, which `read_only` does not have. Downloading a file of every
 * address we hold is not a thing that should arrive as a side effect of being
 * able to see the console.
 *
 * EVERY EXPORT IS LOGGED, including the row count. An export leaves the building
 * — it lands on somebody's laptop and we stop being able to say where it is — so
 * the record of who took what and when is the only control that survives the
 * download. `staff_actions` is append-only and enforced so by a trigger.
 */

export async function GET(request: Request) {
  try {
    const staff = await requireStaff("reports.read");
    const tab = new URL(request.url).searchParams.get("tab") ?? "inbound";

    let headers: string[];
    let rows: unknown[][];

    switch (tab) {
      case "companies": {
        const companies = await companyContacts(staff.db);
        headers = ["Kind", "Company", "Status", "Person", "Email", "Phone", "Role"];
        // One line per person, not per company — a CSV is read by something that
        // expects a flat table, and a company with three contacts folded into one
        // cell is a cell nobody can filter on.
        rows = companies.flatMap((c) =>
          c.people.length === 0
            ? [[c.kind, c.company, c.status, "", "", "", ""]]
            : c.people.map((p) => [
                c.kind,
                c.company,
                c.status,
                p.name,
                p.email,
                p.phone,
                p.role,
              ]),
        );
        break;
      }

      default: {
        const inbound = await inboundContacts(staff.db);
        headers = [
          "Source",
          "Name",
          "Email",
          "Phone",
          "Company",
          "State",
          "Status",
          "Note",
          "When",
        ];
        rows = inbound.map((r) => [
          r.source,
          r.name,
          r.email,
          r.phone,
          r.company,
          r.state,
          r.status,
          r.note,
          r.createdAt,
        ]);
        break;
      }
    }

    await logStaffAction(staff, {
      action: "contacts.exported",
      subjectType: "platform_staff",
      detail: { list: tab, rows: rows.length },
    });

    const today = new Date().toISOString().slice(0, 10);

    return new Response(toCsv(headers, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="iwaiver-${tab}-${today}.csv"`,
        // Never cached anywhere. This is the customer base.
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
