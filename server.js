
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// Meta WhatsApp Cloud API helper (env-driven, server-side only)
const { notifyVendorOfPackage, sendWhatsAppText, isValidWhatsappNumber, getConfigStatus } = require('./lib/whatsapp');

// Load environment variables from .env if present
const dotenvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotenvPath)) {
  const envContent = fs.readFileSync(dotenvPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith('#')) return;
    const idx = cleanLine.indexOf('=');
    if (idx !== -1) {
      const key = cleanLine.substring(0, idx).trim();
      const val = cleanLine.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
}

const PORT = process.env.PORT || 9000;
const DB_FILE = path.join(__dirname, 'db.json');
const app = express();

// Session Token Memory Store (30 Days TTL as requested)
const activeSessions = new Map(); // token -> { userId, role, expiresAt }
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function createSessionToken(userId, role) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + THIRTY_DAYS_MS;
  activeSessions.set(token, { userId: String(userId), role, expiresAt });
  return token;
}

function getSessionUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

function requireAuth(req, res, next) {
  const session = getSessionUser(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or expired session token.' });
  }
  req.userSession = session;
  next();
}

// Rate Limiter for Login Endpoint (5 attempts / 15 mins)
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

function withSupaTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), ms))
  ]);
}

// Initialize Supabase if credentials are provided and not placeholders
let supabase = null;
const hasSupabaseUrl = process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-project');
const hasSupabaseKey = process.env.SUPABASE_KEY && !process.env.SUPABASE_KEY.includes('your_service_role');
if (hasSupabaseUrl && hasSupabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    // Cap every Supabase request at 2.5s: a slow or missing table (or flaky
    // network) must never block a response — callers fall back to db.json.
    const timedFetch = (input, init) => Promise.race([
      globalThis.fetch(input, init),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), 2500))
    ]);
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { global: { fetch: timedFetch } });
    console.log('[Supabase] Testing database connection... ⚡');
    withSupaTimeout(client.from('users').select('id').limit(1), 2000)
      .then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Connection query failed. Falling back to local db.json:', error.message);
          supabase = null;
        } else {
          supabase = client;
          console.log('[Supabase] Connected to database successfully! ⚡');
        }
      })
      .catch(err => {
        console.warn('[Supabase] Connection timeout/error. Falling back to local db.json:', err.message);
        supabase = null;
      });
  } catch (e) {
    console.warn('[Supabase] Failed to initialize client, falling back to db.json:', e.message);
    supabase = null;
  }
}

const zlib = require('zlib');

// In-Memory API Cache System for Zero-Latency Performance
const apiMemoryCache = new Map();
const CACHE_TTL_MS = 5000; // 5-second RAM cache TTL

function getCachedApiResponse(key) {
  const cached = apiMemoryCache.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }
  return null;
}

function setCachedApiResponse(key, data) {
  apiMemoryCache.set(key, { data, timestamp: Date.now() });
}

function invalidateApiCache(table) {
  if (!table) { apiMemoryCache.clear(); return; }
  for (const key of apiMemoryCache.keys()) {
    if (key.startsWith(table + ':') || key.startsWith('storefronts:') || key.startsWith('stores:')) {
      apiMemoryCache.delete(key);
    }
  }
}

app.use(express.json({ limit: '50mb' }));

