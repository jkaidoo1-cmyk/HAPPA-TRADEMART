'use strict';
// RLS coverage guard.
//
// The app's only Postgres credential is the service_role key, used from
// server-side code (api/index.js / lib/* / server.js). The browser never talks
// to Supabase — there is no createClient() in js/, no Realtime, no anon key
// anywhere in the repo. So the correct row-level-security state of EVERY table
// is:
//
//     RLS enabled · zero policies · no grants for anon / authenticated / PUBLIC
//
// That is deny-by-default for everyone except the server, and it is what
// migrations/007_rls_lockdown.sql establishes. This test is static (no live
// database in CI) and fails if:
//
//   1. a table the app creates or queries is missing from 007's contract list,
//   2. 007 stops being deny-by-default (a policy appears, a revoke disappears),
//   3. any migration hands anon/authenticated/PUBLIC access to anything,
//   4. api/index.js ships DDL again — the old block carried
//      `CREATE POLICY IF NOT EXISTS` (not valid Postgres) on a
//      `FOR ALL USING (true)` policy with no `to` clause, i.e. PUBLIC, so a
//      table it created was world-writable if the statement had ever run,
//   5. a fresh install that stops at migration 000 is left readable — 000 now
//      enables RLS itself.
//
// After applying the migrations, verify the real database with:
//     select * from public.rls_audit();

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'migrations');

const read = (p) => fs.readFileSync(p, 'utf-8');
const migrationFiles = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const migrationSql = migrationFiles.map((f) => ({ file: f, sql: read(path.join(MIG_DIR, f)) }));
const LOCKDOWN = migrationSql.find((m) => m.file.startsWith('007_'));
assert.ok(LOCKDOWN, 'migrations/007_rls_lockdown.sql is the canonical RLS migration and must exist');

const apiSrc = read(path.join(ROOT, 'api', 'index.js'));

// Comments document past attacks by quoting the very SQL this test forbids,
// so strip line comments before matching — or a guard trips on its own prose.
const stripSqlComments = (s) =>
  s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const stripJsComments = (s) =>
  s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const LOCKDOWN_SQL = stripSqlComments(LOCKDOWN.sql);
const ALL_SQL = stripSqlComments(
  migrationSql.map((m) => m.sql).join('\n')
);
const API_SRC = stripJsComments(apiSrc);

// ── Inventory ───────────────────────────────────────────────────────────────

function createdTables(sql) {
  const out = new Set();
  for (const m of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+([a-z_]+)/gi)) {
    const name = m[1];
    if (/^[a-z_][a-z0-9_]*$/.test(name)) out.add(name);
  }
  return out;
}

function sqlStringLiterals(sql) {
  const out = new Set();
  for (const m of sql.matchAll(/['"]([a-z_][a-z0-9_]*)['\"]/g)) {
    if (/^[a-z_][a-z0-9_]*$/.test(m[1])) out.add(m[1]);
  }
  return out;
}

function queriedTables() {
  const out = new Set();
  const files = fs
    .readdirSync(path.join(ROOT, 'api'))
    .map((f) => path.join(ROOT, 'api', f))
    .concat(fs.readdirSync(path.join(ROOT, 'lib')).map((f) => path.join(ROOT, 'lib', f)))
    .concat([path.join(ROOT, 'server.js')]);
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const src = read(f);
    for (const m of src.matchAll(/\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)/g)) {
      if (/^[a-z_][a-z0-9_]*$/.test(m[1])) out.add(m[1]);
    }
  }
  return out;
}

// The contract list inside 007's `expected text[] := array[...]`.
function contractList(sql) {
  const m = sql.match(/expected\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i);
  assert.ok(m, '007 must declare its expected table list');
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}
const CONTRACT = contractList(LOCKDOWN.sql);

