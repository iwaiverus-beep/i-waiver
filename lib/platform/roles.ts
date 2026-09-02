/**
 * What each i-Waiver staff role may do.
 *
 * A capability map rather than role checks scattered through the routes. The
 * point is not tidiness: it is that "who can issue a live key" should be
 * answerable by reading one file, and changing the answer should be one line
 * that a reviewer can see. `if (role === 'admin' || role === 'super_admin')`
 * spread over twenty handlers is a policy nobody can state.
 *
 * This module is deliberately free of imports. It is a statement of policy and
 * both the server and (for rendering which buttons exist) the client may read it.
 */

export type StaffRole =
  | "super_admin"
  | "admin"
  | "support"
  | "compliance"
  | "read_only";

export type StaffCapability =
  /** Grant, change and revoke staff access. */
  | "staff.manage"
  /** Approve or decline a partner application. */
  | "partners.review"
  /** Edit a partner, invite their people, tick off onboarding. */
  | "partners.manage"
  /** Issue a sandbox key on a partner's behalf. */
  | "partners.key.sandbox"
  /** Issue a LIVE key. The narrowest capability here, and deliberately so. */
  | "partners.key.live"
  /** Approve a partner's co-branding before it renders on our surface. */
  | "branding.review"
  /** Add a carrier, its products, and its credentials. */
  | "carriers.manage"
  /** Record that a product is filed in a state. A legal fact, not a commercial one. */
  | "carriers.filings"
  /** Empty a partner's sandbox. */
  | "sandbox.purge"
  /**
   * Read the lender and borrower reports, and export them.
   *
   * Separate from `console.read` deliberately. Seeing the console is one thing;
   * downloading a file containing every borrower's name, email and the states
   * they signed in is another, and the second should not arrive as a side effect
   * of the first. `read_only` therefore does not have it.
   */
  | "reports.read"
  /** Read and reply to support tickets. */
  | "support.respond"
  /** Assign, prioritise and close tickets. */
  | "support.triage"
  /** Open or close a state, and record a clause-set review. */
  | "compliance.states"
  /** See the admin console at all. */
  | "console.read";

const CAPABILITIES: Record<StaffRole, StaffCapability[]> = {
  // The only role that can create another role holder, and the only one that can
  // put a partner into production. Both of those are one-way doors.
  super_admin: [
    "staff.manage",
    "partners.review",
    "partners.manage",
    "partners.key.sandbox",
    "partners.key.live",
    "branding.review",
    "carriers.manage",
    "carriers.filings",
    "sandbox.purge",
    "reports.read",
    "support.respond",
    "support.triage",
    "compliance.states",
    "console.read",
  ],
  // Runs the partner pipeline day to day. Can do everything up to the moment real
  // money and a real carrier are involved, and then has to ask.
  admin: [
    "partners.review",
    "partners.manage",
    "partners.key.sandbox",
    "branding.review",
    "sandbox.purge",
    "reports.read",
    "support.respond",
    "support.triage",
    "console.read",
  ],
  // Support reads accounts in order to answer questions about them, which is
  // exactly what the lender and borrower reports are. It still changes nothing.
  support: ["reports.read", "support.respond", "support.triage", "console.read"],
  // States, filings and clause sets are a legal judgement, not an operational
  // one, so the person who makes it does not also run the commercial pipeline.
  //
  // `carriers.filings` sits here and NOT on admin, deliberately. Recording that a
  // product is filed in a state is a claim about a regulator's decision, and it
  // is the only input to whether a live quote may be given there — an operator
  // under pressure to open a state should not be able to assert it themselves.
  compliance: [
    "carriers.filings",
    "compliance.states",
    "reports.read",
    "support.respond",
    "console.read",
  ],
  read_only: ["console.read"],
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  support: "Support",
  compliance: "Compliance",
  read_only: "Read only",
};

export const STAFF_ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  super_admin:
    "Everything, including granting staff access, issuing live keys and adding carriers.",
  admin:
    "Approves partners, runs onboarding, issues sandbox keys. Cannot put a partner live or record a filing.",
  support: "Answers tickets. Reads accounts; changes nothing about them.",
  compliance:
    "Records carrier filings, opens and closes states, and signs off clause sets.",
  read_only:
    "Sees the console and the dashboard totals. Cannot open the lender or borrower reports.",
};

export function staffCan(role: StaffRole, capability: StaffCapability): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: StaffRole): StaffCapability[] {
  return [...(CAPABILITIES[role] ?? [])];
}
