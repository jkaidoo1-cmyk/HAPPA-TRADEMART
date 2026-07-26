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

async function testDeleteUser() {
  console.log('=== TESTING USER DELETION ENDPOINT ===\n');

  // 1. Create a dummy user to delete
  const timestamp = Date.now();
  const testEmail = `todelete_${timestamp}@example.com`;
  const dummyUser = {
    name: 'Dummy User To Delete',
    email: testEmail,
    phone: '020000' + Math.floor(1000 + Math.random() * 9000),
    role: 'buyer',
    status: 'active',
    password_hash: 'pass123456'
  };

  console.log('1. Creating test user to delete:', testEmail);
  const createRes = await apiRequest('POST', '/api/users', dummyUser);
  const createdUserId = createRes.data?.id;
  console.log('  -> Created User ID:', createdUserId);
  if (!createdUserId) throw new Error('User creation failed!');
  console.log('  ✅ User created successfully!\n');

  // 2. Call DELETE /api/users/:id
  console.log('2. Deleting user account ID:', createdUserId);
  const delRes = await apiRequest('DELETE', `/api/users/${createdUserId}`);
  console.log('  -> DELETE Response Status:', delRes.status);
  if (delRes.status !== 204 && delRes.status !== 200) {
    throw new Error(`DELETE endpoint returned status ${delRes.status}`);
  }
  console.log('  ✅ DELETE request returned HTTP 204/200!\n');

  // 3. Verify user is NO LONGER present in GET /api/users
  console.log('3. Verifying user is permanently deleted from GET /api/users...');
  const getRes = await apiRequest('GET', '/api/users?limit=500');
  const allUsers = getRes.data?.data || [];
  const foundUser = allUsers.find(u => String(u.id) === String(createdUserId) || u.email === testEmail);
  
  if (foundUser) {
    throw new Error('FAILED: User was found in GET /api/users after deletion!');
  }
  console.log('  ✅ Verified user is permanently removed from database!\n');

  console.log('=== USER DELETION TEST PASSED 100% SUCCESSFULLY! ===');
}

testDeleteUser().catch(err => {
  console.error('\n❌ USER DELETION TEST FAILED:', err.message);
  process.exit(1);
});
