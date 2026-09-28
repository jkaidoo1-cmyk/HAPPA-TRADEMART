'use strict';
// Resumable uploads: the chunk session, the resume primitive and the
// `asset:<id>` reference that keeps a record save small.
//
// The behaviour under test is the thing that was missing before: an upload that
// is interrupted (or reloaded) continues from the first chunk the server is
// missing instead of starting over, and the record save carries a short token
// rather than megabytes of base64.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');

// server.js loads .env at startup and overrides the inherited environment, so
// the token minted here must use the same secret the child will use.
(function resolveFromEnvFile() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq !== -1 && trimmed.slice(0, eq).trim() === 'SESSION_SECRET') {
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (value) process.env.SESSION_SECRET = value;
    }
  }
})();

const session = require('../lib/session');
const access = require('../lib/access');
const uploads = require('../lib/uploads');

let SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
if (!SESSION_SECRET) {
  try { SESSION_SECRET = fs.readFileSync(path.join(ROOT, '.session-secret'), 'utf-8').trim(); } catch (e) {}
  if (SESSION_SECRET) process.env.SESSION_SECRET = SESSION_SECRET;
}

let tmpDir = null;
let dbFile = '';
let child = null;
let base = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function api(p, opts = {}) {
  const res = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function auth(userId, role) {
  return { Authorization: `Bearer ${session.createSessionToken(userId, role)}` };
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
}

// A data URL big enough to need several chunks (~250 KB -> 3 chunks at 96 KB).
function bigImage(marker) {
  const body = marker.padEnd(250 * 1024, 'A');
  return `data:image/jpeg;base64,${body}`;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happa-up-'));
  dbFile = path.join(tmpDir, 'db.json');
  fs.copyFileSync(path.join(ROOT, 'db.json'), dbFile);

  const db = readDb();
  const isFixture = id => String(id || '').startsWith('up-');
  db.users = (db.users || []).filter(u => !isFixture(u && u.id));
  db.upload_chunks = [];
  db.users.push(
    { id: 'up-vendor-1', name: 'Upload Vendor', email: 'up-vendor-1@test.com', role: 'vendor', status: 'active', password_hash: '$2b$10$0123456789012345678901234567890123456789012345678901' },
    { id: 'up-vendor-2', name: 'Other Vendor', email: 'up-vendor-2@test.com', role: 'vendor', status: 'active', password_hash: '$2b$10$0123456789012345678901234567890123456789012345678901' }
  );
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), HAPPA_DB_FILE: dbFile, SESSION_SECRET }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const deadline = Date.now() + 15000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('server.js did not start:\n' + log);
    try {
      const r = await fetch(base + '/settings');
      if (r.ok) break;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
});

after(() => {
  if (child) { try { child.kill('SIGKILL'); } catch (e) {} child = null; }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} tmpDir = null; }
});

// ── Pure logic ──────────────────────────────────────────────

test('uploads: chunk splitting and reassembly are lossless', () => {
  const big = 'x'.repeat(uploads.CHUNK_CHARS * 2 + 7);
  const chunks = uploads.splitIntoChunks(big);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, uploads.CHUNK_CHARS);
  assert.equal(chunks[2].length, 7);
  const rows = chunks.map((data, idx) => ({ idx, data }));
  assert.equal(uploads.assemble(rows, 3), big);
});

test('uploads: a gap in the chunks assembles to nothing', () => {
  const rows = [{ idx: 0, data: 'a' }, { idx: 2, data: 'c' }];
  assert.equal(uploads.assemble(rows, 3), null, 'a partial upload must never become a truncated image');
  assert.deepEqual(uploads.missingChunks([0, 2], 3), [1]);
});

