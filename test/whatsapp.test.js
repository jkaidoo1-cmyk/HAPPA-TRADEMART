const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidWhatsappNumber,
  buildOrderMessage,
  notifyVendorOfPackage
} = require('../lib/whatsapp');

const PKG = {
  id: 'pkg-1',
  package_code: 'PK-100',
  order_id: 'ord-1',
  vendor_id: 'vendor-1',
  buyer_name: 'Jane Doe',
  total: 125,
  items: [
    { name: 'Sneakers', qty: 2, price: 40 },
    { name: 'Cap', qty: 1, price: 45 }
  ]
};

test('isValidWhatsappNumber accepts E.164 numbers and rejects malformed ones', () => {
  assert.equal(isValidWhatsappNumber('+233201234567'), true);
  assert.equal(isValidWhatsappNumber('+1234567'), true);
  assert.equal(isValidWhatsappNumber('0201234567'), false); // missing +
  assert.equal(isValidWhatsappNumber('+233-201-234-567'), false); // non-digits
  assert.equal(isValidWhatsappNumber('+23320abc'), false);
  assert.equal(isValidWhatsappNumber(''), false);
  assert.equal(isValidWhatsappNumber(null), false);
});

test('buildOrderMessage includes order id, items, total and admin link', () => {
  const body = buildOrderMessage({ pkg: PKG, vendorName: 'Ama', adminBaseUrl: 'https://admin.example.com' });
  assert.match(body, /Hi Ama, new order #PK-100 from Jane Doe\./);
  assert.match(body, /Items: 2× Sneakers, 1× Cap/);
  assert.match(body, /Total: GHS125\.00/);
  assert.match(body, /Please confirm and prepare for shipment\./);
  assert.match(body, /View order: https:\/\/admin\.example\.com\/#admin-orders/);
});

test('buildOrderMessage omits the link when no admin base URL is configured', () => {
  const body = buildOrderMessage({ pkg: PKG, vendorName: 'Ama', adminBaseUrl: '' });
  assert.ok(!body.includes('View order'));
});

test('notifyVendorOfPackage skips vendors that have not opted in (no log)', async () => {
  const logs = [];
  const result = await notifyVendorOfPackage(PKG, {
    getVendor: async () => ({ id: 'vendor-1', name: 'Ama', whatsapp_phone: '+233201234567', receive_order_notifications_on_whatsapp: false }),
    log: async (rec) => { logs.push(rec); return rec; }
  });
  assert.equal(result, null);
  assert.equal(logs.length, 0);
});

test('notifyVendorOfPackage logs failed when the number is invalid', async () => {
  const logs = [];
  const result = await notifyVendorOfPackage(PKG, {
    getVendor: async () => ({ id: 'vendor-1', name: 'Ama', whatsapp_phone: '0201234567', receive_order_notifications_on_whatsapp: true }),
    log: async (rec) => { logs.push(rec); return rec; }
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error_message, /Invalid WhatsApp number/);
  assert.equal(logs.length, 1);
});

test('notifyVendorOfPackage returns null when no vendor record exists', async () => {
  const logs = [];
  const result = await notifyVendorOfPackage(PKG, {
    getVendor: async () => null,
    log: async (rec) => { logs.push(rec); return rec; }
  });
  assert.equal(result, null);
  assert.equal(logs.length, 0);
});

test('notifyVendorOfPackage logs skipped when WHATSAPP_ENABLED=false (dev/test mode)', async () => {
  process.env.WHATSAPP_ENABLED = 'false';
  try {
    const logs = [];
    const result = await notifyVendorOfPackage(PKG, {
      getVendor: async () => ({ id: 'vendor-1', name: 'Ama', whatsapp_phone: '+233201234567', receive_order_notifications_on_whatsapp: true }),
      log: async (rec) => { logs.push(rec); return rec; }
    });
    assert.equal(result.status, 'skipped');
    assert.match(result.error_message, /WHATSAPP_ENABLED=false/);
    assert.equal(logs.length, 1);
    assert.equal(result.order_id, 'ord-1');
    assert.equal(result.package_id, 'pkg-1');
    assert.equal(result.vendor_id, 'vendor-1');
    assert.equal(result.channel, 'whatsapp');
  } finally {
    delete process.env.WHATSAPP_ENABLED;
  }
});

test('notifyVendorOfPackage logs failed when credentials are missing', async () => {
  process.env.WHATSAPP_ENABLED = 'true';
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  try {
    const logs = [];
    const result = await notifyVendorOfPackage(PKG, {
      getVendor: async () => ({ id: 'vendor-1', name: 'Ama', whatsapp_phone: '+233201234567', receive_order_notifications_on_whatsapp: true }),
      log: async (rec) => { logs.push(rec); return rec; }
    });
    assert.equal(result.status, 'failed');
    assert.match(result.error_message, /not configured/);
    assert.equal(logs.length, 1);
  } finally {
    delete process.env.WHATSAPP_ENABLED;
  }
});
