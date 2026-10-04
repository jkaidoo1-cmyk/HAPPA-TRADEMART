'use strict';
// Rendor profile: profile picture + share link.
//
// Two regressions guarded here:
//
//   * shareRendorProfile() put the profile URL in BOTH the share `text` and
//     the `url` field, so share sheets that render both (WhatsApp, Messages)
//     showed the link twice in one message. The link now travels only in
//     `url`; the clipboard fallback still copies text+link since it has no
//     second field to carry it.
//   * The Edit Profile modal gained a profile picture (avatar_url was already
//     an allowlisted, self-editable users column — nothing ever wrote it).
//     saveRendorProfile must send avatar_url only when it CHANGED: an
//     unchanged base64 photo would balloon every save, and removing the
//     picture must clear the column rather than silently keep it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const marketplaceSrc = fs.readFileSync(path.join(ROOT, 'js/marketplace.js'), 'utf-8');
const rendorSrc = fs.readFileSync(path.join(ROOT, 'js/rendor.js'), 'utf-8');

/** Extract a top-level function from source (brace-balanced). */
function extract(src, sig) {
  const start = src.indexOf(sig);
  assert.ok(start !== -1, `${sig} is missing`);
  let i = src.indexOf('{', start);
  assert.ok(i !== -1, `could not find the body of ${sig}`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  assert.equal(depth, 0, `could not isolate the body of ${sig}`);
  return src.slice(start, i);
}

// ── share ──────────────────────────────────────────────────────────────

function loadShareRendorProfile() {
  const body = extract(marketplaceSrc, 'function shareRendorProfile');
  const make = new Function('navigator', 'window', 'showToast', 'prompt',
    `${body}\nreturn shareRendorProfile;`);
  return make;
}

test('rendor profile share: the link appears exactly once', () => {
  let payload = null;
  const fn = loadShareRendorProfile()(
    { share: p => { payload = p; return Promise.resolve(); } },
    { location: { origin: 'https://happa.test' } },
    () => {}, () => {});
  fn('r42', 'Nana Creative');

  assert.ok(payload, 'navigator.share was not called');
  const url = 'https://happa.test/#rendor-profile/r42';
  const count = `${payload.text} ${payload.url}`.split(url).length - 1;
  assert.equal(count, 1, `link appears ${count}x in the shared payload`);
  assert.equal(payload.url, url, 'the url field must carry the profile link');
  assert.ok(payload.text.includes('Nana Creative'), 'the text should still name the rendor');
});

test('rendor profile share: clipboard fallback still copies a usable link', () => {
  let copied = '';
  const fn = loadShareRendorProfile()(
    {}, // no navigator.share — take the clipboard branch
    { location: { origin: 'https://happa.test' } },
    () => {}, () => {});
  // No clipboard either → prompt fallback captures the full text.
  fn('r42', 'Nana Creative');
  // Re-run with a clipboard stub.
  const fn2 = new Function('navigator', 'window', 'showToast', 'prompt',
    `${extract(marketplaceSrc, 'function shareRendorProfile')}\nreturn shareRendorProfile;`)(
      { clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } },
      { location: { origin: 'https://happa.test' } },
      () => {}, () => {});
  fn2('r42', 'Nana Creative');
  assert.ok(copied.includes('https://happa.test/#rendor-profile/r42'),
    'the copied text must contain the profile link');
});

// ── avatar save ────────────────────────────────────────────────────────

function makeSaveRendorProfile(fields, currentUser) {
  let sent = null;
  const body = extract(rendorSrc, 'async function saveRendorProfile');
  const save = new Function('document', 'apiPatch', 'showToast', 'saveSessions',
    'closeModalForce', 'renderRendorDashboard', 'App',
    `${body}\nreturn saveRendorProfile;`)(
      { getElementById: id => (id in fields ? { value: fields[id] } : null) },
      async (_t, _id, patch) => { sent = patch; },
      () => {}, () => {}, () => {}, () => {},
      { currentUser });
  return save().then(() => sent);
}

const baseFields = {
  'rp-name': 'Nana Creative', 'rp-cat': 'Design', 'rp-bio': 'Logos',
  'rp-price': '50', 'rp-tags': 'branding', 'rp-save-btn': null,
};

test('rendor profile: a newly picked picture is saved', async () => {
  const patch = await makeSaveRendorProfile(
    { ...baseFields, 'rp-avatar-b64': 'data:image/jpeg;base64,NEW', 'rp-avatar-keep': '' },
    { id: 'u1', avatar_url: '' });
  assert.equal(patch.avatar_url, 'data:image/jpeg;base64,NEW');
});

