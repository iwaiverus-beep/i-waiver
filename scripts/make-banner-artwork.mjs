#!/usr/bin/env node
/**
 * Draws print-ready pop-up banner artwork into public/marketing/.
 *
 *   node scripts/make-banner-artwork.mjs
 *
 * Same bargain as scripts/make-brand-assets.mjs, for the same reasons: no new
 * dependency, Chrome does the drawing, `--print-to-pdf` keeps the result vector
 * with the typeface embedded, and the output is committed so a normal build
 * never runs this. Re-run it when the wording, the palette or the mark changes.
 *
 * WHAT A PRINTER NEEDS, AND WHY THE PAGE IS TALLER THAN THE BANNER.
 *
 * A retractable stand is a cassette with a spring roller in it. The bottom two
 * to three inches of the print wind into that cassette and are never seen, and
 * the top inch is gripped by the rail. So the artwork is supplied taller than
 * the visible graphic — 83in of page for an 80in banner — with the background
 * running right through the allowance. Trimming the file to the visible height
 * instead is how you get a white sliver above the base.
 *
 * The second thing print files get wrong is where the words sit. A banner is
 * read across a hall from eye level, and the bottom foot of it is behind a
 * table, a chair, or the back of whoever is talking to you. Every layout here
 * keeps its message between roughly 15in and 60in from the top and leaves the
 * bottom clear, which is why the page has a `dead` measurement as well as an
 * allowance.
 *
 * COLOUR. These are RGB. Large-format printers convert, and their conversion is
 * better than ours would be — the alternative is shipping a CMYK profile we
 * cannot soft-proof. #1B5E4F is a deep enough green to survive the conversion;
 * if a printer asks, tell them Pantone 3435 C is the nearest coated match and
 * ask for a proof.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import QRCode from "qrcode";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "marketing");
const MANIFEST = join(ROOT, "lib", "marketing", "banner-kit.generated.ts");
const WORK = join(tmpdir(), "iwaiver-banners-" + process.pid);

// From tailwind.config.ts, repeated for the same reason make-brand-assets.mjs
// repeats them: this is a plain script and that file is TypeScript behind a
// build.
const INK = "#0B1622";
const PAPER = "#FAF9F6";
const ACCENT = "#1B5E4F";
const LINE = "#E2DDD3";
const INK_SOFT = "#33475B";
// On an ink ground the brand green goes muddy at a distance. This is the same
// trade components/Mark.tsx makes for the dot, one step lighter again because a
// banner is read across a room rather than at arm's length.
const ACCENT_REVERSED = "#7CC9AC";

const NAME = "I-Waiver"; // lib/brand.ts
const DOMAIN = "i-waiver.com";
const SITE = "https://i-waiver.com";

/**
 * The stand sizes, in inches, as the trade calls them.
 *
 * `allowance` is what winds into the cassette, `rail` is what the top clamp
 * covers, and both are drawn but never seen.
 *
 * `foot` is the green band across the bottom, and it is a print decision rather
 * than a decorative one. The bottom foot and a half of a stand is behind a
 * table, a chair, or whoever is talking to you, so no words may go there — and a
 * banner that simply stops, leaving bare paper down to the base, reads as
 * unfinished artwork rather than as a design. A block of colour fills it, and
 * nothing is lost when the last three inches wind into the cassette, because
 * those three inches are the same green as the twenty-six above them.
 *
 * `scale` is set per size rather than derived from the width, because reading
 * distance is not proportional to the banner. A jumbo is read from further away
 * than a standard; a tabletop is read from three feet, and scaling its type
 * down by width alone would produce something nobody could read at all.
 */
const SIZES = {
  tabletop: { w: 11, h: 17, allowance: 1.5, rail: 0.5, foot: 4, scale: 0.34 },
  standard: { w: 33.5, h: 80, allowance: 3, rail: 1, foot: 26, scale: 1 },
  wide: { w: 39, h: 80, allowance: 3, rail: 1, foot: 26, scale: 1.12 },
  extraWide: { w: 47, h: 80, allowance: 3, rail: 1, foot: 26, scale: 1.28 },
  jumbo: { w: 60, h: 80, allowance: 3, rail: 1, foot: 26, scale: 1.55 },
};

