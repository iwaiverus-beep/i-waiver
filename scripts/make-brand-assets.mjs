#!/usr/bin/env node
/**
 * Draws the downloadable brand kit into public/brand/.
 *
 * The logo has never existed as a file. It is drawn in components/Mark.tsx and
 * redrawn in scripts/make-icons.mjs, which is fine for the product and useless
 * the moment somebody needs it on a shirt, in an advertisement, or as a profile
 * picture. This script is the one place that turns the mark into artwork other
 * people can be handed, and /admin/marketing is where they collect it.
 *
 *   node scripts/make-brand-assets.mjs
 *
 * The output is committed. A normal build never runs this — re-run it only when
 * the mark in components/Mark.tsx or the name in lib/brand.ts changes, and
 * commit what it writes.
 *
 * No new dependency. Rasterising a typeface needs a font engine, and the two
 * obvious ones — sharp and resvg — are tens of megabytes of native binary that
 * would sit in the dependency tree, and therefore the audit surface, forever in
 * order to be run once a year. Chrome is already on the machine of anyone who
 * can run this, already has the font, and already renders our own SVG the way
 * the site does. So Chrome does the drawing:
 *
 *   - PNG   `--screenshot`, over a transparent backdrop
 *   - PDF   `--print-to-pdf`, which stays vector and embeds the typeface
 *   - JPEG  a second pass that paints the PNG onto a canvas and reads it back
 *           out as JPEG, because Chrome will only screenshot to PNG
 *
 * Every size is measured before it is drawn rather than guessed: a pass with
 * `--dump-dom` reports what the lockup actually came out as, and the real render
 * is then sized to fit it. A hard-coded width would mean the artwork drifting
 * off centre the first time the name or the typeface changed.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "brand");
const MANIFEST = join(ROOT, "lib", "marketing", "brand-kit.generated.ts");
const WORK = join(tmpdir(), "iwaiver-brand-" + process.pid);

// The palette, from tailwind.config.ts. Repeated rather than imported because
// this is a plain script and that file is TypeScript behind a build.
const INK = "#0B1622";
const PAPER = "#FAF9F6";
// Not `accent` (#1B5E4F). The dot has to contrast with the strokes it sits
// among, not the plate behind them, and against ink the brand green reads as a
// smudge. Same trade components/Mark.tsx makes, and for the same reason.
const DOT_COLOUR = "#1B8A72";

const NAME = "I-Waiver"; // lib/brand.ts

// --- the mark, transcribed from components/Mark.tsx -------------------------

const DOT = { x: 19, y: 17.1, r: 4.2 };
const PERF_RADIUS = 19.8;
const PERF_COUNT = 20;
const BEAD_RADIUS = 1.2;

/**
 * Beads that fall under the accent dot are dropped, so the dot reads as one
 * enlarged bead standing in for them rather than a blob covering them. Both
 * components/Mark.tsx and scripts/make-icons.mjs build this list the same way;
 * the three must not drift.
 */
const PERFORATION = Array.from({ length: PERF_COUNT }, (_, i) => {
  const angle = (i / PERF_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 32 + PERF_RADIUS * Math.cos(angle),
    y: 32 + PERF_RADIUS * Math.sin(angle),
  };
}).filter(({ x, y }) => Math.hypot(x - DOT.x, y - DOT.y) > DOT.r + BEAD_RADIUS + 0.6);

/** The mark's innards, in its own 64-unit space. `ink` is everything but the dot. */
function markBody(ink) {
  const beads = PERFORATION.map(
    (b) =>
      `<circle cx="${b.x.toFixed(3)}" cy="${b.y.toFixed(3)}" r="${BEAD_RADIUS}" fill="${ink}"/>`,
  ).join("");
  return [
    `<circle cx="32" cy="32" r="26.5" fill="none" stroke="${ink}" stroke-width="3.6"/>`,
    beads,
    `<g fill="none" stroke="${ink}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="M19 33l5 9 9-16"/><path d="M29 29l5 9 10-15"/></g>`,
    `<circle cx="${DOT.x}" cy="${DOT.y}" r="${DOT.r}" fill="${DOT_COLOUR}"/>`,
  ].join("");
}

