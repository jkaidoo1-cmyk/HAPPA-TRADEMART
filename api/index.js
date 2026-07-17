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

function serializeRecord(record) {
  const out = { ...record };

  // Parse JSONB columns stored as strings
  for (const col of JSONB_COLS) {
    if (col in out && typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch {}
    }
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
  users: ['id', 'name', 'email', 'phone', 'password_hash', 'role', 'status', 'location', 'wallet_balance', 'referral_code', 'referred_by', 'registered_at', 'created_at', 'updated_at', 'is_verified', 'id_verified', 'rendor_display_name', 'rendor_service_cat', 'rendor_bio', 'rendor_starting_price', 'rendor_tags', 'rendor_whatsapp', 'rendor_email', 'rendor_instagram', 'rendor_twitter', 'rendor_facebook', 'rendor_website', 'rendor_contact_other', 'rendor_sub_status', 'rendor_sub_expiry', 'rendor_sub_plan', 'avatar_url', 'extra', 'campus', 'referral_earnings', 'referral_count', 'preferred_store_name', 'preferred_store_cat', 'preferred_store_desc', 'preferred_store_kws', 'id_image', 'proof_sales_1', 'proof_sales_2', 'proof_sales_3', 'proof_share'],
  notifications: ['id', 'user_id', 'type', 'title', 'message', 'is_read', 'created_at', 'extra'],
  stores: ['id', 'name', 'slug', 'vendor_id', 'category', 'location', 'status', 'logo_url', 'banner_url', 'description', 'keywords', 'avg_rating', 'review_count', 'total_sales', 'total_orders', 'store_price', 'is_paid', 'storefront_status', 'slogan', 'primary_color', 'secondary_color', 'tertiary_color', 'theme', 'font_family', 'hero_image_url', 'gallery_images', 'business_hours', 'return_policy', 'whatsapp', 'instagram', 'facebook', 'twitter', 'subscription_plan', 'subscription_status', 'subscription_start', 'subscription_end', 'subscription_months', 'subscription_method', 'created_at', 'updated_at', 'extra'],
  orders: ['id', 'buyer_id', 'vendor_id', 'store_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'subtotal', 'platform_fee', 'delivery_fee', 'total', 'status', 'payment_method', 'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location', 'package_code', 'notes', 'created_at', 'updated_at', 'extra'],
  ad_campaigns: ['id', 'vendor_id', 'store_id', 'title', 'image_url', 'link', 'placement', 'budget', 'spent', 'impressions', 'clicks', 'status', 'start_date', 'end_date', 'created_at', 'updated_at', 'extra'],
  services: ['id', 'rendor_id', 'title', 'category', 'description', 'price', 'image_url', 'status', 'created_at', 'updated_at', 'extra'],
  service_orders: ['id', 'service_id', 'rendor_id', 'buyer_id', 'title', 'amount', 'status', 'notes', 'created_at', 'updated_at', 'extra'],
  settings: ['id', 'key', 'value', 'label', 'type', 'updated_at'],
  reviews: ['id', 'product_id', 'store_id', 'buyer_id', 'rating', 'comment', 'created_at'],
  products: ['id', 'store_id', 'vendor_id', 'name', 'category', 'price', 'original_price', 'stock_qty', 'images', 'is_flash_sale', 'flash_pct', 'status', 'is_available', 'description', 'location', 'avg_rating', 'review_count', 'total_sold', 'created_at', 'updated_at', 'extra'],
  packages: ['id', 'code', 'buyer_id', 'vendor_id', 'store_id', 'items', 'status', 'total', 'delivery_fee', 'payment_method', 'delivery_name', 'delivery_phone', 'delivery_address', 'delivery_location', 'notes', 'created_at', 'updated_at', 'extra'],
  delivery_rates: ['id', 'origin', 'destination', 'base_rate', 'per_kg_rate', 'est_days', 'is_local', 'created_at'],
  referrals: ['id', 'referrer_id', 'referred_id', 'reward', 'status', 'created_at'],
  wallet_transactions: ['id', 'user_id', 'type', 'amount', 'description', 'reference', 'created_at', 'extra'],
  storefronts: ['id', 'store_id', 'vendor_id', 'status', 'url_slug', 'theme', 'font_family', 'slogan', 'about_us', 'logo_url', 'banner_url', 'primary_color', 'secondary_color', 'tertiary_color', 'whatsapp_number', 'facebook_url', 'instagram_url', 'youtube_url', 'meta_description', 'created_at', 'updated_at']
};

function prepareRecordForDb(table, record) {
  const out = { ...record };

  // Inverse aliasing: map frontend names back to DB column names if DB column is missing
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
    
    if (!supabase) {
      dataStore.ensureTable(table);
      const store = dataStore.getStore();
      const idx = store[table].findIndex(r => String(r.id) === String(id));
      if (idx === -1) return res.status(404).json({ error: 'Record not found' });
      store[table][idx] = { ...store[table][idx], ...record };
      dataStore.saveToFile();
      return res.json(serializeRecord(store[table][idx]));
    }
    
    const dbRecord = prepareRecordForDb(table, record);
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

module.exports = app;
