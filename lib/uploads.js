/**
 * Shared resumable-upload logic.
 *
 * Why this exists: every image in the app is compressed in the browser to a
 * ~180 KB data URL before it is sent anywhere, and the compressed string then
 * rides along inside the record save (a product can carry several images, and a
 * bulk add can carry dozens — up to the 15 MB body cap on both servers). One
 * dropped connection therefore threw away the whole request AND the form, and
 * the retry re-sent every byte from zero.
 *
 * The fix keeps the storage model untouched — images are still stored inline in
 * the row exactly as before — but splits the *transport*:
 *
 *   1. The browser cuts a compressed image into fixed-size text chunks and
 *      uploads them one at a time. Each chunk is acknowledged by being stored,
 *      so a retry only needs the chunks the server does not already have
 *      (GET /api/uploads/:id reports them). Progress survives a page reload.
 *   2. The record save then carries the short reference `asset:<uploadId>`
 *      instead of the base64, so the request body is tiny and the thing most
 *      likely to fail is no longer the biggest thing.
 *   3. When the record is written, the server expands every `asset:<id>` back
 *      into the full data URL (assembled from the stored chunks) and deletes the
 *      chunks. The row looks exactly like one written before this existed.
 *
 * Everything here is pure logic — no express, no database — so both backends
 * share it and it can be unit tested. The storage adapter is supplied by the
 * caller (Supabase table, or db.json on the local server).
 */

const crypto = require('crypto');

// 96 KB of base64 text per chunk. A typical compressed image (~180 KB) is two
// chunks, so a retry usually re-sends at most one of them, while a 15 MB payload
// stays well under the request-body cap.
const CHUNK_CHARS = 96 * 1024;

// Storage budget for ONE image. The browser compresses every image down to a
// ≤ ~180 KB data URL before it is sent anywhere (`compressImage`/
// `squareImage` in js/utils.js), but compression is a client courtesy — nothing
// stopped a scripted client from posting an uncompressed 12 MB "image", which
// is exactly how a storage quota disappears.
//
// 2 MB is chosen to be unreachable by the app (worst case there is a few
// hundred KB) while still cutting the abuse ceiling ~6x. It is deliberately NOT
// tighter: the edit forms prefill a row's stored image into a hidden input and
// resend it inline (`value="${s.logo_url||''}"`), so a cap below what older rows
// already hold would make those records permanently unsaveable. Enforced twice —
// on the chunk session and on inline data URLs in every write body; see
// `firstOversizedImage`.
const MAX_IMAGE_CHARS = 2 * 1024 * 1024;

// Hard ceiling on one upload session, derived from the image budget so the chunk
// protocol cannot be used as a general-purpose blob store.
const MAX_CHUNKS = Math.ceil(MAX_IMAGE_CHARS / CHUNK_CHARS) + 1; // 23 → ~2.2 MB
const MAX_TOTAL_CHARS = CHUNK_CHARS * MAX_CHUNKS;

// Abandoned uploads are swept opportunistically, so an interrupted session
// cannot accumulate chunk rows forever.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// The string a record body carries in place of an inline image.
const ASSET_PREFIX = 'asset:';

function newUploadId() {
  return 'up-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex');
}

function isAssetRef(value) {
  return typeof value === 'string' && value.startsWith(ASSET_PREFIX) && value.length > ASSET_PREFIX.length;
}

function assetIdOf(value) {
  return String(value).slice(ASSET_PREFIX.length);
}

function assetRefFor(uploadId) {
  return ASSET_PREFIX + String(uploadId);
}

/** Only a data URL we produced can be re-fetched; everything else is inline. */
function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:') && value.includes(',');
}

/**
 * Validate an upload-session request.
 * @returns {{ok: true, value: {filename: string, totalChunks: number}} | {ok: false, status: number, error: string}}
 */
function validateCreate(body = {}) {
  const filename = String(body.filename || 'image').replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 120) || 'image';
  const totalChars = Number(body.totalChars);
  const totalChunks = Number(body.totalChunks);
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    return { ok: false, status: 400, error: 'totalChunks must be a positive integer.' };
  }
  if (totalChunks > MAX_CHUNKS) {
    return { ok: false, status: 413, error: `That file is too large (max ${Math.round(MAX_TOTAL_CHARS / 1024 / 1024)} MB of encoded image data).` };
  }
  if (Number.isFinite(totalChars) && totalChars > MAX_TOTAL_CHARS) {
    return { ok: false, status: 413, error: `That file is too large (max ${Math.round(MAX_TOTAL_CHARS / 1024 / 1024)} MB of encoded image data).` };
  }
  return { ok: true, value: { filename, totalChunks } };
}

/**
 * Validate one chunk of an upload session.
 * @returns {{ok: true, value: {index: number, data: string}} | {ok: false, status: number, error: string}}
 */