/**
 * The mark on its own, as a standalone SVG file.
 *
 * Padded by a third of the mark on every side. A logo delivered edge to edge
 * gets set flush against whatever is next to it, because the file gives no hint
 * that it should not be; building the clear space into the artwork is the only
 * instruction that survives being emailed to a printer.
 */
function markSvg(ink) {
  const pad = 64 / 3;
  const box = 64 + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.toFixed(3)} ${box.toFixed(3)}" width="${box.toFixed(0)}" height="${box.toFixed(0)}">
<title>${NAME}</title>
<g transform="translate(${pad.toFixed(3)} ${pad.toFixed(3)})">${markBody(ink)}</g>
</svg>`;
}

// --- the lockup -------------------------------------------------------------

// The proportions the masthead uses: a 32px mark beside 18px type, 10px apart.
// Scaled rather than re-judged, so the logo somebody downloads and the logo at
// the top of the site are the same drawing.
const WORD_RATIO = 0.6;
const GAP_RATIO = 0.31;
const PAD_RATIO = 0.3;

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600&display=block";

/**
 * The lockup as an HTML page, which is what Chrome is given.
 *
 * `measure` renders it and reports the box it occupied, so the second pass can
 * be sized to the artwork instead of leaving it swimming in a canvas of guessed
 * dimensions.
 */
function lockupHtml({ mark, colour, background, measure }) {
  const font = Math.round(mark * WORD_RATIO);
  const gap = Math.round(mark * GAP_RATIO);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}">
<style>
  html,body{margin:0;padding:0;background:${background};}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh}
  #lockup{display:inline-flex;align-items:center;gap:${gap}px}
  #lockup svg{display:block}
  #word{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:${font}px;
        letter-spacing:-0.025em;line-height:1;color:${colour};
        /* The serif sits a hair high against a circular mark at this size. */
        position:relative;top:${Math.round(font * 0.02)}px}
  #measured{position:fixed;left:0;top:0;font:12px monospace;opacity:0}
</style></head><body>
<div id="lockup"><svg viewBox="0 0 64 64" width="${mark}" height="${mark}">${markBody(colour)}</svg><div id="word">${NAME}</div></div>
${measure ? '<div id="measured"></div>' : ""}
<script>
  document.fonts.ready.then(function () {
    var r = document.getElementById("lockup").getBoundingClientRect();
    var out = document.getElementById("measured");
    var w = document.getElementById("word").getBoundingClientRect();
    if (out) out.textContent = "SIZE:" + Math.ceil(r.width) + "x" + Math.ceil(r.height) + "x" + Math.ceil(w.width);
  });
</script>
</body></html>`;
}

/**
 * The typeface, subset to the eight glyphs in the name and inlined into the SVG.
 *
 * Without this the SVG is a trap. It names "Source Serif 4" and almost nobody
 * opening it has that installed, so it silently falls back to Georgia, which is
 * wider — the name then runs past the edge of the canvas the file declares, and
 * the logo arrives with its last letter sliced off. Naming a font you do not
 * ship is not a fallback, it is a defect that only shows up on someone else's
 * machine.
 *
 * Google will subset on request, so `text=` brings back a few kilobytes rather
 * than a whole family. Source Serif 4 is under the SIL Open Font License, which
 * permits embedding.
 *
 * Returns null if the fetch fails; the caller then writes a plain-text SVG and
 * says so, because a brand kit that is quietly missing a file is worse than one
 * that complains.
 */
async function embeddedFont() {
  const url =
    "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600&text=" +
    encodeURIComponent(NAME);
  // Google serves woff2 only to a user agent it believes supports it.
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
  const css = await fetch(url, { headers }).then((r) => r.text());
  // Matched on the `format()` that follows rather than on a file extension: a
  // subset comes back from /l/font?kit=... with no extension at all.
  const found = css.match(/url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/);
  if (!found) return null;
  const font = Buffer.from(await fetch(found[1], { headers }).then((r) => r.arrayBuffer()));
  return `@font-face{font-family:"Source Serif 4";font-weight:600;font-style:normal;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")}`;
}

