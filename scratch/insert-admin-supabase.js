/**
 * insert-admin-supabase.js
 * Uses Supabase REST API to upsert the admin user directly.
 * Run with: node scratch/insert-admin-supabase.js
 */

const https = require('https');

const SUPABASE_URL = 'https://lifsgstqkkzhkbafuodp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpZnNnc3Rxa2t6aGtiYWZ1b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTc4MjksImV4cCI6MjA5OTE5MzgyOX0.fGKieuxaUeerDZeaqNYa7ZYJukTP2yTc_GUEkkayXfA';

const adminUser = {
  id: 'admin',
  name: 'Admin User',
  email: 'jkaidoo1@gmail.com',
  phone: '0000000000',
  password_hash: '$2b$10$7np7sS50mKm9IVj9vxdT9uirVL1hKrBqeAImVZrCW4BuHM4maPKOi',
  role: 'admin',
  status: 'active',
  location: 'Accra',
  wallet_balance: 0,
  referral_code: 'ADMIN001',
  registered_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  extra: {}
};

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const url = new URL(SUPABASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function run() {
  console.log('\n🔌 Connecting to Supabase REST API...');

  // ── 1. Check if admin already exists ──────────────────────────────────
  console.log('\n🔍 Checking for existing admin row...');
  const checkRes = await supabaseRequest('GET', '/rest/v1/users?id=eq.admin&select=id,email,role');
  console.log(`   Status: ${checkRes.status}`);
  
  if (checkRes.status === 200) {
    const rows = Array.isArray(checkRes.body) ? checkRes.body : [];
    console.log(`   Found ${rows.length} row(s) with id='admin':`, rows);
  } else {
    console.log('   Response:', checkRes.body);
  }

  // ── 2. Upsert admin (insert or update) ────────────────────────────────
  console.log('\n📝 Upserting admin user into Supabase...');
  const upsertRes = await supabaseRequest('POST', '/rest/v1/users', adminUser);
  console.log(`   Status: ${upsertRes.status}`);
  
  if (upsertRes.status === 200 || upsertRes.status === 201) {
    console.log('   ✅ Admin upserted successfully!');
    console.log('   Data:', upsertRes.body);
  } else {
    console.log('   ⚠️  Response:', JSON.stringify(upsertRes.body, null, 2));
    
    // If insert failed (likely RLS), try PATCH update instead
    console.log('\n🔄 Trying PATCH update instead...');
    const patchRes = await supabaseRequest('PATCH', '/rest/v1/users?id=eq.admin', {
      email: adminUser.email,
      password_hash: adminUser.password_hash,
      updated_at: adminUser.updated_at
    });
    console.log(`   Status: ${patchRes.status}`);
    console.log('   Response:', patchRes.body);
  }

  // ── 3. Verify final state ──────────────────────────────────────────────
  console.log('\n🔍 Final check — all users in Supabase:');
  const finalRes = await supabaseRequest('GET', '/rest/v1/users?select=id,email,role,status');
  if (finalRes.status === 200) {
    const users = Array.isArray(finalRes.body) ? finalRes.body : [];
    if (users.length === 0) {
      console.log('   ⚠️  Still 0 users visible — RLS is blocking reads with anon key.');
      console.log('   ➡  You need to run the SQL in Supabase Dashboard → SQL Editor (see below).');
    } else {
      users.forEach(u => console.log(`   ✅ id="${u.id}" email="${u.email}" role="${u.role}"`));
    }
  }

  console.log('\n📋 If the above did not work due to RLS, run this SQL in Supabase Dashboard:');
  console.log('   Go to: https://supabase.com/dashboard → Your project → SQL Editor → New Query\n');
  console.log(`-- Paste and run this:
INSERT INTO public.users (
  id, name, email, phone, password_hash, role, status,
  location, wallet_balance, referral_code, registered_at, updated_at, extra
) VALUES (
  'admin', 'Admin User', 'jkaidoo1@gmail.com', '0000000000',
  '$2b$10$7np7sS50mKm9IVj9vxdT9uirVL1hKrBqeAImVZrCW4BuHM4maPKOi',
  'admin', 'active', 'Accra', 0, 'ADMIN001', NOW(), NOW(), '{}'
)
ON CONFLICT (id) DO UPDATE SET
  email         = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  updated_at    = NOW();
`);
  console.log('\n✅ Done.\n');
}

run().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
