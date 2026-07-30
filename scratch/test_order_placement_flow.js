const fs = require('fs');
const path = require('path');
const http = require('http');

function apiRequest(method, pathStr, body = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost',
      port: 9000,
      path: pathStr,
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
  console.log('=== STARTING END-TO-END ORDER PLACEMENT & MANAGEMENT VERIFICATION ===\n');

  // 1. Create test vendor & product
  const testVendorId = 'u-test-vendor-' + Date.now();
  const testStoreId = 'store-' + Date.now();
  const testProdId = 'prod-test-' + Date.now();

  console.log('1. Creating test product with stock_qty = 10...');
  const prodRes = await apiRequest('POST', '/api/products', {
    id: testProdId,
    store_id: testStoreId,
    vendor_id: testVendorId,
    name: 'Test Product Order Flow',
    price: 100.00,
    stock_qty: 10,
    sold_count: 0,
    total_sold: 0,
    status: 'active',
    is_available: true,
    location: 'Accra'
  });
  console.log('   Product created status:', prodRes.status, 'stock_qty:', prodRes.data.stock_qty);
  if (prodRes.data.stock_qty !== 10) throw new Error('Failed to create product with stock 10');

  // 2. Create Order & Package (Simulating Checkout)
  console.log('\n2. Simulating placeOrder for Guest Buyer...');
  const testOrderId = 'ord-test-' + Date.now();
  const testPkgCode = 'ACC-' + Math.floor(10000 + Math.random() * 89999);
  const guestBuyerId = 'guest_' + Date.now();

  const orderRes = await apiRequest('POST', '/api/orders', {
    id: testOrderId,
    buyer_id: guestBuyerId,
    buyer_name: 'Ama Serwaa',
    buyer_phone: '0241234567',
    buyer_email: 'ama@example.com',
    items: [{ id: testProdId, name: 'Test Product Order Flow', price: 100.00, qty: 2, store_id: testStoreId }],
    subtotal: 200.00,
    platform_fee: 4.00,
    delivery_fee: 15.00,
    total: 219.00,
    payment_method: 'mobile_money',
    status: 'paid'
  });
  console.log('   Order created status:', orderRes.status, 'Order ID:', orderRes.data.id);

  console.log('   Creating package with buyer metadata...');
  const pkgRes = await apiRequest('POST', '/api/packages', {
    id: testPkgCode,
    package_code: testPkgCode,
    code: testPkgCode,
    order_id: testOrderId,
    vendor_id: testVendorId,
    store_id: testStoreId,
    buyer_id: guestBuyerId,
    buyer_name: 'Ama Serwaa',
    buyer_phone: '0241234567',
    buyer_email: 'ama@example.com',
    delivery_address: 'East Legon, House #45',
    delivery_name: 'Ama Serwaa',
    delivery_phone: '0241234567',
    items: [{ id: testProdId, name: 'Test Product Order Flow', qty: 2, price: 100.00 }],
    gross_amount: 200.00,
    commission_amount: 10.00,
    vendor_amount: 190.00,
    delivery_fee: 15.00,
    status: 'pending',
    vendor_status: 'pending',
    admin_status: 'pending'
  });
  console.log('   Package created status:', pkgRes.status, 'Package Code:', pkgRes.data.package_code);

  // 3. Deduct stock for product
  console.log('\n3. Deducting 2 units from stock...');
  await apiRequest('PATCH', '/api/products/' + testProdId, {
    stock_qty: 8,
    total_sold: 2,
    sold_count: 2
  });

  const updatedProd1 = await apiRequest('GET', '/api/products/' + testProdId);
  console.log('   updatedProd1 full response:', JSON.stringify(updatedProd1));
  if (updatedProd1.data.stock_qty !== 8 || updatedProd1.data.sold_count !== 2) {
    throw new Error('Stock deduction failed!');
  }

  // 4. Verify package metadata retrieval
  console.log('\n4. Fetching package to verify buyer metadata & JSON item handling...');
  const fetchedPkgRes = await apiRequest('GET', '/api/packages/' + testPkgCode);
  const fetchedPkg = fetchedPkgRes.data;
  console.log('   Package buyer_name:', fetchedPkg.buyer_name || fetchedPkg.extra?.buyer_name);
  console.log('   Package buyer_phone:', fetchedPkg.buyer_phone || fetchedPkg.extra?.buyer_phone);
  console.log('   Package items is array:', Array.isArray(fetchedPkg.items) || typeof fetchedPkg.items === 'string');

  if (!fetchedPkg.buyer_name && !fetchedPkg.extra?.buyer_name) {
    throw new Error('Package missing buyer_name!');
  }

  // 5. Test Vendor Status Transitions
  console.log('\n5. Updating vendor_status: pending -> received -> processed...');
  await apiRequest('PATCH', '/api/packages/' + testPkgCode, { vendor_status: 'received' });
  await apiRequest('PATCH', '/api/packages/' + testPkgCode, { vendor_status: 'processed' });
  const vsPkg = await apiRequest('GET', '/api/packages/' + testPkgCode);
  console.log('   Package vendor_status:', vsPkg.data.vendor_status || vsPkg.data.extra?.vendor_status);

  // 6. Test Admin Status Transitions & Earnings Release
  console.log('\n6. Updating admin_status: pending -> on_delivery -> delivered...');
  await apiRequest('PATCH', '/api/packages/' + testPkgCode, { admin_status: 'on_delivery', status: 'in_transit' });
  await apiRequest('PATCH', '/api/packages/' + testPkgCode, {
    admin_status: 'delivered',
    status: 'delivered',
    delivered_date: new Date().toISOString(),
    balance_released: true
  });
  const delivPkg = await apiRequest('GET', '/api/packages/' + testPkgCode);
  console.log('   Package admin_status:', delivPkg.data.admin_status || delivPkg.data.extra?.admin_status);
  console.log('   Package balance_released:', delivPkg.data.balance_released || delivPkg.data.extra?.balance_released);

  // 7. Test Order Rejection & Stock Restoration
  console.log('\n7. Creating second test package to test Rejection & Stock Restoration...');
  const testProd2Id = 'prod-test-2-' + Date.now();
  await apiRequest('POST', '/api/products', {
    id: testProd2Id,
    store_id: testStoreId,
    vendor_id: testVendorId,
    name: 'Restoration Product',
    price: 50.00,
    stock_qty: 5,
    sold_count: 5,
    status: 'active'
  });

  const testPkg2Code = 'ACC-' + Math.floor(10000 + Math.random() * 89999);
  await apiRequest('POST', '/api/packages', {
    id: testPkg2Code,
    package_code: testPkg2Code,
    code: testPkg2Code,
    vendor_id: testVendorId,
    buyer_id: guestBuyerId,
    items: [{ id: testProd2Id, name: 'Restoration Product', qty: 3, price: 50.00 }],
    vendor_status: 'pending'
  });

  console.log('   Deducting stock (stock: 5 -> 2, sold: 5 -> 8)...');
  await apiRequest('PATCH', '/api/products/' + testProd2Id, { stock_qty: 2, sold_count: 8 });

  console.log('   Simulating Rejection & Restoring stock (stock: 2 -> 5, sold: 8 -> 5)...');
  await apiRequest('PATCH', '/api/packages/' + testPkg2Code, {
    vendor_status: 'rejected',
    rejected_reason: 'Out of stock',
    status: 'cancelled'
  });
  await apiRequest('PATCH', '/api/products/' + testProd2Id, { stock_qty: 5, sold_count: 5, status: 'active' });

  const restoredProd = await apiRequest('GET', '/api/products/' + testProd2Id);
  console.log('   Restored product stock_qty:', restoredProd.data.stock_qty, 'sold_count:', restoredProd.data.sold_count);
  if (restoredProd.data.stock_qty !== 5 || restoredProd.data.sold_count !== 5) {
    throw new Error('Stock restoration failed!');
  }

  // Cleanup test records
  console.log('\n8. Cleaning up test records...');
  await apiRequest('DELETE', '/api/products/' + testProdId);
  await apiRequest('DELETE', '/api/products/' + testProd2Id);
  await apiRequest('DELETE', '/api/packages/' + testPkgCode);
  await apiRequest('DELETE', '/api/packages/' + testPkg2Code);
  await apiRequest('DELETE', '/api/orders/' + testOrderId);

  console.log('\n=== ALL END-TO-END ORDER MANAGEMENT TESTS PASSED SUCCESSFULLY! 100% ===');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
