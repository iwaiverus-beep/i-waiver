import "server-only";

import { BRAND } from "@/lib/brand";
import { sendNotice } from "@/lib/email";
import { siteOrigin, supportEmail } from "@/lib/env";

/**
 * The mail a partner gets.
 *
 * Plain text, like every other message this product sends — see the note in
 * lib/email.ts. Nothing here carries a credential: an approval email says an
 * account exists and where to sign in, and the key is minted in the console by
 * the person who will use it. A key in an inbox is a key in every inbox that
 * message is ever forwarded to.
 *
 * Every send here is best-effort. A partner who was approved is approved whether
 * or not Resend was reachable, so a failure is logged and swallowed rather than
 * rolling back a decision somebody made.
 */

const send = sendNotice;

export function partnerApplicationReceived(input: {
  to: string;
  contactName: string;
  companyName: string;
}) {
  return send({
    to: input.to,
    subject: `We have your partner application — ${input.companyName}`,
    lines: [
      `Hi ${input.contactName.split(" ")[0]},`,
      "",
      `Thanks for asking about embedding coverage into ${input.companyName}.`,
      "",
      "A person reads every one of these, so it is a few working days rather than a few minutes. If we approve it, you will get a second email with a link to sign in and a sandbox to build against.",
      "",
      "What we will want to talk about: which states you operate in, roughly how many waivers you take a year, and who does your integration work.",
      "",
      `If anything is urgent in the meantime, reply here or write to ${supportEmail()}.`,
    ],
  });
}

export function partnerApplicationNotice(input: {
  to: string;
  companyName: string;
  website: string | null;
  partnerKind: string;
  contactName: string;
  contactEmail: string;
  jurisdictions: string[];
  volumeBand: string | null;
  notes: string | null;
  applicationId: string;
}) {
  return send({
    to: input.to,
    subject: `Partner application: ${input.companyName} (${input.partnerKind})`,
    lines: [
      `${input.companyName} has applied to embed coverage.`,
      "",
      `Kind:     ${input.partnerKind}`,
      `Website:  ${input.website ?? "—"}`,
      `Contact:  ${input.contactName} <${input.contactEmail}>`,
      `States:   ${input.jurisdictions.length ? input.jurisdictions.join(", ") : "—"}`,
      `Volume:   ${input.volumeBand ?? "—"}`,
      "",
      input.notes ? `Notes:\n${input.notes}` : "No notes.",
      "",
      "Review it here:",
      `${siteOrigin()}/admin/applications/${input.applicationId}`,
    ],
  });
}

export function partnerApproved(input: {
  to: string;
  contactName: string;
  companyName: string;
}) {
  return send({
    to: input.to,
    subject: `${input.companyName} is approved — here is your sandbox`,
    lines: [
      `Hi ${input.contactName.split(" ")[0]},`,
      "",
      `We have opened a partner account for ${input.companyName}.`,
      "",
      "Sign in with this email address:",
      `${siteOrigin()}/partners/console`,
      "",
      "There is no separate partner password. Use the same sign-in as the rest of the site with this address, and your access is waiting for you.",
      "",
      "Inside you can mint a sandbox key, invite whoever is doing the integration, and run a test quote against the mock carrier. Nothing a sandbox key produces is a real policy.",
      "",
      "Going live is a separate conversation — states, the partner agreement, and how the offer is presented in your product. The console shows exactly what is outstanding.",
      "",
      `The integration reference is at ${siteOrigin()}/partners/docs.`,
    ],
  });
}

export function partnerDeclined(input: {
  to: string;
  contactName: string;
  companyName: string;
  reason: string | null;
}) {
  return send({
    to: input.to,
    subject: `About your partner application — ${input.companyName}`,
    lines: [
      `Hi ${input.contactName.split(" ")[0]},`,
      "",
      `Thanks for your interest in embedding coverage into ${input.companyName}. We are not able to take it forward at the moment.`,
      "",
      input.reason
        ? `The reason: ${input.reason}`
        : "This is usually about the states we are licensed in rather than anything about your product.",
      "",
      "We open new states steadily. You are welcome to apply again.",
    ],
  });
}

export function partnerMemberInvited(input: {
  to: string;
  companyName: string;
  invitedBy: string;
  role: string;
}) {
  return send({
    to: input.to,
    subject: `${input.invitedBy} added you to ${input.companyName} on ${BRAND.name}`,
    lines: [
      `${input.invitedBy} has given you ${input.role} access to the ${BRAND.name} partner console for ${input.companyName}.`,
      "",
      "Sign in with this email address:",
      `${siteOrigin()}/partners/console`,
      "",
      "There is no invitation code. The address is the invitation — sign in with it and your access is there.",
      "",
      `If you were not expecting this, tell us at ${supportEmail()} and we will remove it.`,
    ],
  });
}

export function partnerWentLive(input: {
  to: string;
  companyName: string;
  jurisdictions: string[];
}) {
  return send({
    to: input.to,
    subject: `${input.companyName} is live`,
    lines: [
      `${input.companyName} can now quote and bind real coverage.`,
      "",
      `Live states: ${input.jurisdictions.join(", ")}`,
      "",
      "A live key has been issued in the console. It is shown once, at the moment it is created, and is not recoverable afterwards.",
      "",
      "Your sandbox keys keep working and stay separate. Nothing a sandbox key produces will ever appear in a real report.",
      "",
      `Anything at all: ${supportEmail()}.`,
    ],
  });
}
