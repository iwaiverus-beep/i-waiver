/**
 * What each role inside a partner company may do.
 *
 * The same shape as lib/platform/roles.ts, and for the same reason. Note what is
 * absent from every row: nothing here mentions a live key. A partner cannot put
 * themselves into production — that is a decision made on our side, recorded
 * against an onboarding step, and carried out with `partners.key.live`, which
 * only a super admin holds.
 */

export type PartnerRole = "owner" | "admin" | "developer" | "viewer";

export type PartnerCapability =
  /** Mint a sandbox key. */
  | "keys.create"
  /** Revoke any of the company's keys, sandbox or live. */
  | "keys.revoke"
  /** Set the webhook URL and rotate its signing secret. */
  | "webhook.manage"
  /** Invite and remove colleagues. */
  | "members.manage"
  /** Submit logo and colours for review. */
  | "branding.submit"
  /** Open and reply to support tickets. */
  | "support.write"
  /** See the console. */
  | "console.read";

const CAPABILITIES: Record<PartnerRole, PartnerCapability[]> = {
  owner: [
    "keys.create",
    "keys.revoke",
    "webhook.manage",
    "members.manage",
    "branding.submit",
    "support.write",
    "console.read",
  ],
  admin: [
    "keys.create",
    "keys.revoke",
    "webhook.manage",
    "members.manage",
    "branding.submit",
    "support.write",
    "console.read",
  ],
  // The person doing the integration. Everything technical, nothing commercial —
  // they can break their own sandbox and cannot change who has access.
  developer: [
    "keys.create",
    "keys.revoke",
    "webhook.manage",
    "support.write",
    "console.read",
  ],
  viewer: ["console.read"],
};

export const PARTNER_ROLE_LABELS: Record<PartnerRole, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  viewer: "Viewer",
};

export const PARTNER_ROLE_DESCRIPTIONS: Record<PartnerRole, string> = {
  owner: "Everything, including who else has access.",
  admin: "Everything except being removed by another admin.",
  developer: "Keys, webhooks and support. Cannot change who has access.",
  viewer: "Can see the console. Changes nothing.",
};

export function partnerCan(
  role: PartnerRole,
  capability: PartnerCapability,
): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}
