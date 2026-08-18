/**
 * Shared API access-control layer for HAPPA TRADEMART.
 *
 * Used by server.js (local dev) and api/index.js (deployed backend).
 *
 * Policy summary:
 *  - Reads: catalog tables are public; PII-bearing tables are returned only to
 *    the owner (or admin) and are scrubbed for everyone else. Anonymous users
 *    get scrubbed rows for users/packages/orders, and empty lists for
 *    wallet/support/notifications/referrals/platform-revenue/audit tables.
 *  - Writes: signup and checkout must stay open, so POST stays open for most
 *    tables (with role/balance coercion on users). server-internal tables
 *    (order_notifications, audit_logs) reject client writes. settings and
 *    delivery_rates are admin-only. Mutations (PUT/PATCH/DELETE) require the
 *    owner or an admin.
 *
 * Everything here is pure logic — no express dependency — so it can be unit
 * tested and shared by both backends.
 */

const { getSessionUser } = require('./session');

// ── Read policy ────────────────────────────────────────────────

// Catalog/content tables anyone may read (even anonymously).
const PUBLIC_READ_TABLES = new Set([
  'products', 'stores', 'storefronts', 'services', 'settings', 'ad_campaigns',
  'delivery_rates', 'reviews', 'categories'
]);

// PII-bearing tables. Anonymous readers get scrubbed rows (users/packages/
// orders are still listed publicly — marketplace names, tracking status — but
// without contact details). Logged-in users see their own rows in full.
const SCRUBBED_PUBLIC_READ_TABLES = new Set(['users', 'packages', 'orders']);

// Tables only the row-owner (or an admin) may read. Anonymous → empty list.
const OWNER_READ_TABLES = {
  wallet_transactions: ['user_id'],
  support_tickets: ['user_id'],
  notifications: ['user_id'],
  referrals: ['referrer_id', 'referred_id'],
  service_orders: ['buyer_id', 'rendor_id']
};

// Tables only admins may read.
const ADMIN_ONLY_READ_TABLES = new Set([
  'order_notifications', 'platform_revenue', 'audit_logs'
]);

// ── Write policy ───────────────────────────────────────────────

// Tables written exclusively by server-side code — client writes are rejected.
const BLOCKED_CLIENT_WRITE_TABLES = new Set(['order_notifications', 'audit_logs']);

// Tables only admins may write (create/update/delete).
const ADMIN_ONLY_WRITE_TABLES = new Set(['settings', 'delivery_rates']);

// Owner-identity columns per table, used to authorize PUT/PATCH/DELETE.
// The record matches if ANY of these fields equals the session user id.
const OWNER_FIELDS = {
  users: ['id'],
  stores: ['vendor_id'],
  storefronts: ['vendor_id'],
  products: ['vendor_id'],
  orders: ['buyer_id', 'vendor_id'],
  packages: ['buyer_id', 'vendor_id'],
  wallet_transactions: ['user_id'],
  support_tickets: ['user_id'],
  notifications: ['user_id'],
  referrals: ['referrer_id', 'referred_id'],
  reviews: ['buyer_id', 'customer_id'],
  services: ['rendor_id'],
  service_orders: ['buyer_id', 'rendor_id'],
  ad_campaigns: ['vendor_id']
};

// Fields a non-admin may never set on a user record (admin-only).
const ADMIN_ONLY_USER_FIELDS = ['role', 'status', 'wallet_balance', 'is_verified', 'id_verified', 'password_hash'];

// Roles a user may self-assign via POST/PATCH (never 'admin').
const SELF_ASSIGNABLE_ROLES = ['buyer', 'vendor', 'rendor'];

// ── Helpers ────────────────────────────────────────────────────

function getAccessContext(req) {
  return getSessionUser(req); // { userId, role } | null
}

function isAdmin(viewer) {
  return !!viewer && String(viewer.role) === 'admin';
}

