import { BANNER_FILES } from "./banner-kit.generated";

/**
 * The trade-show banners: what is in public/marketing/, and how to buy them.
 *
 * Split from banner-kit.generated.ts for the same reason the brand kit is split
 * from its own manifest — that file is bytes and inches, rewritten wholesale
 * every time scripts/make-banner-artwork.mjs runs, and this one is judgement
 * that regenerating the artwork must never quietly overwrite.
 *
 * WHY THESE EXIST AS FILES AT ALL. A banner is ordered by whoever is going to
 * the show, usually the week before, usually from whichever print shop answers
 * the phone. Without a file to send, that person writes the words themselves,
 * and the claim on the stand at the front of the booth is then a claim nobody
 * reviewed. Every word on these is already on the site.
 */

export type BannerSize = {
  /** How the trade names it. */
  label: string;
  /** The visible graphic, in inches. */
  visible: string;
  /** The file, in inches — taller, see `printNotes`. */
  page: string;
  /** When this is the one to order. */
  note: string;
  file: string;
  preview: string;
};

export type BannerDesign = {
  id: string;
  title: string;
  description: string;
  /** Ink ground or paper ground — decides which plate the preview needs. */
  plate: "light" | "dark";
  sizes: BannerSize[];
};

export type BannerGroup = {
  heading: string;
  blurb: string;
  /** Shown as a warning above the group. Present only on artwork nobody may order. */
  warn?: string;
  designs: BannerDesign[];
};

export const BANNER_KIT: BannerGroup[] = [
  {
    heading: "Stands you can order on their own",
    blurb:
      "Each of these works by itself at the front of a booth or beside a counter. Three designs, so a booth with more than one stand is not the same sentence twice.",
    designs: [
      {
        id: "signed-and-covered",
        title: "Signed and covered",
        description:
          "The one to order first. The homepage headline, the three things a lender gets, and the address. Paper ground, so it reads in a hall lit from above.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "The workhorse. Three of these side by side fill the back wall of a 10 × 10 booth.",
            file: "banner-signed-and-covered-33-5x80.pdf",
            preview: "banner-signed-and-covered-33-5x80.png",
          },
          {
            label: "Wide",
            visible: "39 × 80 in",
            page: "39 × 84 in",
            note: "More room per stand, where the floor space is there for it.",
            file: "banner-signed-and-covered-39x80.pdf",
            preview: "banner-signed-and-covered-39x80.png",
          },
          {
            label: "Extra wide",
            visible: "47 × 80 in",
            page: "47 × 84 in",
            note: "Two of these make a back wall without a third stand to align.",
            file: "banner-signed-and-covered-47x80.pdf",
            preview: "banner-signed-and-covered-47x80.png",
          },
          {
            label: "Jumbo",
            visible: "60 × 80 in",
            page: "60 × 84 in",
            note: "A back wall on its own, or the thing people stand in front of for a photograph.",
            file: "banner-signed-and-covered-60x80.pdf",
            preview: "banner-signed-and-covered-60x80.png",
          },
          {
            label: "Tabletop",
            visible: "11 × 17 in",
            page: "11 × 19 in",
            note: "A registration desk or a counter. Read from three feet, so it is set larger in proportion than the tall ones.",
            file: "banner-signed-and-covered-11x17.pdf",
            preview: "banner-signed-and-covered-11x17.png",
          },
        ],
      },
      {
        id: "how-it-works",
        title: "How it works",
        description:
          "Three steps, one signature each. Ink ground, which is what makes it read as a different stand rather than a second copy of the first one when the two are in the same booth.",
        plate: "dark",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "Beside the demonstration, where somebody has already stopped walking.",
            file: "banner-how-it-works-33-5x80.pdf",
            preview: "banner-how-it-works-33-5x80.png",
          },
        ],
      },
      {
        id: "for-businesses",
        title: "For businesses",
        description:
          "Retrieval, not signing. The one to take to a rental, powersports or track show, where every person walking past already collects waivers and none of them can find one.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "Front of the booth at a trade-only show.",
            file: "banner-for-businesses-33-5x80.pdf",
            preview: "banner-for-businesses-33-5x80.png",
          },
        ],
      },
    ],
  },
  {
    heading: "The three-panel back wall",
    blurb:
      "One sentence across three standard stands. 33.5 in each, so three of them fill 100.5 in of a 10 ft back wall with a hand's width either side — order all three, and set them in this order left to right.",
    designs: [
      {
        id: "backdrop-1",
        title: "Panel 1 — “A handshake is nice.”",
        description: "Left. The quiet one; it sets up the middle panel.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "Left of three.",
            file: "banner-backdrop-1-33-5x80.pdf",
            preview: "banner-backdrop-1-33-5x80.png",
          },
        ],
      },
      {
        id: "backdrop-2",
        title: "Panel 2 — “Signed and covered is better.”",
        description:
          "Centre. The only ink panel of the three, which is what makes the middle of the wall the thing you see from across the hall.",
        plate: "dark",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "Middle of three.",
            file: "banner-backdrop-2-33-5x80.pdf",
            preview: "banner-backdrop-2-33-5x80.png",
          },
        ],
      },
      {
        id: "backdrop-3",
        title: "Panel 3 — What they sign",
        description: "Right. The three parts, set large enough to read from the aisle.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "Right of three.",
            file: "banner-backdrop-3-33-5x80.pdf",
            preview: "banner-backdrop-3-33-5x80.png",
          },
        ],
      },
    ],
  },
  {
    heading: "Naming drafts — not approved",
    blurb:
      "Three candidate names for the service, set at the size they would actually be read at. Identical apart from the words, because the words are the only thing being compared. One standard stand each; whichever wins gets cut at every size afterwards.",
    warn:
      "Do not send these to a printer. The name is undecided, and two of the three read as an insurance promise to somebody who reads nothing else on the stand — which is most people walking past one. Every file carries “where it is available” on the cover line for exactly that reason, and that qualifier does not come off.",
    designs: [
      {
        id: "draft-loaner-protection",
        title: "“Loaner Protection”",
        description:
          "The name as the whole message, with the definition directly under it. The safest of the three: it reads as the name of a programme rather than a promise, which is the same ground “Buyer Protection” stands on.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "For comparison. Not approved for print.",
            file: "banner-draft-loaner-protection-33-5x80.pdf",
            preview: "banner-draft-loaner-protection-33-5x80.png",
          },
        ],
      },
      {
        id: "draft-cover-your-loaner",
        title: "“Cover your loaner”",
        description:
          "An instruction rather than a name. It is the most direct of the three and the most exposed: “cover” is the word an insurer uses, and this is the version most likely to need a carrier's sign-off before it goes anywhere.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "For comparison. Not approved for print.",
            file: "banner-draft-cover-your-loaner-33-5x80.pdf",
            preview: "banner-draft-cover-your-loaner-33-5x80.png",
          },
        ],
      },
      {
        id: "draft-protect-your-loaner",
        title: "“Protect your loaner”",
        description:
          "The same shape with a softer verb. “Protect” covers the agreement and the record as well as the cover, so it is defensible in a state where no cover is written yet — but it is a sentence, not a name, and a sentence cannot be trademarked or reused as a product tier.",
        plate: "light",
        sizes: [
          {
            label: "Standard",
            visible: "33.5 × 80 in",
            page: "33.5 × 84 in",
            note: "For comparison. Not approved for print.",
            file: "banner-draft-protect-your-loaner-33-5x80.pdf",
            preview: "banner-draft-protect-your-loaner-33-5x80.png",
          },
        ],
      },
    ],
  },
];

