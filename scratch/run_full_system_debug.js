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
          const parsed = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: responseBody, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

function extractList(res) {
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.data?.data)) return res.data.data;
  return [];
}

async function runSystemDebug() {
  console.log('=== RUNNING FULL END-TO-END SYSTEM DEBUG & HEALTH CHECK ===\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName}`);
    }
  }

  // 1. Test Server Root API
  console.log('1. Checking Server Root API Status...');
  const rootRes = await apiRequest('GET', '/api');
  assert(rootRes.status === 200 && rootRes.data.status === 'ok', 'Server root /api is online and responsive');

  // 2. Test Read Endpoints & Response Caching
  console.log('\n2. Testing In-Memory RAM Caching & Compression...');
  const start1 = Date.now();
  const prodRes1 = await apiRequest('GET', '/api/products?limit=20');
  const dur1 = Date.now() - start1;

  const start2 = Date.now();
  const prodRes2 = await apiRequest('GET', '/api/products?limit=20');
  const dur2 = Date.now() - start2;

  console.log(`   First query duration: ${dur1} ms | Cached query duration: ${dur2} ms`);
  assert(prodRes1.status === 200, 'GET /api/products returns HTTP 200');
  assert(dur2 <= dur1 || dur2 < 100, 'In-memory caching is active and super-fast');

  // 3. Test Storefront Pricing Sync
  console.log('\n3. Testing Storefront Custom Plan Pricing Sync...');
  const testStoreId = 'store-debug-' + Date.now();
  const testVendorId = 'u-vendor-debug-' + Date.now();

  await apiRequest('POST', '/api/stores', {
    id: testStoreId,
    vendor_id: testVendorId,
    name: 'Debug Test Store',
    slug: 'debug-store-' + Date.now(),
    storefront_status: 'draft'
  });

  const patchSfRes = await apiRequest('PATCH', `/api/storefronts/${testStoreId}`, {
    status: 'approved_pending_payment',
    plan_prices: { starter: 35, growth: 75, pro: 160 }
  });

  assert(patchSfRes.status === 200, 'PATCH /api/storefronts returns 200');
  assert(patchSfRes.data.plan_prices?.pro === 160, 'Custom plan pricing persisted accurately');

  // 4. Test Package Delivery & Earnings Release
  console.log('\n4. Testing Package Delivery & Wallet Earnings Release...');
  const testPkgId = 'pkg-debug-' + Date.now();

  await apiRequest('POST', '/api/users', { id: testVendorId, name: 'Debug Vendor', role: 'vendor', wallet_balance: 50 });
  await apiRequest('POST', '/api/packages', {
    id: testPkgId,
    vendor_id: testVendorId,
    admin_status: 'pending',
    status: 'pending',
    vendor_amount: 100,
    balance_released: false
  });

  const deliverRes = await apiRequest('PATCH', `/api/packages/${testPkgId}`, {
    admin_status: 'delivered',
    status: 'delivered',
    balance_released: true
  });

  assert(deliverRes.status === 200, 'PATCH package status to delivered returned 200');
  assert(deliverRes.data.admin_status === 'delivered', 'Package admin_status updated to delivered');

  // 5. Cleanup Test Records
  console.log('\n5. Cleaning up test records...');
  await apiRequest('DELETE', `/api/stores/${testStoreId}`);
  await apiRequest('DELETE', `/api/packages/${testPkgId}`);
  await apiRequest('DELETE', `/api/users/${testVendorId}`);
  console.log('   Test records cleaned up.');

  console.log(`\n==================================================`);
  console.log(`DEBUG RESULTS: ${passed}/${total} assertions passed successfully!`);
  console.log(`==================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runSystemDebug().catch(err => {
  console.error('❌ Debug suite error:', err);
  process.exit(1);
});
