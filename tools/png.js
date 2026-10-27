'use strict';
// Minimal, dependency-free PNG reader/writer for the PWA icon build.
//
// The icons are the only images this repo generates, and pulling in a native
// image library (sharp/canvas) just to pad two PNGs would add a build-time
// binary to a project that otherwise has no image pipeline. Node's zlib already
// covers the interesting part, so this supports the subset the icon sources use:
// 8-bit palette (with tRNS), RGB, RGBA, greyscale and greyscale+alpha, all with
// the five standard row filters.
//
// Decoded pixels are always returned as RGBA so callers never branch on the
// source colour type.

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reads a PNG file into { width, height, data } with `data` as RGBA bytes. */
function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = y * stride;
    const prev = out - stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[out + x - channels] : 0;
      const up = y > 0 ? pixels[prev + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[prev + x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
      pixels[out + x] = value & 0xff;
    }
  }

  // Normalise every colour type to RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const o = i * 4;
    if (colorType === 6) {
      rgba[o] = pixels[p]; rgba[o + 1] = pixels[p + 1];
      rgba[o + 2] = pixels[p + 2]; rgba[o + 3] = pixels[p + 3];
    } else if (colorType === 2) {
      rgba[o] = pixels[p]; rgba[o + 1] = pixels[p + 1];
      rgba[o + 2] = pixels[p + 2]; rgba[o + 3] = 255;
    } else if (colorType === 3) {
      const idx = pixels[p] * 3;
      rgba[o] = palette[idx]; rgba[o + 1] = palette[idx + 1]; rgba[o + 2] = palette[idx + 2];
      rgba[o + 3] = transparency && pixels[p] < transparency.length ? transparency[pixels[p]] : 255;
    } else if (colorType === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p];
      rgba[o + 3] = pixels[p + 1];
    } else { // 0 — greyscale
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p];
      rgba[o + 3] = 255;
    }
  }

  return { width, height, data: rgba };
}

/**
 * Encodes RGBA bytes as a PNG.
 *
 * The alpha channel is written only when something is actually transparent:
 * the maskable icons are fully opaque on their background colour, and dropping
 * a constant `255` byte out of every pixel is free compression.
 *
 * Filters are chosen per row with the usual minimum-sum-of-absolute-differences
 * heuristic. The icons are mostly flat white with one detailed subject, so a
 * single fixed filter either leaves the subject noisy (filter 0) or the flat
 * areas worse — adaptive costs a little CPU here and saves ~20% of the file,
 * which matters because every install downloads these.
 */
function encode(width, height, rgba) {
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) { hasAlpha = true; break; }
  }

  const pixel = hasAlpha ? 4 : 3;
  const pixels = hasAlpha ? rgba : repackOpaque(width, height, rgba);
  const stride = width * pixel;
  const raw = Buffer.alloc((stride + 1) * height);
  const filtered = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let bestSum = Infinity;
    let bestFilter = 0;

    for (let filter = 0; filter < 5; filter++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= pixel ? row[x - pixel] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= pixel ? prev[x - pixel] : 0;
        let value;
        if (filter === 0) value = row[x];
        else if (filter === 1) value = row[x] - a;
        else if (filter === 2) value = row[x] - b;
        else if (filter === 3) value = row[x] - ((a + b) >> 1);
        else value = row[x] - paeth(a, b, c);
        value &= 0xff;
        sum += value < 128 ? value : 256 - value;
        filtered[x] = value;
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestFilter = filter;
        filtered.copy(raw, y * (stride + 1) + 1);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                        // bit depth
  ihdr[9] = hasAlpha ? 6 : 2;         // RGBA / RGB
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(typed) : crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function repackOpaque(width, height, rgba) {
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0, o = 0; i < width * height; i++, o += 3) {
    out[o] = rgba[i * 4];
    out[o + 1] = rgba[i * 4 + 1];
    out[o + 2] = rgba[i * 4 + 2];
  }
  return out;
}

// zlib.crc32 only exists on newer Node builds; keep a portable fallback.
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { decode, encode };
