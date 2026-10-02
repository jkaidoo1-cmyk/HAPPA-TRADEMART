/**
 * HAPPA TRADEMART — Vercel Serverless API
 * Backed by Supabase (PostgreSQL)
 *
 * Environment variables required (set in Vercel Dashboard):
 *   SUPABASE_URL  — e.g. https://xxxx.supabase.co
 *   SUPABASE_KEY  — your project's service_role (secret) key
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const crypto = require('crypto');
const dataStore = require('./data-store');

// Shared session/auth module (HMAC-signed tokens via SESSION_SECRET, or
// in-memory fallback) and the shared API access-control layer.
const { createSessionToken, getSessionUser, hasInvalidSession, requireAuth, requireAdmin, revokeToken, equalizeLoginTiming } = require('../lib/session');
const access = require('../lib/access');
const otp = require('../lib/otp');
const notify = require('../lib/notify');
const uploads = require('../lib/uploads');
const shell = require('../lib/storefront-shell');
const rendorPosts = require('../lib/rendor-posts');

const app = express();
// Allow larger JSON payloads (product images are sent as base64 up to 5 images)
// 15mb matches the dev server (server.js) — the same payload must be accepted
// in both environments. This caps request bodies (guide §: bounded input) and
// still fits the heaviest legitimate write: a product/store save carrying
// several base64 images. 50mb was needlessly large for a JSON API.
app.use(express.json({ limit: '15mb' }));

function r2Server(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Warn if SESSION_SECRET is not set — in-memory sessions are lost on every
// serverless cold start, causing immediate logout after login.
if (!String(process.env.SESSION_SECRET || '').trim()) {
  console.warn('\n[Session] WARNING: SESSION_SECRET is not set.');
  console.warn('[Session] Without it, session tokens are stored in per-process memory');
  console.warn('[Session] and will be lost on every serverless cold start / redeploy.');
  console.warn('[Session] Set SESSION_SECRET in your Vercel environment variables.\n');
}

// (#20) Never fall back to the local data store silently in production. On a
// serverless host the filesystem is ephemeral, so writes that land in the
// local store are lost on the next cold start. The fallback is still allowed
// (it keeps local development working) but it must be loud.
if (!String(process.env.SUPABASE_URL || '').trim() || !String(process.env.SUPABASE_KEY || '').trim()) {
  const hosted = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production');
  if (hosted) {
    console.error('\n[Data] ERROR: SUPABASE_URL / SUPABASE_KEY are not set in this hosted environment.');
    console.error('[Data] Every write is landing in the ephemeral local store and WILL BE LOST.');
    console.error('[Data] Set both variables in the host dashboard before serving traffic.\n');
  }
}

// ── Dead-session detection ─────────────────────────────────────
// A presented-but-invalid Bearer token is an explicit 401, never silent
// anonymity: owner-only tables (notifications, wallet, …) would otherwise
// return an empty 200 for an expired session (e.g. after instance rotation
// without SESSION_SECRET) and the client would freeze on stale data until
// re-login. Auth endpoints are exempt so a stale token can never block login.
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (String(req.path || '').startsWith('/api/auth/')) return next();
  // Public HTML for shared storefront links: a visitor arriving from a link
  // (with no token, or with a token that expired while the tab sat idle) must
  // still get the page rather than a JSON 401.
  if (/^\/(?:storefront|store-admin)\//.test(String(req.path || ''))) return next();
  if (hasInvalidSession(req)) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  next();
});

// ── Response security: never leak password hashes to clients ──────────
// Deep-copies the payload, dropping `password_hash` at any depth. Applied at
// the single response boundary so every route is covered without touching
// the stored records (writes still persist the hash).
function scrubSensitive(obj) {
  if (Array.isArray(obj)) return obj.map(scrubSensitive);
  if (obj instanceof Date) return obj;
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const key of Object.keys(obj)) {
      if (key === 'password_hash') continue;
      const val = obj[key];
      out[key] = (val && typeof val === 'object') ? scrubSensitive(val) : val;
    }
    return out;
  }
  return obj;
}

const _origResJson = app.response.json;
app.response.json = function (body) {
  return _origResJson.call(this, scrubSensitive(body));
};

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:9000,http://127.0.0.1:9000,http://localhost:3000')
  .split(',').map(s => s.trim());

// ── CORS + security headers ────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Service-Worker-Allowed', '/');
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Supabase Client ───────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    return null; // caller will fall back to local DB
  }
  // Cap every Supabase request at 2.5s: a slow/missing table or flaky network
  // must never hold the response (Vercel functions time out at 10s). Callers
  // fall back to the local data store on timeout/error.
  const timedFetch = (input, init) => Promise.race([
    globalThis.fetch(input, init),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), 2500))
  ]);
  return createClient(url, key, { global: { fetch: timedFetch } });
}

// ── Helpers ───────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Drops memoised reads after a write. This function used to be referenced from
// the wallet adapter without ever being defined, so every balance save threw a
// ReferenceError AFTER the money had already moved (a paid subscription would
// surface as a 500). server.js keeps a full response cache; here only the user
// map is memoised, and a stale balance must not outlive a wallet move.
function invalidateApiCache(table) {
  try {
    if (table === 'users' || table === 'wallet_transactions' || !table) {
      global.userCache = {};
    }
  } catch (e) { /* cache reset is best-effort */ }
}

// (#2) Which store does a product write belong to? A product is filed under a
// store, and that store decides both the storefront it appears in and the
// vendor the package pays out to — so a vendor must not be able to file
// products into (or move them into) another vendor's store.
// Returns 'own' | 'foreign' | 'unknown' (unknown = legacy/unmirrored row, in
// which case the write is allowed rather than blocked on missing data).
async function productStoreOwnership(viewer, storeId) {
  const sid = String(storeId || '');
  const uid = String((viewer && viewer.userId) || '');
  if (!sid || !uid) return 'unknown';
  let row = null;
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await withSupaTimeout(supabase.from('stores').select('id, vendor_id').eq('id', sid).limit(1), 2000);
      if (data && data[0]) row = data[0];
    } catch (e) {}
  }
  if (!row) {
    dataStore.ensureTable('stores');
    row = (dataStore.getStore().stores || []).find(s => String(s.id) === sid) || null;
  }
  if (!row) return 'unknown';
  const owner = String(row.vendor_id || '');
  if (!owner) return 'unknown';
  return owner === uid ? 'own' : 'foreign';
}

// Does a user with this id exist? Used to validate a referral's referrer.
async function userExistsById(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await withSupaTimeout(supabase.from('users').select('id').eq('id', uid).limit(1), 2000);
      if (data && data[0]) return true;
    } catch (e) {}
  }
  dataStore.ensureTable('users');
  return (dataStore.getStore().users || []).some(u => String(u.id) === uid);
}

// Cap a single Supabase call at `ms`. This was referenced in seven places but
// never defined — the resulting ReferenceError was silently swallowed by the
// surrounding try/catch blocks, so those fallbacks never raced a timeout.
function withSupaTimeout(promise, ms = 2500) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Supabase request timeout')), ms);
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeout
  ]);
}

// Best-effort audit log for privileged actions (dataStore + Supabase mirror).
function auditLog(entry) {
  access.writeAuditLog({
    saveLocal: (e) => { dataStore.ensureTable('audit_logs'); dataStore.getStore().audit_logs.push(e); dataStore.saveToFile(); },
    // NOTE: PostgrestBuilder is only a thenable — it has no .catch(). A
    // chained .catch here threw synchronously and 500'd every audited action
    // (admin user deletes, product deletes, …). writeAuditLog already wraps
    // the returned builder in Promise.resolve().catch.
    mirrorSupa: (e) => { const sb = getSupabase(); return sb ? sb.from('audit_logs').insert(e) : null; },
    ...entry
  });
}

// Columns that are stored as JSON arrays/objects in Postgres (jsonb)
// We serialize them before writing and parse them after reading
const JSONB_COLS = new Set([
  'images', 'keywords', 'rendor_tags', 'gallery_images', 'items', 'extra', 'messages'
]);

// Optional product columns — may be missing on slim Supabase schemas
const PRODUCT_OPTIONAL_COLS = [
  'weight_kg', 'allow_buyer_note', 'buyer_note_prompt',
  'campus', 'tags', 'commission_pct', 'flash_sale_end'
];

// Ad campaign fields that live in the extra JSONB column (Supabase table has legacy schema)
const AD_CAMPAIGN_EXTRA_FIELDS = [
  'name', 'pages', 'store_ids', 'store_budgets',
  'interval_value', 'interval_unit', 'duration_days',
  'show_store_name', 'created_by'
];

// Package lifecycle fields live in jsonb `extra` on slim Supabase schemas
const PACKAGE_META_FIELDS = [
  'package_code', 'order_id', 'vendor_status', 'admin_status', 'buyer_confirmed',
  'has_review', 'rejected_reason', 'vendor_amount', 'commission_amount', 'gross_amount',
  'origin_location', 'dest_location', 'is_intercity', 'tracking_link', 'tracking_number',
  'delivery_partner', 'pickup_date', 'delivered_date', 'balance_released', 'refunded',
  'buyer_name', 'buyer_phone', 'buyer_email', 'payment_status', 'total_amount', 'items_count',
  'delivery_status', 'order_source', 'storefront_id', 'storefront_name', 'platform_fee',
  'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location',
  // (#15) pending → released | refunded. Packed into `extra` on the slim schema
  // so a released order can never also be refunded (and vice versa).
  'settlement_status'
];

const ORDER_META_FIELDS = [
  'buyer_name', 'buyer_phone', 'buyer_email', 'items', 'referral_code', 'discount',
  'coupon_code', 'payment_ref', 'ship_date', 'buyer_location'
];

const TXN_META_FIELDS = [
  'balance_before', 'balance_after', 'payment_method', 'status', 'note', 'network', 'account_number', 'reviewed_by'
];

const USER_META_FIELDS = [
  'id_image', 'proof_sales_1', 'proof_sales_2', 'proof_sales_3', 'proof_share',
  'rendor_sub_price_override'
];

function packUserMeta(record, existingExtra) {
  const extra = { ...parseExtraObject(existingExtra), ...parseExtraObject(record.extra) };
  for (const key of USER_META_FIELDS) {
    if (key in record && record[key] !== undefined) extra[key] = record[key];
  }
  return extra;
}

function unpackUserMeta(record) {
  if (!record) return record;
  const out = { ...record };
  const extra = parseExtraObject(out.extra);
  for (const [key, value] of Object.entries(extra)) {
    if (out[key] === undefined || out[key] === null || out[key] === '') out[key] = value;
  }
  return out;
}

function parseExtraObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  return {};
}

function packPackageMeta(record, existingExtra) {
  const extra = { ...parseExtraObject(existingExtra), ...parseExtraObject(record.extra) };
  for (const key of PACKAGE_META_FIELDS) {
    if (key in record && record[key] !== undefined) extra[key] = record[key];
  }
  return extra;
}

function packOrderMeta(record, existingExtra) {
  const extra = { ...parseExtraObject(existingExtra), ...parseExtraObject(record.extra) };
  for (const key of ORDER_META_FIELDS) {
    if (key in record && record[key] !== undefined) extra[key] = record[key];
  }
  return extra;
}

function packWalletTxnMeta(record, existingExtra) {
  const extra = { ...parseExtraObject(existingExtra), ...parseExtraObject(record.extra) };
  for (const key of TXN_META_FIELDS) {
    if (key in record && record[key] !== undefined) extra[key] = record[key];
  }
  return extra;
}

function unpackWalletTxnMeta(record) {
  if (!record) return record;
  const out = { ...record };
  const extra = parseExtraObject(out.extra);
  for (const [key, value] of Object.entries(extra)) {
    if (out[key] === undefined || out[key] === null || out[key] === '') out[key] = value;
  }
  return out;
}

function unpackPackageMeta(record) {
  if (!record) return record;
  const out = { ...record };
  const extra = parseExtraObject(out.extra);
  for (const [key, value] of Object.entries(extra)) {
    if (out[key] === undefined || out[key] === null || out[key] === '') out[key] = value;
  }
  if (!out.package_code && out.code) out.package_code = out.code;
  if (!out.code && out.package_code) out.code = out.package_code;
  if (out.total == null && out.total_amount != null) out.total = out.total_amount;
  if (out.gross_amount == null && out.total != null) out.gross_amount = out.total;
  return out;
}

function looksLikeStoreRecord(out) {
  return !!(out && (
    'slug' in out || 'logo_url' in out || 'banner_url' in out ||
    'store_price' in out || 'storefront_status' in out ||
    'business_hours' in out || 'plan_prices' in out ||
    'subscription_plan' in out
  ));
}

function looksLikeProductRecord(out) {
  return !!(out && (
    'category' in out || 'stock_qty' in out || 'is_available' in out ||
    'weight_kg' in out || 'commission_pct' in out || 'sold_count' in out ||
    'total_sold' in out
  ));
}

function unpackProductMeta(record) {
  if (!record || !looksLikeProductRecord(record)) return record;
  const out = { ...record };
  const extra = parseExtraObject(out.extra);
  for (const key of PRODUCT_OPTIONAL_COLS) {
    if ((out[key] === undefined || out[key] === null || out[key] === '') && key in extra) {
      out[key] = extra[key];
    }
  }
  return out;
}

// plan_prices lives in the jsonb `extra` on the slim Supabase schema (admin
// approval writes it there). Unpacking it makes every storefronts/stores read
// carry the admin-approved prices — without this vendors saw the hardcoded
// defaults because `plan_prices` was only ever present in local db.json rows.
const STORE_UNPACK_COLS = ['logo_url', 'banner_url', 'slogan', 'name', 'layout', 'plan_prices'];

function unpackStoreMeta(record) {
  if (!record || !looksLikeStoreRecord(record)) return record;
  const out = { ...record };
  const extra = parseExtraObject(out.extra);
  for (const key of STORE_UNPACK_COLS) {
    if ((out[key] === undefined || out[key] === null || out[key] === '') && key in extra) {
      out[key] = extra[key];
    }
  }
  return out;
}

function serializeRecord(record) {
  let out = { ...record };

  // Parse JSONB columns stored as strings
  for (const col of JSONB_COLS) {
    if (col in out && typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch {}
    }
  }

  out = unpackPackageMeta(out);
  out = unpackUserMeta(out);

  // Users: normalize rendor_sub_expiry to a ms number on read. Postgres
  // returns the timestamptz as an ISO string while every consumer (sub gate,
  // renewal logic, admin UI) expects the ms epoch the app writes — Number(iso)
  // was NaN, which made every live rendor look unsubscribed to buyers.
  if (out.rendor_sub_expiry != null && out.rendor_sub_expiry !== '' && typeof out.rendor_sub_expiry !== 'number') {
    const _subMs = access.rendorSubExpiryMs(out.rendor_sub_expiry);
    if (Number.isFinite(_subMs)) out.rendor_sub_expiry = _subMs;
  }
  out = unpackProductMeta(out);
  out = unpackStoreMeta(out);

  if (out.extra && typeof out.extra === 'object') {
    out = unpackWalletTxnMeta(out);
  }
  if (out.description !== undefined && out.note === undefined) {
    out.note = out.description;
  }
  if (out.reference !== undefined && out.payment_ref === undefined) {
    out.payment_ref = out.reference;
  }

  // ── Field aliasing: DB name → frontend expected name ──────────
  // Products: total_sold → sold_count (frontend uses sold_count everywhere)
  if (looksLikeProductRecord(out) && 'total_sold' in out && !('sold_count' in out)) {
    out.sold_count = out.total_sold;
  }
  // Users: avatar_url → avatar
  if ('avatar_url' in out && !('avatar' in out)) {
    out.avatar = out.avatar_url;
  }
  // Stores: description → about_us (used by store views)
  if (looksLikeStoreRecord(out) && 'description' in out && !('about_us' in out)) {
    out.about_us = out.description;
  }
  // Stores: return_policy → shipping_policy fallback
  if (looksLikeStoreRecord(out) && 'return_policy' in out && !('shipping_policy' in out)) {
    out.shipping_policy = out.return_policy;
  }
  // Stores: review_count → followers fallback for display
  if (looksLikeStoreRecord(out) && 'review_count' in out && !('followers' in out)) {
    out.followers = out.review_count || 0;
  }
  // Products: review_count → views fallback
  if (looksLikeProductRecord(out) && 'review_count' in out && !('views' in out)) {
    out.views = (out.review_count || 0) * 10;
  }
  // Ad campaigns: title → name fallback (legacy Supabase column is 'title')
  if ('title' in out && !out.name) {
    out.name = out.title;
  }
  // Ad campaigns: ensure store_ids and pages are arrays (may come back as JSON strings from extra)
  if ('store_ids' in out && typeof out.store_ids === 'string') {
    try { out.store_ids = JSON.parse(out.store_ids); } catch { out.store_ids = []; }
  }
  if ('pages' in out && typeof out.pages === 'string') {
    try { out.pages = JSON.parse(out.pages); } catch { out.pages = []; }
  }

  return out;
}

