const fs = require('fs');

console.log('=== VERIFYING VENDOR DELIVERY INFO & BUYER NOTES ===\n');

// 1. Check orders.js for Customer Delivery Contact rendering
const ordersJs = fs.readFileSync('js/orders.js', 'utf8');
const hasCustomerDeliveryBlock = ordersJs.includes('Customer Delivery Details');
const hasBuyerNameField = ordersJs.includes('pkg.buyer_name');
const hasBuyerPhoneField = ordersJs.includes('pkg.buyer_phone');
const hasDeliveryLocationField = ordersJs.includes('pkg.delivery_location');
const hasBuyerNoteSupport = ordersJs.includes('buyer_note');

console.log('1. Checking Vendor Order Cards in js/orders.js...');
console.log(`   Customer Delivery Contact Block: ${hasCustomerDeliveryBlock ? '✅' : '❌'}`);
console.log(`   Customer Name Displayed: ${hasBuyerNameField ? '✅' : '❌'}`);
console.log(`   Customer Phone / WhatsApp Displayed: ${hasBuyerPhoneField ? '✅' : '❌'}`);
console.log(`   Customer Location & Address Displayed: ${hasDeliveryLocationField ? '✅' : '❌'}`);
console.log(`   Buyer Item Notes Displayed: ${hasBuyerNoteSupport ? '✅' : '❌'}`);

if (!hasCustomerDeliveryBlock || !hasBuyerNameField || !hasBuyerPhoneField || !hasDeliveryLocationField || !hasBuyerNoteSupport) {
  throw new Error('Vendor delivery info or buyer note rendering is incomplete!');
}

console.log('\n==================================================');
console.log('VENDOR DELIVERY INFO & BUYER NOTES VERIFICATION PASSED!');
console.log('==================================================\n');
