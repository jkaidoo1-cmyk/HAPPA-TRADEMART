/**
 * HAPPA TRADEMART — Vercel Serverless API
 * Backed by Supabase (PostgreSQL)
 *
 * Environment variables required (set in Vercel Dashboard):
 *   SUPABASE_URL  — e.g. https://xxxx.supabase.co
 *   SUPABASE_KEY  — your project's service_role (secret) key
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const dataStore = require('./data-store');

const app = express();
app.use(express.json({ limit: '8mb' }));

// ── CORS ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Service-Worker-Allowed', '/');
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
  return createClient(url, key);
}

// ── Helpers ───────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Columns that are stored as JSON arrays/objects in Postgres (jsonb)
// We serialize them before writing and parse them after reading
const JSONB_COLS = new Set([
  'images', 'keywords', 'rendor_tags', 'gallery_images', 'items', 'extra'
]);

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
  'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location'
];

const ORDER_META_FIELDS = [
  'buyer_name', 'buyer_phone', 'buyer_email', 'items', 'referral_code', 'discount',
  'coupon_code', 'payment_ref', 'ship_date', 'buyer_location'
];

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
    'weight_kg' in out || 'commission_pct' in out || 'sell_count' in out ||
    'total_sold' in out
  ));
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
  users: ['id', 'name', 'email', 'phone', 'password_hash', 'role', 'status', 'location', 'wallet_balance', 'referral_code', 'referred_by', 'registered_at', 'created_at', 'updated_at', 'is_verified', 'id_verified', 'rendor_display_name', 'rendor_service_cat', 'rendor_bio', 'rendor_starting_price', 'rendor_tags', 'rendor_whatsapp', 'rendor_email', 'rendor_instagram', 'rendor_twitter', 'rendor_facebook', 'rendor_website', 'rendor_contact_other', 'rendor_sub_status', 'rendor_sub_expiry', 'rendor_sub_plan', 'avatar_url', 'extra', 'referral_earnings', 'referral_count', 'preferred_store_name', 'preferred_store_cat', 'preferred_store_desc', 'preferred_store_kws', 'sub_request_status', 'sub_quote_monthly', 'sub_quote_quarterly', 'sub_quote_biannual'],
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
  storefronts: ['id', 'store_id', 'vendor_id', 'status', 'url_slug', 'name', 'theme', 'font_family', 'slogan', 'about_us', 'logo_url', 'banner_url', 'primary_color', 'secondary_color', 'tertiary_color', 'business_hours', 'shipping_policy', 'return_policy', 'whatsapp_number', 'facebook_url', 'instagram_url', 'youtube_url', 'meta_description', 'subscription_plan', 'subscription_status', 'subscription_start', 'subscription_end', 'created_at', 'updated_at']
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

app.post('/api/clean-temp-database-records', async (req, res) => {
  try {
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

// GET /api/:table  — list with optional filters
app.get('/api/:table', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const { search, limit, page, sort, ...filters } = req.query;

    if (table === 'storefronts') {
      let stores = [];
      if (!supabase) {
        dataStore.ensureTable('stores');
        const store = dataStore.getStore();
        stores = store.stores.map(serializeRecord);
      } else {
        const { data, error } = await supabase.from('stores').select('*');
        if (error) return res.status(500).json({ error: error.message });
        stores = (data || []).map(serializeRecord);
      }

      let rows = stores.map(st => ({
        id: st.id,
        store_id: st.id,
        vendor_id: st.vendor_id,
        status: st.storefront_status || 'none',
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
      }));

      if (search) rows = applyClientFilters(rows, { search, limit, page });
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        rows = rows.filter(r => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase());
      }
      return res.json({ data: rows });
    }

    if (!supabase) {
      // In-memory/file-backed path
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      let rows = store[table].map(serializeRecord);
      
      // Apply filters
      if (search) rows = applyClientFilters(rows, { search, limit, page });
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        rows = rows.filter(r => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase());
      }
      // Apply sorting
      if (sort) rows.sort((a,b) => (b[sort]||0) - (a[sort]||0));
      
      res.json({ data: rows });
      return;
    }

    // Supabase path
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
        queryBuilder = queryBuilder.range(start, start + max - 1);
      }
    }
    const { data, error } = await queryBuilder;
    if (error) return res.status(500).json({ error: error.message });
    let rows = (data || []).map(serializeRecord);
    if (search) rows = applyClientFilters(rows, { search, limit, page });
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:table/:id  — single record
app.get('/api/:table/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const id = req.params.id;

    if (table === 'storefronts') {
      let stores = [];
      if (!supabase) {
        dataStore.ensureTable('stores');
        const store = dataStore.getStore();
        stores = store.stores.map(serializeRecord);
      } else {
        const { data, error } = await supabase.from('stores').select('*');
        if (error) return res.status(500).json({ error: error.message });
        stores = (data || []).map(serializeRecord);
      }

      const st = stores.find(s => String(s.id) === String(id) || String(s.vendor_id) === String(id) || (s.slug && String(s.slug).toLowerCase() === String(id).toLowerCase()));
      if (!st) return res.status(404).json({ error: 'Storefront not found' });

      const sf = {
        id: st.id,
        store_id: st.id,
        vendor_id: st.vendor_id,
        status: st.storefront_status || 'draft',
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
        only_show_on_storefront: st.extra?.only_show_on_storefront === true || st.extra?.only_show_on_storefront === 'true',
        created_at: st.created_at,
        updated_at: st.updated_at
      };
      return res.json(sf);
    }

    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const found = store[table].find(r => String(r.id) === String(id));
      if (!found) return res.status(404).json({ error: 'Record not found' });
      return res.json(serializeRecord(found));
    }
    
    const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Record not found' });
    res.json(serializeRecord(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:table  — create record
app.post('/api/:table', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const body = req.body || {};

    if (table === 'storefronts') {
      const storeId = body.store_id || body.id;
      let st = null;
      if (!supabase) {
        dataStore.ensureTable('stores');
        const store = dataStore.getStore();
        st = store.stores.find(s => String(s.id) === String(storeId));
      } else {
        const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
        if (!error && data) st = serializeRecord(data);
      }

      if (!st) {
        return res.status(404).json({ error: 'Store not found to attach storefront' });
      }

      const storeUpdates = {
        storefront_status: body.status || 'draft',
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

      if (!supabase) {
        const store = dataStore.getStore();
        const idx = store.stores.findIndex(s => String(s.id) === String(storeId));
        if (idx !== -1) {
          store.stores[idx] = { ...store.stores[idx], ...storeUpdates };
          dataStore.saveToFile();
        }
      } else {
        const dbRecord = prepareRecordForDb('stores', storeUpdates);
        await supabase.from('stores').update(dbRecord).eq('id', storeId);
      }

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
        shipping_policy: storeUpdates.return_policy,
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
    if (!body.id) body.id = generateId();
    body.id = String(body.id);
    if (!body.created_at) body.created_at = new Date().toISOString();
    body.updated_at = new Date().toISOString();
    const record = serializeRecord(body);

    if (!supabase) {
      // In-memory/file-backed path
      try {
        dataStore.ensureTable(table);
        const store = dataStore.getStore();
        store[table].push(record);
        const fileSaved = dataStore.saveToFile();
        
        console.log(`[POST] Saved ${table}/${record.id} to memory${fileSaved ? ' + db.json' : ' (file save failed, continuing with memory)'}`);
        return res.status(201).json(serializeRecord(record));
      } catch (localErr) {
        console.error('[POST] Local store error:', table, localErr);
        return res.status(500).json({ error: localErr.message, backend: 'memory-cache' });
      }
    }

    // Supabase path
    const dbRecord = prepareRecordForDb(table, record);
    const { data, error } = await supabase.from(table).insert(dbRecord).select().single();
    if (error) {
      console.error('[POST] Supabase error:', table, error);
      return res.status(500).json({ error: error.message, backend: 'supabase' });
    }
    console.log(`[POST] Saved ${table}/${data.id} to Supabase`);
    res.status(201).json(serializeRecord(data));
  } catch (err) {
    console.error('[POST] Unexpected error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// PUT /api/:table/:id  — full replace
app.put('/api/:table/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const id = req.params.id;
    const body = { ...req.body, id: id, updated_at: new Date().toISOString() };
    const record = serializeRecord(body);
    
    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const idx = store[table].findIndex(r => String(r.id) === String(id));
      if (idx === -1) store[table].push(record); else store[table][idx] = { ...store[table][idx], ...record };
      dataStore.saveToFile();
      return res.json(serializeRecord(record));
    }
    
    const dbRecord = prepareRecordForDb(table, record);
    const { data, error } = await supabase.from(table).upsert(dbRecord).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(serializeRecord(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/:table/:id  — partial update
app.patch('/api/:table/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const id = req.params.id;
    const body = { ...req.body, id: id, updated_at: new Date().toISOString() };
    const record = serializeRecord(body);

    if (table === 'storefronts') {
      let st = null;
      if (!supabase) {
        dataStore.ensureTable('stores');
        const store = dataStore.getStore();
        st = store.stores.find(s => String(s.id) === String(id));
      } else {
        const { data, error } = await supabase.from('stores').select('*').eq('id', id).maybeSingle();
        if (!error && data) st = serializeRecord(data);
      }

      if (!st) {
        if (!supabase) {
          const store = dataStore.getStore();
          st = store.stores.find(s => String(s.vendor_id) === String(id));
        } else {
          const { data, error } = await supabase.from('stores').select('*').eq('vendor_id', id).limit(1);
          if (!error && data && data.length > 0) st = serializeRecord(data[0]);
        }
      }

      if (!st) {
        return res.status(404).json({ error: 'Store not found to update storefront' });
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

      let extra = {};
      try {
        extra = typeof st.extra === 'string' ? JSON.parse(st.extra) : (st.extra || {});
      } catch(e) {}
      if ('only_show_on_storefront' in body) {
        extra.only_show_on_storefront = body.only_show_on_storefront === true || body.only_show_on_storefront === 'true';
        storeUpdates.extra = extra;
      }
      if ('plan_prices' in body) {
        extra.plan_prices = body.plan_prices;
        storeUpdates.extra = extra;
      }

      storeUpdates.updated_at = new Date().toISOString();

      if (!supabase) {
        const store = dataStore.getStore();
        const idx = store.stores.findIndex(s => String(s.id) === String(storeId));
        if (idx !== -1) {
          store.stores[idx] = { ...store.stores[idx], ...storeUpdates };
          dataStore.saveToFile();
        }
      } else {
        const dbRecord = prepareRecordForDb('stores', storeUpdates);
        await supabase.from('stores').update(dbRecord).eq('id', storeId);
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
        only_show_on_storefront: updatedSt.extra?.only_show_on_storefront === true || updatedSt.extra?.only_show_on_storefront === 'true',
        created_at: updatedSt.created_at,
        updated_at: updatedSt.updated_at
      };
      return res.json(sf);
    }
    
    let existingRecord = null;
    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      existingRecord = store[table].find(r => String(r.id) === String(id));
    } else {
      const { data: dbData } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (dbData) existingRecord = serializeRecord(dbData);
    }

    if (!supabase) {
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
    
    const dbRecord = prepareRecordForDb(table, record, existingRecord);
    // Use update instead of upsert to perform partial updates without wiping other columns
    const { data, error } = await supabase.from(table).update(dbRecord).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(serializeRecord(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:table/:id  — delete record
app.delete('/api/:table/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const id = req.params.id;
    
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

        // 3. Now safely hard-delete the user account
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
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
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getRecordCandidatesForTable(table, record) {
  const primary = prepareRecordForDb(table, record);
  const slim = { ...primary };
  delete slim.weight_kg;
  delete slim.allow_buyer_note;
  delete slim.buyer_note_prompt;
  delete slim.campus;
  delete slim.tags;
  delete slim.commission_pct;
  delete slim.flash_sale_end;
  return [primary, slim];
}

app.getRecordCandidatesForTable = getRecordCandidatesForTable;
app.prepareRecordForDb = prepareRecordForDb;
app.serializeRecord = serializeRecord;

module.exports = app;
