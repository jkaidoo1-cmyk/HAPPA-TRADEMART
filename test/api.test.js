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
