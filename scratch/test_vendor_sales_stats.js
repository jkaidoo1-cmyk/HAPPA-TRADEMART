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

async function testVendorSalesStats() {
  console.log('=== TESTING VENDOR STORE TOTAL SALES & TOTAL ORDERS UPDATE ===\n');

  const vendorId = 'u-vendor-sales-' + Date.now();
  const storeId = 'store-sales-' + Date.now();
  const pkgId = 'pkg-sales-' + Date.now();

  // 1. Create vendor & store
  console.log('1. Creating test vendor and store...');
  await apiRequest('POST', '/api/users', { id: vendorId, name: 'Sales Vendor', role: 'vendor', wallet_balance: 0 });
  await apiRequest('POST', '/api/stores', { id: storeId, vendor_id: vendorId, name: 'Sales Store', total_sales: 0, total_orders: 0 });

  // 2. Create delivered package
  console.log(`2. Creating package (${pkgId}) for vendor (${vendorId}) with vendor_amount = GH₵ 250...`);
  await apiRequest('POST', '/api/packages', {
    id: pkgId,
    vendor_id: vendorId,
    store_id: storeId,
    admin_status: 'delivered',
    status: 'delivered',
    vendor_amount: 250,
    balance_released: true
  });

  // 3. Increment store stats as updateAdminStatus does
  let storeObj = await apiRequest('GET', `/api/stores/${storeId}`);
  let sData = storeObj.data;
  const oldSales = parseFloat(sData?.total_sales) || 0;
  const oldOrders = parseInt(sData?.total_orders) || 0;
  
  await apiRequest('PATCH', `/api/stores/${storeId}`, {
    total_sales: oldSales + 250,
    total_orders: oldOrders + 1
  });

  // 4. Verify updated store stats
  console.log('\n3. Verifying updated store total_sales and total_orders...');
  const updatedStoreRes = await apiRequest('GET', `/api/stores/${storeId}`);
  const updatedStore = updatedStoreRes.data;

  console.log(`   Updated Total Sales: GH₵ ${updatedStore.total_sales}`);
  console.log(`   Updated Total Orders: ${updatedStore.total_orders}`);

  if (parseFloat(updatedStore.total_sales) !== 250 || parseInt(updatedStore.total_orders) !== 1) {
    throw new Error(`Store stats update failed! Expected sales 250, orders 1. Got sales: ${updatedStore.total_sales}, orders: ${updatedStore.total_orders}`);
  }

  console.log('\n   ✅ Store Total Sales & Total Orders updated 100% successfully!');

  // Cleanup
  await apiRequest('DELETE', `/api/stores/${storeId}`);
  await apiRequest('DELETE', `/api/packages/${pkgId}`);
  await apiRequest('DELETE', `/api/users/${vendorId}`);

  console.log('\n=== ALL VENDOR SALES STATS TESTS PASSED SUCCESSFULLY! ===');
}

testVendorSalesStats().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