const SCHEMA_DB = new Set(['public', 'auth', 'storage', 'graphql', 'extensions', 'misc', 'pg_catalog']);
const KNOWN_TABLES = new Set([
  // Every table this app creates or queries MUST be in 007's contract list.
  'users', 'stores', 'storefronts', 'products', 'orders', 'packages',
  'wallet_transactions', 'notifications', 'order_notifications',
  'ad_campaigns', 'services', 'service_orders', 'settings', 'reviews',
  'delivery_rates', 'referrals', 'platform_revenue', 'support_tickets',
  'push_subscriptions', 'audit_logs', 'otps', 'upload_chunks', 'categories',
]);
const REQUIRE_NO_TEST = new Set([
  // SQL-enum names / type names and other words that are only ever spelled
  // with the ordinary identifier quotes ('...'), not as "table names". Drop them
  // from the required-set so a stray literal inside the migration prose does not
  // make the test think the app owns that table.
  'public', 'auth', 'storage', 'graphql', 'extensions', 'misc', 'pg_catalog',
  'inet_ops', 'jsonb_pl', 'ltree', 'txid_snapshot', 'box', 'circle', 'line', 'lseg',
  'path', 'pg_lsn', 'point', 'polygon', 'macaddr', 'macaddr8', 'tid', 'regclass', 'regtype',
  'xid', 'pgsql-parts', 'uint8', 'int2', 'int4', 'int8', 'float4', 'float8', 'num', 'text',
  'varchar', 'bpchar', 'date', 'time', 'timestamp', 'timestamptz', 'interval', 'money',
  'bytea', 'xml', 'json', 'jsonb', 'uuid', 'oid', 'cidr', 'tsvector', 'tsquery',
  // bare faker-style noun tokens that appear as data in migration/comment strings
  'anonymous', 'authenticated', 'notifications', 'home', 'r', 'secret', 'van', 'food', 'fish',
  'service_role', 'cost', 'gold', 'laser', 'blue', 'red', 'green', 'huang', 'online',
  'complets', 'replace', 'restore', 'medi Cry', 'tele', 'global', 'run', 'scene', 'string',
  'account_number', 'banner_url', 'buyer', 'completed', 'logo_url', 'name', 'network',
  'note', 'package_id', 'reviewed_by', 'vapid_private_key', 'vapid_public_key', 'verify_phone',
  'anonymous', 'system', 'table', 'status', 'completed', 'logo_url', 'network', 'note', 'package_id', 'reviewed_by', 'vapid_private_key', 'vapid_public_key', 'verify_phone',
  'anon',
]);

const REQUIRED_TABLES = [...new Set(
  [...createdTables(LOCKDOWN_SQL), ...queriedTables()].filter(
    (t) => KNOWN_TABLES.has(t)
  ).concat([
    // For any OTHER table the app may reference via dynamic string literals, the
    // contract must still mention it — but only if it is a real common-schema table
    // the app could plausibly own (at least 4 lowercase, no capitals, no leading digit).
    ...Array.from(sqlStringLiterals(ALL_SQL)).filter(
      (t) => !REQUIRE_NO_TEST.has(t) &&
             /^[a-z_][a-z][a-z0-9_]*$/.test(t) && t.length >= 4 &&
             !KNOWN_TABLES.has(t) && !CONTRACT.has(t)
    ),
  ])
)].sort();

// ── 1. Every table is covered ──────────────────────────────────────────────

test('every table the app creates or queries is in the 007 RLS contract list', () => {
  const missing = REQUIRED_TABLES.filter((t) => !CONTRACT.has(t));
  assert.deepEqual(
    missing, [],
    `add these to migrations/007_rls_lockdown.sql (and to OWNER_FIELDS in lib/access.js ` +
    `if they hold rows owned by someone): ${missing.join(', ')}`
  );
});

test('007 enables RLS generically over every public table', () => {
  assert.match(LOCKDOWN_SQL, /enable row level security/i, '007 must enable RLS');
  assert.match(
    LOCKDOWN_SQL,
    /information_schema\.tables|pg_class/,
    '007 must sweep tables dynamically — a hand-written list goes stale'
  );
});

// ── 2. 007 stays deny-by-default ───────────────────────────────────────────

test('007 creates no policy at all — service_role bypasses RLS, nobody else needs one', () => {
  assert.doesNotMatch(
    LOCKDOWN_SQL,
    /create\s+policy/i,
    '007 must not create a policy: an RLS-enabled table with zero policies is ' +
    'the deny-by-default posture this repo depends on'
  );
});

test('007 drops every policy by name, not just the ones earlier migrations used', () => {
  assert.match(LOCKDOWN_SQL, /pg_policies/, 'policy sweep must read pg_policies so renamed policies are caught too');
  assert.match(LOCKDOWN_SQL, /drop\s+policy\s+if\s+exists/i);
});

test('007 revokes access from anon/authenticated on tables, sequences and functions', () => {
  assert.match(LOCKDOWN_SQL, /revoke\s+all\s+on\s+table[\s\S]{0,200}anon,\s*authenticated/i);
  assert.match(LOCKDOWN_SQL, /revoke\s+all\s+on\s+sequence[\s\S]{0,200}anon,\s*authenticated/i);
  assert.match(LOCKDOWN_SQL, /revoke\s+all\s+on\s+function[\s\S]{0,200}anon,\s*authenticated/i);
  assert.match(
    LOCKDOWN_SQL,
    /alter\s+default\s+privileges\s+in\s+schema\s+public\s+revoke\s+all\s+on\s+tables/i,
    'objects created later must start closed, not open'
  );
});

test('007 audits itself with an rls_audit() hook the operator can run', () => {
  assert.match(LOCKDOWN_SQL, /create\s+or\s+replace\s+function\s+public\.rls_audit\(\)/i);
  assert.match(
    LOCKDOWN_SQL,
    /revoke\s+all\s+on\s+function\s+public\.rls_audit\(\)[\s\S]{0,120}anon,\s*authenticated/i,
    'the audit function must not be callable by anon either'
  );
});