const TABLE_COLUMNS = {
  users: ['id', 'name', 'email', 'phone', 'password_hash', 'role', 'status', 'location', 'wallet_balance', 'referral_code', 'referred_by', 'registered_at', 'created_at', 'updated_at', 'is_verified', 'id_verified', 'rendor_display_name', 'rendor_service_cat', 'rendor_bio', 'rendor_starting_price', 'rendor_tags', 'rendor_whatsapp', 'rendor_email', 'rendor_instagram', 'rendor_twitter', 'rendor_facebook', 'rendor_website', 'rendor_contact_other', 'rendor_sub_status', 'rendor_sub_expiry', 'rendor_sub_plan', 'avatar_url', 'extra', 'referral_earnings', 'referral_count', 'preferred_store_name', 'preferred_store_cat', 'preferred_store_desc', 'preferred_store_kws', 'sub_request_status', 'sub_quote_monthly', 'sub_quote_quarterly', 'sub_quote_biannual', 'sub_payment_status', 'sub_payment_months', 'sub_payment_amount', 'sub_paid_at', 'sub_payment_ref', 'rendor_sub_price_override', 'push_enabled'],
  notifications: ['id', 'user_id', 'type', 'title', 'message', 'is_read', 'created_at', 'extra'],
  stores: ['id', 'name', 'slug', 'vendor_id', 'category', 'location', 'status', 'logo_url', 'banner_url', 'description', 'keywords', 'avg_rating', 'review_count', 'total_sales', 'total_orders', 'store_price', 'is_paid', 'storefront_status', 'slogan', 'primary_color', 'secondary_color', 'tertiary_color', 'theme', 'font_family', 'hero_image_url', 'gallery_images', 'business_hours', 'return_policy', 'whatsapp', 'instagram', 'facebook', 'twitter', 'subscription_plan', 'subscription_status', 'subscription_start', 'subscription_end', 'subscription_months', 'subscription_method', 'created_at', 'updated_at', 'extra'],
  orders: ['id', 'buyer_id', 'vendor_id', 'store_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'subtotal', 'platform_fee', 'delivery_fee', 'total', 'status', 'payment_method', 'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location', 'package_code', 'notes', 'created_at', 'updated_at', 'extra'],
  ad_campaigns: ['id', 'vendor_id', 'store_id', 'title', 'image_url', 'link', 'placement', 'budget', 'spent', 'impressions', 'clicks', 'status', 'start_date', 'end_date', 'created_at', 'updated_at', 'extra'],
  services: ['id', 'rendor_id', 'title', 'category', 'description', 'price', 'image_url', 'status', 'created_at', 'updated_at', 'extra'],
  service_orders: ['id', 'service_id', 'rendor_id', 'buyer_id', 'title', 'amount', 'status', 'notes', 'created_at', 'updated_at', 'extra'],
  settings: ['id', 'key', 'value', 'label', 'type', 'updated_at'],
  reviews: ['id', 'product_id', 'store_id', 'buyer_id', 'rating', 'comment', 'created_at'],
  products: ['id', 'store_id', 'vendor_id', 'name', 'category', 'price', 'original_price', 'stock_qty', 'images', 'is_flash_sale', 'flash_pct', 'status', 'is_available', 'description', 'location', 'avg_rating', 'review_count', 'total_sold', 'created_at', 'updated_at', 'weight_kg', 'allow_buyer_note', 'buyer_note_prompt', 'tags', 'commission_pct', 'campus', 'flash_sale_end', 'extra'],
  packages: ['id', 'code', 'buyer_id', 'vendor_id', 'store_id', 'items', 'status', 'total', 'delivery_fee', 'payment_method', 'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location', 'notes', 'created_at', 'updated_at', 'extra'],
  delivery_rates: ['id', 'origin', 'destination', 'base_rate', 'per_kg_rate', 'est_days', 'is_local', 'created_at'],
  referrals: ['id', 'referrer_id', 'referred_id', 'reward', 'status', 'created_at'],
  wallet_transactions: ['id', 'user_id', 'type', 'amount', 'description', 'reference', 'created_at', 'extra'],
  platform_revenue: ['id', 'source', 'amount', 'reference', 'description', 'created_at', 'extra'],
  support_tickets: ['id', 'user_id', 'user_name', 'user_email', 'user_role', 'subject', 'category', 'priority', 'status', 'message', 'messages', 'assigned_to', 'created_at', 'updated_at', 'extra'],
  storefronts: ['id', 'store_id', 'vendor_id', 'status', 'url_slug', 'name', 'theme', 'font_family', 'slogan', 'about_us', 'logo_url', 'banner_url', 'primary_color', 'secondary_color', 'tertiary_color', 'business_hours', 'shipping_policy', 'return_policy', 'whatsapp_number', 'facebook_url', 'instagram_url', 'youtube_url', 'meta_description', 'subscription_plan', 'subscription_status', 'subscription_start', 'subscription_end', 'created_at', 'updated_at'],
  push_subscriptions: ['id', 'user_id', 'endpoint', 'keys', 'created_at']
};


// Columns typed as timestamp (timestamptz) and numeric in the Postgres schema.
// Empty strings from clients are coerced to null in prepareRecordForDb —
// Postgres rejects '' in these column types (22P07/22007) while the JS side
// treats '' and null interchangeably.
const TIMESTAMP_COLUMNS = {
  users: ['registered_at', 'created_at', 'updated_at', 'rendor_sub_expiry'],
  stores: ['subscription_start', 'subscription_end', 'created_at', 'updated_at'],
  products: ['flash_sale_end', 'created_at', 'updated_at'],
  orders: ['created_at', 'updated_at'],
  packages: ['created_at', 'updated_at'],
  wallet_transactions: ['created_at', 'updated_at'],
  notifications: ['created_at', 'updated_at'],
  order_notifications: ['created_at', 'updated_at'],
  ad_campaigns: ['start_date', 'end_date', 'created_at', 'updated_at'],
  services: ['created_at', 'updated_at'],
  service_orders: ['created_at', 'updated_at'],
  settings: ['updated_at'],
  reviews: ['created_at'],
  delivery_rates: ['created_at'],
  referrals: ['created_at'],
  platform_revenue: ['created_at'],
  support_tickets: ['created_at', 'updated_at'],
  storefronts: ['subscription_start', 'subscription_end', 'created_at', 'updated_at'],
  push_subscriptions: ['created_at'],
  audit_logs: ['created_at']
};
const NUMERIC_COLUMNS = {
  users: ['wallet_balance', 'referral_earnings', 'rendor_starting_price', 'sub_quote_monthly', 'sub_quote_quarterly', 'sub_quote_biannual', 'sub_payment_amount', 'rendor_sub_price_override'],
  stores: ['avg_rating', 'total_sales', 'store_price'],
  products: ['price', 'original_price', 'flash_pct', 'avg_rating', 'weight_kg', 'commission_pct'],
  orders: ['unit_price', 'subtotal', 'platform_fee', 'delivery_fee', 'total'],
  packages: ['total', 'delivery_fee'],
  wallet_transactions: ['amount', 'balance_before', 'balance_after'],
  ad_campaigns: ['budget', 'spent'],
  services: ['price'],
  service_orders: ['amount'],
  reviews: ['rating'],
  delivery_rates: ['base_rate', 'per_kg_rate'],
  referrals: ['reward'],
  platform_revenue: ['amount']
};

function prepareRecordForDb(table, record, existingRecord) {
  const out = { ...record };

  // Inverse aliasing: map frontend names back to DB column names if DB column is missing
  if ('package_code' in out && !('code' in out)) {
    out.code = out.package_code;
  }
  if ('code' in out && !('package_code' in out)) {
    out.package_code = out.code;
  }
  if ('about_us' in out && !('description' in out)) {
    out.description = out.about_us;
  }
  if ('sold_count' in out && !('total_sold' in out)) {
    out.total_sold = out.sold_count;
  }
  if ('avatar' in out && !('avatar_url' in out)) {
    out.avatar_url = out.avatar;
  }
  if ('shipping_policy' in out && !('return_policy' in out)) {
    out.return_policy = out.shipping_policy;
  }
  if (table === 'packages') {
    if (out.total == null && out.total_amount != null) out.total = out.total_amount;
    if (out.total == null && out.gross_amount != null) {
      out.total = (parseFloat(out.gross_amount) || 0) + (parseFloat(out.delivery_fee) || 0);
    }
    // Persist order-management fields inside jsonb `extra` (slim Supabase schema)
    out.extra = packPackageMeta(out, existingRecord?.extra);
  }
  if (table === 'orders') {
    out.extra = packOrderMeta(out, existingRecord?.extra);
  }
  if (table === 'wallet_transactions') {
    if (out.note && !out.description) out.description = out.note;
    if (out.payment_ref && !out.reference) out.reference = out.payment_ref;
    out.extra = packWalletTxnMeta(out, existingRecord?.extra);
  }
  if (table === 'users') {
    out.extra = packUserMeta(out, existingRecord?.extra);
  }
  if (table === 'stores') {
    const storeExtra = { ...parseExtraObject(existingRecord?.extra), ...parseExtraObject(out.extra) };
    if ('plan_prices' in out && out.plan_prices !== undefined) {
      storeExtra.plan_prices = out.plan_prices;
    }
    out.extra = storeExtra;
  }
  if (table === 'ad_campaigns') {
    const adExtra = { ...parseExtraObject(existingRecord?.extra), ...parseExtraObject(out.extra) };
    for (const key of AD_CAMPAIGN_EXTRA_FIELDS) {
      if (key in out && out[key] !== undefined) adExtra[key] = out[key];
    }
    out.extra = adExtra;
    // Map 'name' -> 'title' for the legacy column so filtering still works
    if (out.name && !out.title) out.title = out.name;
    // Safely convert start_date/end_date to ISO format if passed as timestamps
    if (out.start_date && !isNaN(Number(out.start_date))) {
      out.start_date = new Date(Number(out.start_date)).toISOString();
    }
    if (out.end_date && !isNaN(Number(out.end_date))) {
      out.end_date = new Date(Number(out.end_date)).toISOString();
    }
    // Provide safe defaults for legacy NOT NULL columns in Supabase schema
    if (!out.budget)      out.budget      = 0;
    if (!out.spent)       out.spent       = 0;
    if (!out.impressions) out.impressions = 0;
    if (!out.clicks)      out.clicks      = 0;
    if (!out.vendor_id)   out.vendor_id   = null;
    if (!out.store_id)    out.store_id    = null;
    if (!out.image_url)   out.image_url   = '';
    if (!out.link)        out.link        = '';
    if (!out.placement)   out.placement   = Array.isArray(adExtra.pages) ? adExtra.pages.join(',') : 'home';
  }

  // rendor_sub_expiry is a timestamptz column: the app's ms-epoch value must
  // become an ISO string before Postgres sees it, or the write 400s (22008) —
  // which silently failed admin subscription activations and rendor purchases.
  if (table === 'users' && out.rendor_sub_expiry != null && out.rendor_sub_expiry !== '') {
    const _subMs = access.rendorSubExpiryMs(out.rendor_sub_expiry);
    if (Number.isFinite(_subMs)) out.rendor_sub_expiry = new Date(_subMs).toISOString();
  }

  // Postgres rejects empty strings in timestamp/numeric columns (the client
  // sends e.g. flash_sale_end: '' for non-flash products). Coerce them to
  // null BEFORE anything (Supabase write or local mirror) consumes the record —
  // '' is semantically "no value" for every read path.
  for (const col of TIMESTAMP_COLUMNS[table] || []) {
    if (out[col] === '') out[col] = null;
  }
  for (const col of NUMERIC_COLUMNS[table] || []) {
    if (out[col] === '' || out[col] === undefined) out[col] = null;
  }
  // Filter columns to only include valid DB columns for Supabase
  if (TABLE_COLUMNS[table]) {
    const clean = {};
    for (const col of TABLE_COLUMNS[table]) {
      if (col in out) {
        clean[col] = out[col];
      }
    }
    return clean;
  }

  return out;
}


function applyClientFilters(rows, query) {
  let result = [...rows];
  const { search, limit, page, sort, ...filters } = query;

  if (search) {
    const needle = String(search).toLowerCase();
    result = result.filter(r =>
      Object.values(r).some(v => {
        if (v == null) return false;
        if (Array.isArray(v)) return v.some(i => String(i).toLowerCase().includes(needle));
        return String(v).toLowerCase().includes(needle);
      })
    );
  }

  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    result = result.filter(r => String(r[key] ?? '').toLowerCase() === String(value).toLowerCase());
  }

  if (sort) {
    result.sort((a, b) => {
      const av = a[sort], bv = b[sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return bv - av;
      return String(bv).localeCompare(String(av));
    });
  }

  const max = parseInt(limit, 10);
  const pageNum = parseInt(page, 10) || 1;
  if (!Number.isNaN(max) && max > 0) {
    const start = (pageNum - 1) * max;
    result = result.slice(start, start + max);
  }

  return result;
}

// ── Routes ────────────────────────────────────────────────────

app.get('/api', (req, res) => {
  const hasSupa = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
  res.json({ 
    status: 'ok', 
    version: '2.0.0', 
    backend: hasSupa ? 'supabase' : 'memory-cache + db.json',
    debug: {
      supabase_configured: hasSupa,
      data_store_path: dataStore.dbPath,
      node_env: process.env.NODE_ENV || 'development'
    }
  });
});

// ── Rate limiters ──────────────────────────────────────────────
// Login: 5 attempts / 15 min. Writes: 600 / 15 min (throttles signup/order
// abuse without blocking bulk catalog adds).
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
const writeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});
// (#12) Login throttling in layers. Keying only on IP+email lets one IP spray
// unlimited addresses and lets rotating IPs hammer a single account, so the
// per-IP and per-account buckets are enforced separately from the pair.
const loginIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(String(req.ip || '')),
  message: { error: 'Too many login attempts from this network. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
const loginEmailRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  // Hashed: raw emails must not sit in limiter memory, and the key is never an
  // IP so no IPv6 normalization is needed here.
  keyGenerator: (req) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    return crypto.createHash('sha256').update(`email:${email}`).digest('hex');
  },
  message: { error: 'Too many login attempts for this account. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
// ── Auth Endpoints ─────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', loginIpRateLimiter, loginEmailRateLimiter, loginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Load the matching user from Supabase (primary) + local db.json
    // (fallback), merge by id. (#21) Only the matching row is fetched — the old
    // select('*') pulled the whole users table on every login (billed egress;
    // the likely cause of the recurring Supabase 402 quota errors). The login
    // form accepts an email OR a phone number, so query the matching column.
    let supaUsers = [];
    let supaFailed = false; // DB unreachable → fail honestly with 503, never fake "Invalid credentials"
    const supabase = getSupabase();
    if (supabase) {
      try {
        const identifierColumn = cleanEmail.includes('@') ? 'email' : 'phone';
        const { data, error } = await supabase.from('users').select('*').eq(identifierColumn, cleanEmail).limit(1);
        if (error) supaFailed = true;
        else if (data) supaUsers = data.map(serializeRecord);
      } catch (err) { supaFailed = true; }
    }

    // Always also check local db.json (admin lives here if not in Supabase)
    dataStore.ensureTable('users');
    const store = dataStore.getStore();
    const localUsers = (store.users || []).map(serializeRecord);

    const userMap = new Map();
    supaUsers.forEach(u => userMap.set(String(u.id), u));
    localUsers.forEach(u => {
      const key = String(u.id);
      const existing = userMap.get(key) || {};
      userMap.set(key, { ...existing, ...u }); // local wins for same id
    });
    const users = Array.from(userMap.values());

    const user = users.find(u =>
      (u.email?.toLowerCase() === cleanEmail || u.phone === cleanEmail) &&
      u.status !== 'deleted'
    );

    // Unknown account: spend the same bcrypt time as a real check so response
    // latency cannot enumerate registered emails. This is the production login
    // path, so the equalization has to live here and not only in server.js.
    if (!user) {
      await equalizeLoginTiming(password);
    }

    if (!user) {
      if (supaFailed) {
        // The user may exist in the unreachable DB — do NOT report bad credentials.
        return res.status(503).json({ error: 'Service temporarily unavailable — the database could not be reached. Please try again in a few minutes.' });
      }
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Verify password (bcrypt or legacy plaintext)
    let isValidPassword = false;
    const dbHash = user.password_hash || '';

    if (dbHash.startsWith('$2a$') || dbHash.startsWith('$2b$')) {
      isValidPassword = await bcrypt.compare(password, dbHash);
    }
    // Plaintext fallback removed: only bcrypt-hashed passwords are accepted.

    if (!isValidPassword) {
      if (supaFailed) {
        // The database was unreachable, so the hash we compared against may be a
        // stale local mirror rather than a genuine mismatch — say so honestly.
        return res.status(503).json({ error: 'Service temporarily unavailable — the database could not be reached. Please try again in a few minutes.' });
      }
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
    }

    // Auto-deactivate expired rendor subscriptions on login
    if (user.role === 'rendor' && user.rendor_sub_status === 'active' && user.rendor_sub_expiry) {
      const expiryMs = access.rendorSubExpiryMs(user.rendor_sub_expiry);
      if (expiryMs && expiryMs < Date.now()) {
        user.rendor_sub_status = 'inactive';
        user.sub_request_status = null;
        user.sub_payment_status = null;
        user.sub_payment_months = null;
        user.sub_payment_amount = null;
        if (supabase) {
          supabase.from('users').update({
            rendor_sub_status: 'inactive',
            sub_request_status: null,
            sub_payment_status: null,
            sub_payment_months: null,
            sub_payment_amount: null
          }).eq('id', user.id).then(() => {}).catch(() => {});
        }
        try {
          const store = dataStore.getStore();
          const localUser = (store.users || []).find(u => String(u.id) === String(user.id));
          if (localUser) {
            localUser.rendor_sub_status = 'inactive';
            localUser.sub_request_status = null;
            localUser.sub_payment_status = null;
            localUser.sub_payment_months = null;
            localUser.sub_payment_amount = null;
            dataStore.save(store);
          }
        } catch (e) {}
      }
    }

    // Auto-deactivate expired storefront subscriptions on vendor login
    if (user.role === 'vendor') {
      try {
        const supabase = getSupabase();
        let vendorStores = [];
        if (supabase) {
          const { data } = await supabase.from('stores').select('id,subscription_status,subscription_end').eq('vendor_id', user.id);
          if (data) vendorStores = data;
        }
        dataStore.ensureTable('stores');
        const localStores = (dataStore.getStore().stores || []).filter(s => String(s.vendor_id) === String(user.id));
        const allVendorStores = [...vendorStores, ...localStores];
        for (const store of allVendorStores) {
          if (store.subscription_status === 'active' && store.subscription_end) {
            const endMs = new Date(store.subscription_end).getTime();
            if (endMs && endMs < Date.now()) {
              if (supabase) {
                supabase.from('stores').update({ subscription_status: 'inactive' }).eq('id', store.id).then(() => {}).catch(() => {});
              }
              const localStore = localStores.find(s => String(s.id) === String(store.id));
              if (localStore) localStore.subscription_status = 'inactive';
            }
          }
        }
        dataStore.save(dataStore.getStore());
      } catch (e) {}
    }

    // Issue 30-day session token
    const token = createSessionToken(user.id, user.role);
    const userSafe = { ...user };
    delete userSafe.password_hash;

    return res.json({ token, user: userSafe });
  } catch (err) {
    console.error('[Auth/Login] Error:', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/check-email — boolean existence check for signup.
// Returns only { exists: true|false } so registration can detect duplicates
// without leaking account details.
app.post('/api/auth/check-email', async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    let supaUsers = [];
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase.from('users').select('email,status');
        if (!error && data) supaUsers = data;
      } catch (err) {}
    }
    dataStore.ensureTable('users');
    const store = dataStore.getStore();
    const localUsers = store.users || [];
    const exists = [...supaUsers, ...localUsers].some(u =>
      String(u.email || '').toLowerCase() === email && String(u.status) !== 'deleted'
    );
    return res.json({ exists });
  } catch (err) {
    return res.status(500).json({ error: 'Check failed. Please try again.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    revokeToken(authHeader.substring(7).trim());
  }
  return res.json({ success: true });
});

// DELETE /api/auth/account — self-service account deletion (Settings → Delete
// my account). The generic DELETE /api/users/:id is admin-only, so a regular
// user deleting their own account used to 403 and silently do nothing. This
// runs the same server-side cascade for the SESSION user only — the client
// never supplies the id, so it can never delete anyone else.
app.delete('/api/auth/account', writeRateLimiter, async (req, res) => {
  try {
    const viewer = access.getAccessContext(req);
    if (!viewer || !viewer.userId) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }
    if (String(viewer.userId) === 'admin') {
      return res.status(400).json({ error: 'The main admin account cannot be deleted from the app.' });
    }
    const id = String(viewer.userId);
    auditLog({ actorId: id, actorRole: viewer.role, action: 'delete_own_account', table: 'users', targetId: id });

    const supabase = getSupabase();
    if (supabase) {
      const result = await cascadeDeleteUserSupabase(supabase, id);
      if (!result.ok) return res.status(500).json({ error: result.error });
    } else {
      dataStore.ensureTable('users');
      const store = dataStore.getStore();
      cascadeDeleteUserLocal(store, id);
      dataStore.saveToFile();
    }
    invalidateApiCache('users');
    return res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/refresh — extends a valid session by issuing a fresh token.
app.post('/api/auth/refresh', (req, res) => {
  const session = getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'Invalid session.' });
  revokeToken(session.token);
  const newToken = createSessionToken(session.userId, session.role);
  return res.json({ token: newToken });
});

// GET /api/auth/verify
app.get('/api/auth/verify', (req, res) => {
  const session = getSessionUser(req);
  if (!session) return res.status(401).json({ valid: false });
  return res.json({ valid: true, userId: session.userId, role: session.role });
});

// ── SMS delivery (#1) — same contract as server.js; production requires a
// provider (TERMII_* or TWILIO_* env vars), there is no log fallback here.
async function sendSms(phone, text) {
  const p = String(phone || '').trim();
  const t = String(text || '');
  try {
    if (process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID) {
      const r = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: p, from: process.env.TERMII_SENDER_ID, sms: t, type: 'plain', channel: 'generic', api_key: process.env.TERMII_API_KEY })
      });
      return { ok: r.ok, channel: 'termii' };
    }
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + auth },
        body: new URLSearchParams({ To: p, From: process.env.TWILIO_FROM_NUMBER, Body: t })
      });
      return { ok: r.ok, channel: 'twilio' };
    }
  } catch (e) {
    console.warn('[SMS] provider error:', e.message);
  }
  return { ok: false, channel: 'none' };
}

// ── OTP storage (#1) ─────────────────────────────────────────────────────
// Codes live in the shared `otps` table whenever Supabase is configured: a code
// issued by one serverless instance must be verifiable by another, and the
// attempt counter has to survive cold starts. The local file store is the
// fallback for single-process dev runs.
function otpStore() {
  const supabase = getSupabase();
  const localStore = () => { dataStore.ensureTable('otps'); return dataStore.getStore(); };
  return {
    async countOtpsSince(userId, purpose, sinceMs) {
      if (supabase) {
        try {
          const { count, error } = await supabase.from('otps')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', String(userId)).eq('purpose', purpose)
            .gte('created_at', new Date(sinceMs).toISOString());
          if (!error) return count || 0;
        } catch (e) { /* fall back to the local mirror */ }
      }
      const rows = localStore().otps || [];
      return rows.filter(r => String(r.user_id) === String(userId) && r.purpose === purpose && new Date(r.created_at).getTime() >= sinceMs).length;
    },
    async clearPendingOtps(userId, purpose) {
      const now = new Date().toISOString();
      if (supabase) {
        try {
          await supabase.from('otps').update({ consumed_at: now })
            .eq('user_id', String(userId)).eq('purpose', purpose).is('consumed_at', null);
        } catch (e) {}
      }
      const rows = localStore().otps || [];
      for (const r of rows) {
        if (String(r.user_id) === String(userId) && r.purpose === purpose && r.consumed_at == null) r.consumed_at = now;
      }
      dataStore.saveToFile();
    },
    async insertOtp(row) {
      if (supabase) {
        try { await supabase.from('otps').insert(row); } catch (e) { console.warn('[OTP] Supabase insert failed:', e && e.message); }
      }
      const store = localStore();
      store.otps = (store.otps || []).filter(r => String(r.id) !== String(row.id));
      store.otps.push(row);
      dataStore.saveToFile();
    },
    async findPendingOtp(userId, purpose) {
      if (supabase) {
        try {
          const { data, error } = await supabase.from('otps').select('*')
            .eq('user_id', String(userId)).eq('purpose', purpose).is('consumed_at', null)
            .order('created_at', { ascending: false }).limit(1);
          if (!error && data && data[0]) return serializeRecord(data[0]);
        } catch (e) {}
      }
      const rows = localStore().otps || [];
      return rows
        .filter(r => String(r.user_id) === String(userId) && r.purpose === purpose && r.consumed_at == null)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
    },
    async updateOtp(id, patch) {
      if (supabase) {
        try { await supabase.from('otps').update(patch).eq('id', String(id)); } catch (e) {}
      }
      const store = localStore();
      const row = (store.otps || []).find(r => String(r.id) === String(id));
      if (row) { Object.assign(row, patch); dataStore.saveToFile(); }
    }
  };
}

// POST /api/auth/request-otp — issues an OTP for the SESSION user (#1).
// Codes are bcrypt-hashed with a 5-minute expiry and a 5-attempt cap. In
// serverless production an SMS provider (TERMII_* or TWILIO_* env) is
// REQUIRED — without one the request fails honestly instead of leaking codes.
app.post('/api/auth/request-otp', writeRateLimiter, async (req, res) => {
  try {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    let me = null;
    const supabase = getSupabase();
    if (supabase) {
      try { const { data } = await supabase.from('users').select('phone').eq('id', String(session.userId)).maybeSingle(); if (data) me = data; } catch (e) {}
    }
    if (!me) { dataStore.ensureTable('users'); me = (dataStore.getStore().users || []).find(u => String(u.id) === String(session.userId)) || null; }
    if (!me || !me.phone) return res.status(400).json({ error: 'Add a phone number to your account first.' });
    // OTP_TEST_MODE=1: explicit, deliberate testing escape hatch — works even
    // while the master switch is off. The code is still generated, hashed and
    // stored exactly as in production; it is simply ALSO returned in the API
    // response so the caller can complete verification without a carrier.
    const otpTestMode = process.env.OTP_TEST_MODE === '1';
    // Phone verification is switched off (no SMS provider connected): refuse
    // politely — the frontend sees 423/OTP_DISABLED and skips the OTP step.
    // OTP_TEST_MODE=1 overrides the switch (explicit testing intent).
    if (!access.otpEnabled() && !otpTestMode) return res.status(423).json({ error: 'Phone verification is currently disabled.', code: 'OTP_DISABLED' });
    if (!otpTestMode && !process.env.TERMII_API_KEY && !process.env.TWILIO_ACCOUNT_SID) {
      return res.status(503).json({ error: 'SMS delivery is not configured on the server. Set TERMII_API_KEY or TWILIO_ACCOUNT_SID.' });
    }
    const store = otpStore();
    const code = otp.generateCode(); // crypto.randomInt — never Math.random
    const issued = await otp.issueOtp(store, { userId: session.userId, codeHash: await bcrypt.hash(code, 8) });
    if (!issued.ok) return res.status(issued.status).json({ error: issued.error });
    if (otpTestMode) {
      console.warn('[OTP] TEST MODE: returning verification code in the API response for user ' + session.userId);
      return res.json({ success: true, delivered: true, channel: 'test-mode', test_code: code });
    }
    const sent = await sendSms(String(me.phone), `Your HAPPA TRADEMART verification code is ${code}. It expires in 5 minutes.`);
    if (!sent.ok) {
      // The SMS never left: burn the code so it cannot be used later.
      await store.updateOtp(issued.row.id, { consumed_at: new Date().toISOString() });
      return res.status(502).json({ error: 'Could not send the SMS. Try again shortly.' });
    }
    return res.json({ success: true, delivered: true, channel: sent.channel });
  } catch (err) {
    return res.status(500).json({ error: 'Could not start verification. Try again.' });
  }
});

