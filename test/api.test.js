const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/index.js');

test('product insert candidates fall back to a minimal payload when the schema is slim', () => {
  const candidates = api.getRecordCandidatesForTable('products', {
    id: 'p1',
    name: 'Sneakers',
    description: 'Lightweight sneakers',
    price: 120,
    original_price: 150,
    store_id: 'store-1',
    vendor_id: 'vendor-1',
    category: 'Sneakers',
    images: ['img1'],
    stock_qty: 5,
    sold_count: 0,
    views: 0,
    avg_rating: 0,
    review_count: 0,
    location: 'Accra',
    campus: 'Legon',
    is_flash_sale: true,
    flash_sale_end: '',
    status: 'active',
    tags: ['sale'],
    commission_pct: 4,
    weight_kg: 0.8,
    allow_buyer_note: true,
    buyer_note_prompt: 'Select your size',
    is_available: true,
    unknown_field: 'ignored'
  });

  assert.ok(candidates.length >= 2);
  assert.equal(candidates[0].name, 'Sneakers');
  assert.equal(candidates[0].weight_kg, 0.8);
  assert.equal(candidates[0].unknown_field, undefined);
  assert.equal(candidates[1].name, 'Sneakers');
  assert.equal(candidates[1].weight_kg, undefined);
  assert.equal(candidates[1].images[0], 'img1');
  assert.equal(candidates[1].unknown_field, undefined);
});

test('storefront packages preserve source and delivery metadata for vendor processing', () => {
  const prepared = api.prepareRecordForDb('packages', {
    id: 'pkg-1',
    package_code: 'PK-100',
    store_id: 'store-1',
    vendor_id: 'vendor-1',
    buyer_id: 'buyer-1',
    buyer_name: 'Jane Doe',
    buyer_phone: '0241234567',
    delivery_name: 'Jane Doe',
    delivery_phone: '0241234567',
    delivery_address: 'Home 2, East Legon',
    delivery_location: 'Accra',
    order_source: 'storefront',
    storefront_id: 'store-1',
    storefront_name: 'Jane Boutique',
    total_amount: 125,
    platform_fee: 1.25,
    vendor_status: 'accepted',
    admin_status: 'vendor_controlled',
    balance_released: true
  });

  const serialized = api.serializeRecord(prepared);

  assert.equal(serialized.order_source, 'storefront');
  assert.equal(serialized.storefront_id, 'store-1');
  assert.equal(serialized.storefront_name, 'Jane Boutique');
  assert.equal(serialized.buyer_name, 'Jane Doe');
  assert.equal(serialized.buyer_phone, '0241234567');
  assert.equal(serialized.delivery_name, 'Jane Doe');
  assert.equal(serialized.delivery_phone, '0241234567');
  assert.equal(serialized.delivery_address, 'Home 2, East Legon');
  assert.equal(serialized.delivery_location, 'Accra');
  assert.equal(serialized.total_amount, 125);
  assert.equal(serialized.platform_fee, 1.25);
  assert.equal(serialized.vendor_status, 'accepted');
  assert.equal(serialized.admin_status, 'vendor_controlled');
  assert.equal(serialized.balance_released, true);
});

test('wallet transactions preserve ledger metadata without leaking store-only aliases', () => {
  const prepared = api.prepareRecordForDb('wallet_transactions', {
    id: 'txn-1',
    user_id: 'u-1',
    type: 'withdrawal',
    amount: 100,
    balance_before: 450,
    balance_after: 350,
    payment_method: 'mobile_money',
    payment_ref: 'WD-123',
    status: 'pending',
    note: 'Withdrawal pending review',
    network: 'MTN Mobile Money',
    account_number: '0241234567',
    reviewed_by: 'admin-1'
  });

  const serialized = api.serializeRecord(prepared);

  assert.equal(serialized.user_id, 'u-1');
  assert.equal(serialized.type, 'withdrawal');
  assert.equal(serialized.amount, 100);
  assert.equal(serialized.balance_before, 450);
  assert.equal(serialized.balance_after, 350);
  assert.equal(serialized.payment_method, 'mobile_money');
  assert.equal(serialized.status, 'pending');
  assert.equal(serialized.note, 'Withdrawal pending review');
  assert.equal(serialized.network, 'MTN Mobile Money');
  assert.equal(serialized.account_number, '0241234567');
  assert.equal(serialized.reviewed_by, 'admin-1');
  assert.equal(serialized.payment_ref, 'WD-123');
  assert.equal(serialized.about_us, undefined);
});
