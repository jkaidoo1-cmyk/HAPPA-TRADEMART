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

// Server-internal tables: no client reads them, not even an admin. They are
// reached only through their dedicated endpoints. The generic table reader has
// no allowlist of its own, so without this an unlisted internal table falls
// through to "unknown table → return the rows" and would hand out live OTP
// hashes (`otps`) or every user's uploaded image chunks (`upload_chunks`).
const SERVER_ONLY_TABLES = new Set(['otps', 'upload_chunks']);

// ── Write policy ───────────────────────────────────────────────

// Tables written exclusively by server-side code — client writes are rejected.
const BLOCKED_CLIENT_WRITE_TABLES = new Set(['order_notifications', 'audit_logs']);

// (#9) notifications: inserting one auto-dispatches a web-push, so anonymous
// and regular-user inserts are rejected — only the server's own flows and
// admins (announcements, approvals) may create them. Users interact with
// notifications only via PATCH is_read / DELETE, handled below.
const SERVER_OR_ADMIN_WRITE_TABLES = new Set(['notifications']);

// Tables only admins may write (create/update/delete). wallet_transactions is
// server-managed: every balance change goes through the /api/wallet/* endpoints
// (which write rows directly), and platform_revenue is recorded server-side too,
// so a regular user can never fabricate ledger or revenue rows.
// ── Phone-verification (OTP) master switch ────────────────────────────────
// OFF while no SMS provider is connected: signup never asks for a code and
// accounts are treated as verified. Reconnecting later needs no code change —
// set TERMII_*/TWILIO_* in the host env and verification switches itself on.
// OTP_ENABLED=1 forces it on without a provider (request-otp then 503s, the
// pre-existing honest behavior); OTP_ENABLED=0 keeps it off even with one.
// Evaluated per call so env changes (and tests) take effect immediately.
function otpEnabled() {
  const flag = String(process.env.OTP_ENABLED || '').trim();
  return flag === '1' ||
    (flag !== '0' && !!(process.env.TERMII_API_KEY || process.env.TWILIO_ACCOUNT_SID));
}
const ADMIN_ONLY_WRITE_TABLES = new Set(['settings', 'delivery_rates', 'wallet_transactions', 'platform_revenue']);

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
// Rendor subscription/quote state is admin-controlled — a rendor must never be
// able to self-activate (rendor_sub_status/expiry/plan) or self-quote
// (sub_quote_*). They may only REQUEST a quote and CLAIM a payment.
const ADMIN_ONLY_USER_FIELDS = ['role', 'status', 'wallet_balance', 'is_verified', 'id_verified', 'password_hash',
  'rendor_sub_status', 'rendor_sub_expiry', 'rendor_sub_plan',
  'rendor_sub_price_override',
  'sub_quote_monthly', 'sub_quote_quarterly', 'sub_quote_biannual',
  // Referral identity + counters are admin-managed: a user must not be able to
  // rewrite their own share code (steal attributions) or reset their own
  // discount/earnings counters. The code itself is still assigned at signup.
  'referral_code', 'referral_count', 'referral_earnings', 'referral_commission_used'];

// Fields a non-admin may set on their own user row, but only to one of these
// exact values (e.g. a rendor may set sub_request_status='pending_quote' to ask
// for a quote, but never 'quoted' — that is admin's answer).
const SELF_USER_FIELD_VALUES = {
  sub_request_status: ['pending_quote'],
  sub_payment_status: ['paid_pending']
};

// Claim fields a rendor may record after paying (months chosen + amount). They
// carry no privilege — admin still verifies & activates — but they give the
// admin list a concrete "awaiting activation" state.
const SELF_USER_NUMERIC_FIELDS = {
  sub_payment_months: { min: 1, max: 24, integer: true },
  sub_payment_amount: { min: 0.01, max: 1e9, integer: false }
};
const SELF_USER_STRING_FIELDS = ['sub_paid_at', 'sub_payment_ref'];

// Roles a user may self-assign via POST/PATCH (never 'admin').
const SELF_ASSIGNABLE_ROLES = ['buyer', 'vendor', 'rendor'];

// ── Helpers ────────────────────────────────────────────────────

function getAccessContext(req) {
  return getSessionUser(req); // { userId, role } | null
}

function isAdmin(viewer) {
  return !!viewer && String(viewer.role) === 'admin';
}