test('uploads: oversized requests are refused', () => {
  assert.equal(uploads.validateCreate({ totalChunks: uploads.MAX_CHUNKS + 1 }).ok, false);
  assert.equal(uploads.validateCreate({ totalChunks: 2 }).ok, true);
  assert.equal(uploads.validateCreate({ totalChunks: 0 }).ok, false);
  assert.equal(uploads.validateChunk({ index: 9, data: 'x' }, 3).ok, false, 'out-of-range index');
  assert.equal(uploads.validateChunk({ index: 0, data: '' }, 3).ok, false, 'empty chunk');
  assert.equal(uploads.validateChunk({ index: 0, data: 'x'.repeat(uploads.CHUNK_CHARS + 1) }, 3).ok, false, 'oversized chunk');
  assert.equal(uploads.validateChunk({ index: 1, data: 'x' }, 3).ok, true);
});

test('uploads: only real data URLs become asset refs', () => {
  assert.equal(uploads.isAssetRef('asset:up-1'), true);
  assert.equal(uploads.isAssetRef('asset:'), false);
  assert.equal(uploads.isAssetRef('https://example.com/a.jpg'), false);
  assert.equal(uploads.isDataUrl('data:image/jpeg;base64,AAA'), true);
  assert.equal(uploads.isDataUrl('asset:up-1'), false);
});

// ── HTTP flow ───────────────────────────────────────────────

test('uploads: anonymous callers cannot start an upload session', async () => {
  const res = await api('/uploads', { method: 'POST', body: { filename: 'a.jpg', totalChunks: 1 } });
  assert.equal(res.status, 401, JSON.stringify(res.data));
});