/**
 * The lockup as a standalone SVG.
 *
 * The name stays live text rather than being converted to outlines, because
 * outlining needs a font parser and this file has no dependencies. Which means
 * planning for the day the typeface does not arrive: an SVG placed in an `<img>`
 * tag never loads `@font-face` at all — that is the format, not a bug — and
 * Illustrator ignores it too. The name then sets in Georgia, which is wider, and
 * the logo arrives with its last letter past the edge of its own canvas.
 *
 * `textLength` is the fix. It tells the renderer how much room the name occupies
 * whatever is drawing it, so the fallback is squeezed to fit rather than spilling
 * out. With the embedded face it measures the same and nothing moves; without it
 * the letters are a little tight and the logo is still a logo.
 *
 * Anyone setting this in print should still be given the PDF, which carries the
 * typeface properly rather than approximating it.
 */
function lockupSvg(ink, box, mark, fontFace) {
  const { width, height, word } = box;
  const font = Math.round(mark * WORD_RATIO);
  const gap = Math.round(mark * GAP_RATIO);
  const pad = Math.round(mark * PAD_RATIO);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + pad * 2}" height="${height + pad * 2}" viewBox="0 0 ${width + pad * 2} ${height + pad * 2}">
<title>${NAME}</title>
${fontFace ? `<defs><style type="text/css">${fontFace}</style></defs>` : ""}
<g transform="translate(${pad} ${pad + (height - mark) / 2}) scale(${(mark / 64).toFixed(6)})">${markBody(ink)}</g>
<text x="${pad + mark + gap}" y="${pad + height / 2}" dominant-baseline="central"
      textLength="${word}" lengthAdjust="spacingAndGlyphs"
      font-family="Source Serif 4, Source Serif Pro, Georgia, serif" font-weight="600"
      font-size="${font}" letter-spacing="${(-0.025 * font).toFixed(2)}" fill="${ink}">${NAME}</text>
</svg>`;
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
  "--virtual-time-budget=10000",
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

/**
 * Render a page and report the box the lockup occupied, plus the width of the
 * name on its own — the SVG pins the text to that width, see `lockupSvg`.
 */
function measure(html) {
  const page = join(WORK, "measure.html");
  writeFileSync(page, html);
  const dom = chrome(["--dump-dom", fileUrl(page)]);
  const found = dom.match(/SIZE:(\d+)x(\d+)x(\d+)/);
  if (!found) throw new Error("Could not measure the lockup — did the font load?");
  return { width: Number(found[1]), height: Number(found[2]), word: Number(found[3]) };
}

function screenshot(html, width, height, destination, transparent) {
  const page = join(WORK, "shot.html");
  writeFileSync(page, html);
  chrome([
    ...(transparent ? ["--default-background-color=00000000"] : []),
    `--window-size=${width},${height}`,
    `--screenshot=${destination}`,
    fileUrl(page),
  ]);
}

/**
 * PNG to JPEG, through a canvas.
 *
 * Chrome's `--screenshot` only writes PNG, and a JPEG cannot be transparent, so
 * the flattening colour has to be named here. The image comes back as a data URL
 * in the DOM, which is a strange way to move a file and the only one that does
 * not need a library.
 */
function toJpeg(source, destination, background, quality = 0.96) {
  const page = join(WORK, "jpeg.html");
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><div id="out"></div><script>
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        var x = c.getContext("2d");
        x.fillStyle = ${JSON.stringify(background)};
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, 0, 0);
        document.getElementById("out").textContent = c.toDataURL("image/jpeg", ${quality});
      };
      img.src = ${JSON.stringify(fileUrl(source))};
    </script>`,
  );
  const dom = chrome(["--dump-dom", fileUrl(page)]);
  const found = dom.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/);
  if (!found) throw new Error("Canvas did not hand back a JPEG for " + source);
  writeFileSync(destination, Buffer.from(found[1], "base64"));
}

function pdf(html, widthPx, heightPx, destination) {
  const page = join(WORK, "print.html");
  // Chrome prints at 96 CSS pixels to the inch, and @page has to match the
  // artwork exactly or the PDF arrives on a letter sheet with the logo in one
  // corner.
  const sized = html.replace(
    "</style>",
    `@page{size:${(widthPx / 96).toFixed(4)}in ${(heightPx / 96).toFixed(4)}in;margin:0}
     html,body{width:${widthPx}px;height:${heightPx}px;min-height:0}</style>`,
  );
  writeFileSync(page, sized);
  chrome(["--no-pdf-header-footer", `--print-to-pdf=${destination}`, fileUrl(page)]);
}