/**
 * Orders and packages are private to the parties involved. A vendor must never
 * be able to list another vendor's fulfilments (that exposed their items and
 * payout amounts), and an anonymous caller must not be able to dump the whole
 * marketplace's order book. Admins see everything; a signed-in user sees rows
 * they are a party to (they may sell in one order and buy in another); an
 * anonymous caller only gets rows for a TARGETED lookup — tracking a package by
 * the code they already hold — never a bulk listing.
 *
 * `targeted` is decided by the route from the query: an exact code / package
 * code / row id, or a search string long enough to be a real lookup.
 */
function scopeOrderRows(rows, viewer, targeted) {
  if (!Array.isArray(rows)) return rows;
  if (isAdmin(viewer)) return rows;
  if (!viewer) return targeted ? rows : [];
  const uid = String(viewer.userId || '');
  if (!uid) return targeted ? rows : [];
  return rows.filter(r => r && (String(r.vendor_id || '') === uid || String(r.buyer_id || '') === uid));
}

/**
 * A storefront may only go LIVE (status 'active') when the store carries a PAID
 * subscription that has not expired — or when an admin makes the change.
 * Payment is the trust anchor: a vendor must never be able to flip their own
 * storefront live for free (that let an unpaid storefront serve buyers).
 */
function canActivateStorefront(store, viewer) {
  if (isAdmin(viewer)) return true;
  const end = store && store.subscription_end;
  const endMs = end ? new Date(end).getTime() : NaN;
  return Number.isFinite(endMs) && endMs > Date.now();
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
    // public contact fields). Drop everything a stranger must not see. The
    // rendor_sub_active flag (added by applyReadPolicy before scrubbing) is
    // kept so public listings can filter expired rendors without exposing the
    // raw expiry timestamp.
    drop(['email', 'phone', 'wallet_balance', 'id_image', 'proof_sales_1', 'proof_sales_2',
      'proof_sales_3', 'proof_share', 'referral_code', 'referred_by', 'referral_earnings',
      'is_verified', 'id_verified',
      'extra', 'password', 'registered_at', 'sub_request_status', 'sub_quote_monthly',
      'sub_quote_quarterly', 'sub_quote_biannual', 'rendor_sub_expiry', 'rendor_sub_plan',
      'sub_payment_status', 'sub_payment_months', 'sub_payment_amount', 'sub_paid_at', 'sub_payment_ref']);
  } else if (table === 'packages' || table === 'orders') {
    // Tracking needs status/totals/items — but not the customer's contact data.
    // `extra` must go too: on the slim Supabase schema the SAME buyer PII
    // (buyer_name/phone/email, delivery_*) plus vendor payout amounts live
    // inside that jsonb blob, so leaving it would defeat the whole scrub.
    drop(['delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location',
      'buyer_id', 'notes', 'origin_location', 'dest_location', 'tracking_number',
      'tracking_link', 'buyer_name', 'buyer_phone', 'buyer_email', 'extra']);
  } else if (table === 'support_tickets') {
    drop(['user_email', 'user_phone', 'user_id']);
  } else if (table === 'wallet_transactions') {
    drop(['account_number', 'network', 'user_id', 'balance_before', 'balance_after']);
  } else if (table === 'reviews') {
    drop(['customer_id', 'buyer_id']);
  } else if (table === 'referrals') {
    // Keep referrer_id visible so vendors/buyers can see referrals they made;
    // only scrub referred_id (buyer identity) from non-admin viewers.
    drop(['referred_id']);
  }
  return out;
}

/**
 * Rendor subscription expiry arrives in two shapes: the ms-epoch the app
 * itself writes (e.g. "1798594829191") and the ISO string Postgres returns
 * for the timestamptz column (e.g. "2026-12-30T10:00:00+00:00"). Number()
 * on the ISO form is NaN, which silently hid every live rendor from buyers.
 * Parse both; anything unparseable yields NaN so callers treat it as expired.
 */
function rendorSubExpiryMs(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);            // ms (or s) epoch string
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/**
 * Apply the read policy to a list of rows for a given viewer.
 * @returns {Array} the rows the viewer may see (scrubbed where required).
 */