test('rendor profile: an unchanged picture is not re-uploaded on save', async () => {
  const patch = await makeSaveRendorProfile(
    { ...baseFields, 'rp-avatar-b64': '', 'rp-avatar-keep': 'data:image/jpeg;base64,OLD' },
    { id: 'u1', avatar_url: 'data:image/jpeg;base64,OLD' });
  assert.ok(!('avatar_url' in patch),
    `avatar_url must not be re-sent when unchanged (got keys: ${Object.keys(patch)})`);
});

test('rendor profile: removing the picture clears avatar_url', async () => {
  const patch = await makeSaveRendorProfile(
    { ...baseFields, 'rp-avatar-b64': '', 'rp-avatar-keep': '' },
    { id: 'u1', avatar_url: 'data:image/jpeg;base64,OLD' });
  assert.equal(patch.avatar_url, '', 'removal must PATCH an empty avatar_url');
});

// ── display ────────────────────────────────────────────────────────────

test('rendor profile page renders the uploaded picture over the letter avatar', () => {
  assert.ok(marketplaceSrc.includes('avatarPic'),
    'renderRendorProfilePublic must build an avatarPic element');
  assert.ok(/avatarPic\s*\n?\s*`<img[^>]*avatar_url/.test(marketplaceSrc) ||
    marketplaceSrc.includes('rendor.avatar_url'),
    'avatarPic must come from rendor.avatar_url');
});

test('rendor dashboard banner shows the uploaded picture', () => {
  assert.ok(rendorSrc.includes("u.avatar_url ? `<img"),
    'the dashboard banner must render u.avatar_url when set');
});

// ── rich share (picture + the rendor's own info) ──────────────────────
//
// The share buttons used to send a single title line. They now read the full
// post/rendor objects from RENDOR_SHARE_STORE (registered by the card
// renderers) so the message carries the description, price, category, bio and
// tags — and attaches the picture when the target accepts files. The link must
// still appear exactly once: via the `url` field for plain shares, moved into
// the caption for file shares (which drop `url`).

/** Extract a share function together with a private RENDOR_SHARE_STORE. */
function loadShareWithStore(fnName) {
  const body = extract(marketplaceSrc, 'function ' + fnName);
  return new Function('navigator', 'window', 'showToast', 'prompt', 'fetch', 'File',
    'var RENDOR_SHARE_STORE = { profiles: {}, posts: {} };\n' +
    body +
    '\nreturn { fn: ' + fnName + ', store: RENDOR_SHARE_STORE };');
}

test('rendor profile share: caption carries the info the rendor added', () => {
  let payload = null;
  const { fn, store } = loadShareWithStore('shareRendorProfile')(
    { share: p => { payload = p; return Promise.resolve(); } },
    { location: { origin: 'https://happa.test' } },
    () => {}, () => {}, async () => { throw new Error('no fetch expected'); }, File);
  store.profiles['r42'] = {
    id: 'r42', rendor_display_name: 'Nana Creative', rendor_service_cat: 'Graphic Design',
    rendor_bio: 'I design logos for brands.', rendor_starting_price: 120,
    location: 'Accra', rendor_tags: 'branding, logo design',
  };
  fn('r42', 'Nana Creative');
  assert.ok(payload, 'navigator.share was called');
  assert.ok(payload.text.includes('Graphic Design'), 'service category missing');
  assert.ok(payload.text.includes('I design logos for brands.'), 'bio missing');
  assert.ok(payload.text.includes('From GHS 120'), 'starting price missing');
  assert.ok(payload.text.includes('Skills: branding, logo design'), 'tags missing');
  assert.ok(payload.text.includes('Accra'), 'location missing');
  const url = 'https://happa.test/#rendor-profile/r42';
  assert.equal(payload.url, url, 'the url field must carry the profile link');
  assert.equal(`${payload.text} ${payload.url}`.split(url).length - 1, 1,
    'link must appear exactly once across text and url');
});