// POST /api/auth/verify-phone — verifies the SESSION user only (#1).
app.post('/api/auth/verify-phone', async (req, res) => {
  try {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    const targetId = String(session.userId);
    const body = req.body || {};

    // OTP gate: a server-issued, unexpired, unconsumed code must match. The
    // row is read from the SHARED store (Supabase when configured), so a code
    // issued by one instance verifies on another and attempts persist.
    const codes = otpStore();
    const otpRow = await otp.findPendingOtp(codes, { userId: targetId });
    if (!access.otpEnabled()) {
      // Switch off: verification gates are lifted — mark verified and return.
      dataStore.ensureTable('users');
      const st = dataStore.getStore();
      const ui = (st.users || []).findIndex(u => String(u.id) === String(targetId));
      if (ui !== -1) { st.users[ui].is_verified = true; st.users[ui].updated_at = new Date().toISOString(); dataStore.saveToFile(); }
      const sb = getSupabase();
      if (sb) { try { await sb.from('users').update({ is_verified: true, updated_at: new Date().toISOString() }).eq('id', String(targetId)); } catch (e) {} }
      return res.json({ success: true, is_verified: true, otp_disabled: true });
    }
if (!otpRow) return res.status(400).json({ error: 'No verification code pending. Request a new one.' });
    if (otp.isExpired(otpRow)) return res.status(400).json({ error: 'Code expired. Request a new one.' });
    if (otp.isLockedOut(otpRow)) return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    const codeOk = typeof otpRow.code_hash === 'string' && otpRow.code_hash.startsWith('$2') && await bcrypt.compare(String(body.code || ''), otpRow.code_hash);
    if (!codeOk) {
      await codes.updateOtp(otpRow.id, { attempts: (otpRow.attempts || 0) + 1 });
      return res.status(400).json({ error: 'Incorrect code.' });
    }
    await codes.updateOtp(otpRow.id, { consumed_at: new Date().toISOString() });

    dataStore.ensureTable('users');
    const store = dataStore.getStore();
    const uIdx = (store.users || []).findIndex(u => String(u.id) === String(targetId));
    if (uIdx !== -1) {
      store.users[uIdx].is_verified = true;
      store.users[uIdx].updated_at = new Date().toISOString();
      dataStore.saveToFile();
    }
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.from('users').update({ is_verified: true, updated_at: new Date().toISOString() }).eq('id', String(targetId));
      } catch (e) {
        console.warn('[VerifyPhone] Supabase update failed:', e.message);
      }
    }
    return res.json({ success: true, is_verified: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/clean-temp-database-records', requireAdmin, async (req, res) => {
  try {
    auditLog({ actorId: req.userSession && req.userSession.userId, actorRole: req.userSession && req.userSession.role, action: 'clean_temp_records', detail: 'bulk purge of temp store/user records' });
    const supabase = getSupabase();
    
    // 1. Delete Kumasi Fashion Hub & Northern Trends
    const storeRes = await supabase.from('stores').select('*');
    const stores = storeRes.data || [];
    const targets = stores.filter(s => s.name === 'Kumasi Fashion Hub' || s.name === 'Northern Trends');
    
    for (const store of targets) {
      await supabase.from('reviews').delete().eq('store_id', store.id);
      // Delete products and reviews of those products
      const prodRes = await supabase.from('products').select('id').eq('store_id', store.id);
      const productIds = (prodRes.data || []).map(p => p.id);
      for (const pid of productIds) {
        await supabase.from('reviews').delete().eq('product_id', pid);
      }
      await supabase.from('products').delete().eq('store_id', store.id);
      await supabase.from('packages').delete().eq('store_id', store.id);
      await supabase.from('orders').delete().eq('store_id', store.id);
      await supabase.from('ad_campaigns').delete().eq('store_id', store.id);
      await supabase.from('stores').delete().eq('id', store.id);
    }
    
    // 2. Delete Nana Ama (rendor)
    await supabase.from('services').delete().eq('rendor_id', 'rendor');
    await supabase.from('service_orders').delete().eq('rendor_id', 'rendor');
    await supabase.from('service_orders').delete().eq('buyer_id', 'rendor');
    await supabase.from('notifications').delete().eq('user_id', 'rendor');
    await supabase.from('wallet_transactions').delete().eq('user_id', 'rendor');
    await supabase.from('referrals').delete().eq('referrer_id', 'rendor');
    await supabase.from('referrals').delete().eq('referred_id', 'rendor');
    await supabase.from('users').delete().eq('id', 'rendor');
    
    res.json({ success: true, message: 'Purged target records successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Push Notification Endpoints ────────────────────────────
let webpush;
try { webpush = require('web-push'); } catch(e) { console.warn('[Push] web-push not installed — push disabled:', e.message); webpush = null; }

let vapidKeys = null;
function initVapidKeysApi() {
  if (!webpush) return;
  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPub && envPriv) {
    vapidKeys = { publicKey: envPub, privateKey: envPriv };
  } else {
    try {
      const store = dataStore.getStore();
      const settings = store.settings || [];
      const pub = (settings.find(s => s && s.key === 'vapid_public_key') || {}).value;
      const priv = (settings.find(s => s && s.key === 'vapid_private_key') || {}).value;
      if (pub && priv) {
        vapidKeys = { publicKey: pub, privateKey: priv };
      } else {
        // (#7) Never persist the private key: an unconfigured server uses a
        // throwaway key pair that lives in memory for this instance only (push
        // subscriptions must be re-created after a cold start). Set
        // VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the host's env to keep them.
        vapidKeys = webpush.generateVAPIDKeys();
        console.warn('[Push] VAPID keys are not configured — using a temporary in-memory key pair. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to make push subscriptions stable.');
      }
    } catch (e) {
      try { vapidKeys = webpush.generateVAPIDKeys(); } catch (err) {}
    }
  }

  if (vapidKeys && vapidKeys.publicKey && vapidKeys.privateKey) {
    try {
      webpush.setVapidDetails('mailto:support@happamart.com', vapidKeys.publicKey, vapidKeys.privateKey);
      console.log('[Push] VAPID push service initialized 🔔');
    } catch (e) {
      console.warn('[Push] VAPID setup failed:', e.message);
    }
  }
}
initVapidKeysApi();

// Auto-create push_subscriptions table if it doesn't exist
(async () => {
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.from('push_subscriptions').select('endpoint').limit(1);
      if (error && error.message && error.message.includes('does not exist')) {
        console.log('[Push] Creating push_subscriptions table...');
        await supabase.rpc('exec_sql', {
          query: `CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT PRIMARY KEY,
            keys JSONB DEFAULT '{}',
            user_id TEXT DEFAULT 'anonymous',
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
          ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
          CREATE POLICY IF NOT EXISTS "Service role full access" ON push_subscriptions FOR ALL USING (true) WITH CHECK (true);`
        }).catch(() => null);
      }
    }
  } catch(e) {
    console.warn('[Push] Table check skipped:', e.message);
  }
})();

async function dispatchPushNotificationApi({ user_id, title, body, url }) {
  if (!webpush || !vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) {
    return { ok: false, sentCount: 0, reason: 'webpush not configured' };
  }
  const targetId = String(user_id || '').trim();
  if (!targetId || !title) return { ok: false, sentCount: 0, reason: 'Missing user_id or title' };

  const supabase = getSupabase();
  let subs = [];

  if (targetId === 'all' || targetId === 'global') {
    if (supabase) {
      try {
        const { data } = await supabase.from('push_subscriptions').select('*');
        if (Array.isArray(data)) subs.push(...data);
      } catch (e) {}
    }
    const local = dataStore.getStore().push_subscriptions || [];
    subs.push(...local);
  } else if (targetId === 'admin') {
    let adminIds = [];
    if (supabase) {
      try {
        const { data } = await supabase.from('users').select('id').eq('role', 'admin');
        adminIds = (data || []).map(u => String(u.id));
      } catch (e) {}
    }
    const localAdmins = (dataStore.getStore().users || []).filter(u => u.role === 'admin').map(u => String(u.id));
    adminIds = [...new Set([...adminIds, ...localAdmins])];

    if (supabase && adminIds.length) {
      try {
        const { data } = await supabase.from('push_subscriptions').select('*').in('user_id', adminIds);
        if (Array.isArray(data)) subs.push(...data);
      } catch (e) {}
    }
    const local = dataStore.getStore().push_subscriptions || [];
    subs.push(...local.filter(s => adminIds.includes(String(s.user_id))));
  } else {
    if (supabase) {
      try {
        const { data } = await supabase.from('push_subscriptions').select('*').eq('user_id', targetId);
        if (Array.isArray(data)) subs.push(...data);
      } catch (e) {}
    }
    const local = dataStore.getStore().push_subscriptions || [];
    subs.push(...local.filter(s => String(s.user_id) === targetId));
  }

  // Deduplicate by endpoint
  const seen = new Set();
  subs = subs.filter(s => {
    if (!s || !s.endpoint || seen.has(s.endpoint)) return false;
    seen.add(s.endpoint);
    return true;
  });

  if (!subs.length) return { ok: true, sentCount: 0 };

  const payload = JSON.stringify({ title, body: body || '', url: url || './' });
  let sentCount = 0;

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      sentCount++;
    } catch (err) {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        if (supabase) {
          try { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (e) {}
        }
        const store = dataStore.getStore();
        if (Array.isArray(store.push_subscriptions)) {
          store.push_subscriptions = store.push_subscriptions.filter(s => s.endpoint !== sub.endpoint);
          dataStore.saveToFile();
        }
      }
    }
  }));

  return { ok: true, sentCount };
}

// GET /api/push/vapid-key — return public VAPID key for client subscription
app.get('/api/push/vapid-key', (req, res) => {
  if (!vapidKeys || !vapidKeys.publicKey) {
    return res.status(500).json({ error: 'VAPID key not configured.' });
  }
  res.json({ publicKey: vapidKeys.publicKey });
});

// POST /api/push/subscribe — store a push subscription (#9: auth required,
// owned by the session user; client user_id ignored)
app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body || {};
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    const supabase = getSupabase();
    const subRecord = {
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      user_id: String(req.userSession.userId), // (#9) session user, always
      created_at: new Date().toISOString()
    };
    if (supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      const { error } = await supabase.from('push_subscriptions').insert(subRecord);
      if (error) console.warn('[Push] Supabase insert failed:', error.message);
    } else {
      const subs = dataStore.getStore().push_subscriptions || [];
      const filtered = subs.filter(s => s.endpoint !== subscription.endpoint);
      filtered.push(subRecord);
      dataStore.getStore().push_subscriptions = filtered;
      dataStore.saveToFile();
    }
    res.json({ success: true });
  } catch(err) {
    console.error('[Push] Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to store subscription' });
  }
});

// POST /api/push/unsubscribe — remove a push subscription
app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    } else {
      const subs = dataStore.getStore().push_subscriptions || [];
      dataStore.getStore().push_subscriptions = subs.filter(s => s.endpoint !== endpoint);
      dataStore.saveToFile();
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

// POST /api/push/migrate — reassign an existing subscription endpoint to the
// currently authenticated user
app.post('/api/push/migrate', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    const userId = String(req.userSession.userId);
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      const subRecord = { endpoint, keys: req.body.keys || {}, user_id: userId, created_at: new Date().toISOString() };
      try { await supabase.from('push_subscriptions').insert(subRecord); } catch (e) {}
    } else {
      const subs = dataStore.getStore().push_subscriptions || [];
      const idx = subs.findIndex(s => s.endpoint === endpoint);
      if (idx !== -1) {
        subs[idx].user_id = userId;
      } else {
        subs.push({ endpoint, keys: req.body.keys || {}, user_id: userId, created_at: new Date().toISOString() });
      }
      dataStore.getStore().push_subscriptions = subs;
      dataStore.saveToFile();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Push] Migrate error:', err && err.message || err);
    res.status(500).json({ error: 'Migration failed' });
  }
});

// POST /api/push/send — send push notification to a user (#9: admin only)
app.post('/api/push/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { user_id, title, body, url } = req.body || {};
    if (!user_id || !title) return res.status(400).json({ error: 'Missing user_id or title' });
    const result = await dispatchPushNotificationApi({ user_id, title, body, url });
    if (!result.ok && result.reason) {
      return res.status(503).json({ error: result.reason });
    }
    res.json({ sent: result.sentCount, total: result.sentCount });
  } catch(err) {
    console.error('[Push] Send error:', err.message);
    res.status(500).json({ error: 'Failed to send push notification' });
  }
});

// ── Resumable uploads ───────────────────────────────────────
// Chunk storage for lib/uploads.js. Supabase when configured (chunks must be
// shared between serverless instances and survive cold starts), the local store
// otherwise. Same contract as server.js.
function uploadsStore() {
  const localAll = () => { dataStore.ensureTable('upload_chunks'); return dataStore.getStore(); };
  return {
    async loadChunks(uploadId) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await withSupaTimeout(supabase.from('upload_chunks').select('*')
            .eq('upload_id', String(uploadId)).order('idx', { ascending: true }), 3000);
          if (!error && Array.isArray(data)) return data.map(serializeRecord);
        } catch (e) { /* fall through to the local store */ }
      }
      return (localAll().upload_chunks || [])
        .filter(r => String(r.upload_id) === String(uploadId))
        .sort((a, b) => Number(a.idx) - Number(b.idx));
    },
    // Upsert on (upload_id, idx): re-sending a chunk the server already holds is
    // a no-op, which is what makes a retry idempotent.
    async putChunk(row) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          await withSupaTimeout(supabase.from('upload_chunks').upsert(row, { onConflict: 'upload_id,idx' }), 3000);
        } catch (e) { console.warn('[Uploads] Supabase putChunk failed:', e && e.message || e); }
        return;
      }
      const store = localAll();
      store.upload_chunks = (store.upload_chunks || [])
        .filter(r => !(String(r.upload_id) === String(row.upload_id) && Number(r.idx) === Number(row.idx)));
      store.upload_chunks.push(row);
      dataStore.saveToFile();
    },
    async deleteUpload(uploadId) {
      const supabase = getSupabase();
      if (supabase) {
        try { await withSupaTimeout(supabase.from('upload_chunks').delete().eq('upload_id', String(uploadId)), 3000); } catch (e) {}
        return;
      }
      const store = localAll();
      store.upload_chunks = (store.upload_chunks || []).filter(r => String(r.upload_id) !== String(uploadId));
      dataStore.saveToFile();
    },
    // An abandoned upload must not leave chunk rows behind forever. Scoped to
    // the caller so starting a new session never sweeps someone else's rows.
    async purgeExpired(userId, olderThanMs) {
      const cutoffMs = Date.now() - olderThanMs;
      const supabase = getSupabase();
      if (supabase) {
        try {
          await withSupaTimeout(supabase.from('upload_chunks').delete()
            .eq('user_id', String(userId)).lt('created_at', new Date(cutoffMs).toISOString()), 3000);
        } catch (e) {}
        return;
      }
      const store = localAll();
      store.upload_chunks = (store.upload_chunks || []).filter(r =>
        String(r.user_id) !== String(userId) || new Date(r.created_at).getTime() >= cutoffMs
      );
      dataStore.saveToFile();
    }
  };
}

/**
 * Expand every `asset:<id>` reference in a write body into its assembled data
 * URL and delete the consumed chunks. Only the uploader's own chunks count, and
 * a body with no asset refs short-circuits before touching storage, so ordinary
 * writes pay nothing for this.
 *
 * @returns {{ok: true, body: object} | {ok: false, status: number, code?: string, error: string}}
 */
async function expandUploadAssets(body, viewer) {
  // Compression happens in the browser, so this is the server refusing to store
  // what a client that skipped it sent. Checked BEFORE the asset-ref
  // short-circuit so inline images are bounded on the ordinary write path too.
  const oversized = uploads.firstOversizedImage(body);
  if (oversized) {
    return {
      ok: false,
      status: 413,
      error: `That image is too large to store (${Math.round(oversized.chars / 1024)} KB). Images are compressed automatically on upload — please try attaching it again.`
    };
  }
  const ids = uploads.collectAssetRefs(body);
  if (!ids.size) return { ok: true, body };
  const store = uploadsStore();
  const map = new Map();
  for (const id of ids) {
    const rows = await store.loadChunks(id);
    if (!rows.length) continue;
    if (!viewer || String(rows[0].user_id) !== String(viewer.userId)) continue; // not yours
    map.set(id, { rows, totalChunks: Number(rows[0].total_chunks) || 0 });
  }
  const consumed = new Set();
  try {
    const out = uploads.resolveAssetRefs(body, map, consumed);
    for (const id of consumed) await store.deleteUpload(id);
    return { ok: true, body: out };
  } catch (e) {
    if (e && e.code === 'asset_missing') {
      return { ok: false, status: 409, code: 'asset_missing', error: e.message };
    }
    throw e;
  }
}

// One image is several chunks and a bulk add is dozens of images, so chunk
// writes get their own generous per-user budget instead of the general limiter.
const uploadChunkRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 4000,
  keyGenerator: (req) => {
    const v = access.getAccessContext(req);
    const key = v && v.userId ? `u:${v.userId}` : `ip:${ipKeyGenerator(String(req.ip || ''))}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  },
  message: { error: 'Too many upload chunks. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Start a session. Nothing is stored until the first chunk arrives.
app.post('/api/uploads', writeRateLimiter, async (req, res) => {
  try {
    const viewer = access.getAccessContext(req);
    if (!viewer) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    const clean = uploads.validateCreate(req.body || {});
    if (!clean.ok) return res.status(clean.status).json({ error: clean.error });
    await uploadsStore().purgeExpired(viewer.userId, uploads.SESSION_TTL_MS);
    return res.status(201).json({
      uploadId: uploads.newUploadId(),
      chunkChars: uploads.CHUNK_CHARS,
      totalChunks: clean.value.totalChunks,
      received: []
    });
  } catch (err) {
    console.error('[Uploads] create failed:', err && err.message || err);
    return res.status(500).json({ error: 'Could not start the upload.' });
  }
});

// What does the server already hold? This is the resume primitive: the client
// sends only the indices missing from this list.
app.get('/api/uploads/:id', async (req, res) => {
  try {
    const viewer = access.getAccessContext(req);
    if (!viewer) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    const rows = await uploadsStore().loadChunks(req.params.id);
    // A session stores nothing until its first chunk arrives, so "no rows" means
    // "nothing uploaded yet", NOT "unknown upload" — answering 404 here made a
    // fresh client believe its session was lost and restart endlessly.
    if (!rows.length) {
      return res.json({ uploadId: String(req.params.id), totalChunks: 0, chunkChars: uploads.CHUNK_CHARS, received: [], missing: [] });
    }
    if (String(rows[0].user_id) !== String(viewer.userId)) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    const totalChunks = Number(rows[0].total_chunks) || 0;
    const received = rows.map(r => Number(r.idx)).sort((a, b) => a - b);
    return res.json({
      uploadId: String(req.params.id),
      totalChunks,
      chunkChars: uploads.CHUNK_CHARS,
      received,
      missing: uploads.missingChunks(received, totalChunks)
    });
  } catch (err) {
    console.error('[Uploads] status failed:', err && err.message || err);
    return res.status(500).json({ error: 'Could not read the upload state.' });
  }
});

// Store one chunk. Out-of-order arrival is fine — the index is explicit, which
// is what lets a retry resume instead of replaying from the start.
app.put('/api/uploads/:id/:index', uploadChunkRateLimiter, async (req, res) => {
  try {
    const viewer = access.getAccessContext(req);
    if (!viewer) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    const store = uploadsStore();
    const existing = await store.loadChunks(req.params.id);
    if (existing.length && String(existing[0].user_id) !== String(viewer.userId)) {
      return res.status(403).json({ error: 'This upload belongs to another account.' });
    }
    const body = req.body || {};
    const totalChunks = existing.length ? Number(existing[0].total_chunks) : Number(body.totalChunks);
    const clean = uploads.validateChunk({ index: req.params.index, data: body.data }, totalChunks);
    if (!clean.ok) return res.status(clean.status).json({ error: clean.error });

    await store.putChunk({
      upload_id: String(req.params.id),
      idx: clean.value.index,
      user_id: String(viewer.userId),
      filename: String(body.filename || (existing[0] && existing[0].filename) || 'image').slice(0, 120),
      total_chunks: Number(totalChunks),
      data: clean.value.data,
      created_at: new Date().toISOString()
    });

    const rows = await store.loadChunks(req.params.id);
    const received = rows.map(r => Number(r.idx)).sort((a, b) => a - b);
    const missing = uploads.missingChunks(received, totalChunks);
    return res.json({ uploadId: String(req.params.id), received, missing, complete: missing.length === 0 });
  } catch (err) {
    console.error('[Uploads] chunk failed:', err && err.message || err);
    return res.status(500).json({ error: 'Could not store that part of the upload.' });
  }
});

// Confirm the session is whole and hand back the reference for the record save.
// The chunks stay until that record is actually written, so a failed save never
// forces the user to upload anything again.
app.post('/api/uploads/:id/finish', async (req, res) => {
  try {
    const viewer = access.getAccessContext(req);
    if (!viewer) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    const rows = await uploadsStore().loadChunks(req.params.id);
    if (!rows.length || String(rows[0].user_id) !== String(viewer.userId)) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    const totalChunks = Number(rows[0].total_chunks) || 0;
    const missing = uploads.missingChunks(rows.map(r => Number(r.idx)), totalChunks);
    if (missing.length) return res.status(409).json({ error: 'Upload is incomplete.', missing });
    const dataUrl = uploads.assemble(rows, totalChunks);
    if (!dataUrl) return res.status(409).json({ error: 'Upload is incomplete.', missing: [0] });
    return res.json({ uploadId: String(req.params.id), assetRef: uploads.assetRefFor(req.params.id), bytes: dataUrl.length });
  } catch (err) {
    console.error('[Uploads] finish failed:', err && err.message || err);
    return res.status(500).json({ error: 'Could not finish the upload.' });
  }
});

// POST /api/notify — the only way a non-admin can create a notification (#10).
//
// The notifications TABLE is server/admin-only because inserting a row
// auto-dispatches a web-push (a client-open insert was an open push relay), which
// broke the ~59 buyer/vendor alerts the frontend used to create itself. Here the
// caller names a recipient and the server verifies they may address that person —
// themselves, an admin, or the other party on a shared order/package/ticket/
// referral/campaign — then builds and stores the row and dispatches the push once.
const notifyRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  keyGenerator: (req) => {
    const v = access.getAccessContext(req);
    const key = v && v.userId ? `u:${v.userId}` : `ip:${ipKeyGenerator(String(req.ip || ''))}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  },
  message: { error: 'Too many notifications sent. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Escalations to staff ('admin', or a specific staff account) are allowed for
// every caller, including the anonymous signup / password-reset flows.
async function notifyRecipientIsAdmin(userId) {
  const id = String(userId || '');
  if (!id || id === notify.ADMIN_TARGET) return true;
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await withSupaTimeout(supabase.from('users').select('id,role').eq('id', id).limit(1), 2000);
      if (Array.isArray(data) && data[0]) return String(data[0].role || '') === 'admin';
    } catch (e) { /* fall through to the local store */ }
  }
  try {
    dataStore.ensureTable('users');
    const row = (dataStore.getStore().users || []).find(u => String(u.id) === id);
    return !!(row && String(row.role) === 'admin');
  } catch (e) { return false; }
}

async function notifyLoadEntityRow(table, id) {
  if (!notify.PARTY_TABLES[table]) return null;
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await withSupaTimeout(supabase.from(table).select('*').eq('id', String(id)).limit(1), 2000);
      if (Array.isArray(data) && data[0]) return data[0];
    } catch (e) { /* fall through to the local store */ }
  }
  try {
    dataStore.ensureTable(table);
    return (dataStore.getStore()[table] || []).find(r => String(r.id) === String(id)) || null;
  } catch (e) { return null; }
}

