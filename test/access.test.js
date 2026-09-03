const test = require('node:test');
const assert = require('node:assert/strict');

const session = require('../lib/session');
const access = require('../lib/access');

// ── lib/session: HMAC-signed token mode ────────────────────────
const OLD_SECRET = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';

test('session: HMAC token round-trips and verifies', () => {
  const token = session.createSessionToken('user-1', 'buyer');
  assert.ok(token.includes('.'));
  const req = { headers: { authorization: `Bearer ${token}` } };
  const s = session.getSessionUser(req);
  assert.equal(s.userId, 'user-1');
  assert.equal(s.role, 'buyer');
});

test('session: tampered token is rejected', () => {
  const token = session.createSessionToken('user-1', 'admin');
  const [payload] = token.split('.');
  const forged = `${payload}.${'a'.repeat(payload.length)}`;
  const req = { headers: { authorization: `Bearer ${forged}` } };
  assert.equal(session.getSessionUser(req), null);
});

test('session: expired token is rejected', () => {
  const token = session.createSessionToken('user-1', 'buyer');
  const [payload] = token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  data.exp = Date.now() - 1000;
  const expiredPayload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = require('crypto').createHmac('sha256', 'test-secret-0123456789abcdef').update(expiredPayload).digest('base64url');
  const req = { headers: { authorization: `Bearer ${expiredPayload}.${sig}` } };
  assert.equal(session.getSessionUser(req), null);
});

test('session: garbage / missing bearer is rejected', () => {
  assert.equal(session.getSessionUser({ headers: {} }), null);
  assert.equal(session.getSessionUser({ headers: { authorization: 'Basic abc' } }), null);
});

process.env.SESSION_SECRET = OLD_SECRET;

// ── lib/access: read policy ────────────────────────────────────
const ADMIN = { userId: 'admin-1', role: 'admin' };
const BUYER = { userId: 'buyer-1', role: 'buyer' };

test('access: admin sees full user rows; anonymous gets PII scrubbed', () => {
  const rows = [{ id: 'u1', name: 'Ama', email: 'ama@test.com', phone: '024111', wallet_balance: 900, id_image: 'x', role: 'buyer' }];
  const adminView = access.applyReadPolicy('users', rows, ADMIN);
  assert.equal(adminView[0].email, 'ama@test.com');

  const anonView = access.applyReadPolicy('users', rows, null);
  assert.equal(anonView[0].name, 'Ama');            // public name kept
  assert.equal(anonView[0].email, undefined);       // PII stripped
  assert.equal(anonView[0].phone, undefined);
  assert.equal(anonView[0].wallet_balance, undefined);
  assert.equal(anonView[0].id_image, undefined);
});

test('access: package rows are scrubbed for anonymous but full for owner/admin', () => {
  const rows = [{ id: 'p1', package_code: 'PK-1', buyer_id: 'buyer-1', vendor_id: 'v1', status: 'processing', total: 50, delivery_phone: '024111', delivery_address: 'Accra' }];
  assert.equal(access.applyReadPolicy('packages', rows, null)[0].delivery_phone, undefined);
  assert.equal(access.applyReadPolicy('packages', rows, null)[0].status, 'processing');
  assert.equal(access.applyReadPolicy('packages', rows, BUYER)[0].delivery_phone, '024111');
  assert.equal(access.applyReadPolicy('packages', rows, ADMIN)[0].delivery_phone, '024111');
});

test('access: owner-only tables return empty lists to anonymous', () => {
  const rows = [{ id: 'w1', user_id: 'buyer-1', amount: 10 }];
  assert.deepEqual(access.applyReadPolicy('wallet_transactions', rows, null), []);
  assert.equal(access.applyReadPolicy('wallet_transactions', rows, BUYER).length, 1);
  assert.equal(access.applyReadPolicy('wallet_transactions', rows, { userId: 'other', role: 'buyer' }).length, 0);
});

test('access: admin-only tables are invisible to non-admins', () => {
  const rows = [{ id: 'n1' }];
  assert.deepEqual(access.applyReadPolicy('order_notifications', rows, null), []);
  assert.deepEqual(access.applyReadPolicy('order_notifications', rows, BUYER), []);
  assert.equal(access.applyReadPolicy('order_notifications', rows, ADMIN).length, 1);
});

test('access: public catalog tables are readable by everyone', () => {
  const rows = [{ id: 'pr1', name: 'Sneakers' }];
  assert.equal(access.applyReadPolicy('products', rows, null).length, 1);
  assert.equal(access.applyReadPolicy('storefronts', rows, null).length, 1);
});

// ── lib/access: write policy ───────────────────────────────────
test('access: server-internal tables reject client writes', () => {
  assert.equal(access.assertPostAllowed('order_notifications', null, {}).ok, false);
  assert.equal(access.assertPostAllowed('audit_logs', ADMIN, {}).ok, false);
});

test('access: settings writes require admin', () => {
  assert.equal(access.assertPostAllowed('settings', null, {}).ok, false);
  assert.equal(access.assertPostAllowed('settings', ADMIN, {}).ok, true);
});

test('access: signup stays open but is sanitized', () => {
  assert.equal(access.assertPostAllowed('users', null, {}).ok, true);
  const clean = access.sanitizeUserCreate({ role: 'admin', wallet_balance: 999999, is_verified: true, name: 'X' });
  assert.equal(clean.role, 'buyer');
  assert.equal(clean.wallet_balance, 0);
  assert.equal(clean.is_verified, false);
  const vendor = access.sanitizeUserCreate({ role: 'vendor' });
  assert.equal(vendor.role, 'vendor');
});

