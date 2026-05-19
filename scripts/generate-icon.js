#!/usr/bin/env node
/**
 * generate-icon.js — Zero-dependency Node.js script that emits a 128×128
 * monochrome circuit-board PNG to resources/icon.png.
 *
 * Uses only Node built-ins (fs, path, zlib). Builds a valid RGBA PNG by
 * hand: PNG signature + IHDR + IDAT (zlib-deflated filtered scanlines) +
 * IEND chunks, each with a standard PNG CRC32.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 128;
const HEIGHT = 128;
const CHANNELS = 4; // RGBA

// Foreground (monochrome light grey) and transparent background.
const FG = [220, 220, 220, 255];
const BG = [0, 0, 0, 0];

function setPixel(buf, x, y, rgba) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * CHANNELS;
  buf[i] = rgba[0];
  buf[i + 1] = rgba[1];
  buf[i + 2] = rgba[2];
  buf[i + 3] = rgba[3];
}

function fillRect(buf, x0, y0, x1, y1, rgba) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      setPixel(buf, x, y, rgba);
    }
  }
}

function fillCircle(buf, cx, cy, r, rgba) {
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(buf, x, y, rgba);
    }
  }
}

function fillAnnulus(buf, cx, cy, outerR, innerR, rgba) {
  const oR2 = outerR * outerR;
  const iR2 = innerR * innerR;
  for (let y = cy - outerR; y <= cy + outerR; y++) {
    for (let x = cx - outerR; x <= cx + outerR; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= oR2 && d2 >= iR2) setPixel(buf, x, y, rgba);
    }
  }
}

function buildPixels() {
  const buf = Buffer.alloc(WIDTH * HEIGHT * CHANNELS);
  // Initialize to transparent BG (Buffer.alloc gives zeroes, which matches BG).

  // Outer ring (annulus) centered at (64,64), outer r=58, inner r=50.
  fillAnnulus(buf, 64, 64, 58, 50, FG);

  // Four rectangular trace lines from ring edges to image edges.
  fillRect(buf, 60, 6, 68, 50, FG);    // top
  fillRect(buf, 60, 78, 68, 122, FG);  // bottom
  fillRect(buf, 6, 60, 50, 68, FG);    // left
  fillRect(buf, 78, 60, 122, 68, FG);  // right

  // Four 12×12 square "pad" nodes at trace endpoints (inset 6px from edge).
  fillRect(buf, 58, 6, 70, 18, FG);      // top pad
  fillRect(buf, 58, 110, 70, 122, FG);   // bottom pad
  fillRect(buf, 6, 58, 18, 70, FG);      // left pad
  fillRect(buf, 110, 58, 122, 70, FG);   // right pad

  // Center filled circle r=8.
  fillCircle(buf, 64, 64, 8, FG);

  return buf;
}

// --- PNG encoder helpers --------------------------------------------------

// Build the standard PNG CRC32 table (poly 0xEDB88320).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPNG(pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bitDepth=8, colorType=6 (RGBA), comp=0, filter=0, interlace=0.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // IDAT: prepend filter byte 0x00 to each scanline, then zlib-deflate.
  const rowBytes = WIDTH * CHANNELS;
  const filtered = Buffer.alloc((rowBytes + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    filtered[y * (rowBytes + 1)] = 0; // filter: None
    pixels.copy(filtered, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idatData = zlib.deflateSync(filtered);

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', iend),
  ]);
}

// --- Main -----------------------------------------------------------------

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const outDir = path.join(repoRoot, 'resources');
  const outPath = path.join(outDir, 'icon.png');

  fs.mkdirSync(outDir, { recursive: true });
  const pixels = buildPixels();
  const png = buildPNG(pixels);
  fs.writeFileSync(outPath, png);

  process.stdout.write(`resources/icon.png written (${png.length} bytes)\n`);
}

main();