// --- the mark, transcribed from components/Mark.tsx -------------------------
// Kept in step with scripts/make-brand-assets.mjs, which carries the same
// transcription and the same warning: these must not drift from the component.

const DOT = { x: 19, y: 17.1, r: 4.2 };
const PERF_RADIUS = 19.8;
const PERF_COUNT = 20;
const BEAD_RADIUS = 1.2;

const PERFORATION = Array.from({ length: PERF_COUNT }, (_, i) => {
  const angle = (i / PERF_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 32 + PERF_RADIUS * Math.cos(angle),
    y: 32 + PERF_RADIUS * Math.sin(angle),
  };
}).filter(({ x, y }) => Math.hypot(x - DOT.x, y - DOT.y) > DOT.r + BEAD_RADIUS + 0.6);

function markSvg(ink, dot) {
  const beads = PERFORATION.map(
    (b) => `<circle cx="${b.x.toFixed(3)}" cy="${b.y.toFixed(3)}" r="${BEAD_RADIUS}" fill="${ink}"/>`,
  ).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<circle cx="32" cy="32" r="26.5" fill="none" stroke="${ink}" stroke-width="3.6"/>`,
    beads,
    `<g fill="none" stroke="${ink}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="M19 33l5 9 9-16"/><path d="M29 29l5 9 10-15"/></g>`,
    `<circle cx="${DOT.x}" cy="${DOT.y}" r="${DOT.r}" fill="${dot}"/>`,
    `</svg>`,
  ].join("");
}

// --- the designs ------------------------------------------------------------

/**
 * What each banner says.
 *
 * Every word is already on the site. That is deliberate: a banner written
 * separately from the pages it points at is how a company ends up making two
 * claims about itself, and the one on the banner is the one that cannot be
 * edited after it is printed.
 *
 * NOT ON ANY OF THESE: a coverage promise. The site says cover is offered
 * "where it is available" and that the product is not selling insurance today.
 * A banner is the last place to get ahead of that, so the cover line carries its
 * qualifier in the same breath, in the same size of type.
 */
