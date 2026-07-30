const fs = require('fs');

console.log('=== VERIFYING PROGRESSIVE STREAMING RENDERER IMPLEMENTATION ===\n');

// 1. Check js/app.js for renderItemsProgressively
const appJs = fs.readFileSync('js/app.js', 'utf8');
const hasHelper = appJs.includes('function renderItemsProgressively');
const isExposed = appJs.includes('window.renderItemsProgressively = renderItemsProgressively');

console.log('1. Checking js/app.js helper definition...');
console.log(`   Helper Defined: ${hasHelper ? '✅' : '❌'}`);
console.log(`   Global Window Export: ${isExposed ? '✅' : '❌'}`);

if (!hasHelper || !isExposed) {
  throw new Error('renderItemsProgressively helper missing in js/app.js!');
}

// 2. Check index.html for progressive-card CSS animation
const indexHtml = fs.readFileSync('index.html', 'utf8');
const hasAnimation = indexHtml.includes('.progressive-card') && indexHtml.includes('progressiveItemFadeIn');

console.log('\n2. Checking index.html keyframe & CSS rule...');
console.log(`   CSS Animation Rule: ${hasAnimation ? '✅' : '❌'}`);

if (!hasAnimation) {
  throw new Error('.progressive-card CSS animation missing in index.html!');
}

// 3. Check js/marketplace.js usage
const marketJs = fs.readFileSync('js/marketplace.js', 'utf8');
const hasMarketplaceCall = marketJs.includes('renderItemsProgressively(grid, items');
const hasStoresCall = marketJs.includes('renderItemsProgressively(grid, stores');

console.log('\n3. Checking js/marketplace.js progressive rendering calls...');
console.log(`   Product Grid Progressive Streaming: ${hasMarketplaceCall ? '✅' : '❌'}`);
console.log(`   Store Grid Progressive Streaming: ${hasStoresCall ? '✅' : '❌'}`);

if (!hasMarketplaceCall || !hasStoresCall) {
  throw new Error('Progressive rendering calls missing in js/marketplace.js!');
}

// 4. Check js/search.js usage
const searchJs = fs.readFileSync('js/search.js', 'utf8');
const hasSearchCall = searchJs.includes('renderItemsProgressively(pEl, products');

console.log('\n4. Checking js/search.js progressive rendering calls...');
console.log(`   Search Results Progressive Streaming: ${hasSearchCall ? '✅' : '❌'}`);

if (!hasSearchCall) {
  throw new Error('Progressive rendering calls missing in js/search.js!');
}

console.log('\n==================================================');
console.log('PROGRESSIVE STREAMING UX OPTIMIZATION PASSED 100%!');
console.log('==================================================\n');
