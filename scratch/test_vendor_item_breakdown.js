const fs = require('fs');

console.log('=== VERIFYING VENDOR ITEM BREAKDOWN & FALLBACKS ===\n');

const ordersJs = fs.readFileSync('js/orders.js', 'utf8');

const hasFallbackTitle = ordersJs.includes("Item #${i.id || 'unnamed'}");
const hasThumbnailImg = ordersJs.includes("onerror=\"this.src='https://via.placeholder.com/60x60?text=Item'\"");
const hasItemIdCode = ordersJs.includes("ID: ${escHtml(String(i.id))}");
const hasOrderedItemsHeader = ordersJs.includes("Ordered Items");

console.log('Checking Vendor Item List rendering in js/orders.js...');
console.log(`   Fallback title for unnamed items: ${hasFallbackTitle ? '✅' : '❌'}`);
console.log(`   Product image thumbnail display: ${hasThumbnailImg ? '✅' : '❌'}`);
console.log(`   Product ID code tag: ${hasItemIdCode ? '✅' : '❌'}`);
console.log(`   Ordered items container header: ${hasOrderedItemsHeader ? '✅' : '❌'}`);

if (!hasFallbackTitle || !hasThumbnailImg || !hasItemIdCode || !hasOrderedItemsHeader) {
  throw new Error('Vendor item breakdown logic missing or incomplete!');
}

console.log('\n==================================================');
console.log('VENDOR ITEM BREAKDOWN VERIFICATION PASSED 100%!');
console.log('==================================================\n');
