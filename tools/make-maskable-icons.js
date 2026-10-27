'use strict';
// Rebuilds the maskable PWA icons from their current artwork.
//
// Why this exists: Android scales a `purpose: maskable` icon to fill whatever
// launcher shape the device uses, so the artwork has to sit inside the central
// 80% safe-zone circle on an opaque background. The shipped icons do that, but
// the first padded pass shrank the bag too far — it read as a small stamp on
// the launcher and the Android 12 launch splash. This script re-renders the
// same artwork at ART_SCALE times its current size, keeping it inside the safe
// zone and still far smaller than the original full-bleed art it replaced.
//
//   node tools/make-maskable-icons.js            # rewrite both icons
//   node tools/make-maskable-icons.js --scale 1.2
//
// Run `npm test` afterwards: test/performance-assets.test.js enforces the
// maskable purpose split and the per-file size budget.

const fs = require('node:fs');
const path = require('node:path');
const { decode, encode } = require('./png');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
  { file: 'images/icon-maskable-192.png', size: 192 },
  { file: 'images/icon-maskable-512.png', size: 512 },
];

// 1.2× the previous padded size: big enough to stop reading as a stamp, still
// nowhere near the full-bleed art that Android cropped.
const DEFAULT_SCALE = 1.2;
const BACKGROUND = [255, 255, 255, 255];

function parseArgs(argv) {
  const i = argv.indexOf('--scale');
  if (i === -1) return DEFAULT_SCALE;
  const value = Number(argv[i + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error('--scale needs a positive number');
  return value;
}

/** Bounding box of everything that is not the (opaque) background colour. */
function artworkBox(width, height, data) {
  const [br, bg, bb] = BACKGROUND;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < 8) continue;
      const diff = Math.abs(data[o] - br) + Math.abs(data[o + 1] - bg) + Math.abs(data[o + 2] - bb);
      if (diff <= 18) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('no artwork found — is the icon already blank?');
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Catmull-Rom weight for a 4×4 resampling kernel. A plain nearest/bilinear
// stretch of 1.2× visibly softens the bag's outline, and these icons are the
// first thing a user sees on their home screen.
function catmullRom(t) {
  const a = Math.abs(t);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

function sample(src, width, height, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let total = 0;

  for (let dy = -1; dy <= 2; dy++) {
    const py = Math.min(height - 1, Math.max(0, y0 + dy));
    const wy = catmullRom(sy - (y0 + dy));
    for (let dx = -1; dx <= 2; dx++) {
      const px = Math.min(width - 1, Math.max(0, x0 + dx));
      const w = wy * catmullRom(sx - (x0 + dx));
      if (!w) continue;
      const o = (py * width + px) * 4;
      r += src[o] * w;
      g += src[o + 1] * w;
      b += src[o + 2] * w;
      a += src[o + 3] * w;
      total += w;
    }
  }

  if (!total) return [0, 0, 0, 0];
  return [
    Math.min(255, Math.max(0, Math.round(r / total))),
    Math.min(255, Math.max(0, Math.round(g / total))),
    Math.min(255, Math.max(0, Math.round(b / total))),
    Math.min(255, Math.max(0, Math.round(a / total))),
  ];
}

function build({ file, size }, scale) {
  const absolute = path.join(ROOT, file);
  const { width, height, data } = decode(fs.readFileSync(absolute));
  const box = artworkBox(width, height, data);

  const outWidth = size;
  const outHeight = size;
  const targetW = Math.round(box.width * scale);
  const targetH = Math.round(box.height * scale);
  const offsetX = Math.round((outWidth - targetW) / 2);
  const offsetY = Math.round((outHeight - targetH) / 2);

  // Start from the opaque background the manifest promises
  // (icon_background_color: #ffffff) so every pixel stays defined.
  const out = Buffer.alloc(outWidth * outHeight * 4);
  for (let i = 0; i < outWidth * outHeight; i++) {
    out[i * 4] = BACKGROUND[0];
    out[i * 4 + 1] = BACKGROUND[1];
    out[i * 4 + 2] = BACKGROUND[2];
    out[i * 4 + 3] = BACKGROUND[3];
  }

  const scaleX = box.width / targetW;
  const scaleY = box.height / targetH;

  for (let y = 0; y < targetH; y++) {
    const ty = offsetY + y;
    if (ty < 0 || ty >= outHeight) continue;
    for (let x = 0; x < targetW; x++) {
      const tx = offsetX + x;
      if (tx < 0 || tx >= outWidth) continue;

      const sx = box.x + (x + 0.5) * scaleX - 0.5;
      const sy = box.y + (y + 0.5) * scaleY - 0.5;
      const [r, g, b, a] = sample(data, width, height, sx, sy);
      if (a === 0) continue; // keep the background where the art is transparent

      const alpha = a / 255;
      const o = (ty * outWidth + tx) * 4;
      out[o] = Math.round(r * alpha + BACKGROUND[0] * (1 - alpha));
      out[o + 1] = Math.round(g * alpha + BACKGROUND[1] * (1 - alpha));
      out[o + 2] = Math.round(b * alpha + BACKGROUND[2] * (1 - alpha));
      out[o + 3] = 255;
    }
  }

  fs.writeFileSync(absolute, encode(outWidth, outHeight, out));
  const bytes = fs.statSync(absolute).size;
  console.log(
    `${file}: ${box.width}x${box.height} art → ${targetW}x${targetH} ` +
    `(${((targetW / outWidth) * 100).toFixed(1)}% of ${size}px), ${(bytes / 1024).toFixed(1)} KB`
  );

  // Maskable icons must keep their meaningful pixels inside the central 80%
  // diameter circle, otherwise a launcher with a round mask clips the bag.
  const radius = size * 0.4;
  const halfW = targetW / 2;
  const halfH = targetH / 2;
  const corner = Math.hypot(halfW, halfH);
  if (corner > radius) {
    throw new Error(
      `${file}: the artwork's corner (${corner.toFixed(1)}px) falls outside the ` +
      `${radius.toFixed(1)}px maskable safe zone — lower --scale`
    );
  }
  console.log(`  safe zone ok: corner ${corner.toFixed(1)}px < ${radius.toFixed(1)}px`);
}

const scale = parseArgs(process.argv.slice(2));
for (const source of SOURCES) build(source, scale);