test('access: users can edit themselves but not others, and never role/wallet', () => {
  const self = { id: 'buyer-1' };
  assert.equal(access.assertMutateAllowed('users', BUYER, self, { name: 'New' }).ok, true);
  assert.equal(access.assertMutateAllowed('users', BUYER, self, { role: 'admin' }).ok, false);
  assert.equal(access.assertMutateAllowed('users', BUYER, self, { wallet_balance: 500 }).ok, false);
  assert.equal(access.assertMutateAllowed('users', BUYER, { id: 'other' }, { name: 'Hack' }).ok, false);
  assert.equal(access.assertMutateAllowed('users', ADMIN, { id: 'other' }, { role: 'admin' }).ok, true);
  // Vendor signup upgrade: buyer → vendor is allowed for self
  assert.equal(access.assertMutateAllowed('users', BUYER, self, { role: 'vendor' }).ok, true);
});

test('access: anonymous mutations are rejected; owners/admins pass', () => {
  const pkg = { id: 'p1', vendor_id: 'v1', buyer_id: 'buyer-1' };
  assert.equal(access.assertMutateAllowed('packages', null, pkg, {}).ok, false);
  assert.equal(access.assertMutateAllowed('packages', BUYER, pkg, {}).ok, true);
  assert.equal(access.assertMutateAllowed('packages', { userId: 'v1', role: 'vendor' }, pkg, {}).ok, true);
  assert.equal(access.assertMutateAllowed('packages', { userId: 'other', role: 'vendor' }, pkg, {}).ok, false);
  assert.equal(access.assertMutateAllowed('packages', ADMIN, pkg, {}).ok, true);
});

test('access: rendors can never self-activate or self-quote a subscription', () => {
  const RENDOR = { userId: 'rendor-1', role: 'rendor' };
  const self = { id: 'rendor-1' };
  // Admin-only fields are rejected for a rendor editing their own row
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { rendor_sub_status: 'active' }).ok, false);
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { rendor_sub_expiry: String(Date.now() + 1e12) }).ok, false);
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { rendor_sub_plan: 'biannual' }).ok, false);
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_quote_monthly: '50' }).ok, false);
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_request_status: 'quoted' }).ok, false);
  // Admin may still set them
  assert.equal(access.assertMutateAllowed('users', ADMIN, self, { rendor_sub_status: 'active', rendor_sub_expiry: String(Date.now() + 1e12) }).ok, true);
  assert.equal(access.assertMutateAllowed('users', ADMIN, self, { sub_quote_biannual: '150' }).ok, true);
});

test('access: rendor may only request a quote / claim payment with allowed values', () => {
  const RENDOR = { userId: 'rendor-2', role: 'rendor' };
  const self = { id: 'rendor-2' };
  // Requesting a quote is allowed; answering it is not
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_request_status: 'pending_quote' }).ok, true);
  // Claiming a payment with a concrete months + amount is allowed
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, {
    sub_payment_status: 'paid_pending',
    sub_payment_months: 3,
    sub_payment_amount: 80,
    sub_paid_at: '2026-09-03T00:00:00.000Z'
  }).ok, true);
  // Ranges are enforced (0 months, huge amounts rejected)
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_payment_months: 0 }).ok, false);
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_payment_months: 25 }).ok, false);
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_payment_amount: -5 }).ok, false);
  // A claim cannot be self-confirmed
  assert.equal(access.assertMutateAllowed('users', RENDOR, self, { sub_payment_status: 'confirmed' }).ok, false);
  // Signup can never mint an admin or grant subscription state
  const clean = access.sanitizeUserCreate({ role: 'rendor', rendor_sub_status: 'active', sub_quote_monthly: '30' });
  assert.equal(clean.role, 'rendor');
  assert.equal(clean.rendor_sub_status, undefined);
  assert.equal(clean.sub_quote_monthly, undefined);
});

test('access: rendor_sub_active is derived for public rows but raw expiry stays private', () => {
  const future = String(Date.now() + 90 * 86400000);
  const rows = [{
    id: 'r1', name: 'Ama', role: 'rendor', status: 'active',
    rendor_sub_status: 'active', rendor_sub_expiry: future, rendor_sub_plan: 'quarterly',
    sub_payment_status: 'paid_pending', sub_payment_months: 3, sub_payment_amount: 80,
    email: 'ama@test.com', phone: '024111'
  }, {
    id: 'r2', name: 'Kojo', role: 'rendor', status: 'active',
    rendor_sub_status: 'inactive', rendor_sub_expiry: String(Date.now() - 1000)
  }];
  const anon = access.applyReadPolicy('users', rows, null);
  assert.equal(anon[0].rendor_sub_active, true);   // paid/active rendor visible
  assert.equal(anon[1].rendor_sub_active, false);  // expired rendor hidden
  assert.equal(anon[0].rendor_sub_expiry, undefined); // raw expiry scrubbed
  assert.equal(anon[0].rendor_sub_plan, undefined);
  assert.equal(anon[0].sub_payment_status, undefined);
  assert.equal(anon[0].email, undefined);
  // Admin sees everything including the raw expiry
  const adminView = access.applyReadPolicy('users', rows, ADMIN);
  assert.equal(adminView[0].rendor_sub_expiry, future);
  assert.equal(adminView[0].sub_payment_months, 3);
});
