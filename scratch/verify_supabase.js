/* HAPPA TRADEMART — Supabase connection verifier
 * Run AFTER pasting your real key into .env:
 *   node scratch/verify_supabase.js
 * Performs a READ-ONLY health check: fetches table names and row counts.
 */
const fs = require('fs');
const path = require('path');

// Mirror server.js's .env loader (no dotenv dependency)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const idx = clean.indexOf('=');
    if (idx !== -1) process.env[clean.substring(0, idx).trim()] = clean.substring(idx + 1).trim();
  });
}

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_KEY || '';

if (!url) { console.error('❌ SUPABASE_URL missing in .env'); process.exit(1); }
if (!key || key.includes('your_service_role') || key.includes('PASTE')) {
  console.error('❌ SUPABASE_KEY is still the placeholder. Paste your real key into .env first.');
  console.error('   (Supabase dashboard → Project → Settings → API → Project API keys → service_role)');
  process.exit(1);
}

console.log(`🔌 Testing connection to ${url.replace('https://', '')} ...`);

const headers = {
  'apikey': key,
  'Authorization': `Bearer ${key}`,
  'Content-Type': 'application/json'
};

async function check() {
  // 1) Ping auth (public endpoint that verifies the key works)
  try {
    const ping = await fetch(`${url}/auth/v1/health`, { headers });
    if (ping.ok) console.log('✅ Auth health: OK');
    else console.log(`⚠️  Auth health responded ${ping.status} (may be normal — some projects disable it)`);
  } catch (e) { console.log('⚠️  Auth health unreachable:', e.message); }

  // 2) List tables + row counts via PostgREST (read-only)
  const tables = ['users', 'stores', 'products', 'orders', 'wallet_transactions', 'support_tickets', 'settings'];
  let ok = 0;
  for (const t of tables) {
    try {
      const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, { headers });
      if (r.status === 200) { ok++; console.log(`✅ ${t}: reachable`); }
      else if (r.status === 404) { console.log(`  ⏭ ${t}: table not found (skip)`); }
      else { console.log(`⚠️  ${t}: HTTP ${r.status}`); }
    } catch (e) { console.log(`⚠️  ${t}: ${e.message}`); }
  }

  // 3) Read a real row count (cheap aggregate)
  try {
    const r = await fetch(`${url}/rest/v1/users?select=count`, { headers, method: 'HEAD' });
    const count = r.headers.get('content-range') || 'n/a';
    console.log(`👥 users row count (content-range): ${count}`);
  } catch (e) { console.log('⚠️  count query failed:', e.message); }

  console.log(ok > 0
    ? '\n✅ Connected to Supabase — the server will use the cloud database.'
    : '\n❌ No tables reachable. Check the key/URL, or that the project has the schema set up.');
  process.exit(ok > 0 ? 0 : 1);
}

check();
