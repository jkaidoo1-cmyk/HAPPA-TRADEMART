'use strict';
// A rendor holds at most 5 posts at once.
//
// The dashboard can only ever *suggest* a rule — the same POST can be sent
// straight to the API — so the cap is enforced server-side on every write that
// could add a held post: creating one, and re-activating an archived one. It is
// checked by the API here (through the real express app, against an isolated
// data store) as well as by the pure rule the two servers share.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const posts = require('../lib/rendor-posts');

const RENDOR = 'rendor-1';
const OTHER = 'rendor-2';

// Publishing a post requires an active subscription, so every rendor in these
// tests owns one — otherwise the cap would never be reached.
function subscribedRendors(ids) {
  const expiry = String(Date.now() + 30 * 86400000);
  return ids.map(id => ({ id, role: 'rendor', name: id, rendor_sub_status: 'active', rendor_sub_expiry: expiry }));
}

test('a post is held while active or paused; discarding one frees the slot', () => {
  assert.equal(posts.isHeldPost({ status: 'active' }), true);
  assert.equal(posts.isHeldPost({ status: 'paused' }), true);
  assert.equal(posts.isHeldPost({}), true, 'a missing status is an active post');
  assert.equal(posts.isHeldPost({ status: 'ACTIVE' }), true);
  assert.equal(posts.isHeldPost({ status: 'archived' }), false);
  assert.equal(posts.isHeldPost({ status: 'removed' }), false);
  assert.equal(posts.isHeldPost({ status: 'active', deleted: true }), false);

  const rows = [
    { rendor_id: RENDOR, status: 'active' },
    { rendor_id: RENDOR, status: 'paused' },
    { rendor_id: RENDOR, status: 'archived' },
    { rendor_id: OTHER, status: 'active' },
  ];
  assert.equal(posts.countHeldPosts(rows, RENDOR), 2, 'archived posts and other rendors do not count');
  assert.equal(posts.countHeldPosts(rows, OTHER), 1);
});

test('the sixth held post is refused, the fifth is not', () => {
  assert.equal(posts.exceedsLimit({ body: { status: 'active' }, heldCount: 4 }), false);
  assert.equal(posts.exceedsLimit({ body: { status: 'active' }, heldCount: 5 }), true);
  assert.equal(posts.exceedsLimit({ body: {}, heldCount: 5 }), true, 'no status means active');

  // Editing a post you already hold must never be blocked.
  const held = { id: 'p1', rendor_id: RENDOR, status: 'active' };
  assert.equal(posts.exceedsLimit({ existing: held, body: { title: 'New title' }, heldCount: 5 }), false);
  // Pausing one is still an edit...
  assert.equal(posts.exceedsLimit({ existing: held, body: { status: 'paused' }, heldCount: 5 }), false);
  // ...but reviving an archived one fills a slot and is checked.
  const archived = { id: 'p2', rendor_id: RENDOR, status: 'archived' };
  assert.equal(posts.exceedsLimit({ existing: archived, body: { status: 'active' }, heldCount: 5 }), true);
  assert.equal(posts.exceedsLimit({ existing: archived, body: { status: 'active' }, heldCount: 3 }), false);
  // Discarding one always works.
  assert.equal(posts.exceedsLimit({ existing: held, body: { status: 'archived' }, heldCount: 5 }), false);
});

test('the refusal message names the limit and the way out', () => {
  const msg = posts.limitMessage(5);
  assert.match(msg, /5 posts/);
  assert.match(msg, /Delete a post/i);
  assert.equal(posts.MAX_POSTS, 5);
});

