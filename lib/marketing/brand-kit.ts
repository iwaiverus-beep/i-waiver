import { BRAND_FILES } from "./brand-kit.generated";

/**
 * The brand kit: what is in public/brand/, and what each piece is for.
 *
 * Deliberately split from brand-kit.generated.ts. That file is bytes and pixels,
 * rewritten wholesale every time scripts/make-brand-assets.mjs runs. This one is
 * judgement — which file a person should reach for, and what they should not do
 * with it — and regenerating the artwork must never silently rewrite it.
 *
 * The artwork itself is drawn from components/Mark.tsx. Nothing here is a second
 * copy of the logo; these are renderings of the same drawing, which is why the
 * generator is the only thing allowed to write into public/brand/.
 */

export type BrandDownload = {
  /** Filename inside public/brand/. */
  file: string;
  /** JPG, PNG, SVG, PDF — what the person is choosing between. */
  format: string;
  /** When this is the right one to take. One line; it sits under the link. */
  note: string;
};

export type BrandAsset = {
  id: string;
  title: string;
  description: string;
  /** Which file to show on screen. A PNG, so the preview is what ships. */
  preview: string;
  /** Which plate the preview needs behind it to be legible. */
  plate: "light" | "dark";
  downloads: BrandDownload[];
};

export type BrandGroup = {
  heading: string;
  blurb: string;
  assets: BrandAsset[];
};

export const BRAND_KIT: BrandGroup[] = [
  {
    heading: "The logo",
    blurb:
      "The mark and the name together. This is the default — reach for the mark on its own only where the name is already on the page.",
    assets: [
      {
        id: "logo-light",
        title: "On a light background",
        description:
          "The one to use almost always. Ink on cream, or ink on white — the artwork does not care what is behind it as long as it is pale.",
        preview: "i-waiver-logo.png",
        plate: "light",
        downloads: [
          {
            file: "i-waiver-logo.png",
            format: "PNG",
            note: "Transparent. For slides, documents and anywhere on the web.",
          },
          {
            file: "i-waiver-logo-light.jpg",
            format: "JPG",
            note: "Cream plate baked in. For anything that will not take transparency.",
          },
          {
            file: "i-waiver-logo.svg",
            format: "SVG",
            note: "Vector, for the web. Scales to any size without going soft.",
          },
          {
            file: "i-waiver-logo-light.pdf",
            format: "PDF",
            note: "Send this to a printer. Vector, with the typeface embedded.",
          },
        ],
      },
      {
        id: "logo-dark",
        title: "Reversed, for a dark background",
        description:
          "Cream on ink. Not the light version with a filter over it — the strokes are drawn in the pale colour, which is why it holds up at small sizes.",
        preview: "i-waiver-logo-reversed.png",
        plate: "dark",
        downloads: [
          {
            file: "i-waiver-logo-reversed.png",
            format: "PNG",
            note: "Transparent. Drop it on any dark colour or photograph.",
          },
          {
            file: "i-waiver-logo-dark.jpg",
            format: "JPG",
            note: "Ink plate baked in.",
          },
          {
            file: "i-waiver-logo-reversed.svg",
            format: "SVG",
            note: "Vector, for the web.",
          },
          {
            file: "i-waiver-logo-dark.pdf",
            format: "PDF",
            note: "For print. Ask for ink coverage, not a pale grey.",
          },
        ],
      },
    ],
  },
  {
    heading: "The mark on its own",
    blurb:
      "The seal without the name. For a shirt pocket, an app tile, a stamp on a photograph — anywhere the name is already established or would be too small to read.",
    assets: [
      {
        id: "mark-light",
        title: "Mark, dark strokes",
        description: "For light backgrounds.",
        preview: "i-waiver-mark.png",
        plate: "light",
        downloads: [
          {
            file: "i-waiver-mark.svg",
            format: "SVG",
            note: "Vector and entirely portable — no text in it, so nothing to substitute.",
          },
          {
            file: "i-waiver-mark.png",
            format: "PNG",
            note: "Transparent, and large enough to print big.",
          },
        ],
      },
      {
        id: "mark-dark",
        title: "Mark, reversed",
        description: "For dark backgrounds.",
        preview: "i-waiver-mark-reversed.png",
        plate: "dark",
        downloads: [
          {
            file: "i-waiver-mark-reversed.svg",
            format: "SVG",
            note: "Vector, pale strokes.",
          },
          {
            file: "i-waiver-mark-reversed.png",
            format: "PNG",
            note: "Transparent, pale strokes.",
          },
        ],
      },
    ],
  },
  {
    heading: "Profile pictures",
    blurb:
      "Square, with the mark set at 72% and centred. Every service crops a profile picture to a circle, and these are drawn so the corners can be thrown away without touching the artwork.",
    assets: [
      {
        id: "profile-dark",
        title: "Dark",
        description:
          "The one to use. An ink circle stands out in a list of avatars in a way a pale one does not.",
        preview: "i-waiver-profile-dark.png",
        plate: "dark",
        downloads: [
          {
            file: "i-waiver-profile-dark.jpg",
            format: "JPG",
            note: "What Google, LinkedIn and the rest ask for.",
          },
          {
            file: "i-waiver-profile-dark.png",
            format: "PNG",
            note: "For the few that insist on it.",
          },
        ],
      },
      {
        id: "profile-light",
        title: "Light",
        description: "Where the surrounding interface is already dark.",
        preview: "i-waiver-profile-light.png",
        plate: "light",
        downloads: [
          { file: "i-waiver-profile-light.jpg", format: "JPG", note: "Cream plate." },
          { file: "i-waiver-profile-light.png", format: "PNG", note: "Cream plate." },
        ],
      },
    ],
  },
];