app.post('/api/notify', notifyRateLimiter, async (req, res) => {
  try {
    const clean = notify.sanitizeNotifyBody(req.body || {});
    if (!clean.ok) return res.status(clean.status).json({ error: clean.error });
    const value = clean.value;
    const viewer = access.getAccessContext(req);

    const recipientIsAdmin = await notifyRecipientIsAdmin(value.user_id);
    let sharedEntity = false;
    if (viewer && value.ref) {
      const row = await notifyLoadEntityRow(value.ref.table, value.ref.id);
      sharedEntity = notify.recordLinksBoth(row, value.ref.table, viewer.userId, value.user_id);
    }

    const authz = notify.authorizeNotify({ viewer, value, recipientIsAdmin, sharedEntity });
    if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

    const record = serializeRecord({
      id: String(generateId()),
      user_id: value.user_id,
      type: value.type,
      title: value.title,
      message: value.message,
      action_url: value.action_url,
      is_read: false,
      created_at: new Date().toISOString()
    });

    // Local store is always written (it is the durable fallback and the source
    // the list endpoint merges over Supabase); Supabase is mirrored best-effort.
    try {
      dataStore.ensureTable('notifications');
      dataStore.getStore().notifications.push(record);
      dataStore.saveToFile();
    } catch (e) {
      console.warn('[Notify] Local store write failed:', e.message);
    }
    const supabase = getSupabase();
    if (supabase) {
      try {
        const dbRecord = prepareRecordForDb('notifications', serializeRecord(record));
        await withSupaTimeout(supabase.from('notifications').insert(dbRecord), 2000);
      } catch (e) {
        console.warn('[Notify] Supabase mirror failed:', e.message);
      }
    }
    dispatchPushNotificationApi({
      user_id: record.user_id,
      title: record.title,
      body: record.message || '',
      url: record.action_url || './'
    }).catch(err => console.warn('[Push] Notify dispatch error:', err.message));

    return res.status(201).json(record);
  } catch (err) {
    console.error('[Notify] Unexpected error:', err && err.message || err);
    return res.status(500).json({ error: 'Notification could not be sent.' });
  }
});

// ── Egress accounting ─────────────────────────────────────────
// Vercel's dashboard shows what the browser downloaded; it never shows what
// Supabase sent the function, and that is normally the tighter quota (Supabase's
// free tier meters egress far more aggressively than Vercel's Hobby plan). So
// every list read reports its own payload size. Grep the deployment logs for
// `[egress]` to see which route is actually costing the most.
function logEgress(req, table, payload) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    const rows = payload && Array.isArray(payload.data) ? payload.data.length : '?';
    console.log(`[egress] ${req.method} ${req.originalUrl || req.url} table=${table} rows=${rows} bytes=${bytes}`);
  } catch (e) { /* never let accounting break a response */ }
}

// Single exit for list responses: applies the read policy and the response-wide
// secret scrub, records the payload size, and sends with a conditional-GET ETag.
// Every list branch must go through this so a new read route cannot silently skip
// the accounting or the scrub.
//
// Why the ETag matters here: every list response is `no-cache` (revalidate on
// every request), so before this, every page view, tab-return and 20-second poll
// re-downloaded the full payload — including the base64 images carried inside
// the rows. An unchanged list now costs an empty 304. Freshness is untouched:
// this function recomputes the payload on every request and only skips the
// transfer when the bytes are byte-for-byte identical to what the client holds.
function sendList(req, res, table, rows, viewer) {
  // Orders and packages are private to the parties involved — scope them HERE,
  // the single exit every list branch goes through, so a new read route cannot
  // forget it. A targeted lookup by code (order tracking) is still allowed for
  // anonymous callers; a bulk listing of the order book is not.
  if (table === 'packages' || table === 'orders') {
    const q = req.query || {};
    const exact = [q.code, q.package_code, q.id].some(v => v != null && String(v).trim().length >= 4);
    const searchVal = String(q.search || '').trim();
    rows = access.scopeOrderRows(rows, viewer, exact || searchVal.length >= 4);
  }
  // scrubSensitive is applied here explicitly because this bypasses res.json,
  // which is where that scrub is otherwise installed (app.response.json).
  const payload = scrubSensitive({ data: access.applyReadPolicy(table, rows, viewer) });
  logEgress(req, table, payload);

  const body = JSON.stringify(payload);
  const etag = '"' + crypto.createHash('sha1').update(body).digest('base64url') + '"';

  res.setHeader('ETag', etag);
  // The payload depends on who is asking, so no shared cache may hand one
  // viewer's list to another.
  const priorVary = res.getHeader('Vary');
  res.setHeader('Vary', priorVary ? String(priorVary) + ', Authorization' : 'Authorization');

  const inm = req.headers['if-none-match'];
  if (inm && String(inm).split(',').some(tag => {
    const t = tag.trim();
    return t === etag || t === 'W/' + etag || t === '*';
  })) {
    res.status(304);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(body);
}

// GET /api/:table  — list with optional filters
app.get('/api/:table', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const viewer = access.getAccessContext(req);
    const { search, limit, page, sort, ...filters } = req.query;

    // Order/wallet/notification data must never be served from the browser HTTP
    // cache — a stale empty list made fresh storefront orders look missing.
    if (['packages', 'orders', 'wallet_transactions', 'notifications', 'referrals', 'platform_revenue', 'support_tickets', 'reviews', 'delivery_rates'].includes(table)) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    } else if (['products', 'stores', 'storefronts', 'categories'].includes(table)) {
      // Catalog data must revalidate on every request: max-age/SWR kept a
      // product the admin just deleted visible in the browser for minutes.
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }

    if (table === 'storefronts') {
      let stores = [];
      if (!supabase) {
        dataStore.ensureTable('stores');
        const store = dataStore.getStore();
        stores = store.stores.map(serializeRecord);
      } else {
        // Read the local fallback FIRST — whether a bounded range is safe below
        // depends on whether it actually holds any stores.
        dataStore.ensureTable('stores');
        const localStores = dataStore.getStore().stores.map(serializeRecord);

        // Bound the query inside the database whenever that cannot change the
        // answer. A range is only sound when the local db.json store holds no
        // `stores` rows (otherwise merging could promote a row into the
        // requested page) and the caller passed neither a search nor a filter —
        // those are applied client-side below, so applying them to a truncated
        // window would hide legitimate matches.
        //
        // This matters: the branch previously ran select('*') with no bound at
        // all, so `?limit=200` and the homepage's `?limit=6` both pulled every
        // store — logo and banner included — out of Supabase and then threw all
        // but a handful away. Supabase bills for what the database sends.
        const sfMax = parseInt(limit, 10);
        const sfHasFilters = Object.values(filters).some(v => v !== undefined && v !== '' && v !== null);
        const sfCanBound = !localStores.length && !search && !sfHasFilters &&
          Number.isFinite(sfMax) && sfMax > 0;
        let sfQuery = supabase.from('stores').select('*');
        if (sfCanBound) {
          // Cap the fetch from row 0 rather than applying the page offset here.
          // The slice at the end of this branch is the single place the offset
          // is applied; pushing the offset into the query as well would skip
          // the page twice and return nothing for page > 1.
          const sfPage = parseInt(page, 10) || 1;
          sfQuery = sfQuery.range(0, sfPage * sfMax - 1);
        }
        const { data, error } = await sfQuery;
        if (error) {
          console.error('[GET] Supabase error on stores:', error.message, '— using local stores');
        } else {
          stores = (data || []).map(serializeRecord);
        }
        // Merge local stores too, so records that only live in db.json (written
        // while Supabase was down) are still resolvable — "storefront not available".
        const storeMap = new Map();
        stores.forEach(s => storeMap.set(String(s.id), s));
        localStores.forEach(s => {
          const key = String(s.id);
          const existing = storeMap.get(key) || {};
          storeMap.set(key, { ...existing, ...s });
        });
        stores = Array.from(storeMap.values());
      }

      // Merge the local `storefronts` collection (writes from PUT/PATCH
      // storefronts can land there) so drafts and saved customizations are
      // readable even though the storefront is a virtual view over `stores`.
      dataStore.ensureTable('storefronts');
      const localSFs = dataStore.getStore().storefronts || [];
      const sfMap = new Map();
      localSFs.forEach(sf => { if (sf) sfMap.set(String(sf.store_id || sf.id), sf); });

      let rows = stores.map(st => {
        const extraSf = sfMap.get(String(st.id)) || {};
        return {
          id: st.id,
          store_id: st.id,
          vendor_id: st.vendor_id,
          name: extraSf.name || st.name || '',
          status: extraSf.status || st.storefront_status || 'none',
          location: st.location || '',
          category: st.category || '',
          url_slug: extraSf.url_slug || st.slug || '',
          theme: extraSf.theme || st.theme || 'classic',
          layout: extraSf.layout || st.layout || (st.extra && st.extra.layout) || 'grid',
          font_family: extraSf.font_family || st.font_family || 'Outfit',
          slogan: extraSf.slogan || st.slogan || '',
          about_us: extraSf.about_us || st.description || st.about_us || '',
          logo_url: extraSf.logo_url || st.logo_url || st.extra?.logo_url || '',
          banner_url: extraSf.banner_url || st.banner_url || st.extra?.banner_url || '',
          primary_color: extraSf.primary_color || st.primary_color || '#e85d04',
          secondary_color: extraSf.secondary_color || st.secondary_color || '#faf9f6',
          tertiary_color: extraSf.tertiary_color || st.tertiary_color || '#e85d04',
          business_hours: extraSf.business_hours || st.business_hours || 'Mon - Sat: 8:00 AM - 6:00 PM',
          shipping_policy: extraSf.shipping_policy || st.shipping_policy || '',
          return_policy: extraSf.return_policy || st.return_policy || '',
          facebook_url: extraSf.facebook_url || st.facebook || st.facebook_url || '',
          instagram_url: extraSf.instagram_url || st.instagram || st.instagram_url || '',
          youtube_url: extraSf.youtube_url || st.youtube_url || '',
          meta_description: extraSf.meta_description || st.meta_description || '',
          subscription_plan: extraSf.subscription_plan || st.subscription_plan || 'starter',
          subscription_status: extraSf.subscription_status || st.subscription_status || 'active',
          plan_prices: extraSf.plan_prices || st.plan_prices || st.extra?.plan_prices || null,
          admin_feedback: extraSf.admin_feedback || st.storefront_admin_feedback || st.extra?.admin_feedback || null,
          only_show_on_storefront: st.extra?.only_show_on_storefront === true || st.extra?.only_show_on_storefront === 'true',
          created_at: st.created_at,
          updated_at: st.updated_at
        };
      });

      if (search) rows = applyClientFilters(rows, { search, limit, page });
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        rows = rows.filter(r => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase());
      }
      // Honour `limit` on this branch too. It used to return EVERY storefront
      // regardless of the requested limit — admin.js asks for 200 — so the
      // response body was far larger than any caller wanted.
      const sfLimit = parseInt(limit, 10);
      if (Number.isFinite(sfLimit) && sfLimit > 0) {
        const sfOffset = ((parseInt(page, 10) || 1) - 1) * sfLimit;
        rows = rows.slice(sfOffset, sfOffset + sfLimit);
      }
      return sendList(req, res, table, rows, viewer);
    }

    if (!supabase) {
      // In-memory/file-backed path
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      let rows = store[table].map(serializeRecord);

      // Expiry sweep on read (local path)
      if (table === 'users') sweepExpiredRendorSubs(rows, null);
      
      // Apply filters
      if (search) rows = applyClientFilters(rows, { search, limit, page });
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        rows = rows.filter(r => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase());
      }
      // Apply sorting
      if (sort) rows.sort((a,b) => (b[sort]||0) - (a[sort]||0));

      // Apply limit/page. This branch used to apply them ONLY when `search` was
      // set (that happened inside applyClientFilters), so a bounded read on the
      // local / no-Supabase path returned every row regardless of the requested
      // limit — the same waste the storefronts branch had, and the path taken
      // whenever Supabase credentials are missing.
      const localMax = parseInt(limit, 10);
      if (Number.isFinite(localMax) && localMax > 0) {
        const localStart = ((parseInt(page, 10) || 1) - 1) * localMax;
        rows = rows.slice(localStart, localStart + localMax);
      }
      
      sendList(req, res, table, rows, viewer);
      return;
    }

    // Supabase path — fetch BOTH backends and merge (same strategy as server.js).
    // A record written only to db.json (Supabase insert failure fallback) must
    // still be readable here, otherwise orders vanish from every list page.
    let supaRows = [];
    let supaError = null;
    if (supabase) {
      let queryBuilder = supabase.from(table).select('*');
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== '') {
          queryBuilder = queryBuilder.eq(key, value);
        }
      }
      if (sort) queryBuilder = queryBuilder.order(sort, { ascending: false });
      if (limit && !search) {
        const max = parseInt(limit, 10);
        if (!isNaN(max) && max > 0) {
          const pageNum = parseInt(page, 10) || 1;
          const start = (pageNum - 1) * max;
          // Cap the fetch from row 0 — see the note in the storefronts branch.
          // The final slice is the single authority on the page offset; the
          // old `range(start, …)` here skipped the page a second time, so any
          // page > 1 on the Supabase path merged into an empty result.
          queryBuilder = queryBuilder.range(0, start + max - 1);
        }
      }
      const { data, error } = await queryBuilder;
      if (error) supaError = error;
      else supaRows = (data || []).map(serializeRecord);
    }

    // Merge local db.json rows (idempotent by id — local wins for same id).
    dataStore.ensureTable(table);
    const store = dataStore.getStore();
    const localRows = (store[table] || []).map(serializeRecord);
    const rowMap = new Map();
    supaRows.forEach(r => rowMap.set(String(r.id), r));
    localRows.forEach(r => {
      const key = String(r.id);
      const existing = rowMap.get(key) || {};
      rowMap.set(key, { ...existing, ...r });
    });
    let rows = Array.from(rowMap.values());

    // Expiry sweep on read: mark expired rendor subs inactive before anything
    // is sliced/filtered, so an admin list always reflects real expiry even if
    // the rendor never logs back in after their subscription lapses.
    if (table === 'users') sweepExpiredRendorSubs(rows, supabase);

    // Apply filters client-side (query params were also pushed to Supabase for
    // efficiency; local rows need them applied here).
    if (search) rows = applyClientFilters(rows, { search, limit, page });
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      rows = rows.filter(r => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase());
    }
    if (sort) rows.sort((a, b) => {
      const av = a[sort], bv = b[sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return bv - av;
      return String(bv).localeCompare(String(av));
    });
    const max = parseInt(limit, 10);
    const pageNum = parseInt(page, 10) || 1;
    if (!Number.isNaN(max) && max > 0) {
      const start = (pageNum - 1) * max;
      rows = rows.slice(start, start + max);
    }
    if (supaError) {
      // Supabase read failed (missing table, RLS, timeout) — return whatever the
      // local store has instead of 500. A 500 here makes the browser fall back
      // to localStorage, so records that exist locally look "missing".
      console.error('[GET] Supabase error on', table + ':', supaError.message, '— returning local rows (' + rows.length + ')');
    }
    sendList(req, res, table, rows, viewer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark rendor subscriptions inactive once their expiry passes — run on read so
// an admin/user list always reflects real expiry even without a login sweep.
// Mirrors server.js. Best-effort: updates supabase + the local data store when
// available, and the in-memory rows always reflect the real state.
function sweepExpiredRendorSubs(rows, supabase) {
  const now = Date.now();
  let changedAny = false;
  for (const r of rows) {
    if (!r || r.role !== 'rendor' || r.rendor_sub_status !== 'active') continue;
    const expiryMs = access.rendorSubExpiryMs(r.rendor_sub_expiry);
    if (!Number.isFinite(expiryMs) || expiryMs <= 0 || expiryMs >= now) continue;
    r.rendor_sub_status = 'inactive';
    r.sub_request_status = null;
    r.sub_payment_status = null;
    r.sub_payment_months = null;
    r.sub_payment_amount = null;
    changedAny = true;
    if (supabase) {
      supabase.from('users').update({
        rendor_sub_status: 'inactive',
        sub_request_status: null,
        sub_payment_status: null,
        sub_payment_months: null,
        sub_payment_amount: null
      }).eq('id', r.id).then(() => {}).catch(() => {});
    }
  }
  if (changedAny) {
    try {
      dataStore.ensureTable('users');
      const store = dataStore.getStore();
      let localChanged = false;
      for (const r of rows) {
        if (r && r.rendor_sub_status === 'inactive' && access.rendorSubExpiryMs(r.rendor_sub_expiry) > 0 && access.rendorSubExpiryMs(r.rendor_sub_expiry) < now) {
          const lu = (store.users || []).find(u => String(u.id) === String(r.id));
          if (lu && lu.rendor_sub_status === 'active') { lu.rendor_sub_status = 'inactive'; lu.sub_request_status = null; lu.sub_payment_status = null; lu.sub_payment_months = null; lu.sub_payment_amount = null; localChanged = true; }
        }
      }
      if (localChanged) dataStore.saveToFile();
    } catch (e) {}
  }
}

// GET /api/:table/:id  — single record
app.get('/api/:table/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const id = req.params.id;

    if (table === 'storefronts') {
      // Merge local db.json + Supabase like the list handler does, so records
      // that live only in one backend are still resolvable.
      let supastores = [];
      if (supabase) {
        const { data, error } = await supabase.from('stores').select('*');
        if (error) {
          console.error('[GET] Supabase error on stores:', error.message, '— using local stores');
        } else {
          supastores = (data || []).map(serializeRecord);
        }
      }
      dataStore.ensureTable('stores');
      const store = dataStore.getStore();
      const localStores = store.stores.map(serializeRecord);
      const storeMap = new Map();
      supastores.forEach(s => storeMap.set(String(s.id), s));
      localStores.forEach(s => {
        const key = String(s.id);
        const existing = storeMap.get(key) || {};
        storeMap.set(key, { ...existing, ...s });
      });
      const stores = Array.from(storeMap.values());

      const st = stores.find(s => String(s.id) === String(id) || String(s.vendor_id) === String(id) || (s.slug && String(s.slug).toLowerCase() === String(id).toLowerCase()));
      if (!st) return res.status(404).json({ error: 'Storefront not found' });

      const sf = {
        id: st.id,
        store_id: st.id,
        vendor_id: st.vendor_id,
        name: st.name || '',
        status: st.storefront_status || 'draft',
        location: st.location || '',
        category: st.category || '',
        url_slug: st.slug || '',
        theme: st.theme || 'classic',
        font_family: st.font_family || 'Outfit',
        slogan: st.slogan || '',
        about_us: st.description || st.about_us || '',
        logo_url: st.logo_url || '',
        banner_url: st.banner_url || '',
        primary_color: st.primary_color || '#e85d04',
        secondary_color: st.secondary_color || '#faf9f6',
        tertiary_color: st.tertiary_color || '#e85d04',
        business_hours: st.business_hours || 'Mon - Sat: 8:00 AM - 6:00 PM',
        shipping_policy: st.shipping_policy || '',
        return_policy: st.return_policy || '',
        facebook_url: st.facebook || st.facebook_url || '',
        instagram_url: st.instagram || st.instagram_url || '',
        youtube_url: st.youtube_url || '',
        meta_description: st.meta_description || '',
        subscription_plan: st.subscription_plan || 'starter',
        subscription_status: st.subscription_status || 'active',
        plan_prices: st.plan_prices || st.extra?.plan_prices || null,
        admin_feedback: st.storefront_admin_feedback || st.extra?.admin_feedback || null,
        only_show_on_storefront: st.extra?.only_show_on_storefront === true || st.extra?.only_show_on_storefront === 'true',
        created_at: st.created_at,
        updated_at: st.updated_at
      };
      return res.json(sf);
    }

    // Apply read policy: owners/admins see the record in full; others get a
    // scrubbed copy or a 404 (we don't reveal that restricted records exist).
    const viewer = access.getAccessContext(req);
    const visible = (rec) => {
      const arr = access.applyReadPolicy(table, [serializeRecord(rec)], viewer);
      return arr.length === 0 ? null : arr[0];
    };

    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const found = store[table].find(r => String(r.id) === String(id));
      if (!found) return res.status(404).json({ error: 'Record not found' });
      const out = visible(found);
      return out ? res.json(out) : res.status(404).json({ error: 'Record not found' });
    }
    
    const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
    if (!error && data) {
      const out = visible(data);
      return out ? res.json(out) : res.status(404).json({ error: 'Record not found' });
    }
    if (error) console.error('[GET] Supabase error on', table + '/' + id + ':', error.message, '— falling back to local store');
    // Fall back to the local store so records written during a Supabase outage
    // (or in tables Supabase doesn't have) are still resolvable.
    dataStore.ensureTable(table);
    const store = dataStore.getStore();
    const found = store[table].find(r => String(r.id) === String(id));
    if (!found) return res.status(404).json({ error: 'Record not found' });
    const out = visible(found);
    return out ? res.json(out) : res.status(404).json({ error: 'Record not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:table  — create record
// ── Server-side wallet engine (the only writer of balance-changing ledger rows) ──
const wallet = require('../lib/wallet');
const commerce = require('../lib/commerce');

function walletAdapter() {
  const findPkg = (list, id) => (list || []).find(p =>
    String(p.id) === String(id) || String(p.package_code || '') === String(id) || String(p.code || '') === String(id)
  );
  const mergeById = (supa, local) => {
    const map = new Map();
    (supa || []).forEach(r => map.set(String(r.id), r));
    (local || []).forEach(r => map.set(String(r.id), { ...(map.get(String(r.id)) || {}), ...r }));
    return Array.from(map.values());
  };
  return {
    async loadUser(id) {
      let u = null;
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('users').select('*').eq('id', String(id)).maybeSingle();
          if (!error && data) u = serializeRecord(data);
        } catch (e) {}
      }
      dataStore.ensureTable('users');
      const lu = (dataStore.getStore().users || []).find(x => String(x.id) === String(id));
      return lu ? { ...(u || {}), ...lu } : u;
    },
    async saveUser(id, patch) {
      // Returns true when the write reached the authoritative store (Supabase
      // when connected, else the local file) so wallet ops can detect a silent
      // write failure instead of reporting a false success. The db.json mirror
      // is always kept fresh as a fallback.
      const supabase = getSupabase();
      let ok = false;
      if (supabase) {
        try {
          // Route through prepareRecordForDb so an unknown/legacy column in the
          // patch can never abort the whole update — meta fields are packed into
          // the `extra` jsonb column and the payload is filtered to known columns.
          let existing = null;
          const { data } = await supabase.from('users').select('*').eq('id', String(id)).maybeSingle();
          if (data) existing = serializeRecord(data);
          const merged = serializeRecord({ ...(existing || {}), ...patch, id: String(id) });
          const dbRecord = prepareRecordForDb('users', merged, existing);
          await supabase.from('users').update(dbRecord).eq('id', String(id));
          ok = true;
        } catch (e) { console.warn('[Wallet] Supabase saveUser failed:', e && e.message || e); }
      }
      let localSaved = false;
      try {
        dataStore.ensureTable('users');
        const store = dataStore.getStore();
        const idx = (store.users || []).findIndex(x => String(x.id) === String(id));
        if (idx !== -1) { store.users[idx] = { ...store.users[idx], ...patch }; dataStore.saveToFile(); localSaved = true; }
        // Consider local persistence a successful save. Even when Supabase is
        // configured but temporarily failing, keeping the local mirror up-to-date
        // ensures the GET handlers merge local changes and the subscription
        // becomes effective for the user. This avoids a paid-but-not-activated
        // state when Supabase is transiently unavailable.
        if (localSaved) ok = true;
      } catch (e) { console.warn('[Wallet] local saveUser failed:', e && e.message || e); }
      invalidateApiCache('users');
      return ok;
    },
    async insert(table, rec) {
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        store[table].push(rec);
        dataStore.saveToFile();
      } catch (e) { console.warn('[Wallet] local insert failed:', e && e.message || e); }
      const supabase = getSupabase();
      if (supabase) {
        try {
          const dbRecord = prepareRecordForDb(table, serializeRecord(rec));
          const { data, error } = await withSupaTimeout(supabase.from(table).insert(dbRecord).select().single(), 2000);
          if (!error && data) return serializeRecord(data);
        } catch (e) { console.warn('[Wallet] supabase insert failed:', table, e && e.message || e); }
      }
      return rec;
    },
    // (#5) Atomic balance move. Delegates to the wallet_move RPC (row lock +
    // ledger insert + balance update in ONE transaction, idempotent on
    // user_id+type+reference) and mirrors the result into db.json, which the
    // read paths merge OVER Supabase. Returns null when no RPC is reachable so
    // the wallet engine falls back to its local path.
    async moveBalance(rec, row) {
      const supabase = getSupabase();
      if (!supabase) return null;
      return wallet.rpcMoveBalance({
        supabase,
        withTimeout: withSupaTimeout,
        rec,
        row,
        mirror: (stamped, after) => {
          dataStore.ensureTable('wallet_transactions');
          dataStore.ensureTable('users');
          const store = dataStore.getStore();
          store.wallet_transactions.push(stamped);
          const idx = store.users.findIndex(x => String(x.id) === String(rec.user_id));
          if (idx !== -1) store.users[idx] = { ...store.users[idx], wallet_balance: after };
          dataStore.saveToFile();
          invalidateApiCache('users');
          invalidateApiCache('wallet_transactions');
        }
      });
    },
    async update(table, id, patch) {
      const supabase = getSupabase();
      if (supabase) {
        try { await supabase.from(table).update(patch).eq('id', String(id)); } catch (e) {}
      }
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        const idx = (store[table] || []).findIndex(x => String(x.id) === String(id));
        if (idx !== -1) { store[table][idx] = { ...store[table][idx], ...patch }; dataStore.saveToFile(); }
      } catch (e) {}
    },
    async loadPackage(id) {
      let p = null;
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('packages').select('*').limit(500);
          if (!error && data) p = findPkg(data.map(serializeRecord), id);
        } catch (e) {}
      }
      dataStore.ensureTable('packages');
      const lp = findPkg(dataStore.getStore().packages || [], id);
      return lp ? { ...(p || {}), ...lp } : p;
    },
    async loadAdmin() {
      let a = null;
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('users').select('*').eq('role', 'admin').limit(1);
          if (!error && data && data.length) a = serializeRecord(data[0]);
        } catch (e) {}
      }
      dataStore.ensureTable('users');
      const la = (dataStore.getStore().users || []).find(u => String(u.role) === 'admin');
      return la ? { ...(a || {}), ...la } : a;
    },
    async getSetting(key, def) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
          if (!error && data) return data.value;
        } catch (e) {}
      }
      dataStore.ensureTable('settings');
      const row = (dataStore.getStore().settings || []).find(r => r.key === key);
      return row ? row.value : def;
    },
    async listUserTxns(userId) {
      let supa = [];
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('wallet_transactions').select('*').eq('user_id', String(userId)).limit(500);
          if (!error && data) supa = data.map(serializeRecord);
        } catch (e) {}
      }
      dataStore.ensureTable('wallet_transactions');
      const local = (dataStore.getStore().wallet_transactions || []).filter(t => String(t.user_id) === String(userId));
      return mergeById(supa, local);
    },
    async countUserTxns(userId, filterFn) {
      return (await this.listUserTxns(userId)).filter(filterFn).length;
    },
    async listActiveReferrals(referredId) {
      let supa = [];
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('referrals').select('*').eq('referred_id', String(referredId)).eq('status', 'active').limit(50);
          if (!error && data) supa = data.map(serializeRecord);
        } catch (e) {}
      }
      dataStore.ensureTable('referrals');
      const local = (dataStore.getStore().referrals || []).filter(r => String(r.referred_id) === String(referredId) && String(r.status) === 'active');
      return mergeById(supa, local);
    }
  };
}

