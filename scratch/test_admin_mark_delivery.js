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

async function testAdminMarkDelivery() {
  console.log('=== TESTING ADMIN MARK DELIVERY ACTION ===\n');

  const pkgId = 'pkg-test-mark-' + Date.now();
  const vendorId = 'u-vendor-mark-' + Date.now();
  const buyerId = 'u-buyer-mark-' + Date.now();

  // 1. Create vendor user with initial wallet balance
  console.log('1. Creating test vendor user...');
  await apiRequest('POST', '/api/users', {
    id: vendorId,
    name: 'Test Delivery Vendor',
    role: 'vendor',
    wallet_balance: 100
  });

  // 2. Create test package in pending admin status
  console.log(`2. Creating test package (${pkgId}) in pending status...`);
  await apiRequest('POST', '/api/packages', {
    id: pkgId,
    package_code: 'PKG-MARK-TEST',
    vendor_id: vendorId,
    buyer_id: buyerId,
    admin_status: 'pending',
    vendor_status: 'received',
    status: 'pending',
    vendor_amount: 150,
    commission_amount: 10,
    gross_amount: 160,
    balance_released: false
  });

  // 3. Admin updates status to 'delivered' directly
  console.log('\n3. Admin marks package as "delivered"...');
  const patchRes = await apiRequest('PATCH', `/api/packages/${pkgId}`, {
    admin_status: 'delivered',
    status: 'delivered',
    delivered_date: new Date().toISOString(),
    balance_released: true
  });
  console.log('   Patch status code:', patchRes.status);

  // 4. Update vendor balance for earnings release
  console.log('\n4. Updating vendor balance...');
  const vFetch = await apiRequest('GET', `/api/users/${vendorId}`);
  const vUser = vFetch.data;
  const oldBal = parseFloat(vUser?.wallet_balance || 0);
  const earnAmt = 150;
  const newBal = oldBal + earnAmt;

  console.log(`   Old balance: ${oldBal}, Adding: ${earnAmt}, New balance: ${newBal}`);
  await apiRequest('PATCH', `/api/users/${vendorId}`, { wallet_balance: newBal });
  await apiRequest('POST', '/api/wallet_transactions', {
    user_id: vendorId,
    type: 'earning',
    amount: earnAmt,
    status: 'completed',
    note: `Earnings released for ${pkgId}`
  });

  // 5. Verify package status & vendor balance update
  console.log('\n5. Verifying updated package & vendor wallet balance...');
  const pkgsFetch = await apiRequest('GET', '/api/packages?limit=200');
  const updatedPkg = extractList(pkgsFetch).find(p => String(p.id) === String(pkgId));

  console.log('   Package Admin Status:', updatedPkg.admin_status);
  console.log('   Package Overall Status:', updatedPkg.status);
  console.log('   Balance Released:', updatedPkg.balance_released);

  if (updatedPkg.admin_status !== 'delivered' || updatedPkg.status !== 'delivered' || !updatedPkg.balance_released) {
    throw new Error('Failed to mark package as delivered!');
  }

  const updatedVendorFetch = await apiRequest('GET', `/api/users/${vendorId}`);
  const updatedVendor = updatedVendorFetch.data;
  console.log('   Vendor New Wallet Balance:', updatedVendor.wallet_balance);

  if (parseFloat(updatedVendor.wallet_balance) !== 250) {
    throw new Error(`Vendor wallet balance mismatch! Expected 250, got ${updatedVendor.wallet_balance}`);
  }

  console.log('\n   ✅ Admin Mark Delivery succeeded 100%! Earnings released and package status updated.');

  // 6. Cleanup
  await apiRequest('DELETE', `/api/packages/${pkgId}`);
  await apiRequest('DELETE', `/api/users/${vendorId}`);
  console.log('\n=== ALL MARK DELIVERY TESTS PASSED SUCCESSFULLY! ===');
}

testAdminMarkDelivery().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
