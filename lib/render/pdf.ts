import "server-only";

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { AssembledDocument } from "@/lib/render/agreement";
import { formatCents, shortHash } from "@/lib/format";

/**
 * The rendered artifact.
 *
 * Reproducibility is the requirement, not a nicety: `documents.sha256` is the hash
 * of these bytes, and a document whose hash cannot be reproduced from
 * `render_inputs` proves less than one that can. So every non-deterministic input
 * pdf-lib would otherwise reach for is pinned — creation and modification dates
 * come from the agreement's own execution time, and nothing here reads the clock.
 */

const PAGE = { width: 612, height: 792 };
const MARGIN = 54;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const INK = rgb(0.043, 0.086, 0.133);
const SOFT = rgb(0.2, 0.28, 0.36);
const MUTED = rgb(0.39, 0.45, 0.55);
const FLAG = rgb(0.54, 0.35, 0.09);
const RULE = rgb(0.886, 0.867, 0.827);

type Fonts = {
  body: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
  mono: PDFFont;
};

export type SignatureEvidence = {
  signerId: string;
  displayName: string;
  role: string;
  method: string;
  typedName: string | null;
  imagePng: Uint8Array | null;
  signedAt: string;
  ip: string | null;
  documentHashAtSigning: string;
};

export type AuditLine = {
  eventId: number;
  occurredAt: string;
  eventType: string;
  actor: string;
  hash: string;
};

/** A cursor that knows how to start a new page when it runs out of room. */
class Layout {
  page: PDFPage;
  y: number;
  pages: PDFPage[] = [];
  private doc: PDFDocument;
  private fonts: Fonts;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = this.newPage();
    this.y = PAGE.height - MARGIN;
  }

  private newPage(): PDFPage {
    const page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    return page;
  }

  need(space: number) {
    if (this.y - space < MARGIN + 28) {
      this.page = this.newPage();
      this.y = PAGE.height - MARGIN;
    }
  }

  gap(amount: number) {
    this.y -= amount;
  }

  rule() {
    this.need(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.y -= 14;
  }

  text(
    content: string,
    options: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      leading?: number;
      indent?: number;
    } = {},
  ) {
    const font = options.font ?? this.fonts.body;
    const size = options.size ?? 10;
    const leading = options.leading ?? size * 1.45;
    const indent = options.indent ?? 0;
    const width = CONTENT_WIDTH - indent;

    for (const line of wrap(content, font, size, width)) {
      this.need(leading);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: options.color ?? INK,
      });
      this.y -= leading;
    }
  }

  /** Tinted callout box — used for anything the reader must not skim past. */
  callout(content: string, color: ReturnType<typeof rgb>) {
    const size = 9;
    const lines = wrap(content, this.fonts.bold, size, CONTENT_WIDTH - 24);
    const height = lines.length * (size * 1.45) + 20;
    this.need(height + 8);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - height,
      width: CONTENT_WIDTH,
      height,
      color,
      opacity: 0.08,
      borderColor: color,
      borderWidth: 0.75,
      borderOpacity: 0.35,
    });
    let cursor = this.y - 12;
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + 12,
        y: cursor - size,
        size,
        font: this.fonts.bold,
        color,
      });
      cursor -= size * 1.45;
    }
    this.y -= height + 12;
  }

  keyValue(label: string, value: string) {
    const size = 9.5;
    this.need(size * 1.6);
    this.page.drawText(label.toUpperCase(), {
      x: MARGIN,
      y: this.y - size,
      size: 7.5,
      font: this.fonts.bold,
      color: MUTED,
    });
    const lines = wrap(value, this.fonts.body, size, CONTENT_WIDTH - 150);
    let cursor = this.y;
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + 150,
        y: cursor - size,
        size,
        font: this.fonts.body,
        color: INK,
      });
      cursor -= size * 1.4;
    }
    this.y = Math.min(this.y - size * 1.6, cursor);
  }
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    // pdf-lib's standard fonts have no glyph for characters outside WinAnsi, and
    // an em dash or curly quote from a clause body would throw mid-render. They
    // are folded to their ASCII equivalents rather than dropped.
    const safe = paragraph
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/[^\x20-\x7E]/g, "");

    if (!safe.trim()) {
      out.push("");
      continue;
    }

    let line = "";
    for (const word of safe.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Splits a clause body into paragraphs, noting which were marked bold. */
function paragraphs(body: string): { text: string; bold: boolean }[] {
  return body
    .split(/\n{2,}/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const fullyBold = /^\*\*[\s\S]*\*\*$/.test(raw);
      return {
        text: raw.replace(/\*\*/g, ""),
        bold: fullyBold,
      };
    });
}