// --- the manifest -----------------------------------------------------------

/**
 * What the download page labels each link with.
 *
 * Facts only — bytes and pixels. What each file is *for* is prose, and prose
 * belongs in lib/marketing/brand-kit.ts where a person writes it and a reviewer
 * reads it; regenerating this file must never quietly rewrite the copy.
 *
 * It exists at all because the numbers cannot be read at request time. public/
 * is served from the CDN and is not in the deployed function bundle, so an
 * fs.stat there returns nothing — see the deployment notes. Baking them in at
 * generation time is the only way the page can say "218 KB" and be right.
 */
function manifestSource(files) {
  const rows = files
    .map(
      (f) =>
        `  ${JSON.stringify(f.name)}: { bytes: ${f.bytes}, width: ${f.width}, height: ${f.height} },`,
    )
    .join("\n");
  return `// Generated by scripts/make-brand-assets.mjs. Do not edit by hand.
//
// Sizes and pixel dimensions of everything in public/brand/, so the download
// page can label a link without reading the file — public/ is not in the
// deployed function bundle, so at request time there is nothing to read.

export type BrandFileFacts = { bytes: number; width: number; height: number };

export const BRAND_FILES: Record<string, BrandFileFacts> = {
${rows}
};
`;
}

// --- what gets written ------------------------------------------------------

mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

/**
 * Record a finished file, and say so.
 *
 * The sizes and dimensions end up in lib/marketing/brand-kit.generated.ts so the
 * download page can label each link honestly. Nothing reads them off disk at
 * request time: public/ is served from the CDN and is not in the deployed
 * function bundle, so a runtime fs.stat there returns nothing at all.
 */
const written = [];
function note(name, width, height) {
  const bytes = readFileSync(join(OUT, name)).length;
  written.push({ name, bytes, width, height });
  console.log(
    `  ${name.padEnd(34)} ${String(width + "x" + height).padEnd(12)} ${(bytes / 1024).toFixed(1)} KB`,
  );
}