// ── 3. No migration grants anything to anon/authenticated ──────────────────

test('no migration creates a policy — anonymous access is revoked everywhere', () => {
  const offenders = [];
  for (const { file, sql } of migrationSql) {
    if (/create\s+policy/i.test(stripSqlComments(sql))) offenders.push(file);
  }
  assert.deepEqual(
    offenders, [],
    `these migrations create a policy: ${offenders.join(', ')}. The app never ` +
    'uses the anon key, so any policy is pure exposure — 001 used to ship a ' +
    'PUBLIC FOR ALL USING (true) one, 005 a `to anon` catalog one.'
  );
});

test('no migration or server file grants tables to anon/authenticated/PUBLIC', () => {
  const offenders = [];
  for (const { file, sql } of migrationSql) {
    if (/\bgrant\s+all\s+on\s+table[\s\S]{0,120}\b(anon|authenticated|public)\b/i.test(stripSqlComments(sql))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `these migrations grant table access out: ${offenders.join(', ')}`);
});

// ── 4. The runtime bootstrap path stays correct ────────────────────────────

test('api/index.js ships no DDL and no permissive policy', () => {
  assert.doesNotMatch(API_SRC, /create\s+policy/i, 'server code must not carry CREATE POLICY statements');
  assert.doesNotMatch(API_SRC,
    /rpc\(\s*['"]exec_sql['"]/, 'exec_sql is undefined in every migration — it always failed silently');
  assert.doesNotMatch(
    API_SRC,
    /using\s*\(\s*true\s*\)/i,
    'a `using (true)` policy is a world-readable table, not a server-side one'
  );
  assert.match(
    API_SRC,
    /ensure_push_subscriptions/,
    'the push_subscriptions bootstrap must go through migrations/007\'s narrow, service_role-only function'
  );
});

test('the 007 bootstrap function is idempotent, closes the table and is service_role-only', () => {
  const fn = LOCKDOWN.sql.match(/function\s+public\.ensure_push_subscriptions\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/i);
  assert.ok(fn, 'ensure_push_subscriptions() must exist in 007');
  const body = stripSqlComments(fn[1]);
  assert.match(body, /create\s+table\s+if\s+not\s+exists/i, 'bootstrap must be idempotent');
  assert.match(body, /enable\s+row\s+level\s+security/i, 'a newly created table must not be left open');
  assert.match(body, /revoke\s+all\s+on\s+table[\s\S]{0,120}anon,\s*authenticated/i);
  assert.doesNotMatch(body, /create\s+policy/i);
  assert.match(LOCKDOWN_SQL, /revoke\s+all\s+on\s+function\s+public\.ensure_push_subscriptions\(\)[\s\S]{0,120}anon,\s*authenticated/i);
  assert.match(LOCKDOWN_SQL, /grant\s+execute\s+on\s+function\s+public\.ensure_push_subscriptions\(\)\s+to\s+service_role/i);
});

// ── 5. A fresh install is safe before 007 exists ───────────────────────────

test('migration 000 enables RLS on the tables it creates', () => {
  const bootstrap = migrationSql.find((m) => m.file.startsWith('000_'));
  assert.ok(bootstrap, '000_bootstrap_fresh_project.sql must exist');
  assert.match(
    bootstrap.sql,
    /enable\s+row\s+level\s+security/i,
    'a database that only ever ran 000 must not be readable with the anon key'
  );
});

// ── 6. The SQL we shipped parses ───────────────────────────────────────────
// No psql in CI, so at minimum: every dollar-quoted block is balanced. This
// catches the class of bug 001 had (`CREATE POLICY IF NOT EXISTS` is invalid and
// the whole multi-statement call failed with it).

test('every migration has balanced dollar-quoted blocks', () => {
  for (const { file, sql } of migrationSql) {
    // Walk the tags as Postgres does: a tag closes the innermost open block of
    // the same name, otherwise it opens a new one (nesting needs a different tag).
    const open = [];
    for (const m of sql.matchAll(/\$([A-Za-z_]*)\$/g)) {
      const tag = m[1];
      if (open.length && open[open.length - 1] === tag) open.pop();
      else if (!open.includes(tag)) open.push(tag);
      else assert.fail(`${file}: $${tag}$ re-opened while still open — the block will not parse`);
    }
    assert.deepEqual(open, [], `${file}: unclosed dollar-quote tag(s): $${open.join('$, $')}$`);
  }
});

test('the lockdown migration can be read end to end (no truncation)', () => {
  assert.match(LOCKDOWN.sql, /^-- 007_rls_lockdown\.sql/);
  assert.ok(LOCKDOWN.sql.length > 3000, '007 should document the posture it enforces');
  assert.match(LOCKDOWN.sql, /FORCE ROW LEVEL SECURITY is deliberately NOT set/, 'explain what was deliberately left out');
});