/**
 * What a charge is called on the page.
 *
 * `usage_fee` prints as "Rental fee" because that is what it is, and the document
 * should say so in the word a reader would use. The enum name is the schema's
 * business; the borrower's is what they are being asked to pay for.
 */
const CHARGE_LABELS: Record<string, string> = {
  security_deposit: "Security deposit",
  fuel: "Fuel",
  cleaning: "Cleaning",
  launch_fee: "Launch / ramp fee",
  delivery: "Delivery",
  usage_fee: "Rental fee",
};

const PROVIDER_LABELS: Record<string, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  zelle: "Zelle",
  paypal: "PayPal",
};

export async function renderAgreementPdf(input: {
  document: AssembledDocument;
  signatures: SignatureEvidence[];
  audit: AuditLine[];
  /** Pins the PDF metadata dates so the same inputs give the same bytes. */
  producedAt: Date;
}): Promise<Uint8Array> {
  const { document: doc, signatures, audit, producedAt } = input;

  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRoman),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };

  pdf.setTitle(`Agreement ${doc.agreement.id}`);
  pdf.setProducer("iWaiver");
  pdf.setCreator("iWaiver");
  pdf.setCreationDate(producedAt);
  pdf.setModificationDate(producedAt);

  const L = new Layout(pdf, fonts);

  // ---- Heading ------------------------------------------------------------
  L.text(doc.templateLabel.replace(/\s*\(.*\)$/, ""), {
    font: fonts.serif,
    size: 22,
    leading: 27,
  });
  L.text(
    `${doc.agreement.activity_class.replace(/_/g, " ")} · ${doc.agreement.jurisdiction}`,
    { size: 9.5, color: MUTED },
  );
  L.gap(10);
  L.rule();

  // ---- Honest labelling ---------------------------------------------------
  // Both of these are load-bearing. The specimen banner exists so unreviewed
  // wording can never pass as final, and the cover-only banner exists so the
  // waiver is never quietly oversold in a state that will not enforce it.
  if (doc.specimen) {
    L.callout(
      "SPECIMEN DOCUMENT. The clause set for this state has not been reviewed by counsel. " +
        "This is a structural placeholder produced for testing and must not be relied on by either party.",
      FLAG,
    );
  }

  if (doc.waiverEfficacy === "void") {
    L.callout(
      `Under the law of ${doc.agreement.jurisdiction} a pre-injury release of negligence claims is void or near-void. ` +
        "Treat this document as a record of the loan and of the parties' understanding, not as a shield against liability. " +
        "The cover purchased alongside it is where the protection sits.",
      FLAG,
    );
  } else if (doc.waiverEfficacy === "limited") {
    L.callout(
      `Courts in ${doc.agreement.jurisdiction} enforce pre-injury releases only in narrow circumstances. ` +
        "Do not assume the release paragraph will be given full effect.",
      FLAG,
    );
  }

  // ---- Facts --------------------------------------------------------------
  //
  // A participant release is headed and labelled as what it is. Printing
  // "Borrower" over the name of somebody who never had the boat would be the one
  // sentence on the page a claims adjuster could quote back.
  const participantRelease = doc.signers.some((s) => s.role === "participant");

  L.text(participantRelease ? "The activity" : "The loan", {
    font: fonts.bold,
    size: 12,
  });
  L.gap(6);
  L.keyValue("Lender", nameFor(doc, "lender"));
  L.keyValue(
    participantRelease ? "Participant" : "Borrower",
    nameFor(doc, participantRelease ? "participant" : "borrower"),
  );
  const bundled = doc.assets.length > 1;

  if (bundled) {
    L.keyValue("Items", `${doc.assets.length}, listed in Schedule A below`);
  } else {
    L.keyValue("Asset", doc.mergeValues.asset_description);
    if (doc.asset.identifier) L.keyValue("HIN / VIN / serial", doc.asset.identifier);
  }
  // The declared value is what the damage clause is measured against, and a
  // participant does not carry that clause. Printing a number next to their name
  // that they are not answerable for is an invitation to read the document as
  // saying they are.
  if (!participantRelease) {
    L.keyValue("Declared value", formatCents(doc.totalDeclaredValueCents));
  }
  L.keyValue("From", doc.mergeValues.starts_at);
  L.keyValue("Until", doc.mergeValues.ends_at);
  L.keyValue("State of activity", doc.agreement.jurisdiction);
  L.gap(10);
  L.rule();

  // ---- Schedule A ---------------------------------------------------------
  // Before the clauses, not appended after them. The clauses refer to "the items
  // listed in Schedule A", and a schedule a reader has to hunt for at the back
  // of the document after being told to rely on it is a schedule that gets
  // skipped — which is an argument about whether they knew what they signed for.
  if (bundled) {
    L.need(80);
    L.text(
      participantRelease ? "Schedule A — items involved" : "Schedule A — items lent",
      { font: fonts.bold, size: 12 },
    );
    L.gap(6);

    doc.assets.forEach((item, index) => {
      L.need(34);
      const named = [item.year?.toString(), item.make, item.model]
        .filter(Boolean)
        .join(" ");
      L.text(`${index + 1}. ${named || item.description}`, {
        font: fonts.bold,
        size: 10.5,
      });
      const detail = [
        named ? item.description : null,
        item.identifier ? `HIN / VIN / serial ${item.identifier}` : null,
        `declared value ${formatCents(item.declared_value_cents)}`,
      ]
        .filter(Boolean)
        .join(" · ");
      L.text(detail, { size: 10, color: SOFT });
      L.gap(4);
    });

    L.gap(2);
    L.keyValue("Total declared value", formatCents(doc.totalDeclaredValueCents));
    L.gap(10);
    L.rule();
  }

  // ---- Schedule B — charges ----------------------------------------------
  //
  // In the document, not only in a confirmation email. A schedule that lives in
  // an email is a side note neither party signed, and unenforceable — which is
  // the whole reason these figures are inside the hash as well as on the page.
  //
  // Before the clauses, like Schedule A, and for the same reason: the damage
  // clause measures itself against the deposit, and a reader told to rely on a
  // figure they have not reached yet is a reader who did not read it.
  if (doc.charges.length > 0) {
    L.need(96);
    L.text("Schedule B — charges", { font: fonts.bold, size: 12 });
    L.gap(6);

    doc.charges.forEach((charge, index) => {
      L.need(30);
      L.text(
        `${index + 1}. ${CHARGE_LABELS[charge.kind] ?? charge.kind} — ${formatCents(charge.amount_cents)}`,
        { font: fonts.bold, size: 10.5 },
      );
      const detail = [
        charge.detail,
        charge.kind === "security_deposit"
          ? "refundable, held against damage and return condition"
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (detail) L.text(detail, { size: 10, color: SOFT });
      L.gap(4);
    });

    L.gap(2);
    // Two figures, never one. A deposit is held, not owed, and a single "total"
    // that quietly includes $500 coming back is the number people argue about
    // afterwards — with reason.
    L.keyValue("Total due", formatCents(doc.totalDueCents));
    if (doc.securityDepositCents > 0) {
      L.keyValue("Deposit (refundable)", formatCents(doc.securityDepositCents));
    }

    const direct = doc.charges.filter((c) => c.settlement === "direct");
    const payout = direct.find((c) => c.payout)?.payout ?? null;
    const lenderName = nameFor(doc, "lender");

    if (direct.length === 0) {
      L.keyValue("Payment", "By card, at signing.");
    } else if (payout) {
      const providerLabel = PROVIDER_LABELS[payout.provider];
      L.keyValue(
        "Payment",
        providerLabel
          ? `${lenderName} asked to be paid by ${providerLabel} at ${payout.handle}.`
          : `${lenderName} asked to be paid at ${payout.handle}.`,
      );
    } else {
      L.keyValue("Payment", `Settled directly with ${lenderName}.`);
    }

    // Said plainly, on the document, because the alternative is a borrower who
    // believes a platform stands behind a transfer no platform ever saw.
    if (direct.length > 0) {
      L.gap(4);
      L.callout(
        "This money is paid directly between the two of you. i-Waiver does not collect it, hold it, or confirm that it was sent, and a personal transfer of this kind carries no dispute protection.",
        FLAG,
      );
    }

    L.gap(10);
    L.rule();
  }

  // ---- Clauses ------------------------------------------------------------
  for (const clause of doc.clauses) {
    L.need(60);
    L.text(`${clause.ordinal}. ${clause.label}`, {
      font: fonts.bold,
      size: 11.5,
    });
    L.gap(4);

    for (const para of paragraphs(clause.body)) {
      const upper = clause.conspicuous.uppercase === true;
      const bold = para.bold || clause.conspicuous.bold === true;
      L.text(upper ? para.text.toUpperCase() : para.text, {
        font: bold ? fonts.bold : fonts.body,
        size: Math.max(clause.conspicuous.min_font_pt ?? 10, 10),
        color: bold ? INK : SOFT,
      });
      L.gap(5);
    }

    L.text(`Clause version ${clause.clause_version_id} · body sha256 ${clause.body_hash}`, {
      font: fonts.mono,
      size: 6.5,
      color: MUTED,
    });
    L.gap(12);
  }

  // ---- Signatures ---------------------------------------------------------
  L.rule();
  L.text("Signatures", { font: fonts.bold, size: 12 });
  L.gap(8);

  for (const sig of signatures) {
    L.need(96);
    L.text(`${sig.displayName} — ${sig.role}`, { font: fonts.bold, size: 10.5 });
    L.gap(4);

    if (sig.imagePng) {
      try {
        const image = await pdf.embedPng(sig.imagePng);
        const scaled = image.scaleToFit(200, 56);
        L.need(scaled.height + 8);
        L.page.drawImage(image, {
          x: MARGIN,
          y: L.y - scaled.height,
          width: scaled.width,
          height: scaled.height,
        });
        L.y -= scaled.height + 8;
      } catch {
        // A signature image that will not embed must not take the document with
        // it — the evidence that matters is the row, the hash and the timestamp.
        L.text("[drawn signature on file]", { size: 9, color: MUTED });
      }
    } else if (sig.typedName) {
      L.text(sig.typedName, { font: fonts.serif, size: 18 });
      L.gap(4);
    } else if (sig.method === "biometric") {
      // There is no mark to draw. Saying so plainly is better than an empty
      // rule that reads as a signature nobody got round to making.
      L.text(sig.displayName, { font: fonts.serif, size: 18 });
      L.gap(2);
      L.text(
        "Signed on the signer's own device, confirmed by Face ID, Touch ID or device passcode.",
        { size: 8, color: MUTED },
      );
      L.gap(4);
    }

    L.page.drawLine({
      start: { x: MARGIN, y: L.y },
      end: { x: MARGIN + 240, y: L.y },
      thickness: 0.75,
      color: RULE,
    });
    L.y -= 12;

    L.text(
      `Signed ${sig.signedAt} · method: ${sig.method}` +
        (sig.ip ? ` · from ${sig.ip}` : ""),
      { size: 8, color: MUTED },
    );
    L.text(`Document hash at signing: ${sig.documentHashAtSigning}`, {
      font: fonts.mono,
      size: 6.5,
      color: MUTED,
    });
    L.gap(14);
  }

  // ---- Audit trail --------------------------------------------------------
  L.need(120);
  L.rule();
  L.text("Audit trail", { font: fonts.bold, size: 12 });
  L.text(
    "Each entry is hashed together with the one before it. Altering any entry after the fact " +
      "breaks every hash that follows, which is what makes this list worth reading.",
    { size: 8.5, color: MUTED },
  );
  L.gap(8);

  for (const line of audit) {
    L.need(14);
    L.text(
      `${String(line.eventId).padStart(4, " ")}  ${line.occurredAt}  ${line.eventType.padEnd(20, " ")} ${line.actor.padEnd(9, " ")} ${shortHash(line.hash)}`,
      { font: fonts.mono, size: 7.5, color: SOFT },
    );
  }

  L.gap(16);
  L.text(`Canonical document hash (sha256): ${doc.documentHash}`, {
    font: fonts.mono,
    size: 7,
    color: MUTED,
  });

  // ---- Footers ------------------------------------------------------------
  const total = L.pages.length;
  L.pages.forEach((page, index) => {
    page.drawText(
      `iWaiver · agreement ${doc.agreement.id} · page ${index + 1} of ${total}`,
      {
        x: MARGIN,
        y: MARGIN - 18,
        size: 7,
        font: fonts.body,
        color: MUTED,
      },
    );
  });

  return pdf.save({ useObjectStreams: false });
}

function nameFor(doc: AssembledDocument, role: string): string {
  const signer = doc.signers.find((s) => s.role === role);
  if (!signer) return "—";
  return signer.email ? `${signer.display_name} · ${signer.email}` : signer.display_name;
}