/**
 * What to tell the print shop.
 *
 * Every line here is something a supplier will otherwise ask about, and two of
 * them are things a supplier will otherwise get wrong without asking.
 */
export const PRINT_NOTES = [
  {
    term: "Send the PDF as it is. Do not scale it.",
    detail:
      "Each file is already at life size. A shop that scales to fit will move the message off eye level and pull the green foot up the banner.",
  },
  {
    term: "The page is four inches taller than the banner.",
    detail:
      "One inch at the top for the rail and three at the bottom that wind into the cassette. The artwork runs right through both, which is why there is no white edge above the base. Do not trim the file to 80 in.",
  },
  {
    term: "Nothing important is in the bottom two feet, on purpose.",
    detail:
      "That is a block of green. At a show it is behind a table, a chair or whoever is talking to you, so it carries colour rather than words.",
  },
  {
    term: "It is vector, and the typefaces are inside the file.",
    detail:
      "Source Serif 4 and Inter are both open-licensed, so there is nothing to buy and nothing to send separately. Ask for the proof anyway.",
  },
  {
    term: "The colour is RGB. Ask for a proof of the green.",
    detail:
      "Large-format presses convert it themselves and do it better than we could. #1B5E4F is the value; the nearest coated Pantone is 3435 C if a shop wants a target to match.",
  },
  {
    term: "The QR code goes to i-waiver.com.",
    detail:
      "It is drawn as vector, so it stays crisp at any size. Scan the proof before the run — a QR code that was fine in the file and soft on the press is the classic way to print a thousand useless banners.",
  },
];

/** "PDF · 33.5 × 84 in · 62 KB" — the facts under a download link. */
export function describeBanner(file: string): string {
  const facts = BANNER_FILES[file];
  if (!facts) return "PDF";
  const kb = facts.bytes / 1024;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  return `PDF · ${facts.widthIn} × ${facts.heightIn} in · ${size}`;
}