test('rendor post share: caption carries title, price, category and description', () => {
  let payload = null;
  const { fn, store } = loadShareWithStore('shareRendorPost')(
    { share: p => { payload = p; return Promise.resolve(); } },
    { location: { origin: 'https://happa.test' } },
    () => {}, () => {}, async () => { throw new Error('no fetch expected'); }, File);
  store.posts['svc-9'] = {
    post: { id: 'svc-9', title: 'Logo design', price: 250.5,
      category: 'Graphic Design', description: 'Ten logo concepts.' },
    rendor: { id: 'r42', rendor_display_name: 'Nana Creative' },
  };
  fn('svc-9', 'r42', '', '');
  assert.ok(payload, 'navigator.share was called');
  assert.ok(payload.text.includes('Logo design — GHS 250.50'), 'title + formatted price missing');
  assert.ok(payload.text.includes('Graphic Design'), 'category missing');
  assert.ok(payload.text.includes('Ten logo concepts.'), 'description missing');
  assert.ok(payload.text.includes('By Nana Creative on HAPPA TRADEMART'), 'rendor credit missing');
  const url = 'https://happa.test/#rendor-profile/r42';
  assert.equal(payload.url, url);
  assert.equal(`${payload.text} ${payload.url}`.split(url).length - 1, 1,
    'link must appear exactly once across text and url');
});

test('rendor post share: clipboard fallback copies the full caption + link', () => {
  let copied = '';
  const { fn, store } = loadShareWithStore('shareRendorPost')(
    { clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } },
    { location: { origin: 'https://happa.test' } },
    () => {}, () => {}, async () => { throw new Error('no fetch expected'); }, File);
  store.posts['svc-9'] = {
    post: { id: 'svc-9', title: 'Logo design', price: 250.5,
      category: 'Graphic Design', description: 'Ten logo concepts.' },
    rendor: { id: 'r42', rendor_display_name: 'Nana Creative' },
  };
  fn('svc-9', 'r42', '', '');
  assert.ok(copied.includes('Logo design — GHS 250.50'), 'caption missing from clipboard');
  assert.ok(copied.includes('Ten logo concepts.'), 'description missing from clipboard');
  assert.ok(copied.includes('https://happa.test/#rendor-profile/r42'), 'link missing from clipboard');
});

test('rendor post share: still works with only the inline args (empty store)', () => {
  let payload = null;
  const { fn } = loadShareWithStore('shareRendorPost')(
    { share: p => { payload = p; return Promise.resolve(); } },
    { location: { origin: 'https://happa.test' } },
    () => {}, () => {}, async () => { throw new Error('no fetch expected'); }, File);
  fn('svc-1', 'r42', 'Website design', '500');
  assert.ok(payload, 'navigator.share was called');
  assert.ok(payload.text.includes('Website design — GHS 500'), 'legacy title/price missing');
  const url = 'https://happa.test/#rendor-profile/r42';
  assert.equal(payload.url, url);
  assert.equal(`${payload.text} ${payload.url}`.split(url).length - 1, 1,
    'link must appear exactly once');
});

test('shareWithImage: a file share carries the link in the caption exactly once', async () => {
  const body = extract(marketplaceSrc, 'async function shareWithImage');
  const make = new Function('navigator', 'File', 'fetch', body + '\nreturn shareWithImage;');
  let shared = null;
  const url = 'https://happa.test/#rendor-profile/r42';
  const fn = make(
    { canShare: o => !!(o && o.files && o.files.length),
      share: p => { shared = p; return Promise.resolve(); } },
    File,
    async () => ({ ok: true, blob: async () => new Blob(['img'], { type: 'image/png' }) }));
  const done = await fn({ title: 'Logo design', text: 'The caption', url }, 'https://img/x.png', url);
  assert.equal(done, true, 'image share should report success');
  assert.ok(shared && shared.files && shared.files.length === 1, 'the picture must ride along');
  assert.ok(!('url' in shared), 'file shares drop the url field — link lives in the caption');
  assert.equal(shared.text.split(url).length - 1, 1, 'link appears exactly once in the caption');
});

test('shareWithImage: falls back cleanly when the target refuses files', async () => {
  const body = extract(marketplaceSrc, 'async function shareWithImage');
  const make = new Function('navigator', 'File', 'fetch', body + '\nreturn shareWithImage;');
  let shared = false;
  const fn = make(
    { canShare: () => false, share: () => { shared = true; return Promise.resolve(); } },
    File,
    async () => ({ ok: true, blob: async () => new Blob(['img'], { type: 'image/png' }) }));
  const done = await fn({ title: 'T', text: 'C', url: 'https://x/y' }, 'https://img/x.png', 'https://x/y');
  assert.equal(done, false, 'must decline so the caller shares text+url instead');
  assert.equal(shared, false, 'must not double-share');
});