function applyReadPolicy(table, rows, viewer) {
  if (!Array.isArray(rows)) return rows;

  // Internal tables are invisible to every client, admins included.
  if (SERVER_ONLY_TABLES.has(table)) return [];

  // Rendor subscription is a date-based check. Attach a derived boolean so
  // public callers can filter expired rendors even when the raw expiry column
  // is scrubbed away (the date itself is kept private; the boolean is not).
  if (table === 'users') {
    rows = rows.map(r => {
      const expiryMs = rendorSubExpiryMs(r && r.rendor_sub_expiry);
      const active = !!r && r.rendor_sub_status === 'active' &&
        Number.isFinite(expiryMs) && expiryMs > 0 && expiryMs > Date.now();
      return r ? { ...r, rendor_sub_active: active } : r;
    });
  }

  // Admin sees everything.
  if (isAdmin(viewer)) return rows;

  // Admin-only tables: nobody else sees anything.
  if (ADMIN_ONLY_READ_TABLES.has(table)) return [];

  // Public catalog tables: everyone sees everything.
  if (PUBLIC_READ_TABLES.has(table)) {
    if (table === 'settings' && !isAdmin(viewer)) {
      // Non-admins only get the allowlisted public keys; secret keys
      // (vapid_private_key, …) never leave the server (#7).
      return rows.filter(r => r && PUBLIC_SETTINGS_KEYS.has(String(r.key || '')));
    }
    return rows;
  }

  // PII-bearing public tables: owners in full, everyone else scrubbed.
  if (SCRUBBED_PUBLIC_READ_TABLES.has(table)) {
    return rows.map(r => isOwner(viewer, r, table) ? r : scrubPII(table, r));
  }

  // Owner-only tables: owners in full, everyone else gets nothing.
  if (OWNER_READ_TABLES[table]) {
    if (table === 'notifications') {
      return rows.filter(r => isOwner(viewer, r, table) || (r && (r.user_id === 'all' || r.user_id === 'global')));
    }
    return rows.filter(r => isOwner(viewer, r, table));
  }

  // Unknown table: allow (empty collection read; matches current generic behavior).
  return rows;
}

// settings rows a non-admin may read. Everything else in the settings table
// (VAPID private key, future secrets) is invisible to clients (#7) — admins
// still see all rows, and the server itself reads settings directly, not
// through this policy.
// Every key below is read by client code running as a NON-admin, through
// getSetting(). A key missing here does not error — the read silently returns
// nothing and the caller falls back to its hardcoded default, so the admin's
// change looks like it never saved. That is exactly how an admin-set rendor
// subscription fee kept showing as the generic GHS 30, and why the commission
// and referral tier tables the admin edited never reached a vendor's screen.
// Adding a key here requires that the value is safe for any signed-in user (and
// for anonymous visitors — vendor signup reads vendor_auto_approve before the
// account exists). Secrets stay out.
const PUBLIC_SETTINGS_KEYS = new Set([
  'coupons', 'hero_banners', 'ad_banners',
  'support_whatsapp', 'support_email', 'support_phone',
  'max_pending_withdrawals',
  // Wallet policy: vendors read the minimum and the processing window.
  'min_withdrawal', 'withdrawal_days',
  // Rendor subscription (single price + duration — the admin sets these).
  'rendor_sub_price', 'rendor_sub_months',
  // Vendor onboarding + store referral policy.
  'vendor_auto_approve', 'storefront_auto_approve',
  'require_phone_verify', 'require_id_verify',
  'store_referral_threshold',
  // Commission + referral policy. These are percentages the vendor already sees
  // priced into every order, not secrets — and the server computes the real
  // money from the same tables, so a hidden copy only produced mismatched
  // displays.
  'commission_tiers', 'referral_commission_tiers', 'referral_reward_pct',
  // Delivery pricing (displayed on the cart for main-site orders).
  'delivery_fee_local', 'delivery_fee_intercity',
  // Storefront subscription pricing: vendors read these to build the plan
  // cards — without them every vendor saw stale hardcoded defaults after the
  // admin changed the real prices in Settings.
  'storefront_price_starter', 'storefront_price_growth', 'storefront_price_pro'
]);

// (#10) Closed per-table write allowlist. Any table not listed here 404s on
// GET/POST/PUT/PATCH/DELETE instead of being silently accepted (the old
// generic handler answered unknown tables with an empty success). The server
// itself may still write internal tables (auto-dispatch notifications,
// audit logs, ledger rows) — this only gates the /api/:table HTTP surface.
const WRITABLE_TABLES = new Set([
  'users', 'stores', 'storefronts', 'products', 'orders', 'packages',
  'services', 'reviews', 'support_tickets', 'referrals', 'ad_campaigns',
  'notifications',
  // Admin-only tables must pass the coarse 404 gate on the generic routes
  // and then be caught by ADMIN_ONLY_WRITE_TABLES below — omitting them here
  // made every admin settings save 404 with 'Unknown resource' (#10 regression).
  'settings', 'delivery_rates', 'wallet_transactions', 'platform_revenue'
]);

