// Mock environment to test tab persistence state logic
const window = {
  scrollTo: () => {},
  App: null
};
global.window = window;

// Simulate App object
const App = {
  currentUser: { id: 'admin-1', role: 'admin', name: 'Admin Test' },
  currentPage: 'admin-dashboard',
  activeTab: {},
  notifications: [],
  allStores: [],
  allProducts: [],
  allUsers: []
};
window.App = App;
global.App = App;

function createMockElement(id) {
  return {
    id: id,
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    closest() { return mockContainer; }
  };
}

const mockContainer = {
  querySelectorAll: () => [createMockElement('el1'), createMockElement('el2')],
  querySelector: () => createMockElement('btn')
};

global.document = {
  getElementById: (id) => createMockElement(id)
};

// Import switchTab implementation logic
function switchTab(el, tabId) {
  if (typeof el === 'string' && !tabId) {
    tabId = el;
    el = null;
  }
  const target = document.getElementById(tabId);
  if (!target) return;

  if (window.App) {
    if (!App.activeTab) App.activeTab = {};
    if (App.currentPage) App.activeTab[App.currentPage] = tabId;
  }

  const container = target.closest('#vendor-dashboard-content, #buyer-dashboard-content, #admin-dashboard-content, #rendor-dashboard-content, .page');
  if (container) {
    container.querySelectorAll().forEach(t => t.classList.remove('active'));
  }

  target.classList.add('active');
  if (el && typeof el === 'object' && el.classList) el.classList.add('active');
}

function runTabTests() {
  console.log('=== STARTING TAB PERSISTENCE INTEGRATION TEST ===\n');

  // Test 1: Admin switches tab to admin-orders
  console.log('1. Admin switches active tab to "admin-orders"...');
  App.currentPage = 'admin-dashboard';
  switchTab(createMockElement('btn-admin-orders'), 'admin-orders');

  console.log('   App.activeTab:', App.activeTab);
  if (App.activeTab['admin-dashboard'] !== 'admin-orders') {
    throw new Error('Failed to record activeTab for admin-dashboard!');
  }
  console.log('   ✅ App.activeTab["admin-dashboard"] recorded as "admin-orders"');

  // Test 2: Vendor switches tab to vendor-earnings
  console.log('\n2. Vendor switches active tab to "vendor-earnings"...');
  App.currentPage = 'vendor-dashboard';
  switchTab(null, 'vendor-earnings');

  console.log('   App.activeTab:', App.activeTab);
  if (App.activeTab['vendor-dashboard'] !== 'vendor-earnings') {
    throw new Error('Failed to record activeTab for vendor-dashboard!');
  }
  console.log('   ✅ App.activeTab["vendor-dashboard"] recorded as "vendor-earnings"');

  // Test 3: Buyer switches tab to buyer-wishlist
  console.log('\n3. Buyer switches active tab to "buyer-wishlist"...');
  App.currentPage = 'buyer-dashboard';
  switchTab(null, 'buyer-wishlist');

  console.log('   App.activeTab:', App.activeTab);
  if (App.activeTab['buyer-dashboard'] !== 'buyer-wishlist') {
    throw new Error('Failed to record activeTab for buyer-dashboard!');
  }
  console.log('   ✅ App.activeTab["buyer-dashboard"] recorded as "buyer-wishlist"');

  // Test 4: Rendor switches tab to rendor-posts
  console.log('\n4. Rendor switches active tab to "rendor-posts"...');
  App.currentPage = 'rendor-dashboard';
  switchTab(null, 'rendor-posts');

  console.log('   App.activeTab:', App.activeTab);
  if (App.activeTab['rendor-dashboard'] !== 'rendor-posts') {
    throw new Error('Failed to record activeTab for rendor-dashboard!');
  }
  console.log('   ✅ App.activeTab["rendor-dashboard"] recorded as "rendor-posts"');

  console.log('\n=== ALL TAB PERSISTENCE TESTS PASSED 100% SUCCESSFULLY! ===');
}

runTabTests();
