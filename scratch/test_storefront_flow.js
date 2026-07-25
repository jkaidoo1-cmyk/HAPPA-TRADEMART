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

async function runTests() {
  console.log('=== STARTING STOREFRONT INTEGRATION TEST ===\n');

  // Test 1: Create a brand new vendor user ID
  const testVendorId = 'u-test-vendor-' + Date.now();
  console.log('1. Testing autoCreateStoreForVendor logic for vendor:', testVendorId);
  
  const newStore = {
    id: 'store-' + testVendorId,
    name: 'Auto Approve Store',
    slug: 'auto-approve-store-' + Date.now(),
    vendor_id: testVendorId,
    status: 'active',
    storefront_status: 'none'
  };

  const storeRes = await apiRequest('POST', '/api/stores', newStore);
  console.log('  -> Store creation response status:', storeRes.status);
  console.log('  -> Store storefront_status:', storeRes.data.storefront_status);
  if (storeRes.data.storefront_status !== 'none') {
    throw new Error('FAILED: storefront_status should be "none" initially!');
  }
  console.log('  ✅ Store initialized with storefront_status = "none"\n');

  // Test 2: Fetch storefronts for new vendor
  console.log('2. Testing GET /api/storefronts for new vendor...');
  const sfGetRes = await apiRequest('GET', '/api/storefronts?limit=200');
  const vendorSF = sfGetRes.data.data.find(s => String(s.store_id) === newStore.id || String(s.vendor_id) === testVendorId);
  console.log('  -> Fetched SF status for new vendor:', vendorSF?.status);
  if (vendorSF?.status !== 'none') {
    throw new Error('FAILED: Initial storefront status should be "none" for new vendor!');
  }
  console.log('  ✅ Verified new vendor storefront status is "none" (triggers Create Storefront button)\n');

  // Test 3: Create Storefront Draft (Vendor clicks "Create Storefront")
  console.log('3. Testing vendor creating Storefront Draft (Create Storefront button)...');
  const draftRes = await apiRequest('PATCH', '/api/storefronts/sft-' + newStore.id, {
    status: 'draft',
    theme: 'modern',
    slogan: 'Best Quality Products Guaranteed'
  });
  console.log('  -> Draft response status:', draftRes.status);
  console.log('  -> Updated status:', draftRes.data.status);
  if (draftRes.data.status !== 'draft') {
    throw new Error('FAILED: Storefront status should be "draft" after creation!');
  }
  console.log('  ✅ Verified storefront status transitioned to "draft"\n');

  // Test 4: Vendor submits storefront request (clicks "Send Request")
  console.log('4. Testing vendor submitting storefront request (Send Request button)...');
  const submitRes = await apiRequest('PATCH', '/api/storefronts/sft-' + newStore.id, {
    status: 'pending_approval'
  });
  console.log('  -> Submit response status:', submitRes.status);
  console.log('  -> Updated status:', submitRes.data.status);
  if (submitRes.data.status !== 'pending_approval') {
    throw new Error('FAILED: Storefront status should be "pending_approval"!');
  }
  console.log('  ✅ Verified storefront status transitioned to "pending_approval"\n');

  // Test 5: Admin revokes / rejects storefront
  console.log('5. Testing admin revoking / rejecting storefront...');
  const rejectionReason = 'Please update logo image and storefront slogan.';
  const rejectRes = await apiRequest('PATCH', '/api/storefronts/sft-' + newStore.id, {
    status: 'rejected',
    admin_feedback: rejectionReason
  });
  console.log('  -> Reject response status:', rejectRes.status);
  console.log('  -> Updated status:', rejectRes.data.status);
  
  // Verify store record is also updated with status rejected
  const updatedStoreRes = await apiRequest('GET', '/api/stores?limit=200');
  const updatedStore = updatedStoreRes.data.data.find(s => s.id === newStore.id);
  console.log('  -> Stores table storefront_status:', updatedStore?.storefront_status);
  if (updatedStore?.storefront_status !== 'rejected') {
    throw new Error('FAILED: Stores table storefront_status was not updated to "rejected"!');
  }
  console.log('  ✅ Verified admin rejection correctly syncs to stores & storefronts tables with status "rejected"\n');

  console.log('=== ALL STOREFRONT INTEGRATION TESTS PASSED 100% SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