const WALLET_ACTIONS = {
  deposit: wallet.deposit,
  withdraw: wallet.withdraw,
  pay: wallet.pay,
  purchase: wallet.purchase,
  'rendor-subscribe': wallet.rendorSubscribe,
  'storefront-payout': wallet.storefrontPayout,
  'release-delivery': wallet.releaseDelivery,
  'refund-reject': wallet.refundReject
};

app.post('/api/wallet/:action', writeRateLimiter, async (req, res) => {
  const fn = WALLET_ACTIONS[req.params.action];
  if (!fn) return res.status(404).json({ error: 'Unknown wallet action.' });
  try {
    const out = await fn(walletAdapter(), access.getAccessContext(req), req.body || {});
    // Carry the engine's optional machine-readable hint (code/extra) so the UI
    // can react — e.g. reprice instead of printing the failure verbatim.
    if (!out.ok) return res.status(out.status).json({ error: out.error, ...(out.code ? { code: out.code } : {}), ...(out.extra || {}) });
    return res.json(out.data);
  } catch (err) {
    console.error('[Wallet]', req.params.action, 'error:', err && err.message || err);
    return res.status(500).json({ error: err.message || 'Wallet operation failed.' });
  }
});

// POST /api/ads/track — anonymous campaign analytics from AdEngine. The
// client batches impressions (one per slide shown), clicks and dwell seconds
// and flushes them via sendBeacon every ~20s. Values are DELTAS, never
// absolutes, so concurrent viewers aggregate. No PII, no session required.
app.post('/api/ads/track', writeRateLimiter, async (req, res) => {
  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const campaignId = String(body.campaign_id || '');
    const impressions = Math.max(0, Math.min(500, parseInt(body.impressions, 10) || 0));
    const clicks = Math.max(0, Math.min(100, parseInt(body.clicks, 10) || 0));
    const seconds = Math.max(0, Math.min(7200, Number(body.seconds) || 0));
    if (!campaignId || (!impressions && !clicks && !seconds)) {
      return res.status(400).json({ error: 'Nothing to track' });
    }
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data } = await withSupaTimeout(supabase.from('ad_campaigns').select('*').eq('id', campaignId).maybeSingle(), 2500);
        if (!data) return res.status(404).json({ error: 'Campaign not found' });
        const rec = serializeRecord(data);
        const extra = { ...parseExtraObject(rec.extra) };
        const day = new Date().toISOString().slice(0, 10);
        const daily = { ...(extra.ads_daily || {}) };
        const d = { imp: 0, clk: 0, sec: 0, ...(daily[day] || {}) };
        d.imp += impressions; d.clk += clicks; d.sec = Math.round((Number(d.sec) || 0) + seconds);
        daily[day] = d;
        const days = Object.keys(daily).sort();
        while (days.length > 30) delete daily[days.shift()];   // keep a 30-day window
        extra.ads_daily = daily;
        extra.ads_dwell_seconds = Math.round((Number(extra.ads_dwell_seconds) || 0) + seconds);
        const dbRecord = prepareRecordForDb('ad_campaigns', {
          ...rec,
          impressions: (parseInt(rec.impressions, 10) || 0) + impressions,
          clicks: (parseInt(rec.clicks, 10) || 0) + clicks,
          extra,
          updated_at: new Date().toISOString()
        }, rec);
        await withSupaTimeout(supabase.from('ad_campaigns').update(dbRecord).eq('id', campaignId), 2500);
        return res.json({ ok: true });
      } catch (e) {
        console.warn('[AdsTrack] Supabase failed, using local store:', e.message);
      }
    }
    dataStore.ensureTable('ad_campaigns');
    const row = dataStore.getStore().ad_campaigns.find(c => String(c.id) === String(campaignId));
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    row.impressions = (parseInt(row.impressions, 10) || 0) + impressions;
    row.clicks = (parseInt(row.clicks, 10) || 0) + clicks;
    const extra = parseExtraObject(row.extra);
    const day = new Date().toISOString().slice(0, 10);
    const daily = extra.ads_daily || {};
    const d = daily[day] || { imp: 0, clk: 0, sec: 0 };
    d.imp += impressions; d.clk += clicks; d.sec = Math.round((Number(d.sec) || 0) + seconds);
    daily[day] = d;
    extra.ads_daily = daily;
    extra.ads_dwell_seconds = Math.round((Number(extra.ads_dwell_seconds) || 0) + seconds);
    row.extra = extra;
    dataStore.saveToFile();
    return res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── New-order notifications + web push (vendor + admin) ──────────
// Admins and vendors previously learned about a sale only by polling their
// dashboards. On every successful POST /packages|/orders the server now
// inserts the in-app notification rows and dispatches the web-push through
// the existing engine. Best-effort: an order must never fail over a push.
async function notifyNewOrder(record) {
  try {
    if (!record || !record.id) return;
    const code = record.package_code || record.code || record.id;
    const total = Number(record.total || record.total_amount || 0).toFixed(2);
    const buyerName = record.buyer_name || record.buyer_email || 'A customer';
    const now = new Date().toISOString();
    const rows = [];
    if (record.vendor_id) rows.push({
      id: generateId('notif'), user_id: String(record.vendor_id), type: 'order',
      title: 'New order received 🎉',
      message: `${buyerName} placed order ${code} — GHS ${total}. Open Vendor Orders to process it.`,
      is_read: false, created_at: now, extra: {}
    });
    rows.push({
      id: generateId('notif'), user_id: 'admin', type: 'order',
      title: 'New order on the platform 🎉',
      message: `Order ${code} — GHS ${total}.`,
      is_read: false, created_at: now, extra: {}
    });
    const supabase = getSupabase();
    for (const row of rows) {
      try {
        dataStore.ensureTable('notifications');
        dataStore.getStore().notifications.push(row);
        dataStore.saveToFile();
      } catch (e) {}
      if (supabase) {
        try { await withSupaTimeout(supabase.from('notifications').insert(prepareRecordForDb('notifications', serializeRecord(row))), 2000); } catch (e) {}
      }
      dispatchPushNotificationApi({
        user_id: row.user_id,
        title: row.title,
        body: row.message,
        url: './'
      }).catch(() => {});
    }
  } catch (e) {}
}

// ── Rendor post cap (see lib/rendor-posts.js) ───────────────────
// How many posts a rendor holds right now. Reads the database and falls back to
// the local mirror, like every other read in this file.
async function countHeldRendorPosts(rendorId, supabase) {
  const id = String(rendorId || '');
  if (!id) return 0;
  if (supabase) {
    try {
      const { data, error } = await withSupaTimeout(
        supabase.from('services').select('id,rendor_id,status').eq('rendor_id', id).limit(200), 3000
      );
      if (!error) return rendorPosts.countHeldPosts(data || [], id);
    } catch (e) { /* fall through to the local copy */ }
  }
  try {
    dataStore.ensureTable('services');
    return rendorPosts.countHeldPosts(dataStore.getStore().services || [], id);
  } catch (e) { return 0; }
}

// Which rendor a write belongs to. A rendor's own writes are always their own
// (owner fields are stripped from their body and re-stamped later), while an
// admin writing on someone's behalf names the rendor.
function rendorIdForWrite(viewer, body, existing) {
  if (viewer && String(viewer.role) === 'rendor') return String(viewer.userId || '');
  return String((body && body.rendor_id) || (existing && existing.rendor_id) || '');
}

// null when the write is allowed, otherwise { status, error, code }.
async function rendorPostLimitReached({ viewer, body, existing, supabase }) {
  const rendorId = rendorIdForWrite(viewer, body, existing);
  if (!rendorId) return null;
  const merged = { ...(existing || {}), ...(body || {}) };
  if (!rendorPosts.isHeldPost(merged)) return null;   // this write frees a slot
  const held = await countHeldRendorPosts(rendorId, supabase);
  if (!rendorPosts.exceedsLimit({ existing, body, heldCount: held })) return null;
  return { status: 409, error: rendorPosts.limitMessage(held), code: 'rendor_post_limit' };
}