// ── Response security: never leak password hashes to clients ──────────
// Deep-copies the payload, dropping `password_hash` at any depth. Applied at
// the single response boundary so every route (list, single, cached, local
// and Supabase) is covered without touching the stored records.
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

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Service-Worker-Allowed', '/');

  if (req.method === 'OPTIONS') return res.sendStatus(204);

  // Invalidate in-memory cache on any data modification request
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path.startsWith('/api/')) {
    const table = req.path.substring(5).split('/')[0];
    invalidateApiCache(table);
  }

  // Set HTTP caching headers for read-only GET API endpoints.
  // NOTE: 'settings' (coupons, fees, support contacts, flags) drives live
  // behavior and is edited by admins — it must ALWAYS revalidate (no-cache + ETag)
  // so browsers never apply stale coupons/values after an admin save.
  if (req.method === 'GET' && req.path.startsWith('/api/')) {
    const table = req.path.substring(5).split('/')[0];
    if (table === 'settings') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['products', 'stores', 'storefronts', 'categories'].includes(table)) {
      // Catalog data must revalidate on every request: max-age/SWR kept a
      // product the admin just deleted visible in the browser for minutes.
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['packages', 'orders', 'wallet_transactions', 'notifications', 'referrals', 'platform_revenue', 'support_tickets', 'reviews', 'delivery_rates', 'order_notifications'].includes(table)) {
      // Order/wallet/notification data changes constantly and is fetched fresh on
      // every page view — never let the browser HTTP cache serve a stale empty
      // list (that made storefront orders look missing right after checkout).
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  }

  // Built-in HTTP Gzip/Deflate compression middleware for responses > 512 bytes
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (acceptEncoding.includes('gzip')) {
    const rawSend = res.send;
    res.send = function (body) {
      if (res.headersSent || !body || (typeof body !== 'string' && !Buffer.isBuffer(body))) {
        return rawSend.call(this, body);
      }
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (buf.length < 512) {
        return rawSend.call(this, body);
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      zlib.gzip(buf, (err, compressed) => {
        if (err) return rawSend.call(this, body);
        rawSend.call(this, compressed);
      });
    };
  }

  next();
});

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const seed = seedDb();
      saveDb(seed);
      return seed;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load db.json:', err);
    const seed = seedDb();
    saveDb(seed);
    return seed;
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function generateId(table) {
  return `${table.slice(0, 3)}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function normalizeRecord(table, record) {
  return {
    ...record,
    id: record.id != null ? String(record.id) : generateId(table)
  };
}

const JSONB_COLS = new Set([
  'images', 'keywords', 'rendor_tags', 'gallery_images', 'items', 'extra', 'pages', 'store_ids', 'store_budgets', 'plan_prices', 'messages'
]);

const TXN_META_FIELDS = [
  'balance_before', 'balance_after', 'payment_method', 'status', 'note', 'network', 'account_number', 'reviewed_by'
];

const USER_META_FIELDS = [
  'id_image', 'proof_sales_1', 'proof_sales_2', 'proof_sales_3', 'proof_share'
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

function serializeRecord(record) {
  let out = { ...record };

  // Parse JSONB columns stored as strings
  for (const col of JSONB_COLS) {
    if (col in out && typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch {}
    }
  }

  out = unpackUserMeta(out);
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
  if ('total_sold' in out && !('sold_count' in out)) {
    out.sold_count = out.total_sold;
  }
  // Users: avatar_url → avatar
  if ('avatar_url' in out && !('avatar' in out)) {
    out.avatar = out.avatar_url;
  }
  // Stores: description → about_us (used by store views)
  if ('description' in out && !('about_us' in out)) {
    out.about_us = out.description;
  }
  // Stores: return_policy → shipping_policy fallback
  if ('return_policy' in out && !('shipping_policy' in out)) {
    out.shipping_policy = out.return_policy;
  }
  // Stores: review_count → followers fallback for display
  if ('review_count' in out && !('followers' in out)) {
    out.followers = out.review_count || 0;
  }
  // Products: review_count → views fallback
  if ('review_count' in out && !('views' in out)) {
    out.views = (out.review_count || 0) * 10;
  }

  return out;
}

const TABLE_COLUMNS = {
  users: ['id', 'name', 'email', 'phone', 'password_hash', 'role', 'status', 'location', 'wallet_balance', 'referral_code', 'referred_by', 'registered_at', 'created_at', 'updated_at', 'is_verified', 'id_verified', 'rendor_display_name', 'rendor_service_cat', 'rendor_bio', 'rendor_starting_price', 'rendor_tags', 'rendor_whatsapp', 'rendor_email', 'rendor_instagram', 'rendor_twitter', 'rendor_facebook', 'rendor_website', 'rendor_contact_other', 'rendor_sub_status', 'rendor_sub_expiry', 'rendor_sub_plan', 'avatar_url', 'avatar', 'extra', 'referral_earnings', 'referral_count', 'preferred_store_name', 'preferred_store_cat', 'preferred_store_desc', 'preferred_store_kws', 'sub_request_status', 'sub_quote_monthly', 'sub_quote_quarterly', 'sub_quote_biannual', 'whatsapp_phone', 'receive_order_notifications_on_whatsapp'],
  notifications: ['id', 'user_id', 'type', 'title', 'message', 'is_read', 'created_at', 'extra'],
  stores: ['id', 'name', 'slug', 'vendor_id', 'category', 'location', 'status', 'logo_url', 'banner_url', 'description', 'keywords', 'avg_rating', 'review_count', 'total_sales', 'total_orders', 'store_price', 'is_paid', 'storefront_status', 'slogan', 'primary_color', 'secondary_color', 'tertiary_color', 'theme', 'font_family', 'hero_image_url', 'gallery_images', 'business_hours', 'return_policy', 'whatsapp', 'instagram', 'facebook', 'twitter', 'subscription_plan', 'subscription_status', 'subscription_start', 'subscription_end', 'subscription_months', 'subscription_method', 'plan_prices', 'created_at', 'updated_at', 'extra'],
  orders: ['id', 'buyer_id', 'vendor_id', 'store_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'subtotal', 'platform_fee', 'delivery_fee', 'total', 'status', 'payment_method', 'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location', 'package_code', 'notes', 'created_at', 'updated_at', 'extra'],
  ad_campaigns: ['id', 'vendor_id', 'store_id', 'title', 'image_url', 'link', 'placement', 'budget', 'spent', 'impressions', 'clicks', 'status', 'start_date', 'end_date', 'created_at', 'updated_at', 'extra'],
  services: ['id', 'rendor_id', 'title', 'category', 'description', 'price', 'image_url', 'status', 'created_at', 'updated_at', 'extra'],
  service_orders: ['id', 'service_id', 'rendor_id', 'buyer_id', 'title', 'amount', 'status', 'notes', 'created_at', 'updated_at', 'extra'],
  settings: ['id', 'key', 'value', 'label', 'type', 'updated_at'],
  reviews: ['id', 'product_id', 'store_id', 'buyer_id', 'customer_id', 'customer_name', 'target_id', 'target_type', 'rating', 'comment', 'approved', 'created_at', 'extra'],
  products: ['id', 'store_id', 'vendor_id', 'name', 'category', 'price', 'original_price', 'stock_qty', 'images', 'is_flash_sale', 'flash_pct', 'status', 'is_available', 'description', 'location', 'avg_rating', 'review_count', 'total_sold', 'weight_kg', 'tags', 'commission_pct', 'allow_buyer_note', 'buyer_note_prompt', 'created_at', 'updated_at', 'extra'],
  packages: ['id', 'code', 'package_code', 'order_id', 'buyer_id', 'vendor_id', 'store_id', 'items', 'status', 'vendor_status', 'admin_status', 'buyer_confirmed', 'has_review', 'rejected_reason', 'vendor_amount', 'commission_amount', 'gross_amount', 'delivery_fee', 'total', 'payment_method', 'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location', 'origin_location', 'dest_location', 'is_intercity', 'tracking_link', 'tracking_number', 'delivery_partner', 'pickup_date', 'delivered_date', 'balance_released', 'notes', 'created_at', 'updated_at', 'extra'],
  delivery_rates: ['id', 'origin', 'destination', 'base_rate', 'per_kg_rate', 'est_days', 'is_local', 'created_at'],
  referrals: ['id', 'referrer_id', 'referred_id', 'reward', 'reward_amount', 'reward_pct', 'order_id', 'status', 'created_at', 'updated_at', 'extra'],
  wallet_transactions: ['id', 'user_id', 'type', 'amount', 'balance_before', 'balance_after', 'description', 'reference', 'payment_method', 'status', 'note', 'created_at', 'extra'],
  platform_revenue: ['id', 'source', 'amount', 'reference', 'description', 'created_at', 'extra'],
  support_tickets: ['id', 'user_id', 'user_name', 'user_email', 'user_role', 'subject', 'category', 'priority', 'status', 'message', 'messages', 'assigned_to', 'created_at', 'updated_at', 'extra'],
  order_notifications: ['id', 'order_id', 'package_id', 'package_code', 'vendor_id', 'channel', 'status', 'error_message', 'sent_at', 'created_at', 'updated_at', 'extra'],
  storefronts: ['id', 'store_id', 'vendor_id', 'status', 'url_slug', 'theme', 'font_family', 'slogan', 'about_us', 'logo_url', 'banner_url', 'primary_color', 'secondary_color', 'tertiary_color', 'whatsapp_number', 'facebook_url', 'instagram_url', 'youtube_url', 'meta_description', 'plan_prices', 'created_at', 'updated_at', 'extra']
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

  // Ad campaigns: pack new fields into extra JSONB; set safe defaults for legacy NOT NULL columns
  if (table === 'ad_campaigns') {
    const AD_EXTRA = ['name', 'pages', 'store_ids', 'store_budgets', 'interval_value', 'interval_unit', 'duration_days', 'show_store_name', 'created_by'];
    let adExtra = {};
    try { adExtra = typeof out.extra === 'string' ? JSON.parse(out.extra) : (out.extra || {}); } catch(e) {}
    for (const k of AD_EXTRA) { if (k in out && out[k] !== undefined) adExtra[k] = out[k]; }
    out.extra = adExtra;
    if (out.name && !out.title) out.title = out.name;
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


function parseQueryParams(query) {
  const params = {};
  for (const key in query) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      params[key] = String(query[key] ?? '').trim();
    }
  }
  return params;
}

function matchesSearch(record, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return Object.values(record).some(value => {
    if (value == null) return false;
    if (Array.isArray(value)) {
      return value.some(item => String(item).toLowerCase().includes(needle));
    }
    return String(value).toLowerCase().includes(needle);
  });
}

function applyFilters(data, params) {
  let result = [...data];
  const { search, limit, page, sort, ...filters } = params;

  if (search) {
    result = result.filter(record => matchesSearch(record, search));
  }

  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    result = result.filter(record => String(record[key] ?? '').toLowerCase() === value.toLowerCase());
  }

  if (sort) {
    result.sort((a, b) => {
      const aVal = a[sort];
      const bVal = b[sort];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') return bVal - aVal;
      return String(bVal).localeCompare(String(aVal));
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

function getTable(db, table) {
  if (!Object.prototype.hasOwnProperty.call(db, table)) {
    db[table] = [];
  }
  return db[table];
}

function sendNotFound(res) {
  res.status(404).json({ error: 'Record not found' });
}
// NOTE: serializeRecord is defined above (line ~162) — do not redefine here.

app.get('/api', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', backend: supabase ? 'supabase' : 'local' });
});

// ── Auth Endpoints ──────────────────────────────────────────
app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  let supaUsers = [];
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*');
      if (!error && data) supaUsers = data.map(serializeRecord);
    } catch (err) {}
  }
  const db = loadDb();
  const localUsers = getTable(db, 'users').map(serializeRecord);
  const userMap = new Map();
  supaUsers.forEach(u => userMap.set(String(u.id), u));
  localUsers.forEach(u => {
    const key = String(u.id);
    const existing = userMap.get(key) || {};
    userMap.set(key, { ...existing, ...u });
  });
  const users = Array.from(userMap.values());

  const user = users.find(u =>
    (u.email?.toLowerCase() === cleanEmail || u.phone === cleanEmail) &&
    u.status !== 'deleted'
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  let isValidPassword = false;
  const dbHash = user.password_hash || '';

  // Handle both hashed passwords and legacy plaintext migration
  if (dbHash.startsWith('$2a$') || dbHash.startsWith('$2b$')) {
    isValidPassword = await bcrypt.compare(password, dbHash);
  } else {
    // Plaintext fallback check
    if (dbHash === password) {
      isValidPassword = true;
      // Auto-migrate plaintext password to bcrypt hash
      try {
        const newHash = await bcrypt.hash(password, 10);
        user.password_hash = newHash;
        
        // Update Local DB
        const db = loadDb();
        const uIdx = db.users.findIndex(u => String(u.id) === String(user.id));
        if (uIdx !== -1) {
          db.users[uIdx].password_hash = newHash;
          saveDb(db);
        }
        
        // Update Supabase if active
        if (supabase) {
          await supabase.from('users').update({ password_hash: newHash }).eq('id', user.id).catch(() => {});
        }
        console.log(`[Auth Migration] Auto-migrated password for user "${user.id}" to bcrypt hash.`);
      } catch (err) {
        console.warn('[Auth Migration Error]', err.message);
      }
    }
  }

  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
  }

  // Generate 30-Day Session Token
  const token = createSessionToken(user.id, user.role);

  // Return clean user object (omit password_hash)
  const userSafe = { ...user };
  delete userSafe.password_hash;

  return res.json({ token, user: userSafe });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    activeSessions.delete(token);
  }
  return res.json({ success: true });
});

app.get('/api/auth/verify', (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    return res.status(401).json({ valid: false });
  }
  return res.json({ valid: true, userId: session.userId, role: session.role });
});

app.get('/api/:table', async (req, res) => {
  const table = req.params.table;
  const cacheKey = `${table}:${JSON.stringify(req.query)}`;
  const cachedResponse = getCachedApiResponse(cacheKey);
  if (cachedResponse) {
    return res.json(cachedResponse);
  }

  if (table === 'storefronts') {
    let supaStores = [];
    if (supabase) {
      try {
        const { data, error } = await supabase.from('stores').select('*');
        if (!error && data) supaStores = data.map(serializeRecord);
      } catch (err) {}
    }
    const db = loadDb();
    const localStores = getTable(db, 'stores').map(serializeRecord);
    const storeMap = new Map();
    supaStores.forEach(s => storeMap.set(String(s.id), s));
    localStores.forEach(s => {
      const key = String(s.id);
      const existing = storeMap.get(key) || {};
      storeMap.set(key, { ...existing, ...s });
    });
    const stores = Array.from(storeMap.values());
    const localSFs = getTable(db, 'storefronts') || [];
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
        font_family: extraSf.font_family || st.font_family || 'Outfit',
        slogan: extraSf.slogan || st.slogan || '',
        about_us: extraSf.about_us || st.description || st.about_us || '',
        logo_url: extraSf.logo_url || st.logo_url || '',
        banner_url: extraSf.banner_url || st.banner_url || '',
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
        plan_prices: extraSf.plan_prices || st.plan_prices || null,
        only_show_on_storefront: st.extra?.only_show_on_storefront === true || st.extra?.only_show_on_storefront === 'true',
        created_at: st.created_at,
        updated_at: st.updated_at
      };
    });

    const params = parseQueryParams(req.query);
    const filtered = applyFilters(rows, params);
    const resultObj = { data: filtered };
    setCachedApiResponse(cacheKey, resultObj);
    return res.json(resultObj);
  }
  
  let supaRows = [];
  if (supabase) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (!error && data) supaRows = (data || []).map(serializeRecord);
    } catch (err) {}
  }
  const db = loadDb();
  const localRows = getTable(db, table).map(serializeRecord);
  const rowMap = new Map();
  supaRows.forEach(r => rowMap.set(String(r.id), r));
  localRows.forEach(r => {
    const key = String(r.id);
    const existing = rowMap.get(key) || {};
    rowMap.set(key, { ...existing, ...r });
  });
  const rows = Array.from(rowMap.values());
  const params = parseQueryParams(req.query);
  const filtered = applyFilters(rows, params);
  const resultObj = { data: filtered };
  setCachedApiResponse(cacheKey, resultObj);
  return res.json(resultObj);
});

app.get('/api/:table/:id', async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;

  if (table === 'storefronts') {
    // Merge Supabase + local like the list handler does, so records that live
    // only in db.json are still resolvable (fixes "storefront not available").
    let supaStores = [];
    if (supabase) {
      try {
        const { data, error } = await supabase.from('stores').select('*');
        if (!error && data) supaStores = data.map(serializeRecord);
      } catch (err) {}
    }
    const db = loadDb();
    const localStores = getTable(db, 'stores').map(serializeRecord);
    const storeMap = new Map();
    supaStores.forEach(s => storeMap.set(String(s.id), s));
    localStores.forEach(s => {
      const key = String(s.id);
      const existing = storeMap.get(key) || {};
      storeMap.set(key, { ...existing, ...s });
    });
    const stores = Array.from(storeMap.values());

    const st = stores.find(s => String(s.id) === String(id) || String(s.vendor_id) === String(id) || (s.slug && String(s.slug).toLowerCase() === String(id).toLowerCase()));
    if (!st) return sendNotFound(res);

    const sf = {
      id: st.id,
      store_id: st.id,
      vendor_id: st.vendor_id,
      name: st.name || '',
      status: st.storefront_status || 'none',
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
      plan_prices: st.plan_prices || null,
      only_show_on_storefront: st.extra?.only_show_on_storefront === true || st.extra?.only_show_on_storefront === 'true',
      created_at: st.created_at,
      updated_at: st.updated_at
    };
    return res.json(sf);
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (!error && data) return res.json(serializeRecord(data));
    } catch (err) {}
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const item = rows.find(record => String(record.id) === String(id));
  if (!item) return sendNotFound(res);
  res.json(serializeRecord(item));
});

// ── WhatsApp vendor notifications (Meta Cloud API) ──────────────
async function getVendorForNotify(vendorId) {
  const db = loadDb();
  let vendor = getTable(db, 'users').find(u => String(u.id) === String(vendorId)) || null;
  if (!vendor && supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('id', vendorId).maybeSingle();
      if (!error && data) vendor = serializeRecord(data);
    } catch (err) {}
  }
  return vendor;
}

async function getVendorByEmailForNotify(email) {
  const db = loadDb();
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return null;
  let vendor = getTable(db, 'users').find(u => String(u.email || '').toLowerCase() === needle && String(u.role) === 'vendor') || null;
  if (!vendor && supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('email', needle).eq('role', 'vendor').maybeSingle();
      if (!error && data) vendor = serializeRecord(data);
    } catch (err) {}
  }
  return vendor;
}

async function getStoreForNotify(storeId) {
  const db = loadDb();
  let store = getTable(db, 'stores').find(s => String(s.id) === String(storeId)) || null;
  if (!store && supabase) {
    try {
      const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
      if (!error && data) store = serializeRecord(data);
    } catch (err) {}
  }
  return store;
}

async function logOrderNotification(rec) {
  const db = loadDb();
  getTable(db, 'order_notifications').push(rec);
  saveDb(db);
  if (supabase) {
    try {
      const dbRecord = prepareRecordForDb('order_notifications', serializeRecord(rec));
      const { data, error } = await withSupaTimeout(supabase.from('order_notifications').insert(dbRecord).select().single(), 2000);
      if (!error && data) return serializeRecord(data);
    } catch (err) {
      console.warn('[Supabase] order_notifications insert fallback to db.json:', err.message);
    }
  }
  return rec;
}

async function notifyVendorForPackage(pkg) {
  return notifyVendorOfPackage(pkg, {
    getVendor: getVendorForNotify,
    getVendorByEmail: getVendorByEmailForNotify,
    getStore: getStoreForNotify,
    log: logOrderNotification
  });
}

// Manually re-send the WhatsApp order notification to a package's vendor (admin UI).
app.post('/api/packages/:id/notify-vendor', async (req, res) => {
  try {
    const db = loadDb();
    let pkg = getTable(db, 'packages').find(p => String(p.id) === String(req.params.id)) || null;
    if (!pkg && supabase) {
      try {
        const { data, error } = await supabase.from('packages').select('*').eq('id', req.params.id).maybeSingle();
        if (!error && data) pkg = serializeRecord(data);
      } catch (err) {}
    }
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const result = await notifyVendorForPackage(pkg);
    if (!result) {
      return res.status(400).json({ error: 'Vendor has not opted in to WhatsApp notifications or has no valid WhatsApp number' });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[WhatsApp] Resend failed:', err && err.message || err);
    res.status(500).json({ error: err && err.message || 'Resend failed' });
  }
});

// Send a test WhatsApp message (admin UI) — verifies the Meta Cloud API
// credentials + delivery path without needing a real order.
app.post('/api/whatsapp/test', async (req, res) => {
  try {
    const config = getConfigStatus();
    const to = String((req.body && req.body.to) || '').trim();
    const body = String((req.body && req.body.body) || '').trim() || 'Hi from Happa Trademart! This is a test WhatsApp message sent from the admin panel.';

    if (!config.enabled) {
      return res.json({
        ok: false, skipped: true, config,
        message: 'WHATSAPP_ENABLED is false — the server is in test mode, so no real message was sent. Set WHATSAPP_ENABLED=true to send real messages.'
      });
    }
    if (!config.phoneNumberIdConfigured || !config.accessTokenConfigured) {
      return res.json({
        ok: false, config,
        message: 'WhatsApp is not configured on the server. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN as environment variables (see .env).'
      });
    }
    if (!isValidWhatsappNumber(to)) {
      return res.json({
        ok: false, config,
        message: 'Invalid recipient number. Use international format with + and digits only (e.g. +23320xxxxxxx).'
      });
    }

    const result = await sendWhatsAppText({ to, body });
    res.json({ ok: true, config, to, message: 'Test message sent! Check the recipient\'s WhatsApp.', result });
  } catch (err) {
    console.error('[WhatsApp] Test send failed:', err && err.message || err);
    res.json({
      ok: false,
      config: getConfigStatus(),
      message: 'Meta API error: ' + String((err && err.message) || err)
    });
  }
});

app.post('/api/:table', async (req, res) => {
  let table = req.params.table;
  const body = req.body || {};
  invalidateApiCache(table); // Clear server GET cache so next read reflects new record
  if (table === 'storefronts') invalidateApiCache('stores');

  if (table === 'storefronts') {
    const rawStoreId = body.store_id || body.id || '';
    const storeId = String(rawStoreId).replace(/^sft-/, '');
    let supaSt = null;
    if (supabase) {
      try {
        const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
        if (!error && data) supaSt = serializeRecord(data);
      } catch (err) {}
    }
    const dbLookup = loadDb();
    const localSt = getTable(dbLookup, 'stores').find(s => String(s.id) === String(storeId));
    let st = supaSt || localSt || { id: storeId, vendor_id: body.vendor_id || '', created_at: new Date().toISOString() };

    const storeUpdates = {
      storefront_status: body.status || 'draft',
      name: body.name || st.name || 'My Store',
      status: st.status || 'active',
      category: body.category || st.category || 'General',
      location: body.location || st.location || '',
      slug: body.url_slug || st.slug || '',
      theme: body.theme || 'classic',
      font_family: body.font_family || 'Outfit',
      slogan: body.slogan || '',
      description: body.about_us || st.description || '',
      logo_url: body.logo_url || '',
      banner_url: body.banner_url || '',
      primary_color: body.primary_color || '#e85d04',
      secondary_color: body.secondary_color || '#faf9f6',
      tertiary_color: body.tertiary_color || '#e85d04',
      business_hours: body.business_hours || 'Mon - Sat: 8:00 AM - 6:00 PM',
      return_policy: body.return_policy || '',
      facebook: body.facebook_url || '',
      instagram: body.instagram_url || '',
      subscription_plan: body.subscription_plan || st.subscription_plan || 'starter',
      subscription_status: body.subscription_status || st.subscription_status || 'active',
      plan_prices: body.plan_prices || st.plan_prices || null,
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        const dbRecord = prepareRecordForDb('stores', storeUpdates);
        await supabase.from('stores').update(dbRecord).eq('id', storeId);
      } catch (err) {}
    }
    const db = loadDb();
    const idx = getTable(db, 'stores').findIndex(s => String(s.id) === String(storeId));
    if (idx !== -1) {
      db.stores[idx] = { ...db.stores[idx], ...storeUpdates };
      saveDb(db);
    } else {
      db.stores.push({ id: storeId, vendor_id: st.vendor_id || body.vendor_id || '', ...storeUpdates });
      saveDb(db);
    }

    const sf = {
      id: storeId,
      store_id: storeId,
      vendor_id: st.vendor_id || body.vendor_id || '',
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
      shipping_policy: storeUpdates.return_policy,
      return_policy: storeUpdates.return_policy,
      facebook_url: storeUpdates.facebook,
      instagram_url: storeUpdates.instagram,
      youtube_url: body.youtube_url || '',
      meta_description: body.meta_description || '',
      subscription_plan: storeUpdates.subscription_plan,
      subscription_status: storeUpdates.subscription_status,
      plan_prices: storeUpdates.plan_prices,
      created_at: st.created_at || new Date().toISOString(),
      updated_at: storeUpdates.updated_at
    };
    return res.status(201).json(sf);
  }
  // Legacy alias: old code posted adjustments to a `transactions` table nobody ever reads.
  // Route those writes into the visible wallet ledger so every balance change is traceable.
  if (table === 'transactions') table = 'wallet_transactions';
  if (!body.id) body.id = `${table.slice(0, 3)}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  body.id = String(body.id);
  if (!body.created_at) body.created_at = new Date().toISOString();
  body.updated_at = new Date().toISOString();

  // If creating a user with a password, hash it with bcrypt server-side
  if (table === 'users' && body.password && !body.password_hash) body.password_hash = body.password; // legacy `password` field alias
  if (table === 'users' && body.password_hash && !body.password_hash.startsWith('$2a$') && !body.password_hash.startsWith('$2b$')) {
    try {
      body.password_hash = await bcrypt.hash(body.password_hash, 10);
    } catch(e) {}
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const record = normalizeRecord(table, body);
  rows.push(record);
  saveDb(db);

  // Notify opted-in vendors via WhatsApp when a new order (package) is placed.
  // Fire-and-forget — a slow or failing WhatsApp call must never block checkout.
  if (table === 'packages') {
    notifyVendorForPackage(record).catch(err => console.warn('[WhatsApp] vendor notification failed:', err && err.message || err));
  }

  if (supabase) {
    try {
      const supaRecord = serializeRecord(body);
      const dbRecord = prepareRecordForDb(table, supaRecord);
      const { data, error } = await withSupaTimeout(supabase.from(table).insert(dbRecord).select().single(), 2000);
      if (!error && data) return res.status(201).json(serializeRecord(data));
    } catch (err) {
      console.warn(`[Supabase] ${table} insert fallback to db.json:`, err.message);
    }
  }

  res.status(201).json(record);
});

