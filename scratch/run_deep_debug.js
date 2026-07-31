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

async function GET(path) { return apiRequest('GET', path); }
async function POST(path, body) { return apiRequest('POST', path, body); }
async function PATCH(path, body) { return apiRequest('PATCH', path, body); }

function pass(msg) { console.log(`   ✅ ${msg}`); }
function fail(msg) { console.log(`   ❌ ${msg}`); }
function info(msg) { console.log(`   ℹ️  ${msg}`); }
function warn(msg) { console.log(`   ⚠️  ${msg}`); }

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         HAPPA TRADEMART — DEEP DEBUG SUITE           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  let issues = [];

  // ─── 1. SERVER HEALTH ─────────────────────────────────────────
  console.log('1. SERVER HEALTH');
  try {
    const r = await GET('products?limit=1');
    if (r.status === 200) pass('Server is online (port 9000)');
    else { fail(`Server returned ${r.status}`); issues.push('Server unhealthy'); }
  } catch(e) { fail('Server is OFFLINE — run `node server.js` first'); process.exit(1); }

  // ─── 2. CORE TABLES ───────────────────────────────────────────
  console.log('\n2. CORE TABLE CHECKS');
  const tables = ['products','stores','users','packages','orders','ad_campaigns','settings','coupons'];
  for (const t of tables) {
    const r = await GET(`${t}?limit=200`);
    const count = r.body?.data?.length ?? r.body?.length ?? 0;
    if (r.status === 200) pass(`${t}: ${count} record(s)`);
    else { fail(`${t}: HTTP ${r.status}`); issues.push(`Table ${t} unavailable`); }
  }

  // ─── 3. AD CAMPAIGNS ──────────────────────────────────────────
  console.log('\n3. AD CAMPAIGN CHECKS');
  const adsR = await GET('ad_campaigns?limit=100');
  const campaigns = adsR.body?.data || [];
  if (!campaigns.length) {
    warn('No ad campaigns found in database');
    issues.push('No ad campaigns exist — ads will not play');
  } else {
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    campaigns.forEach(c => {
      const start = Number(c.start_date) || 0;
      const end   = Number(c.end_date)   || Infinity;
      const effectiveStart = (start > now && start <= now + 86400000) ? todayStart.getTime() : start;
      const isActive  = c.status === 'active';
      const inWindow  = now >= effectiveStart && now <= end;
      const storeIds  = Array.isArray(c.store_ids) ? c.store_ids : (typeof c.store_ids === 'string' ? (() => { try { return JSON.parse(c.store_ids); } catch(_) { return []; } })() : []);
      const pages     = Array.isArray(c.pages) ? c.pages : (typeof c.pages === 'string' ? (() => { try { return JSON.parse(c.pages); } catch(_) { return []; } })() : []);
      const icon = isActive && inWindow ? '✅' : '⚠️';
      console.log(`   ${icon} Campaign: "${c.name}" | status=${c.status} | in-window=${inWindow} | stores=${storeIds.length} | pages=${pages.join(',')}`);
      if (!isActive) { warn(`  → Campaign "${c.name}" is not active — set status=active`); issues.push(`Campaign "${c.name}" inactive`); }
      if (!inWindow) { warn(`  → Campaign "${c.name}" date window invalid (start=${c.start_date}, end=${c.end_date}, now=${now})`); issues.push(`Campaign "${c.name}" date window invalid`); }
      if (!storeIds.length) { warn(`  → Campaign "${c.name}" has no stores selected`); issues.push(`Campaign "${c.name}" has no stores`); }
      if (!pages.length)    { warn(`  → Campaign "${c.name}" has no pages selected`); issues.push(`Campaign "${c.name}" has no pages`); }
    });
  }

  // ─── 4. PRODUCTS vs CAMPAIGN STORE IDs ────────────────────────
  console.log('\n4. CAMPAIGN STORE ↔ PRODUCT MATCH');
  const prodsR  = await GET('products?limit=300');
  const products = prodsR.body?.data || [];
  const storesR  = await GET('stores?limit=200');
  const stores   = storesR.body?.data || [];
  if (campaigns.length && products.length) {
    for (const c of campaigns) {
      const storeIds = Array.isArray(c.store_ids) ? c.store_ids : (typeof c.store_ids === 'string' ? (() => { try { return JSON.parse(c.store_ids); } catch(_) { return []; } })() : []);
      for (const sid of storeIds) {
        const matched = products.filter(p => String(p.store_id) === String(sid) && p.status !== 'archived');
        const store = stores.find(s => String(s.id) === String(sid));
        if (matched.length > 0) {
          pass(`Store "${store?.name || sid}" has ${matched.length} eligible product(s) for campaign "${c.name}"`);
        } else {
          warn(`Store "${store?.name || sid}" (id=${sid}) has NO eligible products — ad will fallback to platform products`);
          issues.push(`Campaign "${c.name}": store ${sid} has no products`);
        }
      }
    }
  } else {
    if (!products.length) { fail('No products in database'); issues.push('No products'); }
    else info(`${products.length} products, ${campaigns.length} campaigns`);
  }

  // ─── 5. ORDERS / PACKAGES ─────────────────────────────────────
  console.log('\n5. ORDERS & PACKAGES');
  const pkgsR = await GET('packages?limit=100');
  const pkgs  = pkgsR.body?.data || [];
  info(`${pkgs.length} total package(s) in database`);
  if (pkgs.length) {
    const byStatus = {};
    pkgs.forEach(p => { byStatus[p.vendor_status || 'unknown'] = (byStatus[p.vendor_status || 'unknown'] || 0) + 1; });
    Object.entries(byStatus).forEach(([s,n]) => info(`  vendor_status=${s}: ${n}`));
    const missingBuyer = pkgs.filter(p => !p.buyer_name && !p.buyer_phone);
    if (missingBuyer.length) { warn(`${missingBuyer.length} package(s) missing buyer_name/buyer_phone`); issues.push(`${missingBuyer.length} packages missing buyer info`); }
    else pass('All packages have buyer contact info');
  }

  // ─── 6. DELIVERY FEE BYPASS ───────────────────────────────────
  console.log('\n6. DELIVERY FEE BYPASS');
  const fs = require('fs');
  const appJs = fs.readFileSync('js/app.js','utf8');
  if (appJs.includes('return { rate: 0')) pass('calcDelivery returns rate:0 (fee bypassed)');
  else { fail('calcDelivery may NOT be returning rate:0'); issues.push('Delivery fee bypass not applied'); }

  // ─── 7. CART & CHECKOUT DELIVERY ROW ──────────────────────────
  console.log('\n7. HIDDEN DELIVERY FEE UI');
  const cartJs     = fs.readFileSync('js/cart.js','utf8');
  const checkoutJs = fs.readFileSync('js/checkout.js','utf8');
  if (cartJs.includes('Estimated Delivery row hashed out')) pass('Cart: Delivery Fee row hidden');
  else { fail('Cart: Delivery Fee row is still visible'); issues.push('Cart delivery fee row still visible'); }
  if (checkoutJs.includes('Delivery Fee row hashed out')) pass('Checkout: Delivery Fee row hidden');
  else { fail('Checkout: Delivery Fee row is still visible'); issues.push('Checkout delivery fee row still visible'); }

  // ─── 8. VENDOR DELIVERY INFO ──────────────────────────────────
  console.log('\n8. VENDOR ORDER DELIVERY INFO');
  const ordersJs = fs.readFileSync('js/orders.js','utf8');
  if (ordersJs.includes('Customer Delivery Details')) pass('Vendor order cards show Customer Delivery Details block');
  else { fail('Customer Delivery Details block missing from vendor orders'); issues.push('Vendor orders missing delivery info'); }

  // ─── 9. WALLET BALANCE SYNC ───────────────────────────────────
  console.log('\n9. WALLET BALANCE SYNC');
  const usersR = await GET('users?limit=200');
  const users  = usersR.body?.data || [];
  const vendors = users.filter(u => u.role === 'vendor');
  const negBalances = vendors.filter(u => (parseFloat(u.wallet_balance)||0) < 0);
  if (negBalances.length) { warn(`${negBalances.length} vendor(s) with negative wallet balance`); issues.push(`${negBalances.length} vendors with negative wallet`); }
  else pass(`All ${vendors.length} vendor(s) have non-negative wallet balances`);

  // ─── 10. COUPON SETTINGS ──────────────────────────────────────
  console.log('\n10. COUPONS');
  const settR   = await GET('settings?key=coupons');
  const couponRow = (settR.body?.data || []).find(r => r.key === 'coupons');
  if (couponRow) {
    try {
      const coupons = JSON.parse(couponRow.value);
      pass(`${coupons.length} coupon(s) configured`);
    } catch(e) { fail('Coupon JSON invalid'); issues.push('Coupon JSON parse error'); }
  } else info('No coupons configured');

  // ─── SUMMARY ──────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  if (issues.length === 0) {
    console.log('║  ✅  ALL CHECKS PASSED — SYSTEM FULLY HEALTHY        ║');
  } else {
    console.log(`║  ⚠️   ${issues.length} ISSUE(S) FOUND:${' '.repeat(Math.max(0, 36 - String(issues.length).length))}║`);
    issues.forEach((iss, i) => console.log(`║  ${i+1}. ${iss.substring(0,48).padEnd(49)}║`));
  }
  console.log('╚══════════════════════════════════════════════════════╝\n');
}

main().catch(e => { console.error('Fatal debug error:', e); process.exit(1); });
