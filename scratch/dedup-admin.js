/**
 * dedup-admin.js
 * Finds all rows with id='admin' or email='jkaidoo1@gmail.com' in Supabase users table,
 * keeps exactly one clean record, and deletes all duplicates.
 * Run with: node scratch/dedup-admin.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL   = 'https://lifsgstqkkzhkbafuodp.supabase.co';
const SUPABASE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpZnNnc3Rxa2t6aGtiYWZ1b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTc4MjksImV4cCI6MjA5OTE5MzgyOX0.fGKieuxaUeerDZeaqNYa7ZYJukTP2yTc_GUEkkayXfA';
const ADMIN_EMAIL    = 'jkaidoo1@gmail.com';
const PASSWORD_HASH  = '$2b$10$7np7sS50mKm9IVj9vxdT9uirVL1hKrBqeAImVZrCW4BuHM4maPKOi';

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('\n🔌 Connected to Supabase.');

  // ── Fetch ALL users to find any admin duplicates ───────────────────────
  console.log('\n🔍 Fetching all users from Supabase...');
  const { data: allUsers, error: fetchErr } = await supabase
    .from('users')
    .select('id, name, email, role, status, registered_at, created_at');

  if (fetchErr) {
    console.error('❌ Failed to fetch users:', fetchErr.message);
    process.exit(1);
  }

  console.log(`   Found ${allUsers.length} total user(s) in Supabase:`);
  allUsers.forEach(u => console.log(`   - id="${u.id}"  email="${u.email}"  role="${u.role}"`));

  // Find all rows that belong to the admin (by id OR by email)
  const adminRows = allUsers.filter(u =>
    u.id === 'admin' ||
    (u.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase() ||
    u.role === 'admin'
  );

  console.log(`\n   Admin-related rows found: ${adminRows.length}`);

  if (adminRows.length === 0) {
    console.log('\n⚠️  No admin rows found in Supabase. Nothing to deduplicate.');
    console.log('   The admin only exists in local db.json — that is fine.\n');
    return;
  }

  if (adminRows.length === 1) {
    console.log('\n✅ Only one admin row exists — no duplicates to remove.');
    // Still make sure it has the correct credentials
    const row = adminRows[0];
    console.log(`\n📝 Ensuring credentials are correct on row id="${row.id}"...`);
    const { error: fixErr } = await supabase
      .from('users')
      .update({ email: ADMIN_EMAIL, password_hash: PASSWORD_HASH, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (fixErr) console.error('  ❌', fixErr.message);
    else console.log('  ✅ Credentials confirmed up-to-date.');
    return;
  }

  // ── Multiple admin rows: keep the one with id='admin', delete the rest ─
  // Sort: prefer exact id='admin', then oldest created_at
  adminRows.sort((a, b) => {
    if (a.id === 'admin' && b.id !== 'admin') return -1;
    if (b.id === 'admin' && a.id !== 'admin') return 1;
    const aTime = new Date(a.registered_at || a.created_at || 0).getTime();
    const bTime = new Date(b.registered_at || b.created_at || 0).getTime();
    return aTime - bTime; // oldest first = keep
  });

  const [keepRow, ...deleteRows] = adminRows;
  console.log(`\n✅ Keeping row: id="${keepRow.id}" email="${keepRow.email}"`);
  console.log(`🗑️  Deleting ${deleteRows.length} duplicate(s)...`);

  for (const row of deleteRows) {
    const { error: delErr } = await supabase
      .from('users')
      .delete()
      .eq('id', row.id);

    if (delErr) {
      console.error(`  ❌ Failed to delete id="${row.id}": ${delErr.message}`);
    } else {
      console.log(`  ✅ Deleted duplicate: id="${row.id}" email="${row.email}"`);
    }
  }

  // ── Ensure the kept row has correct credentials ────────────────────────
  console.log(`\n📝 Updating credentials on kept row id="${keepRow.id}"...`);
  const { error: updateErr } = await supabase
    .from('users')
    .update({ email: ADMIN_EMAIL, password_hash: PASSWORD_HASH, updated_at: new Date().toISOString() })
    .eq('id', keepRow.id);

  if (updateErr) {
    console.error('  ❌ Failed to update kept row:', updateErr.message);
  } else {
    console.log('  ✅ Credentials updated on kept row.');
  }

  // ── Final verification ─────────────────────────────────────────────────
  console.log('\n🔍 Final verification — all users in Supabase:');
  const { data: finalUsers } = await supabase
    .from('users')
    .select('id, name, email, role, status');

  (finalUsers || []).forEach(u =>
    console.log(`   ✅ id="${u.id}"  email="${u.email}"  role="${u.role}"  status="${u.status}"`)
  );

  console.log('\n✅ Deduplication complete!\n');
}

run().catch(err => {
  console.error('\n❌ Unexpected error:', err.message);
  process.exit(1);
});