app.post('/api/:table', writeRateLimiter, async (req, res) => {
  // Package side-effect tracking (guide §7/§8): pkgSale is set by the money
  // block, pkgApplied records stock reserved before the insert so a crash can
  // give it back, and supaRef keeps the client reachable from the catch.
  let pkgSale = null;
  let pkgApplied = null;
  let pkgLocalMirrored = false;
  let supaRef = null;
  const releaseReservedStock = async () => {
    if (!pkgApplied || !pkgApplied.length) return;
    console.error('[POST] Releasing', pkgApplied.length, 'stock reservation(s) whose row was never written.');
    try {
      if (pkgLocalMirrored) {
        dataStore.ensureTable('products');
        commerce.restoreLocalDecrement(dataStore.getStore().products || [], pkgApplied);
        dataStore.saveToFile();
      }
    } catch (e) { console.error('[POST] local stock restore failed:', e.message); }
    if (supaRef) {
      try { await commerce.restoreStock(supaRef, pkgApplied, { withTimeout: withSupaTimeout }); }
      catch (e) { console.error('[POST] supabase stock restore failed:', e.message); }
    }
    pkgApplied = null;
  };
  try {
    const supabase = getSupabase();
    supaRef = supabase;
    let table = req.params.table;
    // (#10) Closed table allowlist — unknown tables 404.
    if (!access.WRITABLE_TABLES.has(table)) return res.status(404).json({ error: 'Unknown resource.' });
    let body = req.body || {};
    // Resumable uploads: swap `asset:<id>` refs for the assembled data URLs up
    // front, so every later branch sees ordinary inline images.
    {
      const expanded = await expandUploadAssets(body, access.getAccessContext(req));
      if (!expanded.ok) return res.status(expanded.status).json({ error: expanded.error, code: expanded.code });
      body = expanded.body;
    }
    // (#3) Server assigns ids; (#8) no plaintext; (#2) no client owner fields.
    // EXCEPTION: orders/packages keep their client id — it IS the idempotency
    // key for checkout retries (the replay guard 409s non-owners, #13).
    if (table !== 'orders' && table !== 'packages') delete body.id;
    // (#8) A plaintext password is never stored. User writes hash it into
    // password_hash first (the user blocks below then delete it), so only
    // writes to other tables drop the field here.
    if (table !== 'users') delete body.password;
    // (#2) Owner identity always comes from the session for non-admins — never
    // the body. Admins are trusted to attribute a record on behalf of a
    // vendor/buyer (ad campaigns, storefront editing), so their fields survive.
    const _postViewer0 = access.getAccessContext(req);
    if (!access.isAdmin(_postViewer0)) {
      for (const f of ['vendor_id', 'buyer_id', 'user_id', 'rendor_id', 'referrer_id', 'referred_id']) {
        // referrals: the signup flow records who referred the new account. Both
        // ids are re-validated and re-stamped below, so they pass through here.
        if (table === 'referrals' && (f === 'referrer_id' || f === 'referred_id')) continue;
        delete body[f];
      }
    }

    // ── Access control ─────────────────────────────────────────────
    const viewer = access.getAccessContext(req);
    const allowed = access.assertPostAllowed(table, viewer, body);
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

    // A rendor holds at most MAX_POSTS posts at once (lib/rendor-posts.js).
    // Enforced here as well as in the dashboard: the button is a courtesy, the
    // API is the rule.
    if (table === 'services') {
      const over = await rendorPostLimitReached({ viewer, body, existing: null, supabase });
      if (over) return res.status(over.status).json({ error: over.error, code: over.code });
    }

    // ── Idempotent replay guard — runs BEFORE any side effects ───────────
    // Re-POSTing an existing order/package id returns the original row without
    // re-running money derivation, coupon usage, stock decrement or stats, so a
    // client retry can never apply an effect twice (guide §8 idempotency).
    if (table === 'orders' || table === 'packages') {
      if (!body.id) body.id = generateId();
      body.id = String(body.id);
      let dupRow = null;
      if (supabase) {
        try {
          const { data } = await withSupaTimeout(supabase.from(table).select('*').eq('id', String(body.id)).limit(1), 2000);
          if (data && data[0]) dupRow = data[0];
        } catch (e) {}
      }
      if (!dupRow) {
        dataStore.ensureTable(table);
        dupRow = (dataStore.getStore()[table] || []).find(r => String(r.id) === String(body.id)) || null;
      }
      if (dupRow) {
        const dup = serializeRecord(dupRow);
        // (#13) Only the row's own buyer/vendor (or an admin) may replay it. An
        // anonymous caller has no identity to prove, so a guessed id must never
        // hand back the stored order (buyer name, phone, address, totals).
        const own = !!viewer && (access.isAdmin(viewer) || String(dup.buyer_id) === String(viewer.userId) || String(dup.vendor_id) === String(viewer.userId));
        if (own) return res.status(200).json(dup);
        return res.status(409).json({ error: 'This order was already submitted.' });
      }
    }

    // Anonymous signup must never mint an admin, set a wallet balance, or
    // self-verify. Admins creating users via the panel keep full control.
    // The admin-approval guarantee lives server-side: vendor/rendor status comes
    // from the vendor_auto_approve SETTING, never from the request body.
    if (table === 'users' && !access.isAdmin(viewer)) {
      let autoApprove = false;
      try {
        const raw = await walletAdapter().getSetting('vendor_auto_approve', 'false');
        autoApprove = String(raw) === 'true';
      } catch (e) {}
      Object.assign(body, access.sanitizeUserCreate(body, { autoApprove }));
    }

    // Service posts: only rendors with an active subscription may publish, and
    // the post's rendor_id is ALWAYS the session user. Previously the client's
    // rendor_id was trusted, so any logged-in user (or anonymous caller) could
    // publish posts impersonating another rendor.
    if (table === 'services' && !access.isAdmin(viewer)) {
      if (!viewer) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
      if (String(viewer.role) !== 'rendor') {
        return res.status(403).json({ error: 'Only rendors can publish service posts.' });
      }
      let rendorUser = null;
      if (supabase) {
        try {
          const { data } = await supabase.from('users').select('*').eq('id', String(viewer.userId)).maybeSingle();
          if (data) rendorUser = serializeRecord(data);
        } catch (e) {}
      }
      if (!rendorUser) {
        dataStore.ensureTable('users');
        rendorUser = (dataStore.getStore().users || []).find(u => String(u.id) === String(viewer.userId)) || null;
      }
      const expMs = access.rendorSubExpiryMs(rendorUser && rendorUser.rendor_sub_expiry);
      const subActive = !!rendorUser && rendorUser.rendor_sub_status === 'active' &&
        Number.isFinite(expMs) && expMs > 0 && expMs > Date.now();
      if (!subActive) {
        return res.status(403).json({ error: 'An active subscription is required to publish posts. Please subscribe from your dashboard.' });
      }
      body.rendor_id = String(viewer.userId);
      if (!['active', 'paused'].includes(String(body.status || ''))) body.status = 'active';
    }

    // Product rows must carry sane numbers (guide §3 strict request schemas).
    if (table === 'products') {
      // The name is optional on upload — make sure the key exists so the
      // validator can default a missing/blank name for a CREATE (a partial
      // PATCH below never reaches this line's normalization).
      if (!('name' in body)) body.name = '';
      const pv = commerce.validateProductBody(body, { requirePrice: true });
      if (!pv.ok) return res.status(400).json({ error: pv.error });
      // (#2) A product may only be filed under a store the writer owns.
      if (body.store_id && !access.isAdmin(viewer)
          && (await productStoreOwnership(viewer, body.store_id)) === 'foreign') {
        return res.status(403).json({ error: 'You can only file products under your own store.' });
      }
    }

    // Store slugs are the public storefront URL — they must be globally unique.
    // Without this check any vendor could claim another store's URL slug and
    // hijack its traffic, with resolution order deciding who wins.
    if (table === 'stores') {
      const newSlug = String(body.slug || '').trim().toLowerCase();
      if (newSlug) {
        let clash = null;
        if (supabase) {
          try {
            const { data } = await supabase.from('stores').select('id, slug').eq('slug', newSlug).limit(1);
            if (data && data.length) clash = data[0];
          } catch (e) {}
        }
        if (!clash) {
          dataStore.ensureTable('stores');
          clash = (dataStore.getStore().stores || []).find(s => String(s.slug || '').toLowerCase() === newSlug) || null;
        }
        if (clash && String(clash.id) !== String(body.id || '')) {
          return res.status(409).json({ error: 'That store link is already taken. Please choose a different one.' });
        }
      }
    }

    // ── Server-enforced ownership + revenue recording ───────────────────────
    // Orders/packages are created by the checkout flows: the buyer is always the
    // session user (or an anonymous guest_* id). A logged-in user must never be
    // able to create orders/packages attributed to someone else.
    if (table === 'orders' || table === 'packages') {
      const isGuest = !viewer;
      if (!isGuest) body.buyer_id = String(viewer.userId);

    // A package's store/vendor attribution (#14) is resolved below, once the
    // cart items are actually known — the package is bound to a store and its
    // vendor_id is read from that store row, never from the request body.

    const isStorefrontRow = String(body.order_source || '') === 'storefront' || !!body.storefront_id;
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'An order must contain at least one item.' });
    }

    // ── Authoritative money derivation (guide §6) ─────────────────────────
    // Prices, commission, fees, discount and totals are recomputed HERE from
    // product rows and server-side settings. Client-sent amounts are
    // display-only and never trusted — a crafted request could otherwise mint
    // money via vendor_amount / commission_amount / platform_fee.
    const productIds = [...new Set(rawItems.map(i => String((i && (i.product_id || i.id)) || '')).filter(Boolean))];
    const productsById = new Map();
    if (productIds.length) {
      if (supabase) {
        try {
          const { data, error } = await withSupaTimeout(supabase.from('products').select('*').in('id', productIds), 2500);
          if (!error && Array.isArray(data)) data.forEach(p => productsById.set(String(p.id), serializeRecord(p)));
        } catch (e) {}
      }
      dataStore.ensureTable('products');
      for (const pid of productIds) {
        if (productsById.has(pid)) continue;
        const row = (dataStore.getStore().products || []).find(x => String(x.id) === pid);
        if (row) productsById.set(pid, row);
      }
    }
    const resolved = commerce.resolveItems(rawItems, productsById, { adminBypass: access.isAdmin(viewer) });
    if (!resolved.ok) return res.status(409).json({ error: resolved.error });
    body.items = resolved.items;

    if (table === 'packages') {
      // ── (#14) Bind the package to one store ───────────────────────────
      // A package pays out to exactly one vendor, taken from its store row. So
      // the package must be tied to a store that provably sold every item:
      // `store_id` is the client's claim, and when it is missing (legacy
      // products written before store_id existed) the items' own store is
      // used. A cart mixing another store's products is refused.
      const isAdminPost = access.isAdmin(viewer);
      let storeRow = null;
      if (!body.store_id) {
        const storeIds = new Set();
        for (const it of resolved.items) {
          const prod = productsById.get(String((it && (it.product_id || it.id)) || ''));
          if (prod && prod.store_id) storeIds.add(String(prod.store_id));
        }
        if (storeIds.size === 1) body.store_id = [...storeIds][0];
      }
      if (body.store_id) {
        if (supabase) {
          try {
            const { data } = await withSupaTimeout(supabase.from('stores').select('*').eq('id', String(body.store_id)).maybeSingle(), 2000);
            if (data) storeRow = serializeRecord(data);
          } catch (e) {}
        }
        if (!storeRow) {
          dataStore.ensureTable('stores');
          storeRow = (dataStore.getStore().stores || []).find(s => String(s.id) === String(body.store_id)) || null;
        }
      }
      if (storeRow && storeRow.vendor_id) body.vendor_id = String(storeRow.vendor_id);
      if (!isAdminPost) {
        const storeChk = commerce.validateItemsForStore(resolved.items, productsById, storeRow);
        if (!storeChk.ok) return res.status(409).json({ error: storeChk.error });
      }

      // Refuse to oversell: every product's stock must cover its quantity.
      const stockCheck = commerce.stockRequirements(resolved.items, productsById);
      if (!stockCheck.ok) return res.status(409).json({ error: stockCheck.error });

      // Commission comes from the admin's Settings → commission tiers when one
      // is configured (COMMISSION_TIERS is only the default), so editing the
      // tiers actually changes what is charged.
      let commissionTiers = null;
      try {
        commissionTiers = commerce.parseCommissionTiers(await walletAdapter().getSetting('commission_tiers', '[]'));
      } catch (e) { commissionTiers = null; }
      const money = commerce.packageMoney(resolved.items, { storefront: isStorefrontRow, tiers: commissionTiers });
      body.gross_amount = money.gross;
      body.vendor_amount = money.vendorAmount;
      body.commission_amount = money.commission;
      body.platform_fee = money.platformFee;
      body.total_amount = money.totalAmount;
      body.items_count = money.itemCount;
      body.delivery_fee = 0; // delivery is disabled platform-wide — never client-set

      // Stock decrement + store stats are DEFERRED: they run after the replay
      // guard and just before the row is written ("Atomic stock reservation"
      // below), so a retried POST never decrements twice and a refused sale
      // leaves no side effects behind.
      pkgSale = { reqs: stockCheck.reqs, money, storeId: body.store_id || '' };
    }

    if (table === 'orders') {
      // Discount is recomputed/validated from server-side records; an
      // unverifiable coupon rejects the order (409) rather than charging a
      // different amount than the buyer saw.
      let discount = 0;
      const couponCode = String(body.coupon_code || '').trim().toUpperCase();
      if (couponCode) {
        const ctx = { viewerId: viewer ? String(viewer.userId) : '' };
        let couponRow = null;
        dataStore.ensureTable('settings');
        couponRow = (dataStore.getStore().settings || []).find(r => r.key === 'coupons') || null;
        if (!couponRow && supabase) {
          try {
            const { data, error } = await withSupaTimeout(supabase.from('settings').select('*').eq('key', 'coupons').limit(1), 2000);
            if (!error && data && data[0]) couponRow = serializeRecord(data[0]);
          } catch (e) {}
        }
        try { ctx.coupons = couponRow && couponRow.value ? JSON.parse(couponRow.value) : []; } catch (e) { ctx.coupons = []; }
        if (couponCode.startsWith('REF-') && viewer) {
          const txns = [];
          if (supabase) {
            try {
              const { data } = await withSupaTimeout(supabase.from('wallet_transactions').select('*').eq('user_id', String(viewer.userId)).limit(500), 2500);
              if (Array.isArray(data)) data.forEach(t => txns.push(serializeRecord(t)));
            } catch (e) {}
          }
          if (!txns.length) {
            dataStore.ensureTable('wallet_transactions');
            (dataStore.getStore().wallet_transactions || []).forEach(t => { if (String(t.user_id) === String(viewer.userId)) txns.push(t); });
          }
          let uRow = null;
          if (supabase) {
            try {
              const { data } = await withSupaTimeout(supabase.from('users').select('*').eq('id', String(viewer.userId)).maybeSingle(), 2000);
              if (data) uRow = serializeRecord(data);
            } catch (e) {}
          }
          if (!uRow) {
            dataStore.ensureTable('users');
            uRow = (dataStore.getStore().users || []).find(u => String(u.id) === String(viewer.userId)) || null;
          }
          ctx.txns = txns;
          ctx.user = uRow;
        }
        const cd = commerce.computeDiscount(couponCode, resolved.subtotal, ctx);
        if (cd.error) return res.status(409).json({ error: cd.error });
        discount = cd.discount;
        // Count the redemption server-side so max_uses is actually enforced
        // (the client's settings PATCH was admin-only and silently failed).
        if (cd.countUse && cd.coupon) {
          try {
            const list = JSON.parse((couponRow && couponRow.value) || '[]');
            const target = Array.isArray(list) ? list.find(x => x && String(x.code || '').trim().toUpperCase() === couponCode) : null;
            if (target) {
              target.used_count = (parseInt(target.used_count, 10) || 0) + 1;
              if (viewer) {
                target.used_by = Array.isArray(target.used_by) ? target.used_by : [];
                if (!target.used_by.includes(String(viewer.userId))) target.used_by.push(String(viewer.userId));
              }
              const newVal = JSON.stringify(list);
              const lrow = (dataStore.getStore().settings || []).find(r => r.key === 'coupons');
              if (lrow) { lrow.value = newVal; lrow.updated_at = new Date().toISOString(); dataStore.saveToFile(); }
              if (supabase && couponRow && couponRow.id) {
                supabase.from('settings').update({ value: newVal, updated_at: new Date().toISOString() }).eq('id', String(couponRow.id)).then(() => {}).catch(() => {});
              }
            }
          } catch (e) {}
        }
      }
      const totals = commerce.orderTotals(resolved.items, { storefront: isStorefrontRow, discount });
      body.subtotal = totals.subtotal;
      body.platform_fee = totals.platformFee;
      body.delivery_fee = totals.deliveryFee;
      body.discount = totals.discount;
      body.total = totals.total;
    }
  }

    // Main-site orders: record the platform fee revenue server-side (storefront
    // orders record it via /api/wallet/storefront-payout instead).
    if (table === 'orders' && String(body.order_source || '') !== 'storefront') {
      const fee = parseFloat(body.platform_fee) || 0;
      if (fee > 0) {
        try {
          const revRec = {
            id: generateId('platform_revenue'),
            source: 'platform_fee',
            amount: Math.round(fee * 100) / 100,
            reference: 'ORD-' + (body.id || '') + '-' + Date.now(),
            description: `Platform fee on order ${body.id || ''}`,
            created_at: new Date().toISOString()
          };
          dataStore.ensureTable('platform_revenue');
          dataStore.getStore().platform_revenue.push(revRec);
          dataStore.saveToFile();
          if (supabase) {
            try { await withSupaTimeout(supabase.from('platform_revenue').insert(serializeRecord(revRec)), 2000); } catch (e) {}
          }
        } catch (e) {}
      }
    }

    // REF- personal-referral coupons: the used allowance is server-managed now.
    if (table === 'orders' && viewer && String(body.coupon_code || '').startsWith('REF-')) {
      const used = parseFloat(body.discount) || 0;
      if (used > 0) {
        try {
          dataStore.ensureTable('users');
          const storeU = dataStore.getStore();
          const uIdx = (storeU.users || []).findIndex(x => String(x.id) === String(viewer.userId));
          if (uIdx !== -1) {
            const cur = parseFloat(storeU.users[uIdx].referral_commission_used) || 0;
            storeU.users[uIdx].referral_commission_used = Math.round((cur + used) * 100) / 100;
            dataStore.saveToFile();
            if (supabase) {
              try { await supabase.from('users').update({ referral_commission_used: storeU.users[uIdx].referral_commission_used }).eq('id', String(viewer.userId)); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    // Hash user passwords server-side (admin reset sends password/password_hash)
    if (table === 'users') {
      if (body.password && !body.password_hash) body.password_hash = body.password; // legacy `password` field alias
      delete body.password; // plaintext must never reach the database (#8)
      if (body.password_hash && !body.password_hash.startsWith('$2a$') && !body.password_hash.startsWith('$2b$')) {
        try {
          body.password_hash = await bcrypt.hash(body.password_hash, 10);
        } catch (e) {
          console.error('[Auth] Failed to hash password:', e.message);
          return res.status(500).json({ error: 'Failed to process password update.' });
        }
      }
    }

    if (table === 'storefronts') {
      const storeId = body.store_id || body.id;
      let st = null;
      // Look in Supabase first, then fall back to the local db.json store so a
      // store that lives only locally (e.g. created before Supabase was wired
      // up) can still create a storefront. A Supabase-only lookup 404s for such
      // stores, and the frontend swallows that error — the draft would silently
      // never persist and the "Start Building" button would appear dead.
      if (supabase) {
        const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
        if (!error && data) st = serializeRecord(data);
      }
      if (!st) {
        dataStore.ensureTable('stores');
        const store = dataStore.getStore();
        st = store.stores.find(s => String(s.id) === String(storeId)) || null;
      }

      if (!st) {
        return res.status(404).json({ error: 'Store not found to attach storefront' });
      }

      // ── Access control: only the store owner or an admin ──
      if (!access.isAdmin(viewer) && String(st.vendor_id || body.vendor_id || '') !== String(viewer && viewer.userId)) {
        return res.status(403).json({ error: 'You can only manage your own store.' });
      }

      // (#16) MERGE with the existing row, never reset it; subscription_* can
      // only change via admin edit or the verified-payment flow (#4).
      const isAdminEdit = access.isAdmin(viewer);
      const pick = (v, cur, def) => (v !== undefined && v !== null && v !== '') ? v : (cur !== undefined ? cur : def);
      const storeUpdates = {
        storefront_status: pick(body.status, st.storefront_status, 'draft'),
        name: pick(body.name, st.name, 'My Store'),
        status: st.status || 'active',
        category: pick(body.category, st.category, 'General'),
        location: pick(body.location, st.location, ''),
        slug: pick(body.url_slug, st.slug || st.url_slug, ''),
        theme: pick(body.theme, st.theme, 'classic'),
        font_family: pick(body.font_family, st.font_family, 'Outfit'),
        slogan: pick(body.slogan, st.slogan, ''),
        description: pick(body.about_us, st.description, ''),
        logo_url: pick(body.logo_url, st.logo_url, ''),
        banner_url: pick(body.banner_url, st.banner_url, ''),
        primary_color: pick(body.primary_color, st.primary_color, '#e85d04'),
        secondary_color: pick(body.secondary_color, st.secondary_color, '#faf9f6'),
        tertiary_color: pick(body.tertiary_color, st.tertiary_color, '#e85d04'),
        business_hours: pick(body.business_hours, st.business_hours, 'Mon - Sat: 8:00 AM - 6:00 PM'),
        return_policy: pick(body.return_policy, st.return_policy, ''),
        facebook: pick(body.facebook_url, st.facebook, ''),
        instagram: pick(body.instagram_url, st.instagram, ''),
        youtube_url: pick(body.youtube_url, st.youtube_url, ''),
        meta_description: pick(body.meta_description, st.meta_description, ''),
        subscription_plan: isAdminEdit ? pick(body.subscription_plan, st.subscription_plan, 'starter') : (st.subscription_plan || 'starter'),
        subscription_status: isAdminEdit ? pick(body.subscription_status, st.subscription_status, 'active') : (st.subscription_status || 'active'),
        subscription_start: isAdminEdit ? pick(body.subscription_start, st.subscription_start, null) : (st.subscription_start || null),
        subscription_end: isAdminEdit ? pick(body.subscription_end, st.subscription_end, null) : (st.subscription_end || null),
        subscription_months: isAdminEdit ? pick(body.subscription_months, st.subscription_months, null) : (st.subscription_months || null),
        subscription_method: isAdminEdit ? pick(body.subscription_method, st.subscription_method, null) : (st.subscription_method || null),
        plan_prices: st.plan_prices || body.plan_prices || null,
        updated_at: new Date().toISOString()
      };

      // Only small, non-image fields go into the `extra` JSONB fallback.
      // logo_url/banner_url are deliberately NOT mirrored here. They are image
      // data URLs (up to ~180 KB each after client compression) and mirroring
      // them stored every store's logo and banner TWICE — once in its real
      // column and once inside `extra` — so every `stores`/`storefronts` read
      // moved roughly double the bytes it actually needed. writeWithCandidates
      // below already owns the missing-column case: its slim candidate moves
      // logo_url/banner_url into `extra` only when the real column is absent
      // (STORE_OPTIONAL_COLS), which is precisely when the fallback is needed.
      let extraSf = {};
      try { extraSf = typeof st.extra === 'string' ? JSON.parse(st.extra) : (st.extra || {}); } catch(e) {}
      if (storeUpdates.name) extraSf.name = storeUpdates.name;
      if (storeUpdates.slogan) extraSf.slogan = storeUpdates.slogan;
      if (storeUpdates.layout) extraSf.layout = storeUpdates.layout;
      storeUpdates.extra = extraSf;

      // Always persist locally (db.json is the source of truth and the GET list
      // merges local over Supabase), and mirror the update to Supabase when the
      // store lives there. Use writeWithCandidates to handle missing columns.
      if (supabase) {
        try {
          const dbRecord = prepareRecordForDb('stores', storeUpdates);
          const { data: written, error: writeErr } = await writeWithCandidates(supabase, 'stores', 'update', dbRecord, st, storeId);
          if (writeErr) {
            console.warn('[POST] Supabase storefront update failed:', writeErr.message);
          }
        } catch (err) {
          console.warn('[POST] Supabase storefront update exception:', err.message);
        }
      }
      dataStore.ensureTable('stores');
      const store = dataStore.getStore();
      const idx = store.stores.findIndex(s => String(s.id) === String(storeId));
      if (idx !== -1) {
        store.stores[idx] = { ...store.stores[idx], ...storeUpdates };
      } else {
        store.stores.push({ id: storeId, vendor_id: st.vendor_id || body.vendor_id || '', ...storeUpdates });
      }
      dataStore.saveToFile();

      const sf = {
        id: storeId,
        store_id: storeId,
        vendor_id: st.vendor_id,
        status: storeUpdates.storefront_status,
        url_slug: storeUpdates.slug,
        theme: storeUpdates.theme,
        font_family: storeUpdates.font_family,
        slogan: storeUpdates.slogan,
        about_us: storeUpdates.description,
        logo_url: storeUpdates.logo_url,
        banner_url: storeUpdates.banner_url,
        primary_color: storeUpdates.primary_color,
        secondary_color: storeUpdates.secondary_color,
        tertiary_color: storeUpdates.tertiary_color,
        business_hours: storeUpdates.business_hours,
        shipping_policy: body.shipping_policy || storeUpdates.return_policy,
        return_policy: storeUpdates.return_policy,
        facebook_url: storeUpdates.facebook,
        instagram_url: storeUpdates.instagram,
        youtube_url: body.youtube_url || '',
        meta_description: body.meta_description || '',
        subscription_plan: storeUpdates.subscription_plan,
        subscription_status: storeUpdates.subscription_status,
        created_at: st.created_at,
        updated_at: storeUpdates.updated_at
      };
      return res.status(201).json(sf);
    }
    // Legacy alias: old code posted adjustments to a `transactions` table nobody ever reads.
    // Route those writes into the visible wallet ledger so every balance change is traceable.
    if (table === 'transactions') table = 'wallet_transactions';
    // (#3) Server-generated id — a client-chosen id could collide with (and
    // overwrite) another user's row. EXCEPTION: orders/packages keep the id the
    // replay guard above already checked, so a checkout retry stays idempotent
    // instead of creating a second order (server.js behaves the same).
    if (table === 'orders' || table === 'packages') {
      if (!body.id) body.id = generateId();
      body.id = String(body.id);
    } else {
      body.id = String(generateId());
    }
    if (!body.created_at) body.created_at = new Date().toISOString();
    body.updated_at = new Date().toISOString();

    // ── Atomic stock reservation (guide §7: no oversell) ─────────────────────
    // After the replay guard, before the row is written. Supabase: conditional
    // compare-and-swap UPDATE that only lands while stock_qty still equals the
    // validated value, so concurrent purchases cannot both take the last unit.
    // Local store: synchronous all-or-nothing decrement. Refusals answer 409
    // (out of stock) or 503 (storage unavailable) — never a silent oversell.
    if (pkgSale) {
      let applied = [];
      if (pkgSale.reqs.length) {
        if (supabase) {
          const dec = await commerce.atomicStockDecrement(supabase, pkgSale.reqs, { withTimeout: withSupaTimeout });
          if (!dec.ok) return res.status(dec.conflict ? 409 : 503).json({ error: dec.error });
          applied = dec.applied;
          // Mirror the authoritative Supabase result into the local store.
          try {
            dataStore.ensureTable('products');
            const prows = dataStore.getStore().products || [];
            let mirrored = false;
            for (const a of applied) {
              const lrow = prows.find(x => String(x.id) === a.pid);
              if (lrow) { Object.assign(lrow, a.patch); mirrored = true; }
            }
            if (mirrored) { dataStore.saveToFile(); pkgLocalMirrored = true; }
          } catch (e) { console.error('[POST] stock mirror failed:', e.message); }
        } else {
          dataStore.ensureTable('products');
          const dec = commerce.applyLocalDecrement(dataStore.getStore().products || [], pkgSale.reqs);
          if (!dec.ok) return res.status(dec.conflict ? 409 : 503).json({ error: dec.error });
          applied = dec.applied;
          if (applied.length) { dataStore.saveToFile(); pkgLocalMirrored = true; }
        }
      }

      // Store sales stats — server-owned, counted only for a sale whose stock
      // was actually reserved.
      if (pkgSale.storeId) {
        try {
          dataStore.ensureTable('stores');
          const stRow = (dataStore.getStore().stores || []).find(s => String(s.id) === String(pkgSale.storeId));
          if (stRow) {
            stRow.total_sales = Math.round(((parseFloat(stRow.total_sales) || 0) + pkgSale.money.gross) * 100) / 100;
            stRow.total_orders = (parseInt(stRow.total_orders, 10) || 0) + 1;
            dataStore.saveToFile();
            if (supabase) {
              supabase.from('stores').update({ total_sales: stRow.total_sales, total_orders: stRow.total_orders }).eq('id', String(pkgSale.storeId)).then(() => {}).catch(() => {});
            }
          }
        } catch (e) {}
      }
      pkgApplied = applied;
    }

    // (#2) Stamp the owner from the session AFTER the client fields were
    // dropped. Every writable table that carries an owner needs one here: a
    // missing stamp makes the row invisible to the user who created it
    // (support tickets, referrals) or unattributable (ad campaigns lose their
    // vendor).
    if (access.isAdmin(viewer)) {
      const qOwn = req.query.vendor_id || req.query.buyer_id || req.query.user_id || req.query.rendor_id;
      if (qOwn) {
        if (table === 'products' || table === 'stores' || table === 'storefronts' || table === 'ad_campaigns') body.vendor_id = String(qOwn);
        else if (table === 'orders' || table === 'packages') body.buyer_id = String(qOwn);
        else if (table === 'support_tickets' || table === 'notifications') body.user_id = String(qOwn);
        else if (table === 'services') body.rendor_id = String(qOwn);
      }
    } else {
      const ownId = viewer ? String(viewer.userId) : 'anonymous';
      if (table === 'products' || table === 'stores' || table === 'storefronts' || table === 'ad_campaigns') {
        body.vendor_id = ownId;
      } else if (table === 'orders' || table === 'packages') {
        body.buyer_id = ownId;
      } else if (table === 'support_tickets') {
        body.user_id = ownId;
      } else if (table === 'reviews') {
        body.buyer_id = ownId;
      } else if (table === 'services') {
        body.rendor_id = ownId;
      } else if (table === 'referrals') {
        // The new account records who referred it: the referred side is always
        // the session, and the referrer must be a real account.
        body.referred_id = ownId;
        const referrerId = String(body.referrer_id || '');
        if (!referrerId || !(await userExistsById(referrerId))) {
          return res.status(400).json({ error: 'Referrer not found.' });
        }
      }
    }

    // Product rows must carry sane numbers (mirrors server.js and the PUT/PATCH
    // routes): JSON.stringify turns NaN into null, so the POST path used to
    // happily save price:null products that rendered as "GHS null" on the site.
    if (table === 'products') {
      const pv = commerce.validateProductBody(body, { requirePrice: true });
      if (!pv.ok) return res.status(400).json({ error: pv.error });
    }

    const record = serializeRecord(body);
    // POST shares prepareRecordForDb's Postgres type coercion: an empty-string
    // timestamp (flash_sale_end: '') or numeric would 400 on the fresh schema
    // (22007/22P02). Reuse the same maps the update path uses.
    for (const col of TIMESTAMP_COLUMNS[table] || []) {
      if (record[col] === '') record[col] = null;
    }
    for (const col of NUMERIC_COLUMNS[table] || []) {
      if (record[col] === '') record[col] = null;
    }

    if (table === 'notifications' && record && record.user_id && record.title) {
      dispatchPushNotificationApi({
        user_id: record.user_id,
        title: record.title,
        body: record.message || '',
        url: record.action_url || './'
      }).catch(err => console.warn('[Push] Auto dispatch error:', err.message));
    }

    if (!supabase) {
      // In-memory/file-backed path
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        store[table].push(record);
        const fileSaved = dataStore.saveToFile();
        
        console.log(`[POST] Saved ${table}/${record.id} to memory${fileSaved ? ' + db.json' : ' (file save failed, continuing with memory)'}`);
        const out = serializeRecord(record);
        if (table === 'users' && typeof createSessionToken === 'function') {
          out.token = createSessionToken(out.id, out.role);
        }
        if (table === 'packages' || table === 'orders') notifyNewOrder(out).catch(() => {});
        return res.status(201).json(out);
      } catch (localErr) {
        console.error('[POST] Local store error:', table, localErr);
        await releaseReservedStock();
        return res.status(500).json({ error: localErr.message, backend: 'memory-cache' });
      }
    }

    // Supabase path — retry with slim candidates when optional columns are missing.
    // If Supabase rejects the write (RLS policy, missing column, schema drift),
    // fall back to the local db.json store so the record is NEVER lost — the
    // frontend must not receive a 500 here, because it would silently route the
    // write to localStorage and the order would vanish from every list page.
    const { data, error } = await writeWithCandidates(supabase, table, 'insert', record);
    if (error) {
      console.error('[POST] Supabase error:', table, error.message, '— falling back to db.json');
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        store[table].push(record);
        const fileSaved = dataStore.saveToFile();
        console.log(`[POST] Fallback: saved ${table}/${record.id} to local store${fileSaved ? ' + db.json' : ' (memory only)'}`);
        const out = serializeRecord(record);
        if (table === 'users' && typeof createSessionToken === 'function') {
          out.token = createSessionToken(out.id, out.role);
        }
        if (table === 'packages' || table === 'orders') notifyNewOrder(out).catch(() => {});
        return res.status(201).json(out);
      } catch (localErr) {
        console.error('[POST] Local fallback failed:', table, localErr);
        await releaseReservedStock();
        return res.status(500).json({ error: localErr.message, backend: 'supabase' });
      }
    }
    console.log(`[POST] Saved ${table}/${data.id} to Supabase`);
    const out = serializeRecord(data);
    if (table === 'users' && typeof createSessionToken === 'function') {
      out.token = createSessionToken(out.id, out.role);
    }
    if (table === 'packages' || table === 'orders') notifyNewOrder(out).catch(() => {});
    res.status(201).json(out);
  } catch (err) {
    console.error('[POST] Unexpected error:', err);
    await releaseReservedStock();
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// PUT /api/:table/:id  — full replace
app.put('/api/:table/:id', writeRateLimiter, async (req, res) => {
  try {
    const supabase = getSupabase();
    let table = req.params.table;
    // (#10) Closed table allowlist — unknown tables 404. The POST route already
    // enforced this; PUT/PATCH did not, so a crafted request could have created
    // and written an arbitrary table on the deployed backend.
    if (!access.WRITABLE_TABLES.has(table)) return res.status(404).json({ error: 'Unknown resource.' });
    const id = req.params.id;
    if (table === 'transactions') table = 'wallet_transactions'; // legacy alias → visible ledger
    let body = { ...req.body, id: id, updated_at: new Date().toISOString() };

    // Resumable uploads: swap `asset:<id>` refs for the assembled data URLs.
    {
      const expanded = await expandUploadAssets(body, access.getAccessContext(req));
      if (!expanded.ok) return res.status(expanded.status).json({ error: expanded.error, code: expanded.code });
      body = expanded.body;
    }

    // Server-side convenience: when callers supply a months value but do not
    // include an explicit expiry, compute the subscription expiry by
    // extending from the current expiry (if in the future) or from now.
    // This guarantees renewals are added on top of remaining days.
    try {
      const now = Date.now();
      // Users: rendor subscription claims (admin confirmations or helper calls)
      if (table === 'users') {
        const months = Number(body.sub_payment_months || (body.rendor_sub_plan && parseInt(String(body.rendor_sub_plan).replace(/[^0-9]/g, ''), 10)));
        const activating = body.rendor_sub_status === 'active' || body.sub_payment_status === 'confirmed';
        if (months && activating && !('rendor_sub_expiry' in body)) {
          let existingUser = null;
          const supabase = getSupabase();
          if (supabase) {
            try {
              const { data } = await supabase.from('users').select('rendor_sub_expiry').eq('id', id).maybeSingle();
              if (data) existingUser = serializeRecord(data);
            } catch (e) {}
          }
          if (!existingUser) {
            try { dataStore.ensureTable('users'); existingUser = (dataStore.getStore().users || []).find(u => String(u.id) === String(id)) || null; } catch (e) { existingUser = null; }
          }
          const curMs = access.rendorSubExpiryMs(existingUser && existingUser.rendor_sub_expiry);
          const startFrom = Number.isFinite(curMs) && curMs > now ? curMs : now;
          const newExpiry = new Date(startFrom + months * 30 * 86400000);
          body.rendor_sub_expiry = String(newExpiry.getTime());
          body.rendor_sub_status = 'active';
        }
      }

      // Stores / storefronts: extend subscription_end when months provided
      if (table === 'stores' || table === 'storefronts') {
        const months = Number(body.subscription_months);
        if (months && !('subscription_end' in body)) {
          let existingStore = null;
          const supabase = getSupabase();
          if (supabase) {
            try {
              const { data } = await supabase.from('stores').select('subscription_end').eq('id', id).maybeSingle();
              if (data) existingStore = serializeRecord(data);
            } catch (e) {}
          }
          if (!existingStore) {
            try { dataStore.ensureTable('stores'); existingStore = (dataStore.getStore().stores || []).find(s => String(s.id) === String(id)) || null; } catch (e) { existingStore = null; }
          }
          const currentEnd = existingStore && existingStore.subscription_end ? new Date(existingStore.subscription_end) : null;
          const startFrom = (currentEnd && currentEnd.getTime() > now) ? currentEnd : new Date(now);
          const newEnd = new Date(startFrom);
          newEnd.setMonth(newEnd.getMonth() + months);
          body.subscription_end = newEnd.toISOString();
          body.subscription_start = body.subscription_start || startFrom.toISOString();
          body.subscription_status = 'active';
        }
      }
    } catch (e) {}

    // ── Access control (storefronts are checked in their branch after the
    // store is resolved — a PATCH/PUT may carry only { status } with no owner id) ──
    if (table !== 'storefronts') {
      const viewer = access.getAccessContext(req);
      // Resolve the existing row BEFORE the ownership check so row owners can
      // mutate their records even when the body itself carries no owner field
      // (e.g. marking a notification read sends only { is_read: true }).
      let existingForAuth = null;
      if (table !== 'users') {
        if (!supabase) {
          dataStore.ensureTable(table);
          existingForAuth = dataStore.getStore()[table].find(r => String(r.id) === String(id)) || null;
        } else {
          try {
            const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
            if (data) existingForAuth = serializeRecord(data);
          } catch (e) {}
        }
      }
      const allowed = access.assertMutateAllowed(table, viewer, table === 'users' ? { id } : existingForAuth, body);
      if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });
      // Re-activating an archived post must not slip past the post cap.
      if (table === 'services') {
        const over = await rendorPostLimitReached({ viewer, body, existing: existingForAuth, supabase });
        if (over) return res.status(over.status).json({ error: over.error, code: over.code });
      }
      if (table === 'products') {
        const pv = commerce.validateProductBody(body);
        if (!pv.ok) return res.status(400).json({ error: pv.error });
        // (#2) Moving a product under someone else's store would hand that
        // store the vendor payout for a product it does not sell.
        if (body.store_id && !access.isAdmin(viewer)
            && (await productStoreOwnership(viewer, body.store_id)) === 'foreign') {
          return res.status(403).json({ error: 'You can only file products under your own store.' });
        }
      }
    }

    // (#2) Owner identity lives on the stored record — a PATCH/PUT body can
    // never move a row to another owner.
    for (const f of ['vendor_id', 'buyer_id', 'user_id', 'rendor_id', 'referrer_id', 'referred_id']) delete body[f];

    // Service posts: a rendor can never reassign a post to another rendor.
    if (table === 'services' && !access.isAdmin(viewer)) {
      body.rendor_id = String(viewer.userId);
    }

    // Hash user passwords server-side
    if (table === 'users') {
      if (body.password && !body.password_hash) body.password_hash = body.password; // legacy `password` field alias
      delete body.password; // plaintext must never reach the database (#8)
      if (body.password_hash && !body.password_hash.startsWith('$2a$') && !body.password_hash.startsWith('$2b$')) {
        try {
          body.password_hash = await bcrypt.hash(body.password_hash, 10);
        } catch (e) {
          console.error('[Auth] Failed to hash password:', e.message);
          return res.status(500).json({ error: 'Failed to process password update.' });
        }
      }
    }

    const record = serializeRecord(body);

    // Storefront is a virtual view over `stores` — treat a PUT to it as an
    // update of the store record (mirror of server.js), so saving storefront
    // customizations persists even for stores that live only in db.json.
    if (table === 'storefronts') {
      const cleanId = String(id).replace(/^sft-/, '');
      let st = null;
      if (supabase) {
        try {
          const { data, error } = await supabase.from('stores').select('*').eq('id', cleanId).maybeSingle();
          if (!error && data) st = serializeRecord(data);
        } catch (err) {}
      }
      if (!st) {
        dataStore.ensureTable('stores');
        st = dataStore.getStore().stores.find(s => String(s.id) === String(cleanId)) || null;
      }
      if (!st && supabase) {
        try {
          const { data, error } = await supabase.from('stores').select('*').eq('vendor_id', cleanId).limit(1);
          if (!error && data && data.length > 0) st = serializeRecord(data[0]);
        } catch (err) {}
      }
      if (!st) {
        dataStore.ensureTable('stores');
        st = dataStore.getStore().stores.find(s => String(s.vendor_id) === String(cleanId)) || null;
      }
      if (!st) {
        return res.status(404).json({ error: 'Store not found to update storefront' });
      }

      // ── Access control: only the store owner or an admin ──
      {
        const viewer = access.getAccessContext(req);
        if (!access.isAdmin(viewer) && String(st.vendor_id || body.vendor_id || '') !== String(viewer && viewer.userId)) {
          return res.status(403).json({ error: 'You can only manage your own store.' });
        }
        // Payment enforcement: going live is EARNED by payment, not a flag a
        // client can freely set. Only an admin, or a paid-up store (active
        // subscription ending in the future), may set status 'active'.
        if ('status' in body && body.status === 'active' && !access.canActivateStorefront(st, viewer)) {
          return res.status(402).json({ error: 'Subscription payment required before activating the storefront. Select a plan and pay first.' });
        }
      }

      const storeId = st.id;
      const storeUpdates = {};
      if ('status' in body) storeUpdates.storefront_status = body.status;
      if ('url_slug' in body) storeUpdates.slug = body.url_slug;
      if ('theme' in body) storeUpdates.theme = body.theme;
      if ('font_family' in body) storeUpdates.font_family = body.font_family;
      if ('slogan' in body) storeUpdates.slogan = body.slogan;
      if ('about_us' in body) storeUpdates.description = body.about_us;
      if ('logo_url' in body) storeUpdates.logo_url = body.logo_url;
      if ('banner_url' in body) storeUpdates.banner_url = body.banner_url;
      if ('primary_color' in body) storeUpdates.primary_color = body.primary_color;
      if ('secondary_color' in body) storeUpdates.secondary_color = body.secondary_color;
      if ('tertiary_color' in body) storeUpdates.tertiary_color = body.tertiary_color;
      if ('business_hours' in body) storeUpdates.business_hours = body.business_hours;
      if ('return_policy' in body) storeUpdates.return_policy = body.return_policy;
      if ('facebook_url' in body) storeUpdates.facebook = body.facebook_url;
      if ('instagram_url' in body) storeUpdates.instagram = body.instagram_url;
      if ('subscription_plan' in body) storeUpdates.subscription_plan = body.subscription_plan;
      if ('subscription_status' in body) storeUpdates.subscription_status = body.subscription_status;
      if ('subscription_start' in body) storeUpdates.subscription_start = body.subscription_start;
      if ('subscription_end' in body) storeUpdates.subscription_end = body.subscription_end;
      if ('subscription_months' in body) storeUpdates.subscription_months = body.subscription_months;
      if ('subscription_method' in body) storeUpdates.subscription_method = body.subscription_method;
      if ('plan_prices' in body) storeUpdates.plan_prices = body.plan_prices;
    if ('layout' in body) storeUpdates.layout = body.layout;
      storeUpdates.updated_at = new Date().toISOString();

      // Only small, non-image fields go into `extra` — see the note in the POST
      // storefront branch: mirroring logo_url/banner_url doubled every store's
      // image payload on every read, and writeWithCandidates already retries a
      // slim candidate that populates `extra` when the real column is missing.
      let extraSf = {};
      try { extraSf = typeof st.extra === 'string' ? JSON.parse(st.extra) : (st.extra || {}); } catch(e) {}
      if ('name' in storeUpdates) extraSf.name = storeUpdates.name;
      if ('slogan' in storeUpdates) extraSf.slogan = storeUpdates.slogan;
      if ('plan_prices' in storeUpdates) extraSf.plan_prices = storeUpdates.plan_prices;
      if ('admin_feedback' in body) extraSf.admin_feedback = String(body.admin_feedback).slice(0, 500);
      storeUpdates.extra = extraSf;

      // writeWithCandidates, not a bare update: supabase-js RESOLVES with
      // `{ error }` instead of throwing, so the try/catch that used to wrap the
      // raw update could never fire — a missing column or RLS rejection was
      // swallowed silently and the storefront edit was quietly lost on the
      // deployed backend. This now retries the slim payload and reports failure.
      if (supabase) {
        try {
          const dbRecord = prepareRecordForDb('stores', storeUpdates);
          const { error: writeErr } = await writeWithCandidates(supabase, 'stores', 'update', dbRecord, st, storeId);
          if (writeErr) {
            console.warn('[PUT] Supabase storefront update failed:', writeErr.message);
          }
        } catch (err) {
          console.warn('[PUT] Supabase storefront update exception:', err.message);
        }
      }
      dataStore.ensureTable('stores');
      const storeData = dataStore.getStore();
      const idx = (storeData.stores || []).findIndex(s => String(s.id) === String(storeId));
      if (idx !== -1) {
        storeData.stores[idx] = { ...storeData.stores[idx], ...storeUpdates };
        dataStore.saveToFile();
      } else {
        storeData.stores.push({ id: storeId, vendor_id: st.vendor_id, ...storeUpdates });
        dataStore.saveToFile();
      }

      let updatedSt = { ...st, ...storeUpdates };
      const sf = {
        id: storeId,
        store_id: storeId,
        vendor_id: updatedSt.vendor_id,
        status: updatedSt.storefront_status || 'draft',
        url_slug: updatedSt.slug || '',
        name: updatedSt.name || '',
        theme: updatedSt.theme || 'classic',
        layout: updatedSt.layout || (updatedSt.extra && updatedSt.extra.layout) || 'grid',
        font_family: updatedSt.font_family || 'Outfit',
        slogan: updatedSt.slogan || '',
        about_us: updatedSt.description || updatedSt.about_us || '',
        logo_url: updatedSt.logo_url || '',
        banner_url: updatedSt.banner_url || '',
        primary_color: updatedSt.primary_color || '#e85d04',
        secondary_color: updatedSt.secondary_color || '#faf9f6',
        tertiary_color: updatedSt.tertiary_color || '#e85d04',
        business_hours: updatedSt.business_hours || 'Mon - Sat: 8:00 AM - 6:00 PM',
        shipping_policy: updatedSt.return_policy || '',
        return_policy: updatedSt.return_policy || '',
        facebook_url: updatedSt.facebook || updatedSt.facebook_url || '',
        instagram_url: updatedSt.instagram || updatedSt.instagram_url || '',
        youtube_url: body.youtube_url || '',
        meta_description: body.meta_description || '',
        subscription_plan: updatedSt.subscription_plan || 'starter',
        subscription_status: updatedSt.subscription_status || 'active',
        subscription_start: updatedSt.subscription_start || null,
        subscription_end: updatedSt.subscription_end || null,
        subscription_months: updatedSt.subscription_months || null,
        subscription_method: updatedSt.subscription_method || null,
        plan_prices: updatedSt.plan_prices || body.plan_prices || (updatedSt.extra && updatedSt.extra.plan_prices) || null,
        admin_feedback: body.admin_feedback || (updatedSt.extra && updatedSt.extra.admin_feedback) || null,
        created_at: updatedSt.created_at,
        updated_at: updatedSt.updated_at
      };
      return res.json(sf);
    }
    
    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const idx = store[table].findIndex(r => String(r.id) === String(id));
      if (idx === -1) store[table].push(record); else store[table][idx] = { ...store[table][idx], ...record };
      dataStore.saveToFile();
      return res.json(serializeRecord(record));
    }
    
    const { data, error } = await writeWithCandidates(supabase, table, 'upsert', record);
    if (error) {
      console.error('[PUT] Supabase error:', table, error.message, '— falling back to db.json');
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        const idx = store[table].findIndex(r => String(r.id) === String(id));
        if (idx === -1) store[table].push(record); else store[table][idx] = { ...store[table][idx], ...record };
        dataStore.saveToFile();
        return res.json(serializeRecord(record));
      } catch (localErr) {
        console.error('[PUT] Local fallback failed:', table, localErr);
        return res.status(500).json({ error: localErr.message });
      }
    }
    res.json(serializeRecord(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/:table/:id  — partial update
app.patch('/api/:table/:id', writeRateLimiter, async (req, res) => {
  try {
    const supabase = getSupabase();
    let table = req.params.table;
    // (#10) Closed table allowlist — see the PUT route above.
    if (!access.WRITABLE_TABLES.has(table)) return res.status(404).json({ error: 'Unknown resource.' });
    const id = req.params.id;
    if (table === 'transactions') table = 'wallet_transactions'; // legacy alias → visible ledger
    let body = { ...req.body, id: id, updated_at: new Date().toISOString() };

    // Resumable uploads: swap `asset:<id>` refs for the assembled data URLs.
    {
      const expanded = await expandUploadAssets(body, access.getAccessContext(req));
      if (!expanded.ok) return res.status(expanded.status).json({ error: expanded.error, code: expanded.code });
      body = expanded.body;
    }

    // ── Access control (storefronts are checked in their branch after the
    // store is resolved — a PATCH/PUT may carry only { status } with no owner id) ──
    if (table !== 'storefronts') {
      const viewer = access.getAccessContext(req);
      // Resolve the existing row BEFORE the ownership check so row owners can
      // mutate their records even when the body itself carries no owner field
      // (e.g. marking a notification read sends only { is_read: true }).
      let existingForAuth = null;
      if (table !== 'users') {
        if (!supabase) {
          dataStore.ensureTable(table);
          existingForAuth = dataStore.getStore()[table].find(r => String(r.id) === String(id)) || null;
        } else {
          try {
            const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
            if (data) existingForAuth = serializeRecord(data);
          } catch (e) {}
        }
      }
      const allowed = access.assertMutateAllowed(table, viewer, table === 'users' ? { id } : existingForAuth, body);
      if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });
      // Re-activating an archived post must not slip past the post cap.
      if (table === 'services') {
        const over = await rendorPostLimitReached({ viewer, body, existing: existingForAuth, supabase });
        if (over) return res.status(over.status).json({ error: over.error, code: over.code });
      }
      if (table === 'products') {
        const pv = commerce.validateProductBody(body);
        if (!pv.ok) return res.status(400).json({ error: pv.error });
        // (#2) Moving a product under someone else's store would hand that
        // store the vendor payout for a product it does not sell.
        if (body.store_id && !access.isAdmin(viewer)
            && (await productStoreOwnership(viewer, body.store_id)) === 'foreign') {
          return res.status(403).json({ error: 'You can only file products under your own store.' });
        }
      }
    }

    // Hash user passwords server-side
    if (table === 'users') {
      if (body.password && !body.password_hash) body.password_hash = body.password; // legacy `password` field alias
      delete body.password; // plaintext must never reach the database (#8)
      if (body.password_hash && !body.password_hash.startsWith('$2a$') && !body.password_hash.startsWith('$2b$')) {
        try {
          body.password_hash = await bcrypt.hash(body.password_hash, 10);
        } catch (e) {
          console.error('[Auth] Failed to hash password:', e.message);
          return res.status(500).json({ error: 'Failed to process password update.' });
        }
      }
      global.userCache = {};
    }

    // Store slugs stay globally unique on edit too — a PATCH must never be able
    // to steal another store's public URL.
    if (table === 'stores' && 'slug' in body) {
      const newSlug = String(body.slug || '').trim().toLowerCase();
      if (newSlug) {
        let clash = null;
        if (supabase) {
          try {
            const { data } = await supabase.from('stores').select('id, slug').eq('slug', newSlug).limit(1);
            if (data && data.length) clash = data[0];
          } catch (e) {}
        }
        if (!clash) {
          dataStore.ensureTable('stores');
          clash = (dataStore.getStore().stores || []).find(s => String(s.slug || '').toLowerCase() === newSlug) || null;
        }
        if (clash && String(clash.id) !== String(id)) {
          return res.status(409).json({ error: 'That store link is already taken. Please choose a different one.' });
        }
      }
    }

    const record = serializeRecord(body);

    if (table === 'storefronts') {
      // The frontend PATCHes with id 'sft-<storeId>' — strip the prefix and
      // fall back to the local db.json store so local-only stores can update
      // their storefront (the GET list merges local stores over Supabase).
      const cleanId = String(id).replace(/^sft-/, '');
      let st = null;
      if (supabase) {
        const { data, error } = await supabase.from('stores').select('*').eq('id', cleanId).maybeSingle();
        if (!error && data) st = serializeRecord(data);
      }
      if (!st) {
        dataStore.ensureTable('stores');
        st = dataStore.getStore().stores.find(s => String(s.id) === String(cleanId)) || null;
      }
      if (!st && supabase) {
        const { data, error } = await supabase.from('stores').select('*').eq('vendor_id', cleanId).limit(1);
        if (!error && data && data.length > 0) st = serializeRecord(data[0]);
      }
      if (!st) {
        dataStore.ensureTable('stores');
        st = dataStore.getStore().stores.find(s => String(s.vendor_id) === String(cleanId)) || null;
      }

      if (!st) {
        return res.status(404).json({ error: 'Store not found to update storefront' });
      }

      // ── Access control: only the store owner or an admin ──
      {
        const viewer = access.getAccessContext(req);
        if (!access.isAdmin(viewer) && String(st.vendor_id || body.vendor_id || '') !== String(viewer && viewer.userId)) {
          return res.status(403).json({ error: 'You can only manage your own store.' });
        }
        // Payment enforcement: going live is EARNED by payment, not a flag a
        // client can freely set. Only an admin, or a paid-up store (active
        // subscription ending in the future), may set status 'active'.
        if ('status' in body && body.status === 'active' && !access.canActivateStorefront(st, viewer)) {
          return res.status(402).json({ error: 'Subscription payment required before activating the storefront. Select a plan and pay first.' });
        }
      }

      const storeId = st.id;
      const storeUpdates = {};
      if ('status' in body) storeUpdates.storefront_status = body.status;
      if ('url_slug' in body) storeUpdates.slug = body.url_slug;
      if ('theme' in body) storeUpdates.theme = body.theme;
      if ('font_family' in body) storeUpdates.font_family = body.font_family;
      if ('slogan' in body) storeUpdates.slogan = body.slogan;
      if ('about_us' in body) storeUpdates.description = body.about_us;
      if ('logo_url' in body) storeUpdates.logo_url = body.logo_url;
      if ('banner_url' in body) storeUpdates.banner_url = body.banner_url;
      if ('primary_color' in body) storeUpdates.primary_color = body.primary_color;
      if ('secondary_color' in body) storeUpdates.secondary_color = body.secondary_color;
      if ('tertiary_color' in body) storeUpdates.tertiary_color = body.tertiary_color;
      if ('business_hours' in body) storeUpdates.business_hours = body.business_hours;
      if ('return_policy' in body) storeUpdates.return_policy = body.return_policy;
      if ('facebook_url' in body) storeUpdates.facebook = body.facebook_url;
      if ('instagram_url' in body) storeUpdates.instagram = body.instagram_url;
      if ('subscription_plan' in body) storeUpdates.subscription_plan = body.subscription_plan;
      if ('subscription_status' in body) storeUpdates.subscription_status = body.subscription_status;
      if ('subscription_start' in body) storeUpdates.subscription_start = body.subscription_start;
      if ('subscription_end' in body) storeUpdates.subscription_end = body.subscription_end;
      if ('subscription_months' in body) storeUpdates.subscription_months = body.subscription_months;
      if ('subscription_method' in body) storeUpdates.subscription_method = body.subscription_method;
      if ('layout' in body) storeUpdates.layout = body.layout;
      // Admin per-vendor plan price overrides set at approval time. Must be
      // copied here or the store's `extra.plan_prices` is never written and the
      // vendor falls back to the global prices on reload.
      if ('plan_prices' in body) storeUpdates.plan_prices = body.plan_prices;

      let extra = {};
      try {
        extra = typeof st.extra === 'string' ? JSON.parse(st.extra) : (st.extra || {});
      } catch(e) {}
      // logo_url/banner_url are NOT mirrored into `extra` — see the note in the
      // POST storefront branch. Only the small, non-image fields go here.
      if ('name' in storeUpdates) extra.name = storeUpdates.name;
      if ('slogan' in storeUpdates) extra.slogan = storeUpdates.slogan;
      if ('layout' in storeUpdates) extra.layout = storeUpdates.layout;
      if ('plan_prices' in storeUpdates) extra.plan_prices = storeUpdates.plan_prices;
      if ('admin_feedback' in body) extra.admin_feedback = String(body.admin_feedback).slice(0, 500);
      if ('only_show_on_storefront' in body) {
        extra.only_show_on_storefront = body.only_show_on_storefront === true || body.only_show_on_storefront === 'true';
      }
      storeUpdates.extra = extra;

      storeUpdates.updated_at = new Date().toISOString();

      // writeWithCandidates, not a bare update — see the note in the PUT
      // storefront branch: a resolved `{ error }` never reaches try/catch, so a
      // schema mismatch used to lose the edit silently.
      if (supabase) {
        try {
          const dbRecord = prepareRecordForDb('stores', storeUpdates);
          const { error: writeErr } = await writeWithCandidates(supabase, 'stores', 'update', dbRecord, st, storeId);
          if (writeErr) {
            console.warn('[PATCH] Supabase storefront update failed:', writeErr.message);
          }
        } catch (err) {
          console.warn('[PATCH] Supabase storefront update exception:', err.message);
        }
      }
      dataStore.ensureTable('stores');
      const storeData = dataStore.getStore();
      const idx = (storeData.stores || []).findIndex(s => String(s.id) === String(storeId));
      if (idx !== -1) {
        storeData.stores[idx] = { ...storeData.stores[idx], ...storeUpdates };
        dataStore.saveToFile();
      } else {
        storeData.stores.push({ id: storeId, vendor_id: st.vendor_id || '', ...storeUpdates });
        dataStore.saveToFile();
      }

      let updatedSt = { ...st, ...storeUpdates };
      const sf = {
        id: storeId,
        store_id: storeId,
        vendor_id: updatedSt.vendor_id,
        status: updatedSt.storefront_status || 'draft',
        url_slug: updatedSt.slug || '',
        name: updatedSt.name || '',
        theme: updatedSt.theme || 'classic',
        layout: updatedSt.layout || (updatedSt.extra && updatedSt.extra.layout) || 'grid',
        font_family: updatedSt.font_family || 'Outfit',
        slogan: updatedSt.slogan || '',
        about_us: updatedSt.description || updatedSt.about_us || '',
        logo_url: updatedSt.logo_url || '',
        banner_url: updatedSt.banner_url || '',
        primary_color: updatedSt.primary_color || '#e85d04',
        secondary_color: updatedSt.secondary_color || '#faf9f6',
        tertiary_color: updatedSt.tertiary_color || '#e85d04',
        business_hours: updatedSt.business_hours || 'Mon - Sat: 8:00 AM - 6:00 PM',
        shipping_policy: updatedSt.return_policy || '',
        return_policy: updatedSt.return_policy || '',
        facebook_url: updatedSt.facebook || updatedSt.facebook_url || '',
        instagram_url: updatedSt.instagram || updatedSt.instagram_url || '',
        youtube_url: body.youtube_url || '',
        meta_description: body.meta_description || '',
        subscription_plan: updatedSt.subscription_plan || 'starter',
        subscription_status: updatedSt.subscription_status || 'active',
        subscription_start: updatedSt.subscription_start || null,
        subscription_end: updatedSt.subscription_end || null,
        subscription_months: updatedSt.subscription_months || null,
        subscription_method: updatedSt.subscription_method || null,
        only_show_on_storefront: updatedSt.extra?.only_show_on_storefront === true || updatedSt.extra?.only_show_on_storefront === 'true',
        created_at: updatedSt.created_at,
        updated_at: updatedSt.updated_at
      };
      return res.json(sf);
    }
    
    let existingRecord = null;
    let localOnlyRecord = false;
    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      existingRecord = store[table].find(r => String(r.id) === String(id));
      localOnlyRecord = !!existingRecord;
    } else {
      const { data: dbData } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (dbData) existingRecord = serializeRecord(dbData);
      if (!dbData) {
        // Record isn't in Supabase — it may live only in db.json (e.g. a store
        // created before Supabase was wired up). Fall back to the local record
        // and write locally so PATCHes like storefront_status still persist.
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        const localRec = store[table].find(r => String(r.id) === String(id));
        if (localRec) {
          existingRecord = serializeRecord(localRec);
          localOnlyRecord = true;
        }
      }
    }

    if (!supabase || localOnlyRecord) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const idx = store[table].findIndex(r => String(r.id) === String(id));
      const mergedRecord = serializeRecord({ ...existingRecord, ...body, id: id });
      const dbRecord = prepareRecordForDb(table, mergedRecord, existingRecord);
      if (idx === -1) {
        store[table].push(dbRecord);
      } else {
        store[table][idx] = { ...store[table][idx], ...dbRecord };
      }
      dataStore.saveToFile();
      return res.json(serializeRecord(idx === -1 ? dbRecord : store[table][idx]));
    }
    
    // Use update instead of upsert; retry slim candidates when optional columns are missing.
    // On Supabase failure, persist to the local store so the update is never lost.
    const { data, error } = await writeWithCandidates(supabase, table, 'update', record, existingRecord, id);
    if (error) {
      console.error('[PATCH] Supabase error:', table, error.message, '— falling back to db.json');
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        const idx = store[table].findIndex(r => String(r.id) === String(id));
        const mergedRecord = serializeRecord({ ...existingRecord, ...body, id: id });
        const dbRecord = prepareRecordForDb(table, mergedRecord, existingRecord);
        if (idx === -1) {
          store[table].push(dbRecord);
        } else {
          store[table][idx] = { ...store[table][idx], ...dbRecord };
        }
        dataStore.saveToFile();
        return res.json(serializeRecord(idx === -1 ? dbRecord : store[table][idx]));
      } catch (localErr) {
        console.error('[PATCH] Local fallback failed:', table, localErr);
        return res.status(500).json({ error: localErr.message });
      }
    }
    res.json(serializeRecord(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Account deletion cascade (shared by admin delete + self-service delete) ──
// Dissociate history (orders, packages, wallet, referrals, reviews keep their
// totals for analytics), delete personal dependencies (notifications, ads,
// services, products, stores, push subscriptions, support tickets), then
// hard-delete the user row. Returns { ok } or { ok:false, error }.
async function cascadeDeleteUserSupabase(supabase, id) {
  // 1. Dissociate historical records by setting their user reference to NULL
  try { await supabase.from('orders').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}
  try { await supabase.from('orders').update({ vendor_id: null }).eq('vendor_id', id); } catch (e) {}
  try { await supabase.from('packages').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}
  try { await supabase.from('packages').update({ vendor_id: null }).eq('vendor_id', id); } catch (e) {}
  try { await supabase.from('wallet_transactions').update({ user_id: null }).eq('user_id', id); } catch (e) {}
  try { await supabase.from('referrals').update({ referrer_id: null }).eq('referrer_id', id); } catch (e) {}
  try { await supabase.from('referrals').update({ referred_id: null }).eq('referred_id', id); } catch (e) {}
  try { await supabase.from('reviews').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}
  try { await supabase.from('service_orders').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}
  try { await supabase.from('service_orders').update({ rendor_id: null }).eq('rendor_id', id); } catch (e) {}

  // 2. Delete temporary/personal dependencies
  try { await supabase.from('notifications').delete().eq('user_id', id); } catch (e) {}
  try { await supabase.from('ad_campaigns').delete().eq('vendor_id', id); } catch (e) {}
  try { await supabase.from('services').delete().eq('rendor_id', id); } catch (e) {}
  try { await supabase.from('products').delete().eq('vendor_id', id); } catch (e) {}
  try { await supabase.from('stores').delete().eq('vendor_id', id); } catch (e) {}
  try { await supabase.from('support_tickets').delete().eq('user_id', id); } catch (e) {}
  try { await supabase.from('push_subscriptions').delete().eq('user_id', id); } catch (e) {}

  // 3. Now safely hard-delete the user account
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Local (db.json) variant of the cascade — same rules, memory/file store.
function cascadeDeleteUserLocal(store, id) {
  dataStore.ensureTable('orders');
  store.orders.forEach(o => {
    if (String(o.buyer_id) === String(id)) o.buyer_id = null;
    if (String(o.vendor_id) === String(id)) o.vendor_id = null;
  });

  dataStore.ensureTable('packages');
  store.packages.forEach(p => {
    if (String(p.buyer_id) === String(id)) p.buyer_id = null;
    if (String(p.vendor_id) === String(id)) p.vendor_id = null;
  });

  dataStore.ensureTable('wallet_transactions');
  store.wallet_transactions.forEach(t => {
    if (String(t.user_id) === String(id)) t.user_id = null;
  });

  dataStore.ensureTable('referrals');
  store.referrals.forEach(r => {
    if (String(r.referrer_id) === String(id)) r.referrer_id = null;
    if (String(r.referred_id) === String(id)) r.referred_id = null;
  });

  dataStore.ensureTable('reviews');
  store.reviews.forEach(r => {
    if (String(r.buyer_id) === String(id)) r.buyer_id = null;
  });

  dataStore.ensureTable('notifications');
  store.notifications = store.notifications.filter(n => String(n.user_id) !== String(id));

  dataStore.ensureTable('ad_campaigns');
  store.ad_campaigns = store.ad_campaigns.filter(a => String(a.vendor_id) !== String(id));

  dataStore.ensureTable('services');
  store.services = store.services.filter(s => String(s.rendor_id) !== String(id));

  dataStore.ensureTable('products');
  store.products = store.products.filter(p => String(p.vendor_id) !== String(id));

  dataStore.ensureTable('stores');
  store.stores = store.stores.filter(s => String(s.vendor_id) !== String(id));

  dataStore.ensureTable('support_tickets');
  store.support_tickets = store.support_tickets.filter(t => String(t.user_id) !== String(id));

  dataStore.ensureTable('push_subscriptions');
  store.push_subscriptions = store.push_subscriptions.filter(p => String(p.user_id) !== String(id));

  // Delete user
  dataStore.ensureTable('users');
  store.users = store.users.filter(r => String(r.id) !== String(id));
}

// DELETE /api/:table/:id  — delete record
app.delete('/api/:table/:id', writeRateLimiter, async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const id = req.params.id;

    // ── Access control ─────────────────────────────────────────────
    const viewer = access.getAccessContext(req);
    if (table === 'users') {
      if (!access.isAdmin(viewer)) return res.status(403).json({ error: 'Admin access required.' });
    } else {
      let existing = null;
      if (table === 'storefronts') {
        dataStore.ensureTable('storefronts');
        existing = (dataStore.getStore().storefronts || []).find(r => r && (String(r.id) === String(id) || String(r.store_id) === String(id))) || null;
        if (!existing) {
          dataStore.ensureTable('stores');
          existing = dataStore.getStore().stores.find(s => String(s.id) === String(id).replace(/^sft-/, '')) || null;
        }
      } else {
        dataStore.ensureTable(table);
        existing = dataStore.getStore()[table].find(r => String(r.id) === String(id)) || null;
      }
      if (!existing && supabase) {
        try {
          const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
          if (data) existing = serializeRecord(data);
        } catch (err) {}
      }
      const allowed = access.assertMutateAllowed(table, viewer, existing, {});
      if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });
    }
    auditLog({ actorId: viewer && viewer.userId, actorRole: viewer && viewer.role, action: 'delete_record', table, targetId: id });

    if (table === 'users') {
      if (!supabase) {
        dataStore.ensureTable('users');
        const store = dataStore.getStore();

        // Dissociate in local tables
        dataStore.ensureTable('orders');
        store.orders.forEach(o => {
          if (String(o.buyer_id) === String(id)) o.buyer_id = null;
          if (String(o.vendor_id) === String(id)) o.vendor_id = null;
        });

        dataStore.ensureTable('packages');
        store.packages.forEach(p => {
          if (String(p.buyer_id) === String(id)) p.buyer_id = null;
          if (String(p.vendor_id) === String(id)) p.vendor_id = null;
        });

        dataStore.ensureTable('wallet_transactions');
        store.wallet_transactions.forEach(t => {
          if (String(t.user_id) === String(id)) t.user_id = null;
        });

        dataStore.ensureTable('referrals');
        store.referrals.forEach(r => {
          if (String(r.referrer_id) === String(id)) r.referrer_id = null;
          if (String(r.referred_id) === String(id)) r.referred_id = null;
        });

        dataStore.ensureTable('reviews');
        store.reviews.forEach(r => {
          if (String(r.buyer_id) === String(id)) r.buyer_id = null;
        });

        // Delete dependencies in local tables
        dataStore.ensureTable('notifications');
        store.notifications = store.notifications.filter(n => String(n.user_id) !== String(id));

        dataStore.ensureTable('ad_campaigns');
        store.ad_campaigns = store.ad_campaigns.filter(a => String(a.vendor_id) !== String(id));

        dataStore.ensureTable('services');
        store.services = store.services.filter(s => String(s.rendor_id) !== String(id));

        dataStore.ensureTable('products');
        store.products = store.products.filter(p => String(p.vendor_id) !== String(id));

        dataStore.ensureTable('stores');
        store.stores = store.stores.filter(s => String(s.vendor_id) !== String(id));

        // Delete user
        store.users = store.users.filter(r => String(r.id) !== String(id));

        dataStore.saveToFile();
        return res.status(204).send();
      } else {
        const result = await cascadeDeleteUserSupabase(supabase, id);
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(204).send();
      }
    }

    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const before = store[table].length;
      store[table] = store[table].filter(r => String(r.id) !== String(id));
      dataStore.saveToFile();
      if (store[table].length === before) return res.status(404).json({ error: 'Record not found' });
      return res.status(204).send();
    }
    
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) {
      // A row that stayed in the database is NOT a success. Masking this as
      // 204 made the vendor's device report "Product deleted" while the record
      // stayed live for every other visitor. Fail loudly instead.
      console.error('[DELETE] Supabase error:', table, error.message);
      return res.status(502).json({ error: 'Delete failed on the database: ' + error.message });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getRecordCandidatesForTable(table, record, existingRecord) {
  const primary = prepareRecordForDb(table, record, existingRecord);
  if (table === 'packages' || table === 'orders') {
    // Orders/packages: if the Supabase table is slimmer than expected, a full
    // insert fails with a missing-column error and the record would fall back
    // to the ephemeral serverless filesystem — effectively LOST. A second
    // candidate drops ONLY columns that are safely recoverable on read
    // (promotion from `extra` via unpackPackageMeta), so the write survives
    // schema drift without ever creating a data-incomplete order.
    if (table === 'packages') {
      // Recoverable via extra: delivery contact (all in PACKAGE_META_FIELDS).
      // delivery_fee is always 0 platform-wide; notes duplicates the address.
      const DROPPABLE = ['delivery_fee', 'delivery_name', 'delivery_phone',
        'delivery_address', 'delivery_location', 'notes'];
      const slim = { ...primary };
      let removed = false;
      for (const k of DROPPABLE) {
        if (k in slim) { delete slim[k]; removed = true; }
      }
      return removed ? [primary, slim] : [primary];
    }
    // orders: every real column carries data that is NOT recoverable from
    // extra (delivery_* ∉ ORDER_META_FIELDS), so no safe slim exists.
    return [primary];
  }
  if (table !== 'products' && table !== 'stores' && table !== 'users') return [primary];

  // For stores/products/users, certain fields may not exist as real columns
  // (they live in the jsonb `extra` instead on slim schemas). Move them out of
  // the top-level payload so a second candidate can succeed if the first one
  // fails with a missing-column error.
  const STORE_OPTIONAL_COLS = ['logo_url', 'banner_url', 'slogan', 'name'];
  const optionalCols = table === 'products' ? PRODUCT_OPTIONAL_COLS : table === 'users' ? USER_META_FIELDS : STORE_OPTIONAL_COLS;

  const slim = { ...primary };
  const extra = { ...parseExtraObject(slim.extra) };
  for (const key of optionalCols) {
    if (key in slim && slim[key] !== undefined && slim[key] !== null && slim[key] !== '') {
      extra[key] = slim[key];
      delete slim[key];
    }
  }
  if (Object.keys(extra).length) slim.extra = extra;
  // Deduplicate if slim === primary
  const same = JSON.stringify(primary) === JSON.stringify(slim);
  return same ? [primary] : [primary, slim];
}

function isMissingColumnError(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''} ${error.code || ''}`;
  return /column|schema cache|Could not find|PGRST204|42703/i.test(msg);
}

async function writeWithCandidates(supabase, table, mode, record, existingRecord, id) {
  const candidates = getRecordCandidatesForTable(table, record, existingRecord);
  let lastError = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let result;
    if (mode === 'insert') {
      result = await supabase.from(table).insert(candidate).select().single();
    } else if (mode === 'upsert') {
      result = await supabase.from(table).upsert(candidate).select().single();
    } else {
      result = await supabase.from(table).update(candidate).eq('id', id).select().single();
    }
    if (!result.error) return { data: result.data, error: null };
    lastError = result.error;
    if (!isMissingColumnError(result.error) || i === candidates.length - 1) break;
    console.warn(`[${mode.toUpperCase()}] ${table} schema mismatch, retrying slim payload:`, result.error.message);
  }
  return { data: null, error: lastError };
}

app.getRecordCandidatesForTable = getRecordCandidatesForTable;
app.prepareRecordForDb = prepareRecordForDb;
app.serializeRecord = serializeRecord;
app.writeWithCandidates = writeWithCandidates;

// ── Storefront link previews ───────────────────────────────────
// GET /storefront/:slug and /store-admin/:slug answer with the SPA shell whose
// <head> describes THAT storefront, so a link a vendor shares unfurls as their
// store (own name, description and logo) instead of as the marketplace. The
// body is byte-for-byte the normal shell — the app boots as always and routes
// from the path — so this only changes what a link preview and a crawler see.
let _shellCache = { html: '', at: 0 };
const SHELL_TTL_MS = 5 * 60 * 1000;

function requestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

async function readAppShell(req) {
  const now = Date.now();
  if (_shellCache.html && now - _shellCache.at < SHELL_TTL_MS) return _shellCache.html;

  const candidates = [
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, 'index.html')
  ];
  for (const file of candidates) {
    try {
      const html = await fs.promises.readFile(file, 'utf8');
      if (html && html.indexOf('<html') > -1) { _shellCache = { html, at: now }; return html; }
    } catch (e) { /* try the next location */ }
  }

  // A serverless bundle does not always carry static files next to the
  // function: fall back to this deployment's own /index.html. That path is a
  // static route, never this handler, so it cannot recurse.
  try {
    const origin = requestOrigin(req);
    if (origin) {
      const resp = await fetch(origin + '/index.html', { headers: { 'Cache-Control': 'no-cache' } });
      if (resp.ok) {
        const html = await resp.text();
        if (html && html.indexOf('<html') > -1) { _shellCache = { html, at: now }; return html; }
      }
    }
  } catch (e) {
    console.warn('[Storefront] could not fetch the app shell:', e && e.message || e);
  }
  return '';
}

async function findStorefrontBySlug(slug) {
  const want = String(slug || '').trim().toLowerCase();
  if (!want) return null;

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data: sfRows, error: sfErr } = await withSupaTimeout(
        supabase.from('storefronts').select('*').eq('url_slug', want).limit(1), 3000
      );
      if (!sfErr) {
        const sf = (sfRows || [])[0] || null;
        const storeId = sf && (sf.store_id || sf.id);
        const storeQuery = storeId
          ? supabase.from('stores').select('*').eq('id', storeId).limit(1)
          : supabase.from('stores').select('*').eq('slug', want).limit(1);
        const { data: stRows } = await withSupaTimeout(storeQuery, 3000);
        const st = (stRows || [])[0] || null;
        if (sf || st) {
          return { storefront: sf ? serializeRecord(sf) : {}, store: st ? serializeRecord(st) : {} };
        }
      }
    } catch (e) {
      console.warn('[Storefront] slug lookup failed:', e && e.message || e);
    }
  }

  // Local store (dev, or Supabase unreachable): same row shape, same fields.
  try {
    dataStore.ensureTable('storefronts');
    dataStore.ensureTable('stores');
    const local = dataStore.getStore();
    const sf = (local.storefronts || []).find(r => r && String(r.url_slug || '').toLowerCase() === want) || null;
    const wantedId = sf && (sf.store_id || sf.id);
    const st = (local.stores || []).find(r => r && (String(r.id) === String(wantedId) || (!wantedId && String(r.slug || '').toLowerCase() === want))) || null;
    if (sf || st) {
      return { storefront: sf ? serializeRecord(sf) : {}, store: st ? serializeRecord(st) : {} };
    }
  } catch (e) { /* no local copy either */ }
  return null;
}

function storefrontShellHandler(kind) {
  return async (req, res) => {
    const slug = shell.slugFromPath(req.path) || String(req.params.slug || '');
    const html = await readAppShell(req);
    if (!html) {
      // Never break the link: the hash route resolves to exactly the page this
      // route would have served, just without the store's own preview card.
      return res.redirect(302, `/#${kind}/${encodeURIComponent(slug)}`);
    }
    const found = await findStorefrontBySlug(slug);
    const meta = shell.storefrontShareMeta({
      storefront: found ? found.storefront : {},
      store: found ? found.store : {},
      slug,
      origin: requestOrigin(req),
      kind
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('X-Robots-Tag', kind === 'store-admin' ? 'noindex, nofollow' : 'index, follow');
    return res.status(200).send(shell.injectStorefrontMeta(html, meta));
  };
}

app.get('/storefront/:slug', storefrontShellHandler('storefront'));
app.get('/store-admin/:slug', storefrontShellHandler('store-admin'));

app.findStorefrontBySlug = findStorefrontBySlug;
app.readAppShell = readAppShell;
app.requestOrigin = requestOrigin;

module.exports = app;