// (#10) Subscriptions are granted by admin action or verified payment —
// never directly by the vendor (#16).
const STORE_ADMIN_ONLY_FIELDS = [
  'subscription_status', 'subscription_plan', 'subscription_start',
  'subscription_end', 'subscription_months', 'subscription_method'
];

/**
 * Authorize a POST (create).
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
function assertPostAllowed(table, viewer, body = {}) {
  if (BLOCKED_CLIENT_WRITE_TABLES.has(table)) {
    return { ok: false, status: 403, error: 'This table is managed by the server.' };
  }
  if (SERVER_OR_ADMIN_WRITE_TABLES.has(table)) {
    if (!isAdmin(viewer)) return { ok: false, status: 403, error: 'Notifications are created by the system or an admin.' };
    return { ok: true };
  }
  if (ADMIN_ONLY_WRITE_TABLES.has(table) && !isAdmin(viewer)) {
    return { ok: false, status: 403, error: 'Admin access required.' };
  }
  return { ok: true };
}

/**
 * Sanitize a user record on create so anonymous signup can never mint an
 * admin, set a wallet balance, self-verify, or self-activate a rendor
 * subscription.
 */
function sanitizeUserCreate(body, opts = {}) {
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
  // The admin-approval flow is a server-side guarantee, not a client
  // convention: vendors and rendors always start pending until an admin
  // approves them. The ONLY exception is the vendor_auto_approve setting,
  // which the servers pass in as opts.autoApprove (read from Settings —
  // never trusted from the request body). A direct API call cannot skip review.
  if (out.role === 'vendor' || out.role === 'rendor') {
    out.status = (opts && opts.autoApprove === true) ? 'active' : 'pending_approval';
  } else if (out.role === 'buyer') {
    out.status = 'active';
  }
  // Subscription & quote state is granted by admin later — never on signup.
  // Coerced fields (role/status/wallet/is_verified/id_verified/referral_code)
  // are reapplied AFTER stripping admin-only fields, since they live in that
  // list but the user may still legitimately sign up as buyer/vendor/rendor
  // with a fresh share code.
  const roleOut = out.role;
  const statusOut = out.status;
  const walletOut = out.wallet_balance;
  const verifiedOut = out.is_verified;
  const idVerifiedOut = out.id_verified;
  // The share code is echoed into href/onclick markup on the profile pages, so
  // it is restricted to a safe charset instead of trusting whatever a signup
  // submitted (an attacker could otherwise register a code like "x');alert(1)//").
  const referralCodeOut = String(out.referral_code || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  for (const f of ADMIN_ONLY_USER_FIELDS) delete out[f];
  out.role = roleOut;
  out.status = statusOut;
  out.wallet_balance = walletOut;
  out.is_verified = verifiedOut;
  out.id_verified = idVerifiedOut;
  if (referralCodeOut) out.referral_code = referralCodeOut;
  delete out.sub_request_status;
  delete out.sub_payment_status;
  delete out.sub_payment_months;
  delete out.sub_payment_amount;
  delete out.sub_paid_at;
  delete out.sub_payment_ref;
  return out;
}

/**
 * Sanitize a notifications PATCH body: users may only mark their own
 * notifications read/unread — every other field is stripped.
 */
function sanitizeNotificationPatch(body = {}) {
  const out = {};
  if (typeof body.is_read === 'boolean') out.is_read = body.is_read;
  out.updated_at = new Date().toISOString();
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

  if (table === 'notifications') {
    if (isAdmin(viewer)) return { ok: true };
    const owningUser = String((existingRecord && existingRecord.user_id) || (body && body.user_id) || '');
    const viewerId = String(viewer.userId || '');
    // Allow deleting own notifications and broadcast notifications visible to this user
    if (owningUser === viewerId || owningUser === 'all' || owningUser === 'global') return { ok: true };
    // Admin-targeted notifications are deletable by admins (already handled above)
    if (owningUser === 'admin') return { ok: false, status: 403, error: 'Only admins can delete admin notifications.' };
    // If the record wasn't found at all (null existing + no body user_id), allow
    // the delete for any authenticated user — the actual DB delete will simply
    // be a no-op if the record doesn't exist, and blocking it would prevent
    // users from clearing notifications that only exist in Supabase.
    if (!existingRecord) return { ok: true };
    return { ok: false, status: 403, error: 'You can only delete your own notifications.' };
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
          } else if (f === 'id_verified' && body[f] === false) {
            // Permitted: submitting verification docs leaves verification as false pending admin review
            continue;
          } else {
            return { ok: false, status: 403, error: `You cannot change ${f}.` };
          }
        }
      }
      // Rendor may request a quote / claim a payment — but only with the
      // exact allowed values. Everything else (incl. 'quoted', 'active',
      // 'confirmed') is admin-only.
      for (const [f, allowed] of Object.entries(SELF_USER_FIELD_VALUES)) {
        if (f in body && body[f] !== undefined && !allowed.includes(body[f])) {
          return { ok: false, status: 403, error: `You cannot set ${f} to that value.` };
        }
      }
      for (const [f, range] of Object.entries(SELF_USER_NUMERIC_FIELDS)) {
        if (f in body && body[f] !== undefined && body[f] !== null && body[f] !== '') {
          const n = Number(body[f]);
          const valid = Number.isFinite(n) && n >= range.min && n <= range.max &&
            (!range.integer || Number.isInteger(n));
          if (!valid) return { ok: false, status: 403, error: `You cannot set ${f} to that value.` };
        }
      }
      for (const f of SELF_USER_STRING_FIELDS) {
        if (f in body && body[f] !== undefined && body[f] !== null && typeof body[f] !== 'string') {
          return { ok: false, status: 403, error: `You cannot set ${f} to that value.` };
        }
      }
    }
    return { ok: true };
  }

  if (isAdmin(viewer)) return { ok: true };

  // Stores: the subscription is granted by verified payment or an admin action,
  // never written directly by the owner (#16). Being the owner authorises edits
  // to the store itself, but NOT to its billing state — otherwise a vendor could
  // set subscription_end in one request and satisfy the "payment required" gate
  // for storefront activation with the very field they just wrote. The server
  // grants the subscription through POST /api/wallet/storefront-subscribe.
  if (table === 'stores') {
    for (const f of STORE_ADMIN_ONLY_FIELDS) {
      if (f in body && body[f] !== undefined) {
        return { ok: false, status: 403, error: `You cannot change ${f} directly. Please pay for a plan to update your subscription.` };
      }
    }
  }

  // Everyone else: owner or admin — authorized against the STORED record only.
  // (Owner fields in the request body are never consulted: a client must not be
  // able to claim ownership by passing vendor_id/buyer_id/user_id in the body.)
  if (existingRecord && isOwner(viewer, existingRecord, table)) return { ok: true };
  return { ok: false, status: 403, error: 'You can only modify your own records.' };
}

