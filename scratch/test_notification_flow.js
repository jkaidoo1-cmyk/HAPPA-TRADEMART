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
  console.log('=== STARTING NOTIFICATION SYSTEM INTEGRATION TEST ===\n');

  const testUserId = 'u-notif-test-' + Date.now();
  const notifId1 = 'n-test-1-' + Date.now();
  const notifId2 = 'n-test-2-' + Date.now();
  const globalNotifId = 'n-global-' + Date.now();

  // 1. Post notification for test user
  console.log('1. Creating notification 1 for test user...');
  const res1 = await apiRequest('POST', '/api/notifications', {
    id: notifId1,
    user_id: testUserId,
    type: 'order',
    title: '🛒 New Order!',
    message: 'Package ACC-1001 ordered',
    is_read: false,
    created_at: new Date().toISOString()
  });
  console.log('   Notification 1 status:', res1.status, 'id:', res1.data.id);
  if (res1.status !== 201) throw new Error('Failed to create notification 1');

  // 2. Post second notification with SAME title but different message (testing deduplication handling)
  console.log('\n2. Creating notification 2 for test user (same title, different message)...');
  const res2 = await apiRequest('POST', '/api/notifications', {
    id: notifId2,
    user_id: testUserId,
    type: 'order',
    title: '🛒 New Order!',
    message: 'Package ACC-1002 ordered',
    is_read: false,
    created_at: new Date().toISOString()
  });
  console.log('   Notification 2 status:', res2.status, 'id:', res2.data.id);

  // 3. Post global announcement notification
  console.log('\n3. Creating global announcement notification...');
  const resGlobal = await apiRequest('POST', '/api/notifications', {
    id: globalNotifId,
    user_id: 'global',
    type: 'system',
    title: '📢 Flash Sale Live',
    message: 'Up to 50% off all categories!',
    is_read: false,
    created_at: new Date().toISOString()
  });
  console.log('   Global notification status:', resGlobal.status, 'id:', resGlobal.data.id);

  // 4. Fetch notifications for test user
  console.log('\n4. Fetching notifications from API...');
  const fetchRes = await apiRequest('GET', '/api/notifications?limit=200');
  const allNotifs = fetchRes.data.data || fetchRes.data || [];
  const userNotifs = allNotifs.filter(n => String(n.user_id) === testUserId || n.user_id === 'global' || n.user_id === 'all');

  console.log('   Total user/global notifications fetched:', userNotifs.length);
  const found1 = userNotifs.find(n => n.id === notifId1);
  const found2 = userNotifs.find(n => n.id === notifId2);
  const foundGlobal = userNotifs.find(n => n.id === globalNotifId);

  if (!found1 || !found2) throw new Error('User notifications not retrieved properly!');
  if (!foundGlobal) throw new Error('Global notification not retrieved properly!');
  console.log('   ✅ Both distinct notifications with same title retrieved successfully');
  console.log('   ✅ Global announcement notification retrieved successfully');

  // 5. Test marking notification as read
  console.log('\n5. Testing PATCH /api/notifications/:id to mark as read...');
  const patchRes = await apiRequest('PATCH', '/api/notifications/' + notifId1, { is_read: true });
  console.log('   Patch status:', patchRes.status, 'is_read:', patchRes.data.is_read);
  if (patchRes.data.is_read !== true) throw new Error('Failed to patch is_read status!');

  // 6. Test deleting notification
  console.log('\n6. Cleaning up test notifications...');
  await apiRequest('DELETE', '/api/notifications/' + notifId1);
  await apiRequest('DELETE', '/api/notifications/' + notifId2);
  await apiRequest('DELETE', '/api/notifications/' + globalNotifId);

  console.log('\n=== ALL NOTIFICATION INTEGRATION TESTS PASSED 100% SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
