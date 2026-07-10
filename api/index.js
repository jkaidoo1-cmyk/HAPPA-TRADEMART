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
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
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
  for (const col of JSONB_COLS) {
    if (col in out && typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch {}
    }
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

// GET /api/:table  — list with optional filters
app.get('/api/:table', async (req, res) => {
  try {
    const supabase = getSupabase();
    const table = req.params.table;
    const { data, error } = await supabase.from(table).select('*');
    if (error) return res.status(500).json({ error: error.message });

    const rows = (data || []).map(serializeRecord);
    const filtered = applyClientFilters(rows, req.query);
    res.json({ data: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:table/:id  — single record
app.get('/api/:table/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from(req.params.table)
      .select('*')
      .eq('id', req.params.id)
      .single();
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
    const body = { ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
    const record = serializeRecord(body);
    const { data, error } = await supabase
      .from(table).upsert(record).select().single();
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
    const body = { ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
    const record = serializeRecord(body);
    const { data, error } = await supabase
      .from(table).update(record).eq('id', req.params.id).select().single();
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
    const { error } = await supabase
      .from(req.params.table).delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
