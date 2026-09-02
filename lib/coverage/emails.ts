import "server-only";

import { sendNotice } from "@/lib/email";
import { PARTNER_TEAM_NAME, partnerTeamEmail, siteOrigin } from "@/lib/env";

/**
 * The mail a carrier gets.
 *
 * Separate from lib/partners/emails.ts because the two say different things for
 * a structural reason, not a stylistic one. A partner is told an account exists
 * and where to sign in. A carrier has no account to sign into and never will —
 * the traffic runs the other way, we hold their credential and call them — so
 * every message here has to carry its own way back in, which is what the
 * onboarding link is.
 *
 * They come from the partner team rather than from support, and say so: a
 * carrier's questions are about contracts, filings and an integration, none of
 * which a support queue can answer. Replies land with the people running the
 * pipeline.
 *
 * Plain text and best-effort, like everything else this product sends.
 */

/**
 * The one a carrier gets when we approve their application.
 *
 * It is careful about a distinction that would otherwise cause a real problem:
 * approved means we want to work with them, NOT that anything can be quoted on
 * their paper. Between those two facts sit a contract, their filings, and an
 * adapter somebody has to write. A carrier who reads "approved" and expects
 * traffic next week is a carrier who will be annoyed in six weeks, so the
 * sequence is spelled out rather than implied.
 */
export function carrierApproved(input: {
  to: string;
  contactName: string | null;
  companyName: string;
  onboardingUrl: string;
  expiresAt: Date;
}) {
  const greeting = input.contactName
    ? `Hi ${input.contactName.split(" ")[0]},`
    : "Hello,";

  return sendNotice({
    to: input.to,
    subject: `Approved — next steps for ${input.companyName}`,
    lines: [
      greeting,
      "",
      `Good news: we have approved ${input.companyName} and opened a carrier record on our side.`,
      "",
      "To be straight with you about what that does and does not mean: it means we want your paper behind our quotes and we are ready to start. It does not mean anything can be quoted yet. Three things have to happen first, in this order:",
      "",
      "  1. Contract. The commercial terms, on paper.",
      "  2. Filings. We record, state by state and product by product, where you are admitted and filed. Nothing quotes in a state until that is on the record.",
      "  3. Integration. We write an adapter against your API and test it end to end in your sandbox before a single real quote runs.",
      "",
      "The fastest way to start is to tell us about yourselves. This link opens a short form — no account, no password:",
      "",
      input.onboardingUrl,
      "",
      `It is good until ${input.expiresAt.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}, and you can reopen it to correct anything you send.`,
      "",
      "It asks for your NAIC code, your AM Best rating, the states you are filed in, and where your sandbox lives. Everything goes to a person here before it is recorded — nothing you type changes anything automatically.",
      "",
      `Questions, or something on the form that does not fit your programme? Reply straight to this message — it reaches us — or write to ${partnerTeamEmail()}.`,
    ],
    signature: PARTNER_TEAM_NAME,
    replyTo: partnerTeamEmail(),
  });
}

/**
 * The nudge, when staff re-send the link.
 *
 * Shorter than the approval, because somebody asking for the link again already
 * knows why they have it. Repeating the three-step explanation would bury the
 * only thing they opened the message to find.
 */
export function carrierOnboardingLink(input: {
  to: string;
  contactName: string | null;
  companyName: string;
  onboardingUrl: string;
  expiresAt: Date;
}) {
  const greeting = input.contactName
    ? `Hi ${input.contactName.split(" ")[0]},`
    : "Hello,";

  return sendNotice({
    to: input.to,
    subject: `Your details form — ${input.companyName}`,
    lines: [
      greeting,
      "",
      `Here is a fresh link to the details form for ${input.companyName}:`,
      "",
      input.onboardingUrl,
      "",
      `It replaces any earlier link and is good until ${input.expiresAt.toLocaleDateString(
        "en-US",
        { month: "long", day: "numeric", year: "numeric" },
      )}.`,
      "",
      "NAIC code, AM Best rating, the states you are filed in, and your sandbox details. No account needed, and you can reopen it to make corrections.",
      "",
      `Anything unclear, reply here or write to ${partnerTeamEmail()}.`,
    ],
    signature: PARTNER_TEAM_NAME,
    replyTo: partnerTeamEmail(),
  });
}

/**
 * Told to us, not to them: a carrier has filled the form in.
 *
 * Goes to the same address as a new partner application. A submission sitting in
 * a review panel nobody is told about is the exact failure this whole module was
 * built to fix, and re-creating it one layer down would be a poor joke.
 */
export function carrierSubmissionNotice(input: {
  to: string;
  companyName: string;
  carrierId: string;
  states: string[];
  contactEmail: string | null;
}) {
  return sendNotice({
    to: input.to,
    subject: `Carrier details submitted: ${input.companyName}`,
    lines: [
      `${input.companyName} has filled in their onboarding form.`,
      "",
      `Contact:  ${input.contactEmail ?? "—"}`,
      `States:   ${input.states.length ? input.states.join(", ") : "none given"}`,
      "",
      "Nothing has been written to the carrier record. Review and accept it here:",
      "",
      `${siteOrigin()}/admin/carriers/${input.carrierId}`,
    ],
    signature: PARTNER_TEAM_NAME,
    replyTo: partnerTeamEmail(),
  });
}
