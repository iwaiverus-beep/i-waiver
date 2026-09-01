#!/usr/bin/env node
/**
 * Draws the app icons into public/.
 *
 * Written by hand rather than pulling in sharp or resvg. Those are 30MB of
 * native binary to run once and never again, and they would sit in the
 * dependency tree — and therefore in the audit surface — forever. This needs a
 * rounded square and a tick, which is not worth a build toolchain.
 *
 * Rendered at 4x and averaged down, which is all antialiasing is. Node's zlib
 * does the PNG compression; the rest is the container format, which is short.
 *
 *   node scripts/make-icons.mjs
 *
 * Re-run only when the mark in components/Header.tsx changes. The output is
 * committed, so a normal build never touches this.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

const INK = [11, 22, 34];      // #0B1622, the same ink as the site
const PAPER = [250, 249, 246]; // #FAF9F6
// The dot is not the brand accent (#1B5E4F). It has to contrast with the marks
// it sits among, not the plate behind them, and on ink that green is nearly
// black. This is the lifted variant, the same trade the header mark makes.
const ACCENT = [111, 187, 163]; // #6FBBA3

const SS = 4; // supersampling factor

/**
 * The mark, in the same 64-unit space as `Mark` in components/Header.tsx. Keep
 * the two in step: these numbers are that SVG, transcribed.
 */
const MARK = {
  ring: { r: 26.5, halfStroke: 1.8 },
  perf: { r: 19.8, count: 20, r2: 1.2 },
  ticks: {
    halfStroke: 2.2,
    paths: [
      [[19, 33], [24, 42], [33, 26]],
      [[29, 29], [34, 38], [44, 23]],
    ],
  },
  dot: { r: 4.2 },
};

// Where to centre each variant, how wide it is, and where its dot sits — so the
// mark can be fitted to the plate without hand-tuning every size. `full` spans
// the outer ring; `plain` spans just the ticks and the dot, which is all that
// variant draws.
//
// The dot moves between the two. In the full mark it sits out on the
// perforation radius, aligned with the ring of dots. Take the ring away and
// there is nothing for it to align with, so it drops back to tittle distance
// above the left tick's shoulder — otherwise it just floats in the corner.
const FIT = {
  full:  { cx: 32,   cy: 32,   span: 56.6, fraction: 0.78, dot: { x: 19, y: 17.1 } },
  plain: { cx: 30.5, cy: 32.3, span: 31.4, fraction: 0.66, dot: { x: 19, y: 24.6 } },
};

/**
 * The perforation. Beads that fall under the accent dot are dropped, so the dot
 * reads as one enlarged bead standing in for them rather than a blob covering
 * them — left in, they poke out from underneath as white slivers. `Mark` in
 * components/Header.tsx builds the same list the same way.
 */
const PERF_DOTS = Array.from({ length: MARK.perf.count }, (_, i) => {
  const angle = (i / MARK.perf.count) * Math.PI * 2 - Math.PI / 2;
  return [32 + MARK.perf.r * Math.cos(angle), 32 + MARK.perf.r * Math.sin(angle)];
}).filter(
  ([x, y]) =>
    Math.hypot(x - FIT.full.dot.x, y - FIT.full.dot.y) >
    MARK.dot.r + MARK.perf.r2 + 0.6,
);

/** Distance from a point to a line segment — for stroking the tick. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function insideRoundedSquare(x, y, size, radius) {
  const nx = Math.max(radius - x, 0, x - (size - radius));
  const ny = Math.max(radius - y, 0, y - (size - radius));
  return Math.hypot(nx, ny) <= radius;
}

/**
 * @param size    pixels
 * @param padded  true for a maskable icon, which must survive being cropped to
 *                a circle — Android does that, and an edge-to-edge mark loses
 *                its corners. The safe zone is the middle 80%.
 * @param plain   drop the ring and the perforation, and draw the ticks larger.
 *                The perforation is 2.4 units wide in a 64-unit box, so at
 *                favicon size it stops being dots and becomes a grey ring that
 *                swallows the ticks. Optical sizing, not a different logo.
 */
function drawIcon(size, padded, plain = false) {
  const big = size * SS;
  const pixels = Buffer.alloc(size * size * 4);

  // Geometry in the supersampled space.
  const inset = padded ? big * 0.14 : 0;
  const plateSize = big - inset * 2;
  const radius = plateSize * 0.22;

  // Map the mark's 64-unit space onto the plate.
  const fit = plain ? FIT.plain : FIT.full;
  const unit = (fit.fraction * plateSize) / fit.span;
  const originX = inset + plateSize / 2 - fit.cx * unit;
  const originY = inset + plateSize / 2 - fit.cy * unit;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let plate = 0;
      let mark = 0;
      let dot = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;

          if (insideRoundedSquare(px - inset, py - inset, plateSize, radius)) plate++;

          // Back into mark space, where every number matches the SVG.
          const u = (px - originX) / unit;
          const v = (py - originY) / unit;

          if (onMark(u, v, plain)) mark++;
          if (Math.hypot(u - fit.dot.x, v - fit.dot.y) <= MARK.dot.r) dot++;
        }
      }

      const samples = SS * SS;
      const plateAlpha = plate / samples;
      const markAlpha = mark / samples;
      const dotAlpha = dot / samples;

      // Dot over mark, mark over plate, plate over transparency.
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = INK[channel] * plateAlpha;
        value = value * (1 - markAlpha) + PAPER[channel] * markAlpha;
        value = value * (1 - dotAlpha) + ACCENT[channel] * dotAlpha;
        pixels[offset + channel] = Math.round(value);
      }
      pixels[offset + 3] = Math.round(
        Math.max(plateAlpha, markAlpha, dotAlpha) * 255,
      );
    }
  }

  return encodePng(pixels, size, size);
}

/** Everything drawn in paper: the ring, the perforation and the two ticks. */
function onMark(u, v, plain) {
  for (const [a, b, c] of MARK.ticks.paths) {
    if (
      distanceToSegment(u, v, ...a, ...b) <= MARK.ticks.halfStroke ||
      distanceToSegment(u, v, ...b, ...c) <= MARK.ticks.halfStroke
    ) {
      return true;
    }
  }

  if (plain) return false;

  const fromCentre = Math.hypot(u - 32, v - 32);
  if (Math.abs(fromCentre - MARK.ring.r) <= MARK.ring.halfStroke) return true;

  return PERF_DOTS.some(([dx, dy]) => Math.hypot(u - dx, v - dy) <= MARK.perf.r2);
}

// --- PNG container ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Every scanline gets a filter byte. Filter 0 (none) keeps this simple; the
  // images are small and flat, so deflate handles them well regardless.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const icons = [
  ["icon-192.png", 192, false, false],
  ["icon-512.png", 512, false, false],
  // Android crops these to whatever shape the launcher uses.
  ["icon-192-maskable.png", 192, true, false],
  ["icon-512-maskable.png", 512, true, false],
  // iOS ignores the manifest's icons and uses this one. It also does not
  // respect transparency, which is why the plate goes edge to edge.
  ["apple-touch-icon.png", 180, false, false],
  // Too small for the perforation to survive — ticks and dot only.
  ["favicon-32.png", 32, false, true],
];

for (const [name, size, padded, plain] of icons) {
  const png = drawIcon(size, padded, plain);
  writeFileSync(join(OUT, name), png);
  console.log(
    `  ${name.padEnd(26)} ${size}x${size}`.padEnd(44) +
      `${plain ? "simplified" : "full"}  ${(png.length / 1024).toFixed(1)} KB`,
  );
}