const DESIGNS = {
  "signed-and-covered": {
    title: "Signed and covered",
    tone: "light",
    eyebrow: "Lend it. Stay on good terms.",
    headline: ["A handshake", "is nice."],
    headlineAccent: ["Signed and covered", "is better."],
    body:
      "Turn the loan into a signed agreement both parties keep — written for the state it happens in, and producible years later when somebody asks.",
    points: [
      "They sign from a link. No account, no app, nothing to download.",
      "A record that holds up: versioned wording, signatures bound to the document.",
      "Cover for the loan period, where it is available.",
    ],
  },

  "how-it-works": {
    title: "How it works",
    tone: "dark",
    eyebrow: "How it works",
    headline: ["Three steps,"],
    headlineAccent: ["one signature each."],
    body: null,
    steps: [
      ["Describe the loan", "What is being lent, to whom, where, and for how long."],
      ["Both parties sign", "They get a link, read the agreement, and sign. No account."],
      ["Everyone keeps it", "The same document, fingerprinted, with a timestamped history."],
    ],
  },

  "for-businesses": {
    title: "For businesses",
    tone: "light",
    eyebrow: "Rental counters · tracks · shops and dealers",
    headline: ["Waivers you"],
    headlineAccent: ["can find again."],
    body:
      "Collecting the signature is the easy part. The hard part arrives eighteen months later, when somebody asks for the exact document a customer signed on a specific afternoon.",
    points: [
      "Multiple staff, one account, roles that decide who may change wording.",
      "One reviewed set of templates per state, versioned so you can prove which was in use.",
      "Retrieval is the feature, not an afterthought.",
    ],
  },

  /**
   * THREE NAMES ON TRIAL, NOT THREE BANNERS TO ORDER.
   *
   * "Loaner Protection" is a candidate for what the service is called, and it is
   * not decided. These exist so it can be read at the size it would actually be
   * read at — a phrase can look fine in a document and turn out to be the wrong
   * shape once it is two feet tall — and the three of them are identical apart
   * from the words, because the words are the only thing being compared.
   *
   * Every one of them carries "where it is available" on the cover line, in the
   * same size of type as everything else. That is not a hedge, it is the
   * difference between naming a programme and claiming a policy exists, and it
   * matters most on the two headlines that read as a promise on their own —
   * "Cover your loaner" and "Protect your loaner" both sound like insurance to
   * somebody who reads nothing else, which is most people walking past a stand.
   *
   * The `draft-` in each id reaches the filename, and the console lists them
   * under their own heading. Both are deliberate: the way a trial banner gets
   * printed by mistake is by sitting in a folder next to an approved one with a
   * name that does not say which is which.
   */
  "draft-loaner-protection": {
    title: "Loaner Protection",
    tone: "light",
    eyebrow: "From I-Waiver",
    headline: ["Loaner"],
    headlineAccent: ["Protection."],
    body:
      "A signed agreement, a record that holds up, and cover for the loan period where it is available.",
    points: [
      "They sign from a link. No account, no app, nothing to download.",
      "Written for the state the loan happens in, and producible years later.",
      "Cover for the loan period, where it is available.",
    ],
    // A name is the whole message, so it is set larger than a sentence would be.
    hero: true,
    draft: true,
  },
  "draft-cover-your-loaner": {
    title: "Cover your loaner",
    tone: "light",
    eyebrow: "From I-Waiver",
    headline: ["Cover"],
    headlineAccent: ["your loaner."],
    body:
      "A signed agreement, a record that holds up, and cover for the loan period where it is available.",
    points: [
      "They sign from a link. No account, no app, nothing to download.",
      "Written for the state the loan happens in, and producible years later.",
      "Cover for the loan period, where it is available.",
    ],
    // A name is the whole message, so it is set larger than a sentence would be.
    hero: true,
    draft: true,
  },
  "draft-protect-your-loaner": {
    title: "Protect your loaner",
    tone: "light",
    eyebrow: "From I-Waiver",
    headline: ["Protect"],
    headlineAccent: ["your loaner."],
    body:
      "A signed agreement, a record that holds up, and cover for the loan period where it is available.",
    points: [
      "They sign from a link. No account, no app, nothing to download.",
      "Written for the state the loan happens in, and producible years later.",
      "Cover for the loan period, where it is available.",
    ],
    // A name is the whole message, so it is set larger than a sentence would be.
    hero: true,
    draft: true,
  },

  /**
   * Three standard stands in a row.
   *
   * 33.5in each, so three of them fill 100.5in of a 10ft booth back wall with a
   * hand's width either side. They are one sentence across three panels, which
   * is why the centre one carries the mark and the other two are quieter: a
   * triptych where every panel shouts reads as three unrelated banners that
   * happen to be touching.
   */
  "backdrop-1": {
    title: "Backdrop, panel 1 of 3",
    tone: "light",
    eyebrow: "Panel 1 of 3",
    headline: ["A handshake", "is nice."],
    headlineAccent: null,
    body: "You lend the boat. They bring it back. Nobody wrote anything down.",
    points: null,
    panel: 1,
    emphasis: true,
  },
  "backdrop-2": {
    title: "Backdrop, panel 2 of 3",
    tone: "dark",
    eyebrow: null,
    headline: null,
    headlineAccent: ["Signed and", "covered", "is better."],
    body: null,
    points: null,
    panel: 2,
    hero: true,
  },
  "backdrop-3": {
    title: "Backdrop, panel 3 of 3",
    tone: "light",
    eyebrow: "What they sign",
    headline: null,
    headlineAccent: null,
    body: null,
    points: [
      "An agreement written for the state the loan happens in.",
      "A record that can be produced years later.",
      "Cover for the loan period, where it is available.",
    ],
    panel: 3,
    emphasis: true,
  },
};

