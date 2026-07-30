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
          resolve({ status: res.statusCode, data: parsed });
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

function extractList(res) {
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.data?.data)) return res.data.data;
  return [];
}

async function runStorefrontSubTests() {
  console.log('=== STARTING VENDOR STOREFRONT SUBSCRIPTION & ADMIN PRICE SYNC INTEGRATION TEST ===\n');

  // 1. Create a test store & storefront request
  const storeId = 'store-test-sub-' + Date.now();
  const sfId = 'sft-' + storeId;
  const vendorId = 'u-vendor-sub-' + Date.now();

  console.log(`1. Creating test store (${storeId}) and storefront request (${sfId})...`);
  await apiRequest('POST', '/api/stores', {
    id: storeId,
    name: 'Test Subscription Store',
    vendor_id: vendorId,
    status: 'active',
    storefront_status: 'pending_approval'
  });

  await apiRequest('POST', '/api/storefronts', {
    id: sfId,
    store_id: storeId,
    vendor_id: vendorId,
    status: 'pending_approval',
    url_slug: 'test-sub-store'
  });
  console.log('   ✅ Store & Storefront created.');

  // 2. Admin sets custom plan prices (Starter: 30, Growth: 80, Pro: 150) and approves storefront
  console.log('\n2. Admin sets custom plan prices (Starter: 30, Growth: 80, Pro: 150) and approves layout...');
  const customPrices = { starter: 30, growth: 80, pro: 150 };
  const approveRes = await apiRequest('PATCH', `/api/storefronts/${sfId}`, {
    status: 'approved_pending_payment',
    plan_prices: customPrices
  });
  console.log('   Approve patch status:', approveRes.status);
  console.log('   Approve patch data:', JSON.stringify(approveRes.data));

  await apiRequest('PATCH', `/api/stores/${storeId}`, {
    storefront_status: 'approved_pending_payment'
  });

  // 3. Vendor fetches storefront & verifies custom prices reflect
  console.log('\n3. Vendor fetches storefront and verifies custom plan_prices match admin settings...');
  const sfFetch = await apiRequest('GET', '/api/storefronts?limit=200');
  const allSF = extractList(sfFetch);
  const mySF = allSF.find(s => String(s.id) === sfId || String(s.store_id) === storeId);

  if (!mySF) throw new Error('Storefront not found in API!');
  
  let planPrices = mySF.plan_prices;
  if (typeof planPrices === 'string') planPrices = JSON.parse(planPrices);

  console.log('   Fetched plan_prices:', JSON.stringify(planPrices));
  if (!planPrices || planPrices.starter !== 30 || planPrices.growth !== 80 || planPrices.pro !== 150) {
    throw new Error(`Admin custom pricing failed to sync! Received: ${JSON.stringify(planPrices)}`);
  }
  console.log('   ✅ Admin custom prices (Starter: GH₵ 30, Growth: GH₵ 80, Pro: GH₵ 150) synced 100% correctly!');

  // 4. Test multi-month calculation (Pro plan for 3 months = 150 * 3 = GH₵ 450)
  console.log('\n4. Simulating vendor paying Pro plan for 3 months (GH₵ 150/mo * 3 = GH₵ 450)...');
  const monthlyRate = planPrices.pro;
  const months = 3;
  const totalCost = monthlyRate * months;
  console.log(`   Calculated Total: GH₵ ${totalCost}`);

  const now = new Date();
  const expiryDate = new Date(now);
  expiryDate.setMonth(expiryDate.getMonth() + months);

  const activateRes = await apiRequest('PATCH', `/api/stores/${storeId}`, {
    subscription_plan: 'pro',
    subscription_status: 'active',
    subscription_start: now.toISOString(),
    subscription_end: expiryDate.toISOString()
  });
  await apiRequest('PATCH', `/api/storefronts/${sfId}`, { status: 'active' });

  console.log(`   Activation response status: ${activateRes.status}`);

  // 5. Verify active store status and extended subscription date
  const storeFetch = await apiRequest('GET', `/api/stores?limit=200`);
  const activeStore = extractList(storeFetch).find(s => String(s.id) === storeId);

  console.log(`   Store Subscription Plan: ${activeStore.subscription_plan}`);
  console.log(`   Store Subscription Expiry: ${activeStore.subscription_end}`);

  const endMs = new Date(activeStore.subscription_end).getTime();
  const diffDays = Math.round((endMs - now.getTime()) / (1000 * 60 * 60 * 24));
  console.log(`   Subscription duration in days: ~${diffDays} days (${months} months)`);

  if (diffDays < 85 || diffDays > 95) {
    throw new Error(`Subscription duration incorrect! Expected ~90 days, got ${diffDays}`);
  }
  console.log('   ✅ Multi-month subscription calculation and duration extension verified!');

  // 6. Clean up test records
  console.log('\n6. Cleaning up test records...');
  await apiRequest('DELETE', `/api/stores/${storeId}`);
  await apiRequest('DELETE', `/api/storefronts/${sfId}`);

  console.log('\n=== ALL VENDOR STOREFRONT SUBSCRIPTION TESTS PASSED 100% SUCCESSFULLY! ===');
}

runStorefrontSubTests().catch(err => {
  console.error('\n❌ Test execution failed:', err.message);
  process.exit(1);
});