/** The palette, from tailwind.config.ts. */
export const BRAND_COLOURS = [
  { name: "Ink", hex: "#0B1622", use: "Text, the mark, and any dark plate." },
  { name: "Paper", hex: "#FAF9F6", use: "The background of everything." },
  { name: "Accent", hex: "#1B5E4F", use: "Buttons and links, on a pale background." },
  {
    name: "Accent, lifted",
    hex: "#1B8A72",
    use: "The dot in the mark. The darker green disappears against ink.",
  },
  { name: "Surface", hex: "#F1EEE8", use: "Panel headers and quiet fills." },
  { name: "Line", hex: "#E2DDD3", use: "Rules and borders." },
];

export const BRAND_TYPE = [
  {
    name: "Source Serif 4",
    use: "The name in the logo, and every heading. Semibold in the logo.",
    licence: "SIL Open Font License — free to embed and to send to a printer.",
  },
  {
    name: "Inter",
    use: "Body text, labels, anything small.",
    licence: "SIL Open Font License.",
  },
];

/** Human-readable facts for one file: "JPG · 3894 × 1980 · 219 KB". */
export function describeFile(file: string, format: string): string {
  const facts = BRAND_FILES[file];
  if (!facts) return format;
  const kb = facts.bytes / 1024;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  // A vector file has an intrinsic size but not a resolution, and quoting pixels
  // for one invites somebody to think it has a limit. It does not.
  const vector = format === "SVG" || format === "PDF";
  const dimensions = vector
    ? "any size"
    : `${facts.width.toLocaleString()} × ${facts.height.toLocaleString()}`;
  return `${format} · ${dimensions} · ${size}`;
}

/**
 * Roughly how wide a raster file prints before it starts to look soft.
 *
 * 300 dots to the inch is the number every printer works to. Worth stating on
 * the page, because "3894 pixels" means nothing to somebody deciding whether the
 * file is big enough for a banner.
 *
 * Null for SVG and PDF, and that is the point: a vector file has no such limit,
 * and printing a number beside one would invent a ceiling it does not have.
 */
export function printWidth(file: string, format: string): string | null {
  if (format === "SVG" || format === "PDF") return null;
  const facts = BRAND_FILES[file];
  if (!facts) return null;
  const inches = facts.width / 300;
  return inches >= 1 ? `${inches.toFixed(1)} in at 300dpi` : null;
}