/** Which artwork gets cut at which size. */
const SHEET = [
  ["signed-and-covered", "standard"],
  ["signed-and-covered", "wide"],
  ["signed-and-covered", "extraWide"],
  ["signed-and-covered", "jumbo"],
  ["signed-and-covered", "tabletop"],
  ["how-it-works", "standard"],
  ["for-businesses", "standard"],
  ["backdrop-1", "standard"],
  ["backdrop-2", "standard"],
  ["backdrop-3", "standard"],
  // On trial. One size each — the comparison is between three phrases, not
  // between fifteen files.
  ["draft-loaner-protection", "standard"],
  ["draft-cover-your-loaner", "standard"],
  ["draft-protect-your-loaner", "standard"],
];

// --- drawing ---------------------------------------------------------------

const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700" +
  "&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=block";

/**
 * One banner, as a page of HTML sized in real inches.
 *
 * `ppi` is the only thing that changes between the print file and the thumbnail
 * on the console: at 96 it is Chrome's own print unit and the PDF comes out at
 * life size, at 10 the same layout renders as a small image. Everything below is
 * therefore stated in inches and multiplied, never in pixels.
 */
function banner(designId, sizeId, ppi) {
  const d = DESIGNS[designId];
  const s = SIZES[sizeId];
  const px = (inches) => (inches * ppi).toFixed(2) + "px";
  const type = (inches) => ((inches * s.scale * ppi)).toFixed(2) + "px";

  // A backdrop panel carrying nothing but a list is read from the same distance
  // as one carrying a headline, so its list has to be set at headline scale.
  const em = d.emphasis ? 1.55 : 1;
  const dark = d.tone === "dark";
  const ground = dark ? INK : PAPER;
  const text = dark ? PAPER : INK;
  const quiet = dark ? "rgba(250,249,246,0.72)" : INK_SOFT;
  const accent = dark ? ACCENT_REVERSED : ACCENT;
  const rule = dark ? "rgba(250,249,246,0.22)" : LINE;

  const side = s.w * 0.085;
  const pageH = s.h + s.allowance + s.rail;
  // The band runs from here to the very bottom of the page, allowance included.
  const footTop = pageH - s.allowance - s.foot;

  const lockup = `
    <div class="lockup">
      <span class="mark">${markSvg(text, accent)}</span>
      <span class="wordmark">${NAME}</span>
    </div>`;

  const headline = [
    ...(d.headline ?? []).map((l) => `<span class="line">${l}</span>`),
    ...(d.headlineAccent ?? []).map(
      (l) => `<span class="line accent">${l}</span>`,
    ),
  ].join("");

  const steps = (d.steps ?? [])
    .map(
      ([term, detail], i) => `
      <div class="step">
        <span class="num">${i + 1}</span>
        <div>
          <p class="term">${term}</p>
          <p class="detail">${detail}</p>
        </div>
      </div>`,
    )
    .join("");

  const points = (d.points ?? [])
    .map(
      (p) => `
      <div class="point">
        <span class="tick"></span>
        <p>${p}</p>
      </div>`,
    )
    .join("");

  return `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="${FONTS}">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${px(s.w)};height:${px(pageH)};background:${ground};
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{
    position:relative;
    width:${px(s.w)};height:${px(pageH)};background:${ground};color:${text};
    font-family:"Inter",Arial,Helvetica,sans-serif;
    display:flex;flex-direction:column;
    /* Top padding clears the rail. Bottom padding clears the foot band and
       everything under it, so no word is ever laid out below reading height. */
    padding:${px(s.rail + s.h * 0.055)} ${px(side)} ${px(pageH - footTop + s.h * 0.025)};
  }
  .grow{flex:1 1 auto}
  .band{position:absolute;left:0;right:0;bottom:0;height:${px(pageH - footTop)};
    /* Always the deep brand green, never the lightened one the dark layouts use
       for type. Three stands in a row have to share one foot, and a mint block
       under the middle panel would break the wall in half. */
    background:${ACCENT}}
  .lead{height:${type(4.2)};flex:0 0 auto}

  .lockup{display:flex;align-items:center;gap:${type(0.55)}}
  .mark{width:${type(2.05)};height:${type(2.05)};display:block}
  .mark svg{width:100%;height:100%;display:block}
  .wordmark{font-family:"Source Serif 4",Georgia,serif;font-weight:600;
    font-size:${type(1.72)};letter-spacing:-0.02em;line-height:1}

  .eyebrow{font-size:${type(0.42)};font-weight:600;letter-spacing:0.16em;
    text-transform:uppercase;color:${accent};margin-bottom:${type(0.9)}}

  .headline{font-family:"Source Serif 4",Georgia,serif;font-weight:400;
    font-size:${type(d.hero ? 3.4 : 2.55)};line-height:0.98;letter-spacing:-0.03em;
    display:flex;flex-direction:column}
  .headline .accent{color:${accent}}

  .body{font-size:${type(0.74 * em)};line-height:1.4;color:${quiet};
    margin-top:${type(1.15)};max-width:${type(18)}}

  .points{display:flex;flex-direction:column;gap:${type(0.85 * em)};
    margin-top:${type(1.6)}}
  .point{display:flex;gap:${type(0.62 * em)};align-items:flex-start}
  .point p{font-size:${type(0.72 * em)};line-height:1.32;color:${text};max-width:${type(18)}}
  .tick{flex:0 0 auto;width:${type(0.34 * em)};height:${type(0.34 * em)};border-radius:50%;
    background:${accent};margin-top:${type(0.28 * em)}}

  .steps{display:flex;flex-direction:column;gap:${type(1.35)};margin-top:${type(1.9)}}
  .step{display:flex;gap:${type(0.85)};align-items:flex-start}
  .num{font-family:"Source Serif 4",Georgia,serif;font-size:${type(1.35)};
    line-height:1;color:${accent};width:${type(1.5)};flex:0 0 auto}
  .term{font-size:${type(0.9)};font-weight:600;line-height:1.15}
  .detail{font-size:${type(0.7)};line-height:1.32;color:${quiet};
    margin-top:${type(0.3)};max-width:${type(16)}}

  .foot{border-top:${px(0.02)} solid ${rule};padding-top:${type(0.95)};
    margin-top:${type(2.4)};
    display:flex;align-items:center;justify-content:space-between;gap:${type(1)}}
  .url{font-family:"Source Serif 4",Georgia,serif;font-size:${type(1.4)};
    line-height:1;letter-spacing:-0.01em}
  .strap{font-size:${type(0.52)};color:${quiet};margin-top:${type(0.42)};
    max-width:${type(16)};line-height:1.35}
  .qr{width:${type(3.2)};height:${type(3.2)};flex:0 0 auto;
    background:${dark ? PAPER : "transparent"};padding:${dark ? type(0.16) : "0"};
    border-radius:${type(0.12)}}
  .qr svg{width:100%;height:100%;display:block}
</style>
<div class="page">
  ${lockup}

  <div class="lead"></div>

  <div>
    ${d.eyebrow ? `<p class="eyebrow">${d.eyebrow}</p>` : ""}
    ${headline ? `<h1 class="headline">${headline}</h1>` : ""}
    ${d.body ? `<p class="body">${d.body}</p>` : ""}
    ${steps ? `<div class="steps">${steps}</div>` : ""}
    ${points ? `<div class="points">${points}</div>` : ""}
  </div>

  <!-- Bottom-anchored, so the rule and the address sit immediately above the
       green foot however much the message above them says. -->
  <div class="grow"></div>

  <div class="foot">
    <div>
      <p class="url">${DOMAIN}</p>
      <p class="strap">The agreement and the cover, signed together.</p>
    </div>
    <div class="qr">${QR}</div>
  </div>

  <div class="band"></div>
</div>`;
}