function isOwner(viewer, record, table) {
  if (!viewer) return false;
  const fields = OWNER_FIELDS[table];
  if (!fields) return false;
  const uid = String(viewer.userId);
  return fields.some(f => record != null && String(record[f] ?? '') === uid);
}

/**
 * Strip personally-identifiable / sensitive fields from a record for a viewer
 * who is neither the owner nor an admin.
 */
function scrubPII(table, rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const out = { ...rec };
  const drop = (keys) => { for (const k of keys) delete out[k]; };

  if (table === 'users') {
    // Keep public marketplace profile (name, avatar, role, location, rendor
    // public contact fields). Drop everything a stranger must not see.
    drop(['email', 'phone', 'wallet_balance', 'id_image', 'proof_sales_1', 'proof_sales_2',
      'proof_sales_3', 'proof_share', 'referral_code', 'referred_by', 'referral_earnings',
      'is_verified', 'id_verified', 'whatsapp_phone', 'receive_order_notifications_on_whatsapp',
      'extra', 'password', 'registered_at', 'sub_request_status', 'sub_quote_monthly',
      'sub_quote_quarterly', 'sub_quote_biannual', 'rendor_sub_expiry']);
  } else if (table === 'packages' || table === 'orders') {
    // Tracking needs status/totals/items — but not the customer's contact data.
    drop(['delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location',
      'buyer_id', 'notes', 'origin_location', 'dest_location', 'tracking_number',
      'tracking_link', 'buyer_name', 'buyer_phone', 'buyer_email']);
  } else if (table === 'support_tickets') {
    drop(['user_email', 'user_phone', 'user_id']);
  } else if (table === 'wallet_transactions') {
    drop(['account_number', 'network', 'user_id', 'balance_before', 'balance_after']);
  } else if (table === 'reviews') {
    drop(['customer_id', 'buyer_id']);
  } else if (table === 'referrals') {
    drop(['referrer_id', 'referred_id']);
  }
  return out;
}

/**
 * Apply the read policy to a list of rows for a given viewer.
 * @returns {Array} the rows the viewer may see (scrubbed where required).
 */
function applyReadPolicy(table, rows, viewer) {
  if (!Array.isArray(rows)) return rows;

  // Admin sees everything.
  if (isAdmin(viewer)) return rows;

  // Admin-only tables: nobody else sees anything.
  if (ADMIN_ONLY_READ_TABLES.has(table)) return [];

  // Public catalog tables: everyone sees everything.
  if (PUBLIC_READ_TABLES.has(table)) return rows;

  // PII-bearing public tables: owners in full, everyone else scrubbed.
  if (SCRUBBED_PUBLIC_READ_TABLES.has(table)) {
    return rows.map(r => isOwner(viewer, r, table) ? r : scrubPII(table, r));
  }

  // Owner-only tables: owners in full, everyone else gets nothing.
  if (OWNER_READ_TABLES[table]) {
    return rows.filter(r => isOwner(viewer, r, table));
  }

  // Unknown table: allow (empty collection read; matches current generic behavior).
  return rows;
}

/**
 * Authorize a POST (create).
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
function assertPostAllowed(table, viewer, body = {}) {
  if (BLOCKED_CLIENT_WRITE_TABLES.has(table)) {
    return { ok: false, status: 403, error: 'This table is managed by the server.' };
  }
  if (ADMIN_ONLY_WRITE_TABLES.has(table) && !isAdmin(viewer)) {
    return { ok: false, status: 403, error: 'Admin access required.' };
  }
  return { ok: true };
}

/**
 * Sanitize a user record on create so anonymous signup can never mint an
 * admin, set a wallet balance, or self-verify.
 */