app.put('/api/:table/:id', async (req, res) => {
  let table = req.params.table;
  const id = req.params.id;
  if (table === 'transactions') table = 'wallet_transactions'; // legacy alias → visible ledger
  const body = { ...req.body, id: id, updated_at: new Date().toISOString() };
  invalidateApiCache(table); // Clear server GET cache so next read reflects update
  if (table === 'storefronts') invalidateApiCache('stores');

  // Hash user passwords server-side (admin reset sends password/password_hash)
  if (table === 'users') {
    if (body.password && !body.password_hash) body.password_hash = body.password; // legacy `password` field alias
    if (body.password_hash && !body.password_hash.startsWith('$2a$') && !body.password_hash.startsWith('$2b$')) {
      try { body.password_hash = await bcrypt.hash(body.password_hash, 10); } catch (e) {}
    }
  }

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
      const db = loadDb();
      st = getTable(db, 'stores').find(s => String(s.id) === String(cleanId));
    }

    if (!st) {
      if (supabase) {
        try {
          const { data, error } = await supabase.from('stores').select('*').eq('vendor_id', cleanId).limit(1);
          if (!error && data && data.length > 0) st = serializeRecord(data[0]);
        } catch (err) {}
      }
    }
    if (!st) {
      const db = loadDb();
      st = getTable(db, 'stores').find(s => String(s.vendor_id) === String(cleanId));
    }

    if (!st) {
      return sendNotFound(res);
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
    if ('plan_prices' in body) storeUpdates.plan_prices = body.plan_prices;
    storeUpdates.updated_at = new Date().toISOString();

    if (supabase) {
      try {
        const dbRecord = prepareRecordForDb('stores', storeUpdates);
        await supabase.from('stores').update(dbRecord).eq('id', storeId);
      } catch (err) {}
    }
    const db = loadDb();
    const idx = getTable(db, 'stores').findIndex(s => String(s.id) === String(storeId));
    if (idx !== -1) {
      db.stores[idx] = { ...db.stores[idx], ...storeUpdates };
      saveDb(db);
    } else {
      db.stores.push({ id: storeId, vendor_id: st.vendor_id, ...storeUpdates });
      saveDb(db);
    }

    let updatedSt = { ...st, ...storeUpdates };
    const sf = {
      id: storeId,
      store_id: storeId,
      vendor_id: updatedSt.vendor_id,
      status: updatedSt.storefront_status || 'draft',
      url_slug: updatedSt.slug || '',
      theme: updatedSt.theme || 'classic',
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
      plan_prices: updatedSt.plan_prices || body.plan_prices || null,
      created_at: updatedSt.created_at,
      updated_at: updatedSt.updated_at
    };
    return res.json(sf);
  }

  if (supabase) {
    try {
      const record = serializeRecord(body);
      const dbRecord = prepareRecordForDb(table, record);
      const { data, error } = await supabase.from(table).upsert(dbRecord).select().maybeSingle();
      if (!error && data) return res.json(serializeRecord(data));
    } catch (err) {}
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const idx = rows.findIndex(record => String(record.id) === String(id));
  if (idx !== -1) {
    rows[idx] = { ...rows[idx], ...normalizeRecord(table, body), id: String(id) };
    saveDb(db);
    return res.json(rows[idx]);
  } else {
    const newRec = { id: String(id), ...normalizeRecord(table, body) };
    rows.push(newRec);
    saveDb(db);
    return res.json(newRec);
  }
});

