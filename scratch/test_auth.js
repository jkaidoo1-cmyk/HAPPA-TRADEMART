const http = require('http');

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost',
      port: 9000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: responseBody });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function testAuth() {
  console.log('=== TESTING ACCOUNT CREATION AND LOGIN ===\n');

  // Test 1: Create a buyer account
  const timestamp = Date.now();
  const testEmail = `testbuyer_${timestamp}@example.com`;
  const testPhone = `024${Math.floor(1000000 + Math.random() * 9000000)}`;
  const testPass = 'pass123456';

  console.log('1. Testing Buyer Registration with email:', testEmail);
  const buyerUser = {
    name: 'Test Buyer User',
    email: testEmail,
    phone: testPhone,
    role: 'buyer',
    location: 'Accra',
    is_verified: false,
    id_verified: false,
    referral_code: 'REF' + timestamp,
    referred_by: '',
    referral_earnings: 0,
    referral_count: 0,
    wallet_balance: 0,
    status: 'active',
    password_hash: testPass,
    registered_at: new Date().toISOString()
  };

  const regRes = await apiRequest('POST', '/api/users', buyerUser);
  console.log('  -> Registration HTTP status:', regRes.status);
  console.log('  -> Created User ID:', regRes.data?.id);
  console.log('  -> Created Email:', regRes.data?.email);
  if (!regRes.data?.id) {
    throw new Error('Registration failed: no ID returned!');
  }
  console.log('  ✅ Buyer account creation successful!\n');

  // Test 2: Login with newly created buyer
  console.log('2. Testing Buyer Login with email:', testEmail);
  const loginRes = await apiRequest('GET', `/api/users?search=${encodeURIComponent(testEmail)}&limit=10`);
  console.log('  -> Login API status:', loginRes.status);
  console.log('  -> Users found count:', loginRes.data?.data?.length);

  const matchedUser = (loginRes.data?.data || []).find(u =>
    (u.email?.toLowerCase() === testEmail || u.phone === testEmail) &&
    u.password_hash === testPass && u.status !== 'deleted'
  );

  console.log('  -> Matched User:', matchedUser?.name, matchedUser?.email);
  if (!matchedUser) {
    throw new Error('Login failed: user not found by email search query!');
  }
  console.log('  ✅ Buyer login successful!\n');

  // Test 3: Create Vendor Account
  const vendorEmail = `testvendor_${timestamp}@example.com`;
  console.log('3. Testing Vendor Registration with email:', vendorEmail);
  const vendorUser = {
    name: 'Test Vendor User',
    email: vendorEmail,
    phone: `055${Math.floor(1000000 + Math.random() * 9000000)}`,
    role: 'vendor',
    location: 'Kumasi',
    is_verified: false,
    id_verified: false,
    referral_code: 'VREF' + timestamp,
    preferred_store_name: 'Test Vendor Boutique',
    preferred_store_cat: 'Fashion & Clothing',
    status: 'pending_approval',
    password_hash: testPass,
    registered_at: new Date().toISOString()
  };

  const vRegRes = await apiRequest('POST', '/api/users', vendorUser);
  console.log('  -> Vendor Registration HTTP status:', vRegRes.status);
  console.log('  -> Vendor User ID:', vRegRes.data?.id);
  if (!vRegRes.data?.id) {
    throw new Error('Vendor registration failed!');
  }
  console.log('  ✅ Vendor account creation successful!\n');

  // Test 4: Vendor Login
  console.log('4. Testing Vendor Login with email:', vendorEmail);
  const vLoginRes = await apiRequest('GET', `/api/users?search=${encodeURIComponent(vendorEmail)}&limit=10`);
  const vMatchedUser = (vLoginRes.data?.data || []).find(u =>
    (u.email?.toLowerCase() === vendorEmail || u.phone === vendorEmail) &&
    u.password_hash === testPass && u.status !== 'deleted'
  );
  console.log('  -> Matched Vendor User:', vMatchedUser?.name, vMatchedUser?.email);
  if (!vMatchedUser) {
    throw new Error('Vendor login failed!');
  }
  console.log('  ✅ Vendor login successful!\n');

  console.log('=== ALL AUTH INTEGRATION TESTS PASSED SUCCESSFULLY! ===');
}

testAuth().catch(err => {
  console.error('\n❌ AUTH TEST FAILED:', err.message);
  process.exit(1);
});
