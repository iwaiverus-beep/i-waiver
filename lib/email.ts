import "server-only";

import { emailFrom, resendApiKey } from "@/lib/env";

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
  borrowerName: string;
  lenderName: string;
  assetDescription: string;
  starts: string;
  ends: string;
  url: string;
  expiresHours: number;
  specimen: boolean;
}): { subject: string; text: string } {
  const lines = [
    `Hi ${input.borrowerName.split(" ")[0]},`,
    "",
    `${input.lenderName} is lending you the ${input.assetDescription} and has sent you an agreement to sign.`,
    "",
    `From: ${input.starts}`,
    `Until: ${input.ends}`,
    "",
    "Read it and sign here:",
    input.url,
    "",
    `The link works for ${input.expiresHours} hours and can be used once. You do not need an account.`,
    "",
    "Cover for the loan period is included in what you sign — you will see the options before you sign anything.",
  ];

  if (input.specimen) {
    lines.push(
      "",
      "Please note: this deployment is running a specimen clause set that has not been reviewed by a lawyer. Do not rely on it.",
    );
  }

  lines.push("", "— iWaiver");

  return {
    subject: `${input.lenderName} sent you an agreement to sign`,
    text: lines.join("\n"),
  };
}

/** The email that carries the executed copy. */
export function executedCopy(input: {
  recipientName: string;
  assetDescription: string;
  documentHash: string;
  specimen: boolean;
}): { subject: string; text: string } {
  const lines = [
    `Hi ${input.recipientName.split(" ")[0]},`,
    "",
    `Everyone has now signed the agreement for the ${input.assetDescription}. Your copy is attached.`,
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
