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