test('the client mirrors the server limit', () => {
  const src = read('js/rendor.js');
  const m = /const RENDOR_MAX_POSTS = (\d+);/.exec(src);
  assert.ok(m, 'js/rendor.js no longer declares RENDOR_MAX_POSTS');
  assert.equal(Number(m[1]), posts.MAX_POSTS, 'the dashboard and the API disagree about the limit');
  assert.match(src, /_rendorHeldPosts\(/, 'the dashboard does not compute held posts');
});

test('every write that could add a post asks the rule', () => {
  for (const file of ['api/index.js', 'server.js']) {
    const src = read(file);
    assert.match(src, /rendor-posts/, `${file} does not load the shared rule`);
    const calls = src.match(/rendorPostLimitReached\(/g) || [];
    // POST (create), PUT and PATCH (a status change can revive a post).
    assert.ok(calls.length >= 4, `${file} calls the post-limit guard only ${calls.length - 1} time(s)`);
    assert.match(
      src,
      /status\(over\.status\)\.json\(\{ error: over\.error, code: over\.code \}\)/,
      `${file} refuses without a machine-readable code`
    );
  }
  for (const file of ['api/index.js', 'server.js']) {
    assert.match(
      read(file),
      /code: 'rendor_post_limit'/,
      `${file} no longer names the refusal code`
    );
  }
});

test('the API refuses a sixth post and keeps the first five', async () => {
  // Isolate the data store: api/index.js reads and writes through this module,
  // so patching it here keeps the real db.json untouched.
  const store = { services: [], users: subscribedRendors([RENDOR, OTHER]), notifications: [], platform_revenue: [] };
  const dataStore = require('../api/data-store.js');
  const original = { getStore: dataStore.getStore, ensureTable: dataStore.ensureTable, saveToFile: dataStore.saveToFile };
  dataStore.getStore = () => store;
  dataStore.ensureTable = table => { if (!store[table]) store[table] = []; };
  dataStore.saveToFile = () => {};

  const app = require('../api/index.js');
  const { createSessionToken } = require('../lib/session');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const token = createSessionToken(RENDOR, 'rendor');
  const otherToken = createSessionToken(OTHER, 'rendor');

  const post = (body, t) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/services', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: 'Bearer ' + (t || token) }
    }, res => {
      let text = '';
      res.on('data', c => text += c);
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) {} resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  try {
    const created = [];
    for (let i = 1; i <= posts.MAX_POSTS; i++) {
      const res = await post({ title: `Post ${i}`, category: 'Design', price: 50, status: 'active' });
      assert.ok(res.status < 300, `post ${i} was refused: ${res.status} ${JSON.stringify(res.body)}`);
      created.push(res.body);
    }
    assert.equal(store.services.filter(s => s.rendor_id === RENDOR).length, 5);

    const sixth = await post({ title: 'Post 6', category: 'Design', price: 50, status: 'active' });
    assert.equal(sixth.status, 409, 'the sixth post must be refused');
    assert.equal(sixth.body.code, 'rendor_post_limit');
    assert.match(sixth.body.error, /5 posts/);
    assert.match(sixth.body.error, /Delete a post/i);
    assert.equal(store.services.filter(s => s.rendor_id === RENDOR).length, 5, 'a refused post must not be stored');

    // A paused post still holds a slot; a discarded one does not.
    const paused = await post({ title: 'Post 7', category: 'Design', price: 50, status: 'paused' });
    assert.equal(paused.status, 409);
    const archived = await post({ title: 'Draft', category: 'Design', price: 50, status: 'archived' });
    assert.ok(archived.status < 300, 'an archived post does not occupy a slot');

    // One rendor's posts never count against another's.
    for (let i = 1; i <= 4; i++) {
      const res = await post({ title: `Other ${i}`, category: 'Design', price: 50, status: 'active' }, otherToken);
      assert.ok(res.status < 300);
    }
    const otherFifth = await post({ title: 'Other 5', category: 'Design', price: 50, status: 'active' }, otherToken);
    assert.ok(otherFifth.status < 300, 'the cap is per rendor');
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(dataStore, original);
  }
});

test('reviving an archived post is refused once the slots are full', async () => {
  const store = { services: [], users: subscribedRendors([RENDOR]), notifications: [], platform_revenue: [] };
  const dataStore = require('../api/data-store.js');
  const original = { getStore: dataStore.getStore, ensureTable: dataStore.ensureTable, saveToFile: dataStore.saveToFile };
  dataStore.getStore = () => store;
  dataStore.ensureTable = table => { if (!store[table]) store[table] = []; };
  dataStore.saveToFile = () => {};

  const app = require('../api/index.js');
  const { createSessionToken } = require('../lib/session');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const token = createSessionToken(RENDOR, 'rendor');

  store.services.push(
    { id: 's-1', rendor_id: RENDOR, title: 'One', status: 'active' },
    { id: 's-2', rendor_id: RENDOR, title: 'Two', status: 'active' },
    { id: 's-3', rendor_id: RENDOR, title: 'Three', status: 'active' },
    { id: 's-4', rendor_id: RENDOR, title: 'Four', status: 'active' },
    { id: 's-5', rendor_id: RENDOR, title: 'Five', status: 'active' },
    { id: 's-6', rendor_id: RENDOR, title: 'Old', status: 'archived' }
  );

  const patch = (id, body) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/services/' + id, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: 'Bearer ' + token }
    }, res => {
      let text = '';
      res.on('data', c => text += c);
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) {} resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  try {
    const revive = await patch('s-6', { status: 'active' });
    assert.equal(revive.status, 409, 'reviving a sixth post must be refused');
    assert.equal(revive.body.code, 'rendor_post_limit');
    assert.equal(store.services.find(s => s.id === 's-6').status, 'archived', 'the refused write must not land');

    // Editing a post already held stays allowed at the cap — the cap is on
    // holding, not on saving.
    const edit = await patch('s-1', { title: 'One (edited)' });
    assert.ok(edit.status < 300, `editing a held post was refused: ${edit.status} ${JSON.stringify(edit.body)}`);

    // Freeing a slot lets the archived post come back.
    const discard = await patch('s-2', { status: 'archived' });
    assert.ok(discard.status < 300);
    const revived = await patch('s-6', { status: 'active' });
    assert.ok(revived.status < 300, `reviving after a delete was refused: ${revived.status} ${JSON.stringify(revived.body)}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(dataStore, original);
  }
});
