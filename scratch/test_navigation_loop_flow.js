// Mock environment to test navigation loop suppression & same-page showPage guard
const window = {
  location: { hash: '#admin-dashboard' },
  scrollTo: () => {},
  addEventListener: (event, handler) => {
    window['on' + event] = handler;
  },
  App: null
};
global.window = window;

// Mock DOM element for page-admin-dashboard
const pageAdminEl = {
  id: 'page-admin-dashboard',
  classList: {
    _classes: new Set(['active', 'page']),
    add(c) { this._classes.add(c); },
    remove(c) { this._classes.delete(c); },
    contains(c) { return this._classes.has(c); }
  },
  style: { display: 'block' }
};

global.document = {
  getElementById: (id) => {
    if (id === 'page-admin-dashboard') return pageAdminEl;
    return null;
  },
  querySelectorAll: () => [pageAdminEl]
};

const App = {
  currentUser: { id: 'admin-1', role: 'admin', name: 'Admin Test' },
  currentPage: 'admin-dashboard',
  prevPage: 'home',
  activeTab: {},
  _skipPush: false,
  _isProgrammaticNav: false,
  loadedPages: { 'admin-dashboard': true },
  isBackgroundRefresh: false
};
window.App = App;
global.App = App;

function getPageEntityId(p) { return null; }

let runPageInitCalls = 0;
function runPageInit(pageId) {
  runPageInitCalls++;
}

// Same-page guard implementation
function showPage(pageId, entityId = null) {
  const targetEntity = entityId || getPageEntityId(pageId);
  const currentEntity = getPageEntityId(App.currentPage);
  const targetEl = document.getElementById('page-' + pageId);

  // Same-page guard: return early if already active on the same page
  if (App.currentPage === pageId && String(targetEntity || '') === String(currentEntity || '') && targetEl && targetEl.classList.contains('active') && targetEl.style.display !== 'none') {
    console.log(`   [Guard Hit] Suppressed redundant showPage("${pageId}") call.`);
    return false;
  }

  App.prevPage = App.currentPage;
  App.currentPage = pageId;
  App._isProgrammaticNav = true;
  runPageInit(pageId);
  return true;
}

function resolveRouteFromHash(hashStr) {
  const cleanHash = hashStr.startsWith('#') ? hashStr.substring(1) : hashStr;
  const parts = cleanHash.split('/');
  const route = parts[0];
  const param = parts[1] || null;

  if (route === App.currentPage && String(param || '') === String(getPageEntityId(route) || '')) {
    console.log(`   [Route Resolver Guard] Suppressed redundant resolveRouteFromHash("#${route}") call.`);
    return true;
  }

  return showPage(route, param);
}

function runNavigationTests() {
  console.log('=== STARTING NAVIGATION LOOP & SAME-PAGE GUARD TEST ===\n');

  // Test 1: Calling showPage for current active page
  console.log('1. User is on "admin-dashboard". Calling showPage("admin-dashboard")...');
  runPageInitCalls = 0;
  const didRun1 = showPage('admin-dashboard');
  if (didRun1 || runPageInitCalls !== 0) {
    throw new Error('Same-page guard failed! showPage executed when already active.');
  }
  console.log('   ✅ Same-page guard successfully blocked duplicate showPage execution.');

  // Test 2: Testing resolveRouteFromHash for active route
  console.log('\n2. Testing resolveRouteFromHash("#admin-dashboard") for active route...');
  runPageInitCalls = 0;
  resolveRouteFromHash('#admin-dashboard');
  if (runPageInitCalls !== 0) {
    throw new Error('Hash route resolver guard failed! Re-executed showPage for active route.');
  }
  console.log('   ✅ Hash route resolver guard successfully blocked duplicate route execution.');

  // Test 3: Navigating to a new page
  console.log('\n3. Navigating to a new page ("marketplace")...');
  const didRun3 = showPage('marketplace');
  if (!didRun3 || App.currentPage !== 'marketplace') {
    throw new Error('Failed to navigate to new page!');
  }
  console.log('   ✅ Successfully navigated to "marketplace". Current page:', App.currentPage);

  console.log('\n=== ALL NAVIGATION LOOP & GUARD TESTS PASSED 100% SUCCESSFULLY! ===');
}

runNavigationTests();