app.patch('/api/:table/:id', async (req, res) => {
  let table = req.params.table;
  const id = req.params.id;
  if (table === 'transactions') table = 'wallet_transactions'; // legacy alias → visible ledger
  const body = { ...req.body, id: id, updated_at: new Date().toISOString() };
  invalidateApiCache(table); // Clear server GET cache so next read reflects patch
  if (table === 'storefronts') invalidateApiCache('stores');

  // Hash password if being updated
  if (table === 'users' && body.password && !body.password_hash) body.password_hash = body.password; // legacy `password` field alias
  if (table === 'users' && body.password_hash && !body.password_hash.startsWith('$2a$') && !body.password_hash.startsWith('$2b$')) {
    try {
      body.password_hash = await bcrypt.hash(body.password_hash, 10);
    } catch(e) {}
  }

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
      const db = loadDb();
      st = getTable(db, 'stores').find(s => String(s.id) === String(cleanId));
    }

    if (!st) {
      if (supabase) {
        try {
          const { data, error } = await supabase.from('stores').select('*').eq('vendor_id', cleanId).limit(1);
          if (!error && data && data.length > 0) st = serializeRecord(data[0]);
        } catch (err) {}
      }
    }
    if (!st) {
      const db = loadDb();
      st = getTable(db, 'stores').find(s => String(s.vendor_id) === String(cleanId));
    }

    if (!st) {
      return sendNotFound(res);
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
    if ('plan_prices' in body) storeUpdates.plan_prices = body.plan_prices;
    
    let extra = {};
    try {
      extra = typeof st.extra === 'string' ? JSON.parse(st.extra) : (st.extra || {});
    } catch(e) {}
    if ('only_show_on_storefront' in body) {
      extra.only_show_on_storefront = body.only_show_on_storefront === true || body.only_show_on_storefront === 'true';
      storeUpdates.extra = extra;
    }
    
    storeUpdates.updated_at = new Date().toISOString();

    if (supabase) {
      try {
        const dbRecord = prepareRecordForDb('stores', storeUpdates);
        await supabase.from('stores').update(dbRecord).eq('id', storeId);
      } catch (err) {}
    }
    const db = loadDb();
    const idx = getTable(db, 'stores').findIndex(s => String(s.id) === String(storeId));
    if (idx !== -1) {
      db.stores[idx] = { ...db.stores[idx], ...storeUpdates };
      saveDb(db);
    } else {
      db.stores.push({ id: storeId, vendor_id: st.vendor_id, ...storeUpdates });
      saveDb(db);
    }

    let updatedSt = { ...st, ...storeUpdates };
    const sf = {
      id: storeId,
      store_id: storeId,
      vendor_id: updatedSt.vendor_id,
      status: updatedSt.storefront_status || 'draft',
      url_slug: updatedSt.slug || '',
      theme: updatedSt.theme || 'classic',
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
      plan_prices: updatedSt.plan_prices || body.plan_prices || null,
      only_show_on_storefront: updatedSt.extra?.only_show_on_storefront === true || updatedSt.extra?.only_show_on_storefront === 'true',
      created_at: updatedSt.created_at,
      updated_at: updatedSt.updated_at
    };
    return res.json(sf);
  }

  let existingRecord = null;
  if (supabase) {
    try {
      const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (data) existingRecord = serializeRecord(data);
    } catch (e) {}
  }
  if (!existingRecord) {
    const db = loadDb();
    const rows = getTable(db, table);
    existingRecord = rows.find(r => String(r.id) === String(id));
  }

  if (supabase) {
    try {
      const record = serializeRecord(body);
      const dbRecord = prepareRecordForDb(table, record, existingRecord);
      const { data, error } = await supabase.from(table).update(dbRecord).eq('id', id).select().maybeSingle();
      if (!error && data) return res.json(serializeRecord(data));
    } catch (err) {}
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const idx = rows.findIndex(record => String(record.id) === String(id));
  if (idx !== -1) {
    const record = serializeRecord({ ...rows[idx], ...body, id: String(id) });
    const dbRecord = prepareRecordForDb(table, record, existingRecord);
    rows[idx] = { ...rows[idx], ...dbRecord, id: String(id) };
    saveDb(db);
    return res.json(serializeRecord(rows[idx]));
  } else {
    const record = serializeRecord({ ...body, id: String(id) });
    const dbRecord = prepareRecordForDb(table, record);
    rows.push(dbRecord);
    saveDb(db);
    return res.json(serializeRecord(dbRecord));
  }
});