// --- Chrome -----------------------------------------------------------------

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const CHROME = (() => {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    "Chrome not found. Set CHROME_PATH to the executable and run this again.",
  );
})();

const BASE = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--allow-file-access-from-files",
  // Long enough for the webfont to arrive. `display=block` means Chrome waits
  // rather than painting Georgia first and swapping after the screenshot.
  "--virtual-time-budget=20000",
];

function fileUrl(path) {
  return "file:///" + path.split(String.fromCharCode(92)).join("/");
}

function chrome(args) {
  return execFileSync(CHROME, [...BASE, ...args], {
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
}

function pdf(html, widthIn, heightIn, destination) {
  const page = join(WORK, "print.html");
  // Chrome prints 96 CSS pixels to the inch, and @page has to name the artwork
  // exactly or the banner arrives centred on a letter sheet.
  const sized = html.replace(
    "</style>",
    `@page{size:${widthIn.toFixed(4)}in ${heightIn.toFixed(4)}in;margin:0}</style>`,
  );
  writeFileSync(page, sized);
  chrome(["--no-pdf-header-footer", `--print-to-pdf=${destination}`, fileUrl(page)]);
}

function preview(html, widthPx, heightPx, destination) {
  const page = join(WORK, "shot.html");
  writeFileSync(page, html);
  chrome([`--window-size=${widthPx},${heightPx}`, `--screenshot=${destination}`, fileUrl(page)]);
}

// --- run --------------------------------------------------------------------

const PREVIEW_PPI = 10;

// Built once and shared by every layout: the code is the same on all of them,
// and re-encoding it per banner would be a new SVG each time for no reason.
const QR = (
  await QRCode.toString(SITE, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: INK, light: "#0000" },
  })
).replace(/<\?xml[^>]*\?>/, "");

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const facts = {};

