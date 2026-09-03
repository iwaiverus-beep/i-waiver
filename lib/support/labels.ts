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
  // An enhancement idea, not a problem. See migration 45 for why this is a
  // category on a ticket rather than a table of its own.
  "idea",
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
  idea: "An idea to improve i-Waiver",
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

/**
 * What the help page offers somebody who needs help.
 *
 * A subset, and the reason it is a separate list rather than a filter over
 * SUPPORT_CATEGORIES is that the full list is written for a partner engineer.
 * "Integration" and "Sandbox" mean nothing to a lender who cannot get a signing
 * link to send, and a dropdown whose first two options are unreadable teaches
 * people to pick the last one — after which every ticket is 'other' and the
 * category has stopped being information.
 *
 * 'idea' is deliberately NOT here. The help page asks what kind of thing this is
 * before it asks anything else, and an idea is the other answer to that question;
 * offering it a second time inside the help branch would let the two disagree.
 */
export const HELP_TOPICS: readonly SupportCategory[] = [
  "account",
  "bug",
  "coverage_question",
  "claim",
  "billing",
  "integration",
  "other",
];