app.delete('/api/:table/:id', async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;
  invalidateApiCache(table); // Clear server GET cache so next read excludes deleted record
  if (table === 'storefronts') invalidateApiCache('stores');

  if (table === 'users') {
    if (supabase) {
      try {
        // 1. Dissociate historical records by setting their user reference to NULL
        try { await supabase.from('orders').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}
        try { await supabase.from('orders').update({ vendor_id: null }).eq('vendor_id', id); } catch (e) {}
        try { await supabase.from('packages').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}
        try { await supabase.from('packages').update({ vendor_id: null }).eq('vendor_id', id); } catch (e) {}
        try { await supabase.from('wallet_transactions').update({ user_id: null }).eq('user_id', id); } catch (e) {}
        try { await supabase.from('referrals').update({ referrer_id: null }).eq('referrer_id', id); } catch (e) {}
        try { await supabase.from('referrals').update({ referred_id: null }).eq('referred_id', id); } catch (e) {}
        try { await supabase.from('reviews').update({ buyer_id: null }).eq('buyer_id', id); } catch (e) {}

        // 2. Delete temporary/personal dependencies (stores, products, ads, notifications, services)
        try { await supabase.from('notifications').delete().eq('user_id', id); } catch (e) {}
        try { await supabase.from('ad_campaigns').delete().eq('vendor_id', id); } catch (e) {}
        try { await supabase.from('services').delete().eq('rendor_id', id); } catch (e) {}
        try { await supabase.from('products').delete().eq('vendor_id', id); } catch (e) {}
        try { await supabase.from('stores').delete().eq('vendor_id', id); } catch (e) {}

        // 3. Now safely hard-delete the user account (best-effort — if Supabase
        // fails, still remove the account from the local db below).
        try {
          const { error } = await supabase.from('users').delete().eq('id', id);
          if (error) console.error('[Supabase] user delete rejected:', error.message);
        } catch (err) {
          console.error('[Supabase] user delete failed (falling back to local db):', err.message);
        }
      } catch (err) {
        console.error(`[Supabase Delete Exception] table=${table} id=${id}:`, err.message);
        // Continue to local removal below rather than failing the whole request.
      }
    }
    const db = loadDb();
    
    // Dissociate in local db
    getTable(db, 'orders').forEach(o => {
      if (String(o.buyer_id) === String(id)) o.buyer_id = null;
      if (String(o.vendor_id) === String(id)) o.vendor_id = null;
    });
    getTable(db, 'packages').forEach(p => {
      if (String(p.buyer_id) === String(id)) p.buyer_id = null;
      if (String(p.vendor_id) === String(id)) p.vendor_id = null;
    });
    getTable(db, 'wallet_transactions').forEach(t => {
      if (String(t.user_id) === String(id)) t.user_id = null;
    });
    getTable(db, 'referrals').forEach(r => {
      if (String(r.referrer_id) === String(id)) r.referrer_id = null;
      if (String(r.referred_id) === String(id)) r.referred_id = null;
    });
    getTable(db, 'reviews').forEach(r => {
      if (String(r.buyer_id) === String(id)) r.buyer_id = null;
    });

    // Delete in local db
    db.notifications = getTable(db, 'notifications').filter(n => String(n.user_id) !== String(id));
    db.ad_campaigns = getTable(db, 'ad_campaigns').filter(a => String(a.vendor_id) !== String(id));
    db.services = getTable(db, 'services').filter(s => String(s.rendor_id) !== String(id));
    db.products = getTable(db, 'products').filter(p => String(p.vendor_id) !== String(id));
    db.stores = getTable(db, 'stores').filter(s => String(s.vendor_id) !== String(id));
    db.users = getTable(db, 'users').filter(r => String(r.id) !== String(id));

    saveDb(db);
    return res.status(204).send();
  }

  if (supabase) {
    try {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      // Supabase rejected/timed out (missing table, RLS, outage) — don't fail
      // the request; still remove the record from the local db so it stays gone.
      console.error(`[Supabase Delete fallback] table=${table} id=${id}:`, err.message);
    }
  }

  const db = loadDb();
  if (db[table]) {
    db[table] = db[table].filter(record => String(record.id) !== String(id));
  }
  saveDb(db);
  return res.status(204).send();
});