for (const [designId, sizeId] of SHEET) {
  const s = SIZES[sizeId];
  const stem = `banner-${designId}-${trim(s.w)}x${trim(s.h)}`;

  const print = banner(designId, sizeId, 96);
  pdf(print, s.w, s.h + s.allowance + s.rail, join(OUT, `${stem}.pdf`));

  const small = banner(designId, sizeId, PREVIEW_PPI);
  preview(
    small,
    Math.round(s.w * PREVIEW_PPI),
    Math.round((s.h + s.allowance + s.rail) * PREVIEW_PPI),
    join(OUT, `${stem}.png`),
  );

  facts[`${stem}.pdf`] = {
    bytes: statSync(join(OUT, `${stem}.pdf`)).size,
    widthIn: s.w,
    heightIn: s.h + s.allowance + s.rail,
    visibleIn: s.h,
  };
  facts[`${stem}.png`] = {
    bytes: statSync(join(OUT, `${stem}.png`)).size,
    widthIn: s.w,
    heightIn: s.h + s.allowance + s.rail,
    visibleIn: s.h,
  };

  process.stdout.write(`  ${stem}.pdf\n`);
}

writeFileSync(
  MANIFEST,
  `// Generated by scripts/make-banner-artwork.mjs. Do not edit by hand.
//
// Sizes and weights of everything in public/marketing/, so the console can
// label a download without reading the file — public/ is not in the deployed
// function bundle, so at request time there is nothing to read.

export type BannerFileFacts = {
  bytes: number;
  /** The page, in inches. Wider than nothing, taller than the banner. */
  widthIn: number;
  heightIn: number;
  /** What is actually seen once it is in the stand. */
  visibleIn: number;
};

export const BANNER_FILES: Record<string, BannerFileFacts> = {
${Object.entries(facts)
  .map(
    ([file, f]) =>
      `  ${JSON.stringify(file)}: { bytes: ${f.bytes}, widthIn: ${f.widthIn}, heightIn: ${f.heightIn}, visibleIn: ${f.visibleIn} },`,
  )
  .join("\n")}
};
`,
);

rmSync(WORK, { recursive: true, force: true });

process.stdout.write(`\n  ${SHEET.length} banners into public/marketing/\n`);

function trim(n) {
  return String(n).replace(".", "-");
}
