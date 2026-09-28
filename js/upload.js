/**
 * Resumable uploads (browser side).
 *
 * The problem: every image is compressed here to a ~180 KB data URL and then
 * rides inside the record save. A bulk add can carry dozens of them, so one
 * dropped connection threw away the whole request AND the form, and the retry
 * re-sent every byte from zero.
 *
 * What this does:
 *   - uploads a compressed image as small chunks, one request each, so a retry
 *     only re-sends the chunk that actually failed;
 *   - remembers the upload session per file (name + size + lastModified) in
 *     localStorage, so even after a reload it resumes from the first chunk the
 *     server is missing instead of starting over;
 *   - once every chunk is in, the image is referenced by the short token
 *     `asset:<uploadId>` in the record save (see App.apiFetch's body rewrite),
 *     which keeps the save request tiny. The server expands the token back into
 *     the data URL when it writes the row, so storage is unchanged.
 *
 * If an upload cannot be completed the image is simply sent inline, exactly as
 * before — this can slow a save down, never lose one.
 */
(function () {
  const SESSION_STATE_KEY = 'happa_upload_sessions';

  // Must match CHUNK_CHARS in lib/uploads.js. The server reports its own value
  // and wins if they ever disagree (see adoptChunkChars).
  let CHUNK_CHARS = 96 * 1024;

  const MAX_CHUNK_ATTEMPTS = 3;   // transient blips on one chunk
  const MAX_PASSES = 2;           // full sweeps over the still-missing chunks
  const PROGRESS_EVENT = 'happa-upload-progress';

  // dataUrl -> { uploadId, assetRef } for images that are fully on the server.
  const assets = new Map();
  // fingerprint -> in-flight promise, so the same file picked twice uploads once.
  const inflight = new Map();
  // URLs used by the most recent rewriteBody call, cleared after a successful save.
  let lastUsed = new Set();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function apiBase() {
    return (typeof API === 'string' && API) ? API : 'api/';
  }

  function authHeaders() {
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function readSessions() {
    try { return JSON.parse(localStorage.getItem(SESSION_STATE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function writeSessions(sessions) {
    try { localStorage.setItem(SESSION_STATE_KEY, JSON.stringify(sessions)); } catch (e) { /* private mode */ }
  }

  function forgetSession(key) {
    const sessions = readSessions();
    if (key in sessions) { delete sessions[key]; writeSessions(sessions); }
  }

  function fingerprint(file) {
    return `${file.name || 'image'}:${file.size || 0}:${file.lastModified || 0}`;
  }

  function splitIntoChunks(text) {
    const out = [];
    for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
      out.push(text.slice(offset, offset + CHUNK_CHARS));
    }
    return out;
  }

  function emitProgress(detail) {
    try {
      document.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail }));
    } catch (e) { /* older browsers: progress is cosmetic */ }
  }

  async function request(path, opts = {}) {
    const resp = await fetch(apiBase() + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) }
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* empty body */ }
    if (!resp.ok) {
      const err = new Error((data && data.error) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function adoptChunkChars(chunkChars) {
    const n = Number(chunkChars);
    if (Number.isInteger(n) && n > 0 && n !== CHUNK_CHARS) {
      console.warn('[Upload] server chunk size differs from the client — adopting', n);
      CHUNK_CHARS = n;
    }
  }

  /**
   * Send one chunk, retrying transient failures in place. A 4xx (other than a
   * rate limit) is the server saying this will never work, so it is not retried.
   */
  async function putChunk(uploadId, index, data, meta, attempts = MAX_CHUNK_ATTEMPTS) {
    let lastErr = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await request(`uploads/${encodeURIComponent(uploadId)}/${index}`, {
          method: 'PUT',
          body: JSON.stringify({ data, totalChunks: meta.totalChunks, filename: meta.filename })
        });
      } catch (e) {
        lastErr = e;
        const status = e && e.status;
        if (status && status >= 400 && status < 500 && status !== 429) throw e;
        await sleep(300 * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error('Chunk upload failed.');
  }

  /**
   * Upload a compressed image, resuming any earlier attempt for the same file.
   * @returns {Promise<{assetRef: string|null, dataUrl: string}>}
   */
  async function store(file, dataUrl, onProgress) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return { assetRef: null, dataUrl };
    // Anonymous visitors (guest checkout) have no session to own chunks, so the
    // image stays inline — same as before this existed. NOTE: `App` is a
    // top-level `const`, so it is NOT a property of window — testing
    // `window.App` is always false and would silently disable every upload.
    if (typeof App === 'undefined' || !App.currentUser) return { assetRef: null, dataUrl };

    const key = fingerprint(file);
    if (inflight.has(key)) {
      try { await inflight.get(key); } catch (e) { /* the earlier attempt reports for itself */ }
    }

    const job = (async () => {
      const chunks = splitIntoChunks(dataUrl);
      for (let pass = 0; pass <= MAX_PASSES; pass++) {
        let sessions = readSessions();
        let entry = sessions[key];

        // A different length means the file was re-compressed with different
        // settings — the stored chunks would assemble into a mangled image, so
        // the old session is discarded instead of resumed.
        if (entry && (entry.totalChars !== dataUrl.length || entry.totalChunks !== chunks.length)) {
          entry = null;
          delete sessions[key];
          writeSessions(sessions);
        }

        if (!entry) {
          const created = await request('uploads', {
            method: 'POST',
            body: JSON.stringify({ filename: file.name || 'image', totalChunks: chunks.length, totalChars: dataUrl.length })
          });
          adoptChunkChars(created && created.chunkChars);
          entry = { uploadId: created.uploadId, totalChars: dataUrl.length, totalChunks: chunks.length, received: [] };
          sessions = readSessions();
          sessions[key] = entry;
          writeSessions(sessions);
        }

        // Ask the server which chunks it already holds. THIS is the resume: an
        // interrupted upload, or one from a previous page load, only sends what
        // is missing.
        let received = new Set((entry.received || []).map(Number));
        try {
          const status = await request('uploads/' + encodeURIComponent(entry.uploadId));
          adoptChunkChars(status && status.chunkChars);
          received = new Set((status.received || []).map(Number));
        } catch (e) {
          if (e && e.status === 404) {
            // The session is gone (swept after 24h, or another instance never
            // saw it). Forget it and start clean rather than resuming into nothing.
            forgetSession(key);
            if (pass >= MAX_PASSES) throw e;
            continue;
          }
          // Offline or a server hiccup: keep the state and let the chunk sends
          // below decide — they may still succeed.
        }

        const pending = [];
        for (let i = 0; i < chunks.length; i++) if (!received.has(i)) pending.push(i);

        let lost = false;
        for (const index of pending) {
          try {
            await putChunk(entry.uploadId, index, chunks[index], { totalChunks: chunks.length, filename: file.name || 'image' });
            received.add(index);
            // Persist after every chunk so a reload mid-upload resumes here.
            const live = readSessions();
            live[key] = { ...entry, received: [...received].sort((a, b) => a - b) };
            writeSessions(live);
            if (typeof onProgress === 'function') onProgress(received.size, chunks.length);
            emitProgress({ uploadId: entry.uploadId, received: received.size, totalChunks: chunks.length, name: file.name });
          } catch (e) {
            if (e && (e.status === 404 || e.status === 409)) { lost = true; break; }
            // Network/5xx on this chunk only. Everything already accepted stays
            // accepted; the next pass picks up from here.
            break;
          }
        }

        if (lost) {
          forgetSession(key);
          if (pass >= MAX_PASSES) throw new Error('Upload session lost.');
          continue;
        }

        if (received.size === chunks.length) {
          try {
            await request(`uploads/${encodeURIComponent(entry.uploadId)}/finish`, { method: 'POST', body: '{}' });
          } catch (e) {
            if (pass >= MAX_PASSES) throw e;
            await sleep(400 * Math.pow(2, pass));
            continue;
          }
          const assetRef = 'asset:' + entry.uploadId;
          assets.set(dataUrl, { uploadId: entry.uploadId, assetRef });
          forgetSession(key);
          if (typeof onProgress === 'function') onProgress(chunks.length, chunks.length);
          return { assetRef, dataUrl };
        }

        if (pass >= MAX_PASSES) break;
        await sleep(400 * Math.pow(2, pass));
      }

      // Not finished. The session stays in localStorage so the next attempt (or
      // the next page load) resumes rather than restarts, and the caller sends
      // the image inline so the user's save still works.
      console.warn('[Upload] incomplete after retries — attaching inline for now; it will resume next time');
      return { assetRef: null, dataUrl };
    })();

    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  /** Replace uploaded data URLs with their short asset tokens. */
  function rewriteBody(value, used = new Set()) {
    if (typeof value === 'string') {
      const entry = assets.get(value);
      if (entry && entry.assetRef) { used.add(value); return entry.assetRef; }
      return value;
    }
    if (Array.isArray(value)) return value.map(item => rewriteBody(item, used));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) out[k] = rewriteBody(value[k], used);
      return out;
    }
    return value;
  }

  /** True when at least one image is fully uploaded and can be referenced. */
  function hasAssets() {
    return assets.size > 0;
  }

  /**
   * Rewrite a request body, remembering which images it referenced. Call commit()
   * once the write succeeds — the server deletes the chunks it consumed, so the
   * client must stop offering those tokens.
   */
  function prepareBody(bodyString) {
    if (!hasAssets() || typeof bodyString !== 'string') return bodyString;
    let parsed;
    try { parsed = JSON.parse(bodyString); } catch (e) { return bodyString; }
    const used = new Set();
    const rewritten = rewriteBody(parsed, used);
    lastUsed = used;
    if (!used.size) return bodyString;
    return JSON.stringify(rewritten);
  }

  function commit() {
    for (const url of lastUsed) assets.delete(url);
    lastUsed = new Set();
  }

  /** Drop every pending token (an asset the server no longer has). */
  function invalidateAll() {
    assets.clear();
    lastUsed = new Set();
  }

  window.Uploader = {
    store,
    prepareBody,
    commit,
    invalidateAll,
    hasAssets,
    rewriteBody,
    CHUNK_CHARS,
    splitIntoChunks,
    _assets: assets,
    PROGRESS_EVENT
  };
  // Convenience for call sites that just want "upload this and give me the ref".
  window.resumableUpload = store;
})();