function validateChunk(body = {}, totalChunks) {
  const index = Number(body.index);
  const total = Number.isInteger(totalChunks) ? totalChunks : Number(body.totalChunks);
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, status: 400, error: 'A valid chunk index is required.' };
  }
  if (!Number.isInteger(total) || index >= total) {
    return { ok: false, status: 400, error: 'Chunk index is out of range for this upload.' };
  }
  const data = body.data;
  if (typeof data !== 'string' || !data.length) {
    return { ok: false, status: 400, error: 'Chunk data is required.' };
  }
  if (data.length > CHUNK_CHARS) {
    // A chunk larger than the agreed size would break the offset math, so it is
    // rejected rather than silently accepted into a misaligned assembly.
    return { ok: false, status: 413, error: `Each chunk may hold at most ${CHUNK_CHARS} characters.` };
  }
  return { ok: true, value: { index, data } };
}

/**
 * Split a data URL into chunk strings. The stored chunks are plain text, so
 * reassembly is a string join and the server never has to decode binary.
 */
function splitIntoChunks(dataUrl) {
  const text = String(dataUrl || '');
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
    chunks.push(text.slice(offset, offset + CHUNK_CHARS));
  }
  return chunks;
}

/** Which chunk indices still need to be sent, given what the server holds. */
function missingChunks(received, totalChunks) {
  const have = new Set((received || []).map(Number));
  const missing = [];
  for (let i = 0; i < Number(totalChunks); i++) {
    if (!have.has(i)) missing.push(i);
  }
  return missing;
}

/**
 * Reassemble stored chunks. Returns null when any index is missing, so a
 * partially uploaded asset can never be written into a record as a truncated
 * image.
 */
function assemble(rows, totalChunks) {
  const byIndex = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    byIndex.set(Number(row.idx), String(row.data == null ? '' : row.data));
  }
  let out = '';
  for (let i = 0; i < Number(totalChunks); i++) {
    if (!byIndex.has(i)) return null;
    out += byIndex.get(i);
  }
  return out.length ? out : null;
}

/**
 * Replace every `asset:<uploadId>` reference in a record body with the assembled
 * data URL. Returns `{ ok: false, status, error }` when an asset cannot be
 * resolved (expired or never finished), so the caller can refuse the write
 * instead of silently storing a missing image.
 *
 * `rowsByAsset` maps uploadId → stored chunk rows. The body is walked deeply
 * because images live in several shapes across tables: a plain field
 * (`logo_url`), an array (`images`), and nested objects inside `extra`.
 */
function resolveAssetRefs(value, rowsByAsset, resolved) {
  if (typeof value === 'string') {
    if (!isAssetRef(value)) return value;
    const id = assetIdOf(value);
    const entry = rowsByAsset.get(id);
    if (!entry) {
      const err = new Error('An attached image expired before the form was saved. Please re-attach it.');
      err.code = 'asset_missing';
      throw err;
    }
    const dataUrl = assemble(entry.rows, entry.totalChunks);
    if (!dataUrl) {
      const err = new Error('An attached image is incomplete. Please re-attach it.');
      err.code = 'asset_missing';
      throw err;
    }
    if (resolved) resolved.add(id);
    return dataUrl;
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveAssetRefs(v, rowsByAsset, resolved));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveAssetRefs(v, rowsByAsset, resolved);
    }
    return out;
  }
  return value;
}

/** Collect every upload id referenced by a body (used to load the chunk rows). */
function collectAssetRefs(value, found = new Set()) {
  if (typeof value === 'string') {
    if (isAssetRef(value)) found.add(assetIdOf(value));
    return found;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAssetRefs(v, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectAssetRefs(v, found);
  }
  return found;
}

/**
 * Find the first inline image in a write body that is over the storage budget.
 *
 * The browser compresses everything it uploads, so an image above the budget did
 * not come from the app — and refusing it is the only thing that actually
 * protects the storage quota, because a client is free to skip compression. Only
 * `data:image/…` strings are measured, so unrelated data URLs pass through.
 *
 * @returns {{field: string, chars: number} | null}
 */
function firstOversizedImage(value, budget = MAX_IMAGE_CHARS, field = '') {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') && value.length > budget) {
      return { field: field || 'image', chars: value.length };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = firstOversizedImage(value[i], budget, field ? `${field}[${i}]` : `[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = firstOversizedImage(v, budget, field ? `${field}.${k}` : k);
      if (found) return found;
    }
    return null;
  }
  return null;
}

module.exports = {
  CHUNK_CHARS,
  MAX_IMAGE_CHARS,
  MAX_CHUNKS,
  MAX_TOTAL_CHARS,
  SESSION_TTL_MS,
  ASSET_PREFIX,
  newUploadId,
  isAssetRef,
  assetIdOf,
  assetRefFor,
  isDataUrl,
  validateCreate,
  validateChunk,
  splitIntoChunks,
  missingChunks,
  assemble,
  resolveAssetRefs,
  collectAssetRefs,
  firstOversizedImage
};
