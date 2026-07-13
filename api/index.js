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
const fs = require('fs');
const path = require('path');

// Local JSON DB fallback (used when SUPABASE_* env vars are missing)
const DB_PATH = path.resolve(__dirname, '..', 'db.json');
function loadLocalDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}
function saveLocalDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to write local DB', err);
    return false;
  }
}
function ensureTable(db, table) {
  if (!db[table]) db[table] = [];
}

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
  // Stores: description → about_us (used by storefront views)
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
  res.json({ status: 'ok', version: '2.0.0', backend: 'supabase' });
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
      // Local DB path
      const db = loadLocalDB();
      ensureTable(db, table);
      let rows = db[table].map(serializeRecord);
      if (search) rows = applyClientFilters(rows, { search, limit, page });
      // Apply simple filters
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        rows = rows.filter(r => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase());
      }
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
      const db = loadLocalDB();
      ensureTable(db, table);
      const found = db[table].find(r => String(r.id) === String(id));
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
      const db = loadLocalDB();
      ensureTable(db, table);
      db[table].push(record);
      saveLocalDB(db);
      return res.status(201).json(serializeRecord(record));
    }

    const { data, error } = await supabase.from(table).insert(record).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(serializeRecord(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      const db = loadLocalDB();
      ensureTable(db, table);
      const idx = db[table].findIndex(r => String(r.id) === String(id));
      if (idx === -1) db[table].push(record); else db[table][idx] = { ...db[table][idx], ...record };
      saveLocalDB(db);
      return res.json(serializeRecord(record));
    }
    const { data, error } = await supabase.from(table).upsert(record).select().single();
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
      const db = loadLocalDB();
      ensureTable(db, table);
      const idx = db[table].findIndex(r => String(r.id) === String(id));
      if (idx === -1) return res.status(404).json({ error: 'Record not found' });
      db[table][idx] = { ...db[table][idx], ...record };
      saveLocalDB(db);
      return res.json(serializeRecord(db[table][idx]));
    }
    const { data, error } = await supabase.from(table).update(record).eq('id', id).select().single();
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
      const db = loadLocalDB();
      ensureTable(db, table);
      const before = db[table].length;
      db[table] = db[table].filter(r => String(r.id) !== String(id));
      saveLocalDB(db);
      if (db[table].length === before) return res.status(404).json({ error: 'Record not found' });
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
