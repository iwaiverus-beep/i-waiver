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

const SS = 4; // supersampling factor

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
 */
function drawIcon(size, padded) {
  const big = size * SS;
  const pixels = Buffer.alloc(size * size * 4);

  // Geometry in the supersampled space.
  const inset = padded ? big * 0.14 : 0;
  const plateSize = big - inset * 2;
  const radius = plateSize * 0.22;

  // The tick, as fractions of the plate.
  const stroke = plateSize * 0.085;
  const points = [
    [0.295, 0.525],
    [0.435, 0.665],
    [0.715, 0.355],
  ].map(([fx, fy]) => [inset + fx * plateSize, inset + fy * plateSize]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let plate = 0;
      let tick = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;

          if (insideRoundedSquare(px - inset, py - inset, plateSize, radius)) plate++;

          const onTick =
            distanceToSegment(px, py, ...points[0], ...points[1]) <= stroke / 2 ||
            distanceToSegment(px, py, ...points[1], ...points[2]) <= stroke / 2;
          if (onTick) tick++;
        }
      }

      const samples = SS * SS;
      const plateAlpha = plate / samples;
      const tickAlpha = tick / samples;

      // Tick over plate, plate over transparency.
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const base = INK[channel] * plateAlpha;
        pixels[offset + channel] = Math.round(
          base * (1 - tickAlpha) + PAPER[channel] * tickAlpha,
        );
      }
      pixels[offset + 3] = Math.round(Math.max(plateAlpha, tickAlpha) * 255);
    }
  }

  return encodePng(pixels, size, size);
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
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  // Android crops these to whatever shape the launcher uses.
  ["icon-192-maskable.png", 192, true],
  ["icon-512-maskable.png", 512, true],
  // iOS ignores the manifest's icons and uses this one. It also does not
  // respect transparency, which is why the plate goes edge to edge.
  ["apple-touch-icon.png", 180, false],
  ["favicon-32.png", 32, false],
];

for (const [name, size, padded] of icons) {
  const png = drawIcon(size, padded);
  writeFileSync(join(OUT, name), png);
  console.log(`  ${name.padEnd(26)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
