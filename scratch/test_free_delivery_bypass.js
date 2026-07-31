const fs = require('fs');

console.log('=== VERIFYING FREE DELIVERY & LOCATION PRESERVATION ===\n');

// 1. Check js/app.js for calcDelivery return value
const appJs = fs.readFileSync('js/app.js', 'utf8');
const hasZeroRate = appJs.includes('return { rate: 0');
const hasOriginalHashed = appJs.includes('ORIGINAL DELIVERY RATE CALCULATOR');

console.log('1. Checking calcDelivery in js/app.js...');
console.log(`   Delivery Fee Zeroed: ${hasZeroRate ? '✅' : '❌'}`);
console.log(`   Original Code Preserved in Comments: ${hasOriginalHashed ? '✅' : '❌'}`);

if (!hasZeroRate || !hasOriginalHashed) {
  throw new Error('calcDelivery is not properly configured for zero fee!');
}

// 2. Check checkout location fields in js/checkout.js
const checkoutJs = fs.readFileSync('js/checkout.js', 'utf8');
const hasLocationDropdown = checkoutJs.includes('checkout-dest');
const hasAddressInput = checkoutJs.includes('checkout-address');

console.log('\n2. Checking location fields in js/checkout.js...');
console.log(`   Delivery Location Dropdown Intact: ${hasLocationDropdown ? '✅' : '❌'}`);
console.log(`   Address Input Intact: ${hasAddressInput ? '✅' : '❌'}`);

if (!hasLocationDropdown || !hasAddressInput) {
  throw new Error('Checkout location fields were modified!');
}

console.log('\n==================================================');
console.log('FREE DELIVERY BYPASS & LOCATION PRESERVATION PASSED!');
console.log('==================================================\n');
