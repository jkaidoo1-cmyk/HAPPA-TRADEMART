const http = require('http');

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost',
      port: 9000,
      path: '/api/' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function runTests() {
  console.log('=== PRODUCT UPLOAD FLOW INTEGRATION TESTS ===\n');

  // Test 1: POST Product
  console.log('Test 1: Single Product Creation');
  const dummyProduct = {
    name: 'Test Smart Watch',
    description: 'High quality smartwatch',
    price: 450,
    original_price: 500,
    store_id: 'store-1',
    vendor_id: 'vendor-1',
    category: 'Electronics',
    images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    stock_qty: 15,
    status: 'active',
    is_available: true,
    tags: ['gadget', 'watch'],
    commission_pct: 5,
    weight_kg: 0.3,
    allow_buyer_note: true,
    buyer_note_prompt: 'Specify strap color'
  };

  const res1 = await apiRequest('POST', 'products', dummyProduct);
  if (res1.status === 201 && res1.body.id) {
    console.log('  ✅ Product created successfully with ID:', res1.body.id);
  } else {
    console.error('  ❌ Product creation failed:', res1.status, res1.body);
  }

  const createdId = res1.body?.id;

  // Test 2: GET Product
  console.log('\nTest 2: Retrieve Product');
  const res2 = await apiRequest('GET', `products/${createdId}`);
  if (res2.status === 200 && res2.body && res2.body.id === createdId) {
    console.log('  ✅ Retrieved product matches created product name:', res2.body.name);
  } else {
    console.error('  ❌ Failed to retrieve created product:', res2.status, res2.body);
  }

  // Test 3: PATCH Product Edit
  console.log('\nTest 3: Edit Product');
  const editPayload = {
    name: 'Test Smart Watch (Pro Version)',
    price: 550,
    stock_qty: 20
  };
  const res3 = await apiRequest('PATCH', `products/${createdId}`, editPayload);
  if (res3.status === 200 && res3.body && res3.body.name === 'Test Smart Watch (Pro Version)') {
    console.log('  ✅ Product edit successful');
  } else {
    console.error('  ❌ Product edit failed:', res3.status, res3.body);
  }

  // Test 4: DELETE Clean up
  console.log('\nTest 4: Delete Product');
  const res4 = await apiRequest('DELETE', `products/${createdId}`);
  if (res4.status === 200 || res4.status === 204) {
    console.log('  ✅ Product cleanup successful');
  } else {
    console.error('  ❌ Product cleanup failed:', res4.status, res4.body);
  }
}

runTests().catch(console.error);