test('uploads: an interrupted upload resumes from the first missing chunk', async () => {
  const image = bigImage('RESUME');
  const chunks = uploads.splitIntoChunks(image);

  const created = await api('/uploads', {
    method: 'POST',
    headers: auth('up-vendor-1', 'vendor'),
    body: { filename: 'resume.jpg', totalChunks: chunks.length, totalChars: image.length }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const uploadId = created.data.uploadId;

  // Only the first chunk makes it before the connection drops.
  const first = await api(`/uploads/${uploadId}/0`, {
    method: 'PUT', headers: auth('up-vendor-1', 'vendor'),
    body: { data: chunks[0], totalChunks: chunks.length, filename: 'resume.jpg' }
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.complete, false);
  assert.deepEqual(first.data.missing, [1, 2]);

  // A NEW client (page reload) asks what the server holds — it must be told to
  // send chunks 1 and 2 only, never chunk 0 again.
  const status = await api(`/uploads/${uploadId}`, { headers: auth('up-vendor-1', 'vendor') });
  assert.equal(status.status, 200, JSON.stringify(status.data));
  assert.deepEqual(status.data.received, [0]);
  assert.deepEqual(status.data.missing, [1, 2]);

  for (const idx of status.data.missing) {
    const put = await api(`/uploads/${uploadId}/${idx}`, {
      method: 'PUT', headers: auth('up-vendor-1', 'vendor'),
      body: { data: chunks[idx], totalChunks: chunks.length, filename: 'resume.jpg' }
    });
    assert.equal(put.status, 200, JSON.stringify(put.data));
  }

  const finished = await api(`/uploads/${uploadId}/finish`, { method: 'POST', headers: auth('up-vendor-1', 'vendor') });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.assetRef, `asset:${uploadId}`);
  assert.equal(finished.data.bytes, image.length);
});

test('uploads: re-sending a chunk is idempotent, and an incomplete upload can be finished', async () => {
  const image = bigImage('RETRY');
  const chunks = uploads.splitIntoChunks(image);
  const meta = { totalChunks: chunks.length, filename: 'retry.jpg' };
  const headers = auth('up-vendor-1', 'vendor');

  const created = await api('/uploads', { method: 'POST', headers, body: { filename: 'retry.jpg', totalChunks: chunks.length } });
  const uploadId = created.data.uploadId;

  await api(`/uploads/${uploadId}/0`, { method: 'PUT', headers, body: { data: chunks[0], ...meta } });
  await api(`/uploads/${uploadId}/0`, { method: 'PUT', headers, body: { data: chunks[0], ...meta } });
  const again = await api(`/uploads/${uploadId}/0`, { method: 'PUT', headers, body: { data: chunks[0], ...meta } });
  assert.deepEqual(again.data.received, [0], 'a duplicate chunk must not be stored twice');

  const early = await api(`/uploads/${uploadId}/finish`, { method: 'POST', headers });
  assert.equal(early.status, 409, JSON.stringify(early.data));
  assert.deepEqual(early.data.missing, [1, 2]);

  const rows = (readDb().upload_chunks || []).filter(r => String(r.upload_id) === String(uploadId));
  assert.equal(rows.length, 1, 'exactly one row per chunk index');
});

test('uploads: an asset ref is expanded into the image when the row is saved', async () => {
  const image = bigImage('EXPAND');
  const chunks = uploads.splitIntoChunks(image);
  const headers = auth('up-vendor-1', 'vendor');

  const created = await api('/uploads', { method: 'POST', headers, body: { filename: 'expand.jpg', totalChunks: chunks.length } });
  const uploadId = created.data.uploadId;
  for (let i = 0; i < chunks.length; i++) {
    await api(`/uploads/${uploadId}/${i}`, { method: 'PUT', headers, body: { data: chunks[i], totalChunks: chunks.length, filename: 'expand.jpg' } });
  }
  await api(`/uploads/${uploadId}/finish`, { method: 'POST', headers });

  // The save carries the short token, not 250 KB of base64.
  const saved = await api('/support_tickets', {
    method: 'POST', headers,
    body: { subject: 'Uploaded attachment', message: `asset:${uploadId}` }
  });
  assert.ok(saved.status < 300, JSON.stringify(saved.data));
  const stored = (readDb().support_tickets || []).find(t => String(t.id) === String(saved.data.id));
  assert.ok(stored, 'the ticket is persisted');
  assert.equal(stored.message, image, 'the server expanded the token back into the image');
  assert.equal(stored.user_id, 'up-vendor-1', 'ownership still comes from the session');

  // Consumed chunks are deleted, so a token cannot be replayed into a second row.
  const leftovers = (readDb().upload_chunks || []).filter(r => String(r.upload_id) === String(uploadId));
  assert.equal(leftovers.length, 0, 'the chunks are released once the record is written');

  const replay = await api('/support_tickets', {
    method: 'POST', headers,
    body: { subject: 'Replay', message: `asset:${uploadId}` }
  });
  assert.equal(replay.status, 409, JSON.stringify(replay.data));
  assert.equal(replay.data.code, 'asset_missing');
});

test('uploads: another account cannot use or read your chunks', async () => {
  const image = bigImage('OWNER');
  const chunks = uploads.splitIntoChunks(image);
  const mine = auth('up-vendor-1', 'vendor');
  const theirs = auth('up-vendor-2', 'vendor');

  const created = await api('/uploads', { method: 'POST', headers: mine, body: { filename: 'owner.jpg', totalChunks: chunks.length } });
  const uploadId = created.data.uploadId;
  await api(`/uploads/${uploadId}/0`, { method: 'PUT', headers: mine, body: { data: chunks[0], totalChunks: chunks.length, filename: 'owner.jpg' } });

  const peek = await api(`/uploads/${uploadId}`, { headers: theirs });
  assert.equal(peek.status, 404, 'another user must not see the upload at all');

  const hijack = await api(`/uploads/${uploadId}/1`, { method: 'PUT', headers: theirs, body: { data: chunks[1], totalChunks: chunks.length, filename: 'owner.jpg' } });
  assert.equal(hijack.status, 403, JSON.stringify(hijack.data));

  // And the token is worthless in someone else's record write.
  const stolen = await api('/support_tickets', { method: 'POST', headers: theirs, body: { subject: 'Sneaky', message: `asset:${uploadId}` } });
  assert.equal(stolen.status, 409, JSON.stringify(stolen.data));
  assert.equal(stolen.data.code, 'asset_missing');
});

test('uploads: a stale or unknown asset ref is refused, not silently dropped', async () => {
  const res = await api('/support_tickets', {
    method: 'POST',
    headers: auth('up-vendor-1', 'vendor'),
    body: { subject: 'Expired', message: 'asset:up-does-not-exist' }
  });
  assert.equal(res.status, 409, JSON.stringify(res.data));
  assert.equal(res.data.code, 'asset_missing');
  assert.equal((readDb().support_tickets || []).filter(t => t && t.subject === 'Expired').length, 0, 'nothing is written');
});

test('uploads: the chunk table is invisible to clients, admins included', async () => {
  // The generic table reader has no allowlist of its own, so an unlisted
  // internal table would otherwise be listed for anyone who guessed the name.
  assert.equal(access.SERVER_ONLY_TABLES.has('upload_chunks'), true);
  assert.equal(access.SERVER_ONLY_TABLES.has('otps'), true);
  const rows = [{ upload_id: 'up-secret', idx: 0, user_id: 'up-vendor-1', data: 'SECRET_IMAGE_BYTES' }];

  for (const viewer of [null, { userId: 'up-vendor-1', role: 'vendor' }, { userId: 'admin', role: 'admin' }]) {
    assert.deepEqual(access.applyReadPolicy('upload_chunks', rows, viewer), []);
  }

  const res = await api('/upload_chunks', { headers: auth('up-vendor-1', 'vendor') });
  assert.equal(JSON.stringify(res.data).includes('SECRET_IMAGE_BYTES'), false, 'chunks must never be readable over HTTP');
});

// ── Storage budget ──────────────────────────────────────────
// Compression is a browser courtesy; a scripted client can skip it entirely, so
// the ceiling that actually protects the storage quota lives on the server.

test('uploads: one image is capped, and an upload session cannot exceed it', () => {
  assert.ok(uploads.MAX_IMAGE_CHARS > 180 * 1024, 'the cap must clear the client budget (~180 KB) with room to spare');
  assert.ok(uploads.MAX_IMAGE_CHARS <= 4 * 1024 * 1024, 'but it must still bound what one image can occupy');
  assert.ok(uploads.MAX_TOTAL_CHARS < uploads.MAX_IMAGE_CHARS * 2, 'a whole upload session must stay inside one image budget');
  assert.equal(uploads.validateCreate({ totalChunks: 2, totalChars: 5 * 1024 * 1024 }).ok, false, 'a session cannot claim megabytes');

  const fine = 'data:image/jpeg;base64,' + 'A'.repeat(uploads.MAX_IMAGE_CHARS - 64);
  const tooBig = 'data:image/jpeg;base64,' + 'A'.repeat(uploads.MAX_IMAGE_CHARS + 1);
  assert.equal(uploads.firstOversizedImage({ images: [fine], logo_url: fine }), null);
  const found = uploads.firstOversizedImage({ extra: { images: [fine, tooBig] } });
  assert.ok(found, 'a nested oversized image is found');
  assert.ok(found.chars > uploads.MAX_IMAGE_CHARS);
  // Only images are measured — unrelated data URLs keep working.
  assert.equal(uploads.firstOversizedImage({ blob: 'data:application/pdf;base64,' + 'A'.repeat(uploads.MAX_IMAGE_CHARS * 2) }), null);
});

test('uploads: an uncompressed image is refused on the write path', async () => {
  const headers = auth('up-vendor-1', 'vendor');
  const banner = 'data:image/png;base64,' + 'A'.repeat(uploads.MAX_IMAGE_CHARS + 1024);
  const res = await api('/support_tickets', {
    method: 'POST', headers,
    body: { subject: 'Uncompressed', message: banner }
  });
  assert.equal(res.status, 413, JSON.stringify(res.data));
  assert.equal((readDb().support_tickets || []).filter(t => t && t.subject === 'Uncompressed').length, 0, 'nothing is written');

  // The ceiling is generous enough that a real compressed image still saves —
  // this is deliberately bigger than the client's ~180 KB target.
  const real = 'data:image/jpeg;base64,' + 'A'.repeat(250 * 1024);
  const ok = await api('/support_tickets', {
    method: 'POST', headers,
    body: { subject: 'Compressed', message: real }
  });
  assert.ok(ok.status < 300, JSON.stringify(ok.data));
  const stored = (readDb().support_tickets || []).find(t => String(t.id) === String(ok.data.id));
  assert.equal(stored.message, real, 'a normally compressed image is stored untouched');
});
