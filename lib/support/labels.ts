/**
 * The words and values support tickets are described with.
 *
 * Split out of lib/support/tickets.ts and deliberately free of `server-only`,
 * because the console components render these lists in the browser and importing
 * them from the module that also holds the database reads drags the service
 * client into a client bundle — which Next refuses, correctly.
 *
 * The rule this keeps: a name is public, a query is not.
 */

export const SUPPORT_CATEGORIES = [
  "integration",
  "sandbox",
  "billing",
  "coverage_question",
  "claim",
  "account",
  "bug",
  "other",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  integration: "Integration",
  sandbox: "Sandbox",
  billing: "Billing",
  coverage_question: "A question about cover",
  claim: "A claim",
  account: "Account access",
  bug: "Something is broken",
  other: "Something else",
};

export type SupportStatus =
  | "open"
  | "pending_customer"
  | "pending_us"
  | "resolved"
  | "closed";

export const STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  pending_customer: "Waiting on you",
  pending_us: "Waiting on us",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
