import "server-only";

import { emailFrom, resendApiKey, supportEmail } from "@/lib/env";

/**
 * Outbound email.
 *
 * Delivery is evidence: `signing_links.delivery_ref` holds the provider's message
 * id, and `delivered_at` is a claim that something left the building. So when no
 * provider is configured the transport is reported as `console` and the returned
 * reference says so — it is never dressed up as a real send. A development
 * fallback that produces evidence-shaped lies is worse than no fallback.
 */

export type EmailAttachment = {
  filename: string;
  content: Uint8Array;
};

export type SendResult = {
  id: string;
  transport: "resend" | "console";
};

export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<SendResult> {
  const key = resendApiKey();

  if (!key) {
    console.warn(
      `[email:console] RESEND_API_KEY is not set — nothing was sent.\n` +
        `  to:      ${message.to}\n` +
        `  subject: ${message.subject}\n` +
        `${message.text.replace(/^/gm, "  | ")}\n`,
    );
    return { id: `console:${Date.now().toString(36)}`, transport: "console" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom(),
      to: [message.to],
      // Somewhere a reply can land.
      //
      // The From address is `notifications@`, which is a sending identity and not
      // a mailbox anybody reads. Without this, hitting reply on a waiver — the
      // single most natural thing a confused borrower does — sends a question
      // into nothing, and they are left with a document they did not understand
      // and no way to ask.
      //
      // It is also read by the receiver. A transactional message from a five-day-
      // old domain, carrying one opaque link and no route back to a human, is
      // shaped exactly like a phishing attempt; a Reply-To that resolves is one
      // of the few signals separating the two. Not decisive on its own —
      // reputation is earned by volume over time — but free and true.
      reply_to: supportEmail(),
      subject: message.subject,
      // Plain text only, deliberately. A signing link that arrives looking like a
      // marketing email is a signing link that lands in spam.
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content).toString("base64"),
      })),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as { id?: string };
  return { id: body.id ?? "unknown", transport: "resend" };
}

/** The email that carries a signing link. */
export function signingInvitation(input: {
  /**
   * True when the reader is riding along rather than taking the thing. They are
   * being asked for a release, not handed a boat, and an email telling them
   * otherwise is the first thing they read about a document they are about to
   * sign.
   */
  participant?: boolean;
  borrowerName: string;
  lenderName: string;
  assetDescription: string;
  /**
   * Each item, when several are lent on one agreement. The merge value written
   * into the document says "the 3 items listed in Schedule A below", which is
   * correct on the document and nonsense in an email — there is no schedule
   * below an email. So a bundle is spelled out here instead.
   */
  items?: string[];
  starts: string;
  ends: string;
  url: string;
  expiresHours: number;
  specimen: boolean;
}): { subject: string; text: string } {
  const bundled = (input.items?.length ?? 0) > 1;

  const lines = [
    `Hi ${input.borrowerName.split(" ")[0]},`,
    "",
    input.participant
      ? `${input.lenderName} has sent you your own release to sign before you take part. It covers the ${input.assetDescription}.`
      : bundled
        ? `${input.lenderName} is lending you ${input.items!.length} things, and has sent you one agreement covering all of them.`
        : `${input.lenderName} is lending you the ${input.assetDescription} and has sent you an agreement to sign.`,
    "",
    ...(input.participant
      ? [
          "This is yours alone. Everyone else coming signs their own, and nobody's signature stands in for anybody else's.",
          "",
          "You are not taking the thing and you are not responsible for returning it — that sits with whoever booked it, on their own agreement.",
          "",
        ]
      : []),
    ...(bundled && !input.participant
      ? [...input.items!.map((item) => `  - ${item}`), ""]
      : []),
    `From: ${input.starts}`,
    `Until: ${input.ends}`,
    "",
    "Read it and sign here:",
    input.url,
    "",
    `The link works for ${input.expiresHours} hours and can be used once. You do not need an account.`,
    "",
    input.participant
      ? "Cover for the period is included in what you sign — you will see the options before you sign anything."
      : "Cover for the loan period is included in what you sign — you will see the options before you sign anything.",
  ];

  if (input.specimen) {
    lines.push(
      "",
      "Please note: this deployment is running a specimen clause set that has not been reviewed by a lawyer. Do not rely on it.",
    );
  }

  lines.push("", "— iWaiver");

  return {
    subject: input.participant
      ? `${input.lenderName} sent you a release to sign`
      : `${input.lenderName} sent you an agreement to sign`,
    text: lines.join("\n"),
  };
}

/** The email that carries the executed copy. */
export function executedCopy(input: {
  recipientName: string;
  assetDescription: string;
  /** Item count, when the agreement covers more than one thing. */
  itemCount?: number;
  documentHash: string;
  specimen: boolean;
}): { subject: string; text: string } {
  const bundled = (input.itemCount ?? 1) > 1;

  const lines = [
    `Hi ${input.recipientName.split(" ")[0]},`,
    "",
    bundled
      ? `Everyone has now signed the agreement covering all ${input.itemCount} items. Your copy is attached, with the full schedule in it.`
      : `Everyone has now signed the agreement for the ${input.assetDescription}. Your copy is attached.`,
    "",
    "The PDF includes the full text both of you saw, both signatures, and the audit trail.",
    "",
    `Document fingerprint (SHA-256):`,
    input.documentHash,
    "",
    "Keep it. If the copy you hold ever needs checking, that fingerprint is how it is done.",
  ];

  if (input.specimen) {
    lines.push(
      "",
      "Please note: this document was produced from a specimen clause set that has not been reviewed by a lawyer. Do not rely on it.",
    );
  }

  lines.push("", "— iWaiver");

  return {
    subject: "Your signed agreement",
    text: lines.join("\n"),
  };
}