function sanitizeUserCreate(body) {
  const out = { ...body };
  const role = String(body.role || 'buyer').toLowerCase();
  out.role = SELF_ASSIGNABLE_ROLES.includes(role) ? role : 'buyer';
  if (![undefined, null, ''].includes(body.status)) {
    const status = String(body.status).toLowerCase();
    out.status = ['active', 'pending', 'pending_approval', 'suspended'].includes(status) ? status : 'active';
  } else {
    out.status = 'active';
  }
  out.wallet_balance = 0;
  out.is_verified = false;
  out.id_verified = false;
  return out;
}

/**
 * Authorize a PUT/PATCH/DELETE against an existing record.
 * @param {string} table
 * @param {object|null} viewer session
 * @param {object|null} existingRecord the current stored record (may be null for PUT-upsert)
 * @param {object} [body] incoming body (used for users field-level rules)
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
function assertMutateAllowed(table, viewer, existingRecord, body = {}) {
  if (BLOCKED_CLIENT_WRITE_TABLES.has(table)) {
    return { ok: false, status: 403, error: 'This table is managed by the server.' };
  }
  if (ADMIN_ONLY_WRITE_TABLES.has(table)) {
    if (!isAdmin(viewer)) return { ok: false, status: 403, error: 'Admin access required.' };
    return { ok: true };
  }
  if (!viewer) {
    return { ok: false, status: 401, error: 'Unauthorized. Please sign in.' };
  }

  // Users: self or admin, with admin-only field protection.
  if (table === 'users') {
    const isSelf = existingRecord && String(existingRecord.id) === String(viewer.userId);
    if (!isAdmin(viewer) && !isSelf) {
      return { ok: false, status: 403, error: 'You can only edit your own account.' };
    }
    if (!isAdmin(viewer)) {
      for (const f of ADMIN_ONLY_USER_FIELDS) {
        if (f in body && body[f] !== undefined) {
          if (f === 'role') {
            const role = String(body.role).toLowerCase();
            if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
              return { ok: false, status: 403, error: 'You cannot set this role.' };
            }
          } else {
            return { ok: false, status: 403, error: `You cannot change ${f}.` };
          }
        }
      }
    }
    return { ok: true };
  }

  // Everyone else: owner or admin (for PUT-upsert, body may carry the owner id).
  if (isAdmin(viewer)) return { ok: true };
  if (existingRecord && isOwner(viewer, existingRecord, table)) return { ok: true };
  if (isOwner(viewer, body, table)) return { ok: true };
  return { ok: false, status: 403, error: 'You can only modify your own records.' };
}

/**
 * Best-effort audit log for privileged/admin actions. Writes to the local
 * store (db.json) and, when a writer to Supabase is provided, mirrors there.
 * Never throws — logging failure must not break the action itself.
 */
function writeAuditLog({ saveLocal, mirrorSupa, actorId, actorRole, action, table, targetId, detail }) {
  const entry = {
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    actor_id: actorId ? String(actorId) : null,
    actor_role: actorRole || null,
    action,
    table: table || null,
    target_id: targetId != null ? String(targetId) : null,
    detail: detail ? String(detail).slice(0, 500) : null,
    created_at: new Date().toISOString()
  };
  try {
    if (typeof saveLocal === 'function') saveLocal(entry);
  } catch (e) {
    console.warn('[Audit] local log failed:', e.message);
  }
  if (typeof mirrorSupa === 'function') {
    Promise.resolve(mirrorSupa(entry)).catch(() => {});
  }
  return entry;
}

module.exports = {
  PUBLIC_READ_TABLES,
  SCRUBBED_PUBLIC_READ_TABLES,
  OWNER_READ_TABLES,
  ADMIN_ONLY_READ_TABLES,
  BLOCKED_CLIENT_WRITE_TABLES,
  ADMIN_ONLY_WRITE_TABLES,
  OWNER_FIELDS,
  getAccessContext,
  isAdmin,
  isOwner,
  scrubPII,
  applyReadPolicy,
  assertPostAllowed,
  assertMutateAllowed,
  sanitizeUserCreate,
  writeAuditLog
};
