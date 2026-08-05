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

async function testProductUpload() {
  console.log('Testing Single Product Upload...');
  const testProduct = {
    name: 'Test Product Upload ' + Date.now(),
    description: 'A test product description',
    price: 1500,
    original_price: 2000,
    store_id: 'store-1',
    vendor_id: 'vendor-1',
    category: 'Electronics',
    images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    stock_qty: 10,
    sold_count: 0,
    views: 0,
    avg_rating: 0,
    review_count: 0,
    location: 'Main Campus',
    is_flash_sale: false,
    status: 'active',
    is_available: true,
    tags: ['test'],
    commission_pct: 5,
    weight_kg: 0.5,
    allow_buyer_note: false,
    buyer_note_prompt: ''
  };

  const res = await apiRequest('POST', 'products', testProduct);
  console.log('Response Status:', res.status);
  console.log('Response Body:', res.body);

  if (res.status === 201 || res.status === 200) {
    console.log('Single product upload test PASSED');
  } else {
    console.error('Single product upload test FAILED');
  }

  if (res.body && res.body.id) {
    console.log('Cleaning up created product:', res.body.id);
    await apiRequest('DELETE', 'products/' + res.body.id);
  }
}

testProductUpload().catch(console.error);
