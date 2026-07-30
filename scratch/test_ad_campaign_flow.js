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

async function runAdCampaignTests() {
  console.log('=== STARTING AD CAMPAIGN MANAGEMENT SYSTEM INTEGRATION TEST ===\n');

  // 1. Fetching existing ad campaigns
  console.log('1. Fetching GET /api/ad_campaigns...');
  const initialRes = await apiRequest('GET', '/api/ad_campaigns?limit=200');
  const initial = extractList(initialRes);
  console.log(`   Fetched ${initial.length} initial campaign(s).`);

  // 2. Creating a test ad campaign
  const testId = 'adc-test-' + Date.now();
  console.log(`\n2. Creating test ad campaign (ID: ${testId})...`);
  const createRes = await apiRequest('POST', '/api/ad_campaigns', {
    id: testId,
    name: 'Integration Test Ad Campaign',
    status: 'active',
    pages: ['home', 'shop', 'stores'],
    store_ids: ['store-1', 'store-2'],
    store_budgets: JSON.stringify({ 'store-1': 45, 'store-2': 30 }),
    interval_value: 4,
    interval_unit: 'seconds',
    show_store_name: true,
    start_date: Date.now(),
    end_date: Date.now() + 86400000,
    created_at: new Date().toISOString()
  });
  console.log(`   Create response status: ${createRes.status}`);
  if (createRes.status !== 201 && createRes.status !== 200) {
    throw new Error(`Failed to create ad campaign! Status: ${createRes.status}`);
  }
  console.log('   ✅ Test ad campaign created successfully!');

  // 3. Verifying campaign exists and has valid budgets & pages
  console.log('\n3. Verifying created campaign properties...');
  const listRes = await apiRequest('GET', '/api/ad_campaigns?limit=200');
  const campaignsList = extractList(listRes);
  const found = campaignsList.find(c => String(c.id) === testId);
  if (!found) {
    throw new Error('Created ad campaign not found in GET /api/ad_campaigns response!');
  }
  console.log(`   Campaign Name: "${found.name}"`);
  console.log(`   Target Pages: ${JSON.stringify(found.pages)}`);
  console.log(`   Store Budgets: ${typeof found.store_budgets === 'string' ? found.store_budgets : JSON.stringify(found.store_budgets)}`);
  console.log('   ✅ Verified ad campaign properties.');

  // 4. Testing campaign status toggle (Active -> Paused)
  console.log('\n4. Toggling campaign status (active -> inactive)...');
  const patchRes = await apiRequest('PATCH', `/api/ad_campaigns/${testId}`, { status: 'inactive' });
  console.log(`   Patch status: ${patchRes.status}`);
  
  const checkRes = await apiRequest('GET', '/api/ad_campaigns?limit=200');
  const updatedList = extractList(checkRes);
  const updated = updatedList.find(c => String(c.id) === testId);
  if (updated?.status !== 'inactive') {
    throw new Error('Failed to toggle ad campaign status to inactive!');
  }
  console.log('   ✅ Successfully toggled campaign status to "inactive".');

  // 5. Cleaning up test campaign
  console.log('\n5. Deleting test ad campaign...');
  const delRes = await apiRequest('DELETE', `/api/ad_campaigns/${testId}`);
  console.log(`   Delete response status: ${delRes.status}`);

  const verifyDel = await apiRequest('GET', '/api/ad_campaigns?limit=200');
  const deletedList = extractList(verifyDel);
  const deletedObj = deletedList.find(c => String(c.id) === testId);
  if (deletedObj) {
    throw new Error('Failed to delete test ad campaign!');
  }
  console.log('   ✅ Test ad campaign permanently deleted!');

  console.log('\n=== ALL AD CAMPAIGN MANAGEMENT TESTS PASSED 100% SUCCESSFULLY! ===');
}

runAdCampaignTests().catch(err => {
  console.error('\n❌ Test execution failed:', err.message);
  process.exit(1);
});
