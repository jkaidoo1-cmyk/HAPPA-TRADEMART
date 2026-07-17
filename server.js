
const express = require('express');
const fs = require('fs');
const path = require('path');

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

// Initialize Supabase if credentials are provided and not placeholders
let supabase = null;
const hasSupabaseUrl = process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-project');
const hasSupabaseKey = process.env.SUPABASE_KEY && !process.env.SUPABASE_KEY.includes('your_service_role');
if (hasSupabaseUrl && hasSupabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log('[Supabase] Initializing client... ⚡');
    supabase.from('users').select('id').limit(1).then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Connection query failed. Falling back to local db.json:', error.message);
        supabase = null;
      } else {
        console.log('[Supabase] Connected to database successfully! ⚡');
      }
    }).catch(err => {
      console.warn('[Supabase] Connection error. Falling back to local db.json:', err.message);
      supabase = null;
    });
  } catch (e) {
    console.warn('[Supabase] Failed to initialize client, falling back to db.json:', e.message);
    supabase = null;
  }
}

app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Service-Worker-Allowed', '/');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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
  users: ['id', 'name', 'email', 'phone', 'password_hash', 'role', 'status', 'location', 'wallet_balance', 'referral_code', 'referred_by', 'registered_at', 'created_at', 'updated_at', 'is_verified', 'id_verified', 'rendor_display_name', 'rendor_service_cat', 'rendor_bio', 'rendor_starting_price', 'rendor_tags', 'rendor_whatsapp', 'rendor_email', 'rendor_instagram', 'rendor_twitter', 'rendor_facebook', 'rendor_website', 'rendor_contact_other', 'rendor_sub_status', 'rendor_sub_expiry', 'rendor_sub_plan', 'avatar_url', 'extra', 'referral_earnings', 'referral_count', 'preferred_store_name', 'preferred_store_cat', 'preferred_store_desc', 'preferred_store_kws', 'id_image', 'proof_sales_1', 'proof_sales_2', 'proof_sales_3', 'proof_share', 'sub_request_status', 'sub_quote_monthly', 'sub_quote_quarterly', 'sub_quote_biannual'],
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

const JSONB_COLS = new Set([
  'images', 'keywords', 'rendor_tags', 'gallery_images', 'items', 'extra'
]);

function serializeRecord(record) {
  if (!record) return record;
  const out = { ...record };
  for (const col of JSONB_COLS) {
    if (col in out && typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch {}
    }
  }
  return out;
}

app.get('/api', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', backend: supabase ? 'supabase' : 'local' });
});

app.get('/api/:table', async (req, res) => {
  const table = req.params.table;
  
  if (supabase) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) return res.status(500).json({ error: error.message });
      const rows = (data || []).map(serializeRecord);
      const filtered = applyFilters(rows, parseQueryParams(req.query));
      return res.json({ data: filtered });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const params = parseQueryParams(req.query);
  const filtered = applyFilters(rows, params);
  res.json({ data: filtered });
});

app.get('/api/:table/:id', async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;

  if (supabase) {
    try {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
      if (error || !data) return sendNotFound(res);
      return res.json(serializeRecord(data));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const item = rows.find(record => String(record.id) === String(id));
  if (!item) return sendNotFound(res);
  res.json(item);
});

app.post('/api/:table', async (req, res) => {
  const table = req.params.table;
  const body = req.body || {};
  if (!body.id) body.id = `${table.slice(0, 3)}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  body.id = String(body.id);
  if (!body.created_at) body.created_at = new Date().toISOString();
  body.updated_at = new Date().toISOString();

  if (supabase) {
    try {
      const record = serializeRecord(body);
      const dbRecord = prepareRecordForDb(table, record);
      const { data, error } = await supabase.from(table).insert(dbRecord).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(serializeRecord(data));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const record = normalizeRecord(table, body);
  rows.push(record);
  saveDb(db);
  res.status(201).json(record);
});

app.put('/api/:table/:id', async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;
  const body = { ...req.body, id: id, updated_at: new Date().toISOString() };

  if (supabase) {
    try {
      const record = serializeRecord(body);
      const dbRecord = prepareRecordForDb(table, record);
      const { data, error } = await supabase.from(table).upsert(dbRecord).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(serializeRecord(data));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const idx = rows.findIndex(record => String(record.id) === String(id));
  if (idx === -1) return sendNotFound(res);
  rows[idx] = normalizeRecord(table, body);
  saveDb(db);
  res.json(rows[idx]);
});

app.patch('/api/:table/:id', async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;
  const body = { ...req.body, id: id, updated_at: new Date().toISOString() };

  if (supabase) {
    try {
      const record = serializeRecord(body);
      const dbRecord = prepareRecordForDb(table, record);
      const { data, error } = await supabase.from(table).update(dbRecord).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(serializeRecord(data));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const idx = rows.findIndex(record => String(record.id) === String(id));
  if (idx === -1) return sendNotFound(res);
  rows[idx] = { ...rows[idx], ...body, id: String(id) };
  saveDb(db);
  res.json(rows[idx]);
});

app.delete('/api/:table/:id', async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;

  if (supabase) {
    try {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(204).send();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const db = loadDb();
  const rows = getTable(db, table);
  const idx = rows.findIndex(record => String(record.id) === String(id));
  if (idx === -1) return sendNotFound(res);
  rows.splice(idx, 1);
  saveDb(db);
  res.status(204).send();
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