try {
  // Vector, mark only. No text in it, so these are portable everywhere. The
  // intrinsic size is the 64-unit artwork plus a third of it on each side, which
  // is only a starting point — an SVG scales to whatever it is set at.
  const MARK_SVG_BOX = Math.round(64 + (64 / 3) * 2);


  writeFileSync(join(OUT, "i-waiver-mark.svg"), markSvg(INK));
  note("i-waiver-mark.svg", MARK_SVG_BOX, MARK_SVG_BOX);
  writeFileSync(join(OUT, "i-waiver-mark-reversed.svg"), markSvg(PAPER));
  note("i-waiver-mark-reversed.svg", MARK_SVG_BOX, MARK_SVG_BOX);

  // Raster, mark only. Drawn at 2048 because the 64-unit artwork scales to
  // anything and that is simply the largest size anyone has asked for.
  const MARK_PX = 2048;
  for (const [colour, suffix] of [
    [INK, ""],
    [PAPER, "-reversed"],
  ]) {
    const pad = Math.round(MARK_PX / 3);
    const box = MARK_PX + pad * 2;
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
      body{width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center}
      svg{display:block}</style>
      <svg viewBox="0 0 64 64" width="${MARK_PX}" height="${MARK_PX}">${markBody(colour)}</svg>`;
    const name = `i-waiver-mark${suffix}.png`;
    screenshot(html, box, box, join(OUT, name), true);
    note(name, box, box);
  }

  // The lockup. Measured once at the drawing size and reused for every format,
  // so the SVG, the PDF, the PNG and the JPEG are the same artwork.
  // Sized so the finished lockup lands near 3900px wide, which is a comfortable
  // 13 inches at 300dpi — past anything a banner or a shirt will ask for.
  const LOCKUP_MARK = 1100;
  const box = measure(
    lockupHtml({ mark: LOCKUP_MARK, colour: INK, background: "transparent", measure: true }),
  );
  const pad = Math.round(LOCKUP_MARK * PAD_RATIO);
  const canvasWidth = box.width + pad * 2;
  const canvasHeight = box.height + pad * 2;

  let fontFace = null;
  try {
    fontFace = await embeddedFont();
  } catch {
    /* reported below */
  }
  if (!fontFace) {
    console.warn(
      "  ! Could not fetch the typeface. The SVGs will name Source Serif 4\n" +
        "    without carrying it, so the name may overflow where it is not\n" +
        "    installed. Re-run with a network connection.",
    );
  }

  writeFileSync(
    join(OUT, "i-waiver-logo.svg"),
    lockupSvg(INK, box, LOCKUP_MARK, fontFace),
  );
  note("i-waiver-logo.svg", canvasWidth, canvasHeight);
  writeFileSync(
    join(OUT, "i-waiver-logo-reversed.svg"),
    lockupSvg(PAPER, box, LOCKUP_MARK, fontFace),
  );
  note("i-waiver-logo-reversed.svg", canvasWidth, canvasHeight);

  for (const variant of [
    { suffix: "", colour: INK, plate: PAPER, plateName: "-light" },
    { suffix: "-reversed", colour: PAPER, plate: INK, plateName: "-dark" },
  ]) {
    const transparentHtml = lockupHtml({
      mark: LOCKUP_MARK,
      colour: variant.colour,
      background: "transparent",
      measure: false,
    });
    const platedHtml = lockupHtml({
      mark: LOCKUP_MARK,
      colour: variant.colour,
      background: variant.plate,
      measure: false,
    });

    const png = `i-waiver-logo${variant.suffix}.png`;
    screenshot(transparentHtml, canvasWidth, canvasHeight, join(OUT, png), true);
    note(png, canvasWidth, canvasHeight);

    // Print wants vector and an embedded typeface, which is what a PDF is for.
    // The plated version, because a transparent PDF prints as whatever paper it
    // lands on and the reversed lockup then vanishes.
    const doc = `i-waiver-logo${variant.plateName}.pdf`;
    pdf(platedHtml, canvasWidth, canvasHeight, join(OUT, doc));
    note(doc, canvasWidth, canvasHeight);

    const shot = join(WORK, `plate${variant.suffix}.png`);
    screenshot(platedHtml, canvasWidth, canvasHeight, shot, false);
    const jpg = `i-waiver-logo${variant.plateName}.jpg`;
    toJpeg(shot, join(OUT, jpg), variant.plate);
    note(jpg, canvasWidth, canvasHeight);
  }

  // Square, for a profile picture. Every service that takes one crops it to a
  // circle, so the mark is set at 72% and centred — enough that the corners can
  // be thrown away without touching it.
  const SQUARE = 2048;
  for (const variant of [
    { name: "light", colour: INK, plate: PAPER },
    { name: "dark", colour: PAPER, plate: INK },
  ]) {
    const inner = Math.round(SQUARE * 0.72);
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${variant.plate}}
      body{width:${SQUARE}px;height:${SQUARE}px;display:flex;align-items:center;justify-content:center}
      svg{display:block}</style>
      <svg viewBox="0 0 64 64" width="${inner}" height="${inner}">${markBody(variant.colour)}</svg>`;
    const shot = join(WORK, `square-${variant.name}.png`);
    screenshot(html, SQUARE, SQUARE, shot, false);
    const jpg = `i-waiver-profile-${variant.name}.jpg`;
    toJpeg(shot, join(OUT, jpg), variant.plate);
    note(jpg, SQUARE, SQUARE);
    // Some services still insist on PNG for an avatar.
    const png = `i-waiver-profile-${variant.name}.png`;
    screenshot(html, SQUARE, SQUARE, join(OUT, png), false);
    note(png, SQUARE, SQUARE);
  }
  writeFileSync(MANIFEST, manifestSource(written));
  console.log(`  ${"(manifest)".padEnd(34)} ${written.length} entries`);
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

console.log(
  `\n${written.length} files in public/brand/, plus lib/marketing/brand-kit.generated.ts.` +
    "\nCommit all of it.",
);
