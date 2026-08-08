/**
 * reset-supabase.js
 * Updates the admin credentials in Supabase and clears all other user/data records.
 * Run with: node scratch/reset-supabase.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lifsgstqkkzhkbafuodp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpZnNnc3Rxa2t6aGtiYWZ1b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTc4MjksImV4cCI6MjA5OTE5MzgyOX0.fGKieuxaUeerDZeaqNYa7ZYJukTP2yTc_GUEkkayXfA';

const NEW_ADMIN_EMAIL    = 'jkaidoo1@gmail.com';
const NEW_PASSWORD_HASH  = '$2b$10$7np7sS50mKm9IVj9vxdT9uirVL1hKrBqeAImVZrCW4BuHM4maPKOi';
const ADMIN_ID           = 'admin';

// Tables to completely wipe (non-admin data)
const TABLES_TO_CLEAR = [
  'stores',
  'products',
  'orders',
  'packages',
  'services',
  'wallet_transactions',
  'notifications',
  'ad_campaigns',
  'referrals',
  'reviews',
  'service_orders',
  'platform_revenue',
  'support_tickets',
];

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('\n🔌 Connecting to Supabase...');

  // ── 1. Update admin email + password hash ──────────────────────────────
  console.log('\n📝 Updating admin credentials...');
  const { error: updateErr } = await supabase
    .from('users')
    .update({
      email: NEW_ADMIN_EMAIL,
      password_hash: NEW_PASSWORD_HASH,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ADMIN_ID);

  if (updateErr) {
    console.error('  ❌ Failed to update admin:', updateErr.message);
  } else {
    console.log('  ✅ Admin credentials updated successfully.');
    console.log(`     email         → ${NEW_ADMIN_EMAIL}`);
    console.log(`     password_hash → (bcrypt hash updated)`);
  }

  // ── 2. Delete all non-admin users ─────────────────────────────────────
  console.log('\n🗑️  Deleting non-admin users...');
  const { data: deletedUsers, error: deleteUsersErr } = await supabase
    .from('users')
    .delete()
    .neq('id', ADMIN_ID)
    .select('id, email, role');

  if (deleteUsersErr) {
    console.error('  ❌ Failed to delete users:', deleteUsersErr.message);
  } else {
    const count = deletedUsers ? deletedUsers.length : 0;
    if (count === 0) {
      console.log('  ℹ️  No other users found to delete.');
    } else {
      console.log(`  ✅ Deleted ${count} user(s):`);
      deletedUsers.forEach(u => console.log(`     - [${u.role}] ${u.email} (${u.id})`));
    }
  }

  // ── 3. Clear all data tables ──────────────────────────────────────────
  console.log('\n🧹 Clearing all data tables...');
  for (const table of TABLES_TO_CLEAR) {
    try {
      // neq('id', '__none__') matches all rows — a safe way to delete everything
      const { error } = await supabase
        .from(table)
        .delete()
        .neq('id', '__none__');

      if (error) {
        // Table might not exist in this Supabase project — skip gracefully
        console.log(`  ⚠️  ${table}: ${error.message}`);
      } else {
        console.log(`  ✅ ${table}: cleared`);
      }
    } catch (err) {
      console.log(`  ⚠️  ${table}: ${err.message}`);
    }
  }

  // ── 4. Verify admin record ─────────────────────────────────────────────
  console.log('\n🔍 Verifying admin record...');
  const { data: adminCheck, error: checkErr } = await supabase
    .from('users')
    .select('id, name, email, role, status')
    .eq('id', ADMIN_ID)
    .single();

  if (checkErr) {
    console.warn('  ⚠️  Could not verify admin (may not exist in Supabase yet):', checkErr.message);
  } else {
    console.log('  ✅ Admin record confirmed:');
    console.log(`     id    : ${adminCheck.id}`);
    console.log(`     name  : ${adminCheck.name}`);
    console.log(`     email : ${adminCheck.email}`);
    console.log(`     role  : ${adminCheck.role}`);
    console.log(`     status: ${adminCheck.status}`);
  }

  console.log('\n✅ Done! Supabase has been reset.\n');
}

run().catch(err => {
  console.error('\n❌ Unexpected error:', err.message);
  process.exit(1);
});