app.use(express.static(path.join(__dirname)));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`HAPPA backend running on http://localhost:${PORT}`);
});

function seedDb() {
  return {
    users: [
      {
        id: 'admin',
        name: 'Admin User',
        email: 'admin@happatrademart.com',
        phone: '0000000000',
        password_hash: 'admin123',
        role: 'admin',
        status: 'active',
        location: 'Accra',
        wallet_balance: 0,
        referral_code: 'ADMIN001',
        registered_at: new Date().toISOString()
      },
      {
        id: 'rendor',
        name: 'Nana Ama',
        email: 'nana@test.com',
        phone: '0200000000',
        password_hash: 'rendor123',
        role: 'rendor',
        status: 'active',
        location: 'Accra',
        wallet_balance: 0,
        referral_code: 'NANA001',
        registered_at: new Date().toISOString(),
        rendor_display_name: 'Nana Creative',
        rendor_service_cat: 'Graphic Design',
        rendor_bio: 'I create scroll-stopping visuals for brands, businesses and entrepreneurs across Ghana. From logos and social media content to full brand kits — I\'ve got you covered. Fast delivery, clean designs, affordable rates.',
        rendor_starting_price: 120,
        rendor_tags: ['branding', 'logo design', 'social media', 'flyers', 'business cards'],
        rendor_whatsapp: '0249999999',
        rendor_email: 'nana@test.com',
        rendor_instagram: '@nana.creative',
        rendor_twitter: '@nana_creative',
        rendor_facebook: 'Nana Creative',
        rendor_website: 'https://example.com',
        rendor_contact_other: 'Available Mon–Sat, 8am–8pm. WhatsApp preferred.',
        rendor_sub_status: 'active',
        rendor_sub_expiry: String(Date.now() + 30 * 24 * 60 * 60 * 1000),
        rendor_sub_plan: 'monthly',
        is_verified: true,
        id_verified: true
      }
    ],
    stores: [],
    products: [],
    orders: [],
    packages: [],
    services: [
      {
        id: 'svc-1',
        rendor_id: 'rendor',
        title: 'Social Media Content Pack',
        category: 'Graphic Design',
        description: 'Get 10 custom-designed social media posts for Instagram, Facebook or TikTok. Includes branded templates, captions and a cover image. Perfect for launching or refreshing your online presence.',
        price: 200,
        image_url: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-2',
        rendor_id: 'rendor',
        title: 'Logo & Brand Identity Design',
        category: 'Graphic Design',
        description: 'Full brand identity package — logo (3 concepts), colour palette, typography guide, and business card design. Delivered in PNG, SVG and PDF formats. Ideal for new businesses and rebrands.',
        price: 350,
        image_url: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-3',
        rendor_id: 'rendor',
        title: 'Event Flyer & Poster Design',
        category: 'Graphic Design',
        description: 'Eye-catching flyer or poster design for any event — parties, concerts, seminars, product launches. Turnaround in 24 hours. Includes 2 revision rounds. Print-ready and digital formats included.',
        price: 80,
        image_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-4',
        rendor_id: 'rendor',
        title: 'Business Card Design',
        category: 'Graphic Design',
        description: 'Professional double-sided business card design. Clean, modern layouts that reflect your brand. Delivered ready for print. Add-on: digital VCard version available on request.',
        price: 60,
        image_url: 'https://images.unsplash.com/photo-1598520106830-8c45c2035460?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-5',
        rendor_id: 'rendor',
        title: 'WhatsApp & Telegram Broadcast Design',
        category: 'Graphic Design',
        description: 'Branded graphics and message templates for your WhatsApp Business or Telegram channel. Includes promo banners, product highlight cards and story-size visuals. Great for daily posts.',
        price: 120,
        image_url: 'https://images.unsplash.com/photo-1611746872915-64382b5c76da?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      }
    ],
    wallet_transactions: [],
    notifications: [],
    order_notifications: [],
    ad_campaigns: [],
    settings: [
      {
        id: 'vendor_auto_approve',
        key: 'vendor_auto_approve',
        value: 'false',
        label: 'Vendor Auto Approve',
        type: 'text',
        updated_at: new Date().toISOString()
      }
    ],
    referrals: [],
    delivery_rates: [
      {
        id: 'dr-1',
        origin: 'Kumasi',
        destination: 'KNUST',
        base_rate: 5,
        per_kg_rate: 2,
        est_days: 1,
        is_local: true
      },
      {
        id: 'dr-2',
        origin: 'Accra',
        destination: 'Kumasi',
        base_rate: 25,
        per_kg_rate: 10,
        est_days: 2,
        is_local: false
      }
    ],
    reviews: [],
    service_orders: []
  };
}