/**
 * Remove the storefront billing fields (STORE_ADMIN_ONLY_FIELDS) from a body so
 * a non-admin caller can never write them.
 *
 * Used by the `storefronts` virtual view, which resolves the store itself and
 * therefore bypasses `assertMutateAllowed`. It IGNORES the fields rather than
 * rejecting the request: a storefront record carries subscription_* values, and
 * the vendor editor echoes the whole record back on save — a hard rejection
 * would break every ordinary storefront save. The stored subscription is what
 * survives; the only writers are verified payment and an admin.
 */
function stripStoreAdminFields(body = {}) {
  if (!body || typeof body !== 'object') return body;
  for (const f of STORE_ADMIN_ONLY_FIELDS) {
    if (f in body) delete body[f];
  }
  return body;
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
  OTP_ENABLED: otpEnabled,
  otpEnabled,
  PUBLIC_READ_TABLES,
  PUBLIC_SETTINGS_KEYS,
  WRITABLE_TABLES,
  STORE_ADMIN_ONLY_FIELDS,
  stripStoreAdminFields,
  SCRUBBED_PUBLIC_READ_TABLES,
  OWNER_READ_TABLES,
  ADMIN_ONLY_READ_TABLES,
  SERVER_ONLY_TABLES,
  BLOCKED_CLIENT_WRITE_TABLES,
  ADMIN_ONLY_WRITE_TABLES,
  OWNER_FIELDS,
  getAccessContext,
  isAdmin,
  isOwner,
  scrubPII,
  rendorSubExpiryMs,
  canActivateStorefront,
  scopeOrderRows,
  applyReadPolicy,
  assertPostAllowed,
  assertMutateAllowed,
  sanitizeNotificationPatch,
  sanitizeUserCreate,
  writeAuditLog
};
