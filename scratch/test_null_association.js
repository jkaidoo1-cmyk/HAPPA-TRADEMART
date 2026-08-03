const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const matchUrl = env.match(/SUPABASE_URL\s*=\s*(.*)/);
const matchKey = env.match(/SUPABASE_KEY\s*=\s*(.*)/);
const supabaseUrl = matchUrl ? matchUrl[1].trim().replace(/['"]/g, '') : '';
const supabaseKey = matchKey ? matchKey[1].trim().replace(/['"]/g, '') : '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase env vars missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testNullify() {
  console.log('Testing nullifying references in Supabase...');

  // Create a dummy user
  const uid = 'test-nullify-user-' + Date.now();
  const { error: userErr } = await supabase.from('users').insert({
    id: uid,
    name: 'Nullify Test User',
    email: uid + '@example.com',
    role: 'buyer',
    status: 'active'
  });
  if (userErr) {
    console.error('User creation failed:', userErr.message);
    process.exit(1);
  }
  console.log('Created user:', uid);

  // Create a mock transaction referencing this user
  const { data: txn, error: txnErr } = await supabase.from('wallet_transactions').insert({
    user_id: uid,
    type: 'deposit',
    amount: 10,
    description: 'Test Nullify Txn',
    reference: 'REF-' + Date.now()
  }).select().single();

  if (txnErr) {
    console.error('Transaction creation failed:', txnErr.message);
    // Cleanup user
    await supabase.from('users').delete().eq('id', uid);
    process.exit(1);
  }
  console.log('Created transaction referencing user.');

  // Try to update user_id in transaction to NULL
  console.log('Attempting to set transaction user_id to NULL...');
  const { error: updateErr } = await supabase.from('wallet_transactions')
    .update({ user_id: null })
    .eq('id', txn.id);

  if (updateErr) {
    console.log('❌ Failed to set user_id to NULL:', updateErr.message);
  } else {
    console.log('✅ Successfully set user_id to NULL in transaction!');
  }

  // Cleanup
  await supabase.from('wallet_transactions').delete().eq('id', txn.id);
  await supabase.from('users').delete().eq('id', uid);
}

testNullify();
