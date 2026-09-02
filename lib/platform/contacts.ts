import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The people who are not parties to a document.
 *
 * TWO GROUPS, AND NOT THE OTHER TWO. Lenders and borrowers live in
 * lib/platform/reports.ts and have screens of their own. What is here is:
 *
 *   * INBOUND — people who raised a hand. Waitlist signups, partner applicants,
 *     prospects we cold-approached, and anybody who wrote to support without an
 *     account. Marketing data; nothing in the agreement graph joins to it, which
 *     is what `waitlist`'s own comment in the schema says.
 *   * COMPANIES — the named humans at a carrier or a partner. A working
 *     relationship with a business, reached through the business.
 *
 * The separation is deliberate rather than incidental. A merged "contacts" list
 * would put a stranger who typed an address into the marketing site beside a
 * borrower who signed a legal instrument, under one word, with the same actions
 * available — and that is how the second group ends up in a mailing because the
 * first group was a mailing list.
 *
 * Reading any of this needs `reports.read`, not merely `console.read`.
 */

// --- Inbound ---------------------------------------------------------------

export type InboundContact = {
  source: "waitlist" | "application" | "prospect" | "support";
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  state: string | null;
  status: string | null;
  note: string | null;
  createdAt: string;
  /** Where in the console to go and do something about them, if anywhere. */
  href: string | null;
};

export async function inboundContacts(
  db: SupabaseClient,
): Promise<InboundContact[]> {
  const [waitlist, applications, prospects, tickets] = await Promise.all([
    db
      .from("waitlist")
      .select("id, email, full_name, party_type, state, source, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("partner_applications")
      .select(
        "id, company_name, contact_name, contact_email, contact_phone, partner_kind, status, jurisdictions, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("partner_prospects")
      .select(
        "id, name, contact_name, contact_email, contact_phone, status, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    // Only the ones with nowhere else to belong. A ticket opened by a partner is
    // already reachable through that partner, and listing its opener here again
    // would make the same person look like two leads.
    db
      .from("support_tickets")
      .select("id, reference, opener_email, opener_name, subject, status, created_at")
      .is("partner_id", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const rows: InboundContact[] = [];

  for (const w of waitlist.data ?? []) {
    rows.push({
      source: "waitlist",
      id: w.id,
      name: w.full_name,
      email: w.email,
      phone: null,
      company: null,
      state: w.state,
      status: w.party_type === "business" ? "Business" : "Individual",
      note: w.source ? `From ${w.source}` : null,
      createdAt: w.created_at,
      href: null,
    });
  }

  for (const a of applications.data ?? []) {
    rows.push({
      source: "application",
      id: a.id,
      name: a.contact_name,
      email: a.contact_email,
      phone: a.contact_phone,
      company: a.company_name,
      state: (a.jurisdictions ?? [])[0] ?? null,
      status: a.status,
      note: a.notes,
      createdAt: a.created_at,
      href: `/admin/applications/${a.id}`,
    });
  }

  for (const p of prospects.data ?? []) {
    // A prospect we have not found an address for is still worth listing — the
    // whole point of the table is the names nobody has written to yet.
    rows.push({
      source: "prospect",
      id: p.id,
      name: p.contact_name,
      email: p.contact_email ?? "",
      phone: p.contact_phone,
      company: p.name,
      state: null,
      status: p.status,
      note: p.notes,
      createdAt: p.created_at,
      href: null,
    });
  }

  for (const t of tickets.data ?? []) {
    rows.push({
      source: "support",
      id: t.id,
      name: t.opener_name,
      email: t.opener_email,
      phone: null,
      company: null,
      state: null,
      status: t.status,
      note: t.subject,
      createdAt: t.created_at,
      href: `/admin/support/${t.id}`,
    });
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// --- Companies -------------------------------------------------------------

export type CompanyContact = {
  kind: "carrier" | "partner";
  id: string;
  company: string;
  status: string | null;
  people: { name: string | null; email: string | null; phone: string | null; role: string | null }[];
  href: string;
};

export async function companyContacts(
  db: SupabaseClient,
): Promise<CompanyContact[]> {
  const [carriers, partners, members] = await Promise.all([
    db
      .from("carriers")
      .select("id, name, status, contact_name, contact_email, contact_phone")
      .order("name"),
    db.from("partners").select("id, name, disabled_at").order("name"),
    // Invited but unclaimed rows are included deliberately: an invitation nobody
    // accepted is exactly the thing somebody needs to see and chase.
    db
      .from("partner_members")
      .select("partner_id, email, role, accepted_at, revoked_at")
      .is("revoked_at", null),
  ]);

  const rows: CompanyContact[] = [];

  for (const c of carriers.data ?? []) {
    rows.push({
      kind: "carrier",
      id: c.id,
      company: c.name,
      status: c.status,
      people: c.contact_email || c.contact_name
        ? [
            {
              name: c.contact_name,
              email: c.contact_email,
              phone: c.contact_phone,
              role: null,
            },
          ]
        : [],
      href: `/admin/carriers/${c.id}`,
    });
  }

  const byPartner = new Map<string, CompanyContact["people"]>();
  for (const m of members.data ?? []) {
    if (!byPartner.has(m.partner_id)) byPartner.set(m.partner_id, []);
    byPartner.get(m.partner_id)!.push({
      name: null,
      email: m.email,
      phone: null,
      role: m.accepted_at ? m.role : `${m.role} · not accepted`,
    });
  }

  for (const p of partners.data ?? []) {
    rows.push({
      kind: "partner",
      id: p.id,
      company: p.name,
      status: p.disabled_at ? "disabled" : "active",
      people: byPartner.get(p.id) ?? [],
      href: `/admin/partners/${p.id}`,
    });
  }

  return rows;
}

// --- CSV -------------------------------------------------------------------
//
// Lenders and borrowers are NOT read here. They are parties to documents, they
// have their own screens and their own exports in lib/platform/reports.ts, and a
// second implementation of the same list would drift from the first the first
// time either changed.

/**
 * A CSV cell that cannot become a formula.
 *
 * A value beginning `=`, `+`, `-` or `@` is executed by Excel and Sheets when the
 * file is opened. Names and support subjects arrive here from public forms, so
 * this is user input landing in a file a staff member will open on their own
 * machine — the leading apostrophe is what stops that being an injection.
 */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
}
