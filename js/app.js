/* ============================================================
   HAPPA TRADEMART — Core App State & Navigation
   ============================================================ */

'use strict';

// ── Constants ──────────────────────────────────────────────
const API = '/api/';
const LOCATIONS = [
  'Accra','Kumasi','Takoradi','Tamale','Cape Coast','Tema','Sunyani','Koforidua',
  'Ashaiman','Obuasi','Teshie','Madina','Kasoa','Ho','Bolgatanga','Wa',
  'Techiman','Tarkwa','Nungua','Dodowa','Nsawam','Achimota','Osu',
  'Labadi','East Legon','Spintex','Tema Community 1','Tema Community 25',
  'Spintex Road','Ashongman','Adenta','Madina Zongo','Pantang',
  'Haatso','Oyarifa','Abelemkpe','Roman Ridge','Airport Residential',
  'Cantonments','Labone','Dansoman','Kaneshie','Osu Oxford Street',
  'Madina Market','Legon','UPC','Near University of Ghana',
  'Kumasi Adum','Kumasi Asafo','Kumasi Ahodwo','Kumasi Bantama',
  'Kumasi Kejetia','Kumasi Suame','Kumasi Asokwa','Ejisu',
  'New Juaben','Nkawkaw','Berekum','Bechi','Wenchi',
  'Nkoranza','Drobo','Goaso','Sekondi','Axim',
  'Saltpond','Mankessim','Anomabu','Winneba','Elmina',
  'Shama','Agona Swedru','Biriwa','Kumasi Subin',
  'Oforikrom','Ahinsan','Patase','Nhyiaeso',
  'Ejisu Besease','Ahenkuro','Boankra','Mampong',
  'Ejura','Konongo','Jamasi','Agona',
  'Obuasi Town','Obuasi Adaawam','Obuasi Dunkwa',
  'Tarkwa Nsuaem','Takoradi Market','Sekondi-Takoradi',
  'Ekyem Aduana','Insuam',
  'Other'
];
const CATEGORIES = [
  'Fashion & Footwear','Electronics','Beauty & Skincare','Food & Groceries',
  'Health & Wellness','Sports & Fitness','Home & Living','Books & Stationery',
  'Toys & Games','Art & Crafts','Automotive','Pet Supplies',
  'Phones & Accessories','Computing','Jewelry & Watches','Baby & Kids',
  'Kitchen & Dining','Garden & Outdoor','Office Supplies','Musical Instruments',
  'Industrial & Scientific','Real Estate','Vehicle Parts','Bags & Luggage',
  'Phones Repair','Fashion Accessories','Hair & Wigs','Spices & Seasonings',
  'Beverages','Frozen Foods','Building Materials','Printing & Branding',
  'Farm Produce','Livestock & Poultry','Furniture','Lighting & Electrical',
  'Security & Surveillance','Cleaning Supplies','Packaging & Shipping','Digital Services',
  'Events & Party Supplies','Fabric & Textiles','Tailoring & Sewing','Other'
];
const SERVICE_CATEGORIES = [
  'Writing & Content','Graphic Design','Social Media','Web & Tech',
  'Tutoring & Education','Photography & Video','Music & Audio',
  'Business & Consulting','Translation & Languages','Other'
];
const COMMISSION = [ [1,50,8], [51,100,6], [101,500,4], [501,1000,3], [1001,Infinity,2] ];
const PLATFORM_FEE_PCT = 1.5;
const LOCATION_PREFIXES = {
  'Accra':'AC','Kumasi':'KM','Takoradi':'TD','Tamale':'TM',
  'Cape Coast':'CC','Tema':'TE','Sunyani':'SY','Koforidua':'KF'
};

// ── App State ──────────────────────────────────────────────
const App = {
  currentUser: null,
  cart: [],
  savedStores: [],
  currentPage: 'home',
  prevPage: 'home',
  marketFilter: 'all',
  storeFilter: 'all',
  notifications: [],
  allProducts: [],
  allStores: [],
  allUsers: [],
  currentProductId: null,
  currentStoreId: null,
  currentRendorId: null,
  flashSaleEnd: null,
  loadedPages: {},
  isBackgroundRefresh: false,
  activeTab: {},
};

/**
 * Progressive One-by-One Item Renderer
 * Loads and displays items ONE BY ONE with staggered micro-delays for an ultra-responsive UX.
 */
function renderItemsProgressively(containerEl, items, cardHtmlFn, options = {}) {
  if (!containerEl) return;

  if (!items || !items.length) {
    containerEl.innerHTML = '';
    return;
  }

  if (containerEl._progressiveTimer) {
    clearTimeout(containerEl._progressiveTimer);
    containerEl._progressiveTimer = null;
  }

  const delayMs = options.delayMs || 25; // 25ms micro-delay between each single item

  // 1. Render first item immediately so top left starts instantly
  const firstItem = items[0];
  const firstHtml = (cardHtmlFn(firstItem, 0) || '');
  containerEl.innerHTML = firstHtml;
  const firstCard = containerEl.firstElementChild;
  if (firstCard) {
    firstCard.classList.add('progressive-card');
    firstCard.style.animationDelay = '0s';
  }

  // 2. Stream remaining items ONE BY ONE
  if (items.length > 1) {
    let currentIndex = 1;

    const renderNextItem = () => {
      if (!document.body.contains(containerEl)) return;
      if (currentIndex >= items.length) {
        containerEl._progressiveTimer = null;
        return;
      }

      const item = items[currentIndex];
      const staggerDelay = ((currentIndex % 8) * 0.02).toFixed(3);
      const rawHtml = cardHtmlFn(item, currentIndex);

      containerEl.insertAdjacentHTML('beforeend', rawHtml || '');
      const card = containerEl.lastElementChild;
      if (card) {
        card.classList.add('progressive-card');
        card.style.animationDelay = `${staggerDelay}s`;
      }
      currentIndex++;

      if (currentIndex < items.length) {
        containerEl._progressiveTimer = setTimeout(() => {
          requestAnimationFrame(renderNextItem);
        }, delayMs);
      } else {
        containerEl._progressiveTimer = null;
      }
    };

    containerEl._progressiveTimer = setTimeout(() => {
      requestAnimationFrame(renderNextItem);
    }, delayMs);
  }
}
window.renderItemsProgressively = renderItemsProgressively;

// ── Initialize ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // ── PWA Storefront Link Interceptor ─────────────────────────────
  // If the app is installed as a PWA, intercept any <a> click or
  // programmatic navigation that targets a storefront/store-admin URL
  // and open it in the default browser instead.
  const isPWA = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  document.addEventListener('click', e => {
    if (!isPWA()) return;
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const storefrontPatterns = [
      /^\/storefront\//,
      /^\/store\//,
      /^\/store-admin\//,
      /#storefront\//,
      /#store-admin\//,
    ];
    const isStorefrontLink = storefrontPatterns.some(p => p.test(href));
    if (isStorefrontLink) {
      e.preventDefault();
      const absUrl = new URL(href, window.location.origin).href;
      window.open(absUrl, '_blank', 'noopener,noreferrer');
    }
  }, { capture: true });


  // Bump this version string whenever seed data changes to force a re-seed
  const SEED_VERSION = 'v5';
  if (localStorage.getItem('happa_seed_v') !== SEED_VERSION) {
    ['users','services','stores','products','settings'].forEach(t =>
      localStorage.removeItem('happa_db_' + t)
    );
    localStorage.setItem('happa_seed_v', SEED_VERSION);
  }

  // Clear local cache for any stale/orphaned store or user entries
  try {
    const storeCache = localStorage.getItem('happa_all_stores');
    if (storeCache) {
      let stores = JSON.parse(storeCache);
      if (Array.isArray(stores)) {
        const filtered = stores.filter(s =>
          s && s.name !== 'Kumasi Fashion Hub' && s.name !== 'Northern Trends' && s.name !== 'Nana Ama'
        );
        if (filtered.length !== stores.length) {
          localStorage.setItem('happa_all_stores', JSON.stringify(filtered));
        }
      }
    }
  } catch(e){}

  // First, hide ALL pages completely
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  
  loadSession();
  updateNavForUser(); // apply role-based nav immediately after session load
  initCountdown();
  // Handle storefront links in hash e.g. #storefront/elsbee, ?storefront=elsbee,
  // or path-based URLs e.g. /storefront/<slug> and /store-admin/<slug> on startup
  const startupHash = window.location.hash || '';
  const searchParams = new URLSearchParams(window.location.search);
  const pathStorefrontMatch = window.location.pathname.match(/^\/storefront\/([^/]+)/);
  const pathAdminMatch = window.location.pathname.match(/^\/store-admin\/([^/]+)/);
  const pathSlug = pathStorefrontMatch ? decodeURIComponent(pathStorefrontMatch[1]) :
                   (pathAdminMatch ? decodeURIComponent(pathAdminMatch[1]) : null);
  const isStoreAdmin = !!pathAdminMatch || startupHash.startsWith('#store-admin/');
  const isStorefrontPage = !!pathStorefrontMatch || startupHash.startsWith('#storefront/') || startupHash.includes('storefront');
  const isDirectStorefront = isStorefrontPage || isStoreAdmin || searchParams.has('storefront');

  const storeSlug = pathSlug ||
                    searchParams.get('store') ||
                    (startupHash.startsWith('#store/') ? startupHash.substring(7) : null) ||
                    (isStoreAdmin ? startupHash.substring(13) : null) ||
                    searchParams.get('storefront') ||
                    (isStorefrontPage ? (startupHash.startsWith('#storefront/') ? startupHash.substring(12) : null) : null);

  if (isDirectStorefront) {
    App.isStandaloneStorefront = true;
    document.body.classList.add('is-storefront-view');
    document.documentElement.classList.add('is-storefront-root');
    const splash = document.getElementById('pwa-splash-screen');
    if (splash) splash.remove();
    App.currentStoreId = storeSlug;
    showPage(isStoreAdmin ? 'store-admin' : 'storefront', storeSlug);
    try {
      history.replaceState({ page: isStoreAdmin ? 'store-admin' : 'storefront', entityId: storeSlug, tab: 'home' }, '', window.location.href);
      history.pushState({ page: isStoreAdmin ? 'store-admin' : 'storefront', entityId: storeSlug, tab: 'home' }, '', window.location.href);
    } catch(e) {}
  } else {
    loadHomeData().then(() => { initAdBanners('home'); initHeroBanners(); });
  }

  initSearch();
  if (window.updateHeaderSearchForPage) window.updateHeaderSearchForPage();
  renderNotifBadge();
  // Cross-Tab Session & Wallet Balance Synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === 'happa_user') {
      try {
        const newUser = e.newValue ? JSON.parse(e.newValue) : null;
        App.currentUser = newUser;
        updateNavForUser();
        if (typeof renderVendorDashboard === 'function' && App.currentPage === 'vendor-dashboard') {
          renderVendorDashboard();
        }
      } catch(err) {}
    }
  });

  // Fetch server-side notifications (e.g. announcements) shortly after load
  if (App.currentUser) {
    setTimeout(() => fetchServerNotifications().then(renderNotifBadge), 1500);
    // Start polling for notifications and dashboard sync
    setTimeout(() => startNotifPolling(), 3000);
    setTimeout(() => startDashboardSyncPolling(), 4000);
    setTimeout(() => { if (typeof _hookPushInit === 'function') _hookPushInit(); }, 5000);
  }
  
  if (startupHash === '#register-vendor' || startupHash === '#auth-vendor') {
    showPage('auth');
    setTimeout(() => {
      if (typeof switchRole === 'function') {
        switchRole('vendor');
      }
    }, 150);
  } else if (storeSlug) {
    Promise.all([
      apiGet('stores', 'limit=500'),
      apiGet('storefronts', 'limit=500')
    ]).then(([storesRes, sfRes]) => {
      const allStores = storesRes ? storesRes.data || [] : [];
      const allStorefronts = sfRes ? sfRes.data || [] : [];
      App.allStores = allStores;
      App.allStorefronts = allStorefronts;

      // Direct storefront URLs are already rendering above via the startup block —
      // renderStorefront resolves the slug itself. Here we only warm the caches.
      // (limit=500 matches renderStorefront's fetch keys, so the apiCache reuses
      // the very same in-flight requests instead of issuing duplicates.)
      // NOTE: store-admin URLs are excluded — renderStorefrontAdminPortalPage only
      // resolves store IDs, so it still needs this slug-to-id resolution below.
      if (isDirectStorefront && !isStoreAdmin) return;

      let found = null;
      if (isStorefrontPage || isStoreAdmin || searchParams.has('storefront')) {
        // Resolve storefront first
        const sf = allStorefronts.find(item => String(item.url_slug) === storeSlug || String(item.id) === storeSlug || String(item.store_id) === storeSlug);
        if (sf) {
          found = allStores.find(s => String(s.id) === String(sf.store_id));
        }
      }

      // Fallback/Direct Store Lookup
      if (!found) {
        found = allStores.find(s => String(s.slug) === storeSlug || String(s.id) === storeSlug);
      }
      
      if (found) {
        if (isStoreAdmin) {
          showPage('store-admin', found.id);
        } else if (isStorefrontPage || searchParams.has('storefront')) {
          showPage('storefront', found.id);
        } else {
          showPage('store-detail', found.id);
        }
      } else {
        if (isStorefrontPage || searchParams.has('storefront')) {
          showPage('storefront', storeSlug);
        } else {
          showPage('home');
        }
      }
    }).catch(() => {
      if (!isDirectStorefront) showPage('home');
    });
  } else if (!isDirectStorefront) {
    const startupHash = window.location.hash || '';
    const hasHistoryState = history.state && history.state.page;

    if (startupHash && startupHash !== '#') {
      resolveRouteFromHash(startupHash);
    } else if (hasHistoryState) {
      showPage(history.state.page, history.state.entityId);
    } else {
      showPage('home');
    }

    if (searchParams.has('product')) {
      const productId = searchParams.get('product');
      setTimeout(() => {
        if (typeof openProduct === 'function') openProduct(productId);
      }, 500);
    }
  }

// ── Hash Route Resolver ─────────────────────────────────
function resolveRouteFromHash(hashStr) {
  if (!hashStr || hashStr === '#' || hashStr === '#home') {
    if (App.currentPage !== 'home') showPage('home');
    return true;
  }
  const cleanHash = hashStr.startsWith('#') ? hashStr.substring(1) : hashStr;
  const parts = cleanHash.split('/');
  const route = parts[0];
  const param = parts[1] || null;

  if (route === App.currentPage && String(param || '') === String(getPageEntityId(route) || '')) {
    return true;
  }

  const validPages = [
    'home', 'marketplace', 'stores', 'cart', 'checkout', 'auth', 'settings',
    'buyer-dashboard', 'vendor-dashboard', 'vendor-my-store', 'vendor-orders',
    'rendor-dashboard', 'admin-dashboard', 'notifications', 'privacy'
  ];

  if (route === 'register-vendor' || route === 'auth-vendor') {
    showPage('auth');
    if (typeof switchRole === 'function') switchRole('vendor');
    return true;
  }
  if (route === 'store' && param) {
    const found = (App.allStores || []).find(s => String(s.slug) === param || String(s.id) === param);
    if (found) showPage('store-detail', found.id);
    else showPage('stores');
    return true;
  }
  if (route === 'storefront' && param) {
    const sf = (App.allStorefronts || []).find(item => String(item.url_slug) === param || String(item.id) === param || String(item.store_id) === param);
    const found = sf ? (App.allStores || []).find(s => String(s.id) === String(sf.store_id)) : (App.allStores || []).find(s => String(s.slug) === param || String(s.id) === param);
    showPage('storefront', found ? found.id : param);
    return true;
  }
  if (route === 'store-admin' && param) {
    const sf = (App.allStorefronts || []).find(item => item.url_slug === param || item.id === param || item.store_id === param);
    const found = sf ? (App.allStores || []).find(s => String(s.id) === String(sf.store_id)) : (App.allStores || []).find(s => s.slug === param || s.id === param);
    if (found) showPage('store-admin', found.id);
    else showPage('admin-dashboard');
    return true;
  }
  if (route === 'product' && param) {
    if (typeof openProduct === 'function') openProduct(param);
    else showPage('product', param);
    return true;
  }
  if (route === 'rendor-profile' && param) {
    showPage('rendor-profile', param);
    return true;
  }
  if (route === 'profile' || route === 'dashboard') {
    showPage('dashboard');
    return true;
  }

  if (validPages.includes(route)) {
    showPage(route, param);
    return true;
  }

  return false;
}

  // Listen to hash changes dynamically
  window.addEventListener('hashchange', () => {
    if (App._isProgrammaticNav) return;
    const isStorefront = document.body.classList.contains('is-storefront-view') || document.documentElement.classList.contains('is-storefront-root') || App.isStandaloneStorefront;
    const newHash = window.location.hash;

    if (isStorefront) {
      if (!newHash.startsWith('#storefront/') && !newHash.startsWith('#store-admin/')) {
        console.warn('[Standalone Storefront] Blocked hash change to main site:', newHash);
        if (App.currentStoreId) {
          const sf = (App.allStorefronts || []).find(item => String(item.store_id) === String(App.currentStoreId));
          const slug = sf ? sf.url_slug : App.currentStoreId;
          try {
            history.replaceState({ page: 'storefront', entityId: App.currentStoreId, tab: 'home' }, '', `#storefront/${slug}`);
          } catch(e){}
          showPage('storefront', App.currentStoreId);
        }
        return;
      }
    }

    if (newHash && newHash !== '#') {
      resolveRouteFromHash(newHash);
    }
  });

  // ── Browser back-button support ──
  // Replace the initial entry so it has state, then listen for popstate
  history.replaceState({ page: App.currentPage, entityId: getPageEntityId(App.currentPage) }, '');
  window.addEventListener('popstate', (e) => {
    const isStorefront = document.body.classList.contains('is-storefront-view') || App.currentPage === 'storefront' || document.documentElement.classList.contains('is-storefront-root') || App.isStandaloneStorefront;
    if (isStorefront) {
      // 1. Close product modal if open
      const sfModal = document.getElementById('sf-product-modal') || document.querySelector('.storefront-modal.active');
      if (sfModal && sfModal.style.display !== 'none') {
        sfModal.style.display = 'none';
        try { history.pushState({ page: 'storefront', entityId: App.currentStoreId, tab: window.currentStorefrontTab || 'home' }, '', window.location.href); } catch(err){}
        return;
      }
      // 2. If viewing a sub-tab (cart, checkout, products, about), navigate back to storefront home tab
      if (window.currentStorefrontTab && window.currentStorefrontTab !== 'home' && App.currentStoreId) {
        switchStorefrontTab('home', App.currentStoreId);
        try { history.pushState({ page: 'storefront', entityId: App.currentStoreId, tab: 'home' }, '', window.location.href); } catch(err){}
        return;
      }
      // 3. On storefront home tab: NEVER escape to main website!
      // Attempt window.close() to close website window
      try { window.close(); } catch(err){}

      // Re-lock history on storefront page so user remains on storefront
      if (App.currentStoreId) {
        App._skipPush = true;
        showPage('storefront', App.currentStoreId);
        if (typeof switchStorefrontTab === 'function') switchStorefrontTab('home', App.currentStoreId);
        App._skipPush = false;
        try { history.pushState({ page: 'storefront', entityId: App.currentStoreId, tab: 'home' }, '', window.location.href); } catch(err){}
      }
      return;
    }

    if (e.state && e.state.page) {
      // Navigate to the page stored in the history entry without pushing
      // a new entry (the browser already moved the pointer).
      App._skipPush = true;
      showPage(e.state.page, e.state.entityId);
      App._skipPush = false;
    }
  });

  // ── Background Prefetching ──
  // Start preloading all static pages in the background to speed up navigation
  setTimeout(() => {
    const prefetchPages = ['marketplace', 'stores', 'cart', 'notifications', 'privacy'];
    if (App.cart && App.cart.length) prefetchPages.push('checkout');
    if (App.currentUser) {
      prefetchPages.push('settings');
      if (App.currentUser.role === 'buyer') prefetchPages.push('buyer-dashboard');
      else if (App.currentUser.role === 'vendor' || App.currentUser.role === 'seller') prefetchPages.push('vendor-dashboard', 'vendor-my-store', 'vendor-orders');
      else if (App.currentUser.role === 'rendor') prefetchPages.push('rendor-dashboard');
      else if (App.currentUser.role === 'admin') prefetchPages.push('admin-dashboard');
    }
    prefetchPages.forEach(page => {
      const cacheKey = getPageCacheKey(page);
      if (!App.loadedPages[cacheKey] && App.currentPage !== page) {
        runPageInit(page).catch(e => console.warn('Prefetch failed for', page, e));
      }
    });
  }, 4000); // 4 seconds after DOM load to prioritize initial render

  document.addEventListener('click', closeProfileMenu);
});

// ── Session Persistence ───────────────────────────────────
function loadSession() {
  try {
    const s = localStorage.getItem('happa_session');
    if (s) App.currentUser = JSON.parse(s);
    const c = localStorage.getItem('happa_cart');
    if (c) App.cart = JSON.parse(c);
    const sv = localStorage.getItem('happa_saved');
    if (sv) App.savedStores = JSON.parse(sv);
    const n = localStorage.getItem('happa_notifs');
    if (n) App.notifications = JSON.parse(n);
  } catch(e) { console.warn('Session load error', e); }

  if (App.currentUser && App.currentUser.id) {
    App.notifications = (App.notifications || []).filter(notif => String(notif.user_id) === String(App.currentUser.id));
    // On standalone storefront URLs, don't fire the heavy users-list verification
    // at startup — it competes with the storefront's own fetches for bandwidth.
    // The 5s session heartbeat re-verifies anyway.
    const _startupUrl = window.location.hash + window.location.search + window.location.pathname;
    if (!_startupUrl.includes('storefront') && !_startupUrl.includes('store-admin')) {
      verifySessionUser();
    }
  } else {
    App.currentUser = null;
    App.notifications = [];
  }
  updateCartBadge();
}

async function verifySessionUser() {
  if (!App.currentUser || !App.currentUser.id) return true;
  const uid = String(App.currentUser.id);

  // Verify by the account's own id — NEVER by scanning the `users` list.
  // On the deployed backend that list comes from an ephemeral in-memory store
  // merged with Supabase: it can be incomplete, served from a different
  // serverless instance, or miss accounts written to another instance's
  // memory. Treating "missing from the list" as proof of deletion made valid
  // accounts get logged out minutes after login. Only an explicit status on
  // the account's own record counts as revocation.
  let me = null;
  try {
    me = await apiGet('users/' + encodeURIComponent(uid)).catch(() => null);
  } catch (e) { me = null; }

  if (me && (me.status === 'deleted' || me.status === 'suspended')) {
    console.warn(`[Session Revoked] Account "${uid}" status is ${me.status}. Logging out.`);
    if (typeof stopNotifPolling === 'function') stopNotifPolling();
    if (typeof stopDashboardSyncPolling === 'function') stopDashboardSyncPolling();
    logout(true);
    showToast(`Your account has been ${me.status}.`, 'warning');
    try { localStorage.setItem('happa_logout_user_id', uid); } catch(e){}
    return false;
  }

  if (!me || !me.id) return true; // 404 or transient hiccup — keep the session

  const prevStatus = App.currentUser.status;
  const prevRole   = App.currentUser.role;

  // Sync fresh user fields (e.g. status, role, is_verified, id_verified, wallet_balance)
  Object.assign(App.currentUser, me);
  saveSessions();

  // Update admin user list cache if current user is admin — opportunistically
  // (never gating the session on it, and never on the truncated list alone).
  if (App.currentUser.role === 'admin') {
    apiGet('users', 'limit=500').then(res => {
      const list = res?.data || [];
      if (list && list.length) App.allUsers = list.filter(u => u.role !== 'admin');
    }).catch(() => {});
  }

  if (prevStatus !== me.status || prevRole !== me.role) {
    updateNavForUser();
    App.loadedPages = {};
    if (typeof runPageInit === 'function') {
      runPageInit(App.currentPage);
    }
  }
  return true;
}

// ── Dashboard Sync Polling ────────────────────────────────
let _dashboardSyncTimer = null;
function startDashboardSyncPolling() {
  stopDashboardSyncPolling();
  if (!App.currentUser) return;
  _dashboardSyncTimer = setInterval(async () => {
    if (document.hidden) return; // Pause polling when tab is inactive to save battery and network bandwidth
    if (!App.currentUser) { stopDashboardSyncPolling(); return; }
    const syncPages = ['admin-dashboard', 'vendor-dashboard', 'vendor-orders', 'buyer-dashboard'];
    if (syncPages.includes(App.currentPage)) {
      apiCache.clear();
      App.isBackgroundRefresh = true;
      try {
        if (App.currentPage === 'admin-dashboard') {
          const activeTab = (App.activeTab && App.activeTab['admin-dashboard']) || 'admin-overview';
          if (activeTab === 'admin-orders' && typeof refreshAdminOrdersList === 'function') {
            await refreshAdminOrdersList();
          }
        } else if (App.currentPage === 'vendor-orders') {
          await renderVendorOrdersPage();
        }
      } catch(e){}
      App.isBackgroundRefresh = false;
    }
  }, 15000);
}

function stopDashboardSyncPolling() {
  if (_dashboardSyncTimer) {
    clearInterval(_dashboardSyncTimer);
    _dashboardSyncTimer = null;
  }
}

// ── Session Heartbeat & Cross-Tab Logout Listener ────────────────
setInterval(() => {
  if (App.currentUser && App.currentUser.id) {
    verifySessionUser();
  }
}, 5000);

document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && App.currentUser && App.currentUser.id) {
    apiCache.clear();
    await verifySessionUser();
    const syncPages = ['admin-dashboard', 'vendor-dashboard', 'vendor-orders', 'buyer-dashboard', 'notifications'];
    if (syncPages.includes(App.currentPage)) {
      App.isBackgroundRefresh = true;
      await runPageInit(App.currentPage);
    }
  }
});

window.addEventListener('storage', (e) => {
  if (e.key === 'happa_logout_user_id' || e.key === 'happa_session') {
    const deletedId = e.newValue;
    if (!localStorage.getItem('happa_session') || (App.currentUser && String(App.currentUser.id) === String(deletedId))) {
      console.warn('[Cross-Tab Logout] Current user session deleted in another tab/window. Logging out.');
      if (typeof stopNotifPolling === 'function') stopNotifPolling();
      logout(true);
    }
  }
});

function saveCart() {
  localStorage.setItem('happa_cart', JSON.stringify(App.cart));
  updateCartBadge();
}
function saveSessions() {
  localStorage.setItem('happa_session', JSON.stringify(App.currentUser));
}
function saveNotifs() {
  localStorage.setItem('happa_notifs', JSON.stringify(App.notifications));
}
function logout(skipConfirm = false) {
  if (!skipConfirm && typeof confirm === 'function' && !confirm('Sign out of HAPPA TRADEMART?')) return;
  
  // Call server logout endpoint asynchronously
  try {
    apiFetch('auth/logout', { method: 'POST' }).catch(() => {});
  } catch(e){}

  setAuthToken(null);
  App.currentUser = null;
  App.notifications = [];
  App.loadedPages = {};
  App.myStorefront = null;
  App.myStore = null;
  try {
    localStorage.removeItem('happa_session');
    localStorage.removeItem('happa_notifs');
    localStorage.removeItem('happa_saved');
    localStorage.removeItem('happa_wishlist');
    // Clear any stale cross-tab deletion flag so it can't linger forever
    localStorage.removeItem('happa_logout_user_id');
    // Purge cached PII on logout (shared devices must not retain account data)
    ['happa_all_users', 'happa_all_stores', 'happa_all_storefronts'].forEach(k => localStorage.removeItem(k));
    ['users', 'packages', 'orders', 'wallet_transactions', 'support_tickets', 'notifications', 'referrals', 'order_notifications', 'audit_logs'].forEach(t => localStorage.removeItem('happa_db_' + t));
  } catch(e){}
  if (typeof stopNotifPolling === 'function') stopNotifPolling();
  if (typeof stopDashboardSyncPolling === 'function') stopDashboardSyncPolling();
  if (typeof renderNotifBadge === 'function') renderNotifBadge();
  const notifContent = document.getElementById('notifications-content');
  if (notifContent) {
    notifContent.innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <i class="fas fa-bell-slash"></i>
        <h3>Sign in to see notifications</h3>
      </div>`;
  }
  const containersToClear = [
    'buyer-dashboard-content',
    'vendor-dashboard-content',
    'admin-dashboard-content',
    'rendor-dashboard-content',
    'orders-list',
    'wallet-container',
    'settings-content'
  ];
  containersToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  showPage('home');
  if (!skipConfirm) showToast('Signed out successfully', 'info');
  updateNavForUser();
}

// ── Skeleton Screen Injector ─────────────────────────────
function injectSkeletonLoaders(pageId) {
  const cardHtml = `
    <div class="skeleton-card">
      <div class="skeleton-box image"></div>
      <div class="skeleton-box title" style="margin-top: 4px;"></div>
      <div class="skeleton-box price"></div>
    </div>`;
  const rowHtml = `
    <div class="skeleton-row">
      <div class="skeleton-box avatar"></div>
      <div class="skeleton-box lines">
        <div class="skeleton-box line1"></div>
        <div class="skeleton-box line2"></div>
        <div class="skeleton-box line3"></div>
      </div>
    </div>`;

  if (pageId === 'home') {
    const flashList = document.getElementById('flash-sale-list');
    const localList = document.getElementById('local-products-list');
    const trending = document.getElementById('trending-list');
    const stores = document.getElementById('featured-stores-list');
    if (flashList) flashList.innerHTML = Array(4).fill(cardHtml).join('');
    if (localList) localList.innerHTML = Array(4).fill(cardHtml).join('');
    if (trending) trending.innerHTML = Array(6).fill(cardHtml).join('');
    if (stores) stores.innerHTML = Array(4).fill(rowHtml).join('');
  } else if (pageId === 'marketplace') {
    const list = document.getElementById('marketplace-grid');
    if (list) list.innerHTML = Array(8).fill(cardHtml).join('');
  } else if (pageId === 'stores') {
    const list = document.getElementById('stores-grid');
    if (list) list.innerHTML = Array(8).fill(rowHtml).join('');
  } else if (pageId === 'notifications') {
    const list = document.getElementById('notifications-content');
    if (list) list.innerHTML = Array(6).fill(rowHtml).join('');
  } else if (pageId === 'storefront') {
    const c = document.getElementById('storefront-content');
    if (c) {
      c.innerHTML = `
        <div style="padding: 16px; display: grid; gap: 16px;">
          <div class="skeleton-box" style="width: 100%; height: 150px; border-radius: 12px;"></div>
          <div style="display: flex; align-items: center; gap: 14px; margin-top: -30px; padding: 0 12px; position: relative; z-index: 2;">
            <div class="skeleton-box" style="width: 70px; height: 70px; border-radius: 50%; border: 3px solid #fff; flex-shrink: 0;"></div>
            <div style="flex: 1; display: grid; gap: 8px; margin-top: 20px;">
              <div class="skeleton-box" style="width: 50%; height: 18px; border-radius: 4px;"></div>
              <div class="skeleton-box" style="width: 75%; height: 14px; border-radius: 4px;"></div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px;">
            ${Array(4).fill(cardHtml).join('')}
          </div>
        </div>`;
    }
  } else if (pageId === 'store-detail') {
    const c = document.getElementById('store-detail-content');
    if (c) {
      c.innerHTML = `
        <div style="padding: 16px; display: grid; gap: 16px;">
          <div class="skeleton-box" style="width: 100%; height: 140px; border-radius: 12px;"></div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px;">
            ${Array(4).fill(cardHtml).join('')}
          </div>
        </div>`;
    }
  }
}

function updatePWAManifest(name, logoUrl, themeColor) {
  const currentHash = window.location.hash || '';
  const currentSearch = window.location.search || '';
  const isStorefrontView = document.body.classList.contains('is-storefront-view') || 
                           currentHash.includes('storefront') || 
                           currentHash.includes('store-admin') || 
                           currentHash.includes('store/') || 
                           currentSearch.includes('storefront') || 
                           currentSearch.includes('store=');

  if (isStorefrontView) {
    // Completely suppress PWA manifest on storefront views
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) manifestLink.remove();
    if (name) document.title = name;
    return;
  }

  let link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  
  if (name) {
    document.title = name;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute('content', name);
    const appName = document.querySelector('meta[name="application-name"]');
    if (appName) appName.setAttribute('content', name);
  }
  
  let fullLogoUrl = logoUrl;
  if (logoUrl && !logoUrl.startsWith('http') && !logoUrl.startsWith('data:')) {
    if (logoUrl.startsWith('/')) {
      fullLogoUrl = window.location.origin + logoUrl;
    } else {
      fullLogoUrl = window.location.origin + '/' + logoUrl;
    }
  }

  const dynamicManifest = {
    name: name,
    short_name: name.length > 15 ? name.substring(0, 15) : name,
    icons: [
      { src: fullLogoUrl, sizes: '192x192', type: 'image/png' },
      { src: fullLogoUrl, sizes: '512x512', type: 'image/png' }
    ],
    start_url: window.location.href,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: themeColor || '#e85d04'
  };

  const stringManifest = JSON.stringify(dynamicManifest);
  const blob = new Blob([stringManifest], {type: 'application/json'});
  const manifestURL = URL.createObjectURL(blob);
  link.setAttribute('href', manifestURL);
}

// ── Page Navigation ───────────────────────────────────────
// ── Page Navigation ───────────────────────────────────────
function getPageCacheKey(pageId) {
  if (pageId === 'store-detail') return `store-detail-${App.currentStoreId}`;
  if (pageId === 'product') return `product-${App.currentProductId}`;
  if (pageId === 'rendor-profile') return `rendor-profile-${App.currentRendorId}`;
  if (pageId === 'storefront') return `storefront-${App.currentStoreId}`;
  return pageId;
}

function getPageEntityId(pageId) {
  if (pageId === 'store-detail' || pageId === 'storefront' || pageId === 'store-admin') {
    return App.currentStoreId;
  }
  if (pageId === 'product') {
    return App.currentProductId;
  }
  if (pageId === 'rendor-profile') {
    return App.currentRendorId;
  }
  return null;
}

async function runPageInit(pageId) {
  const cacheKey = getPageCacheKey(pageId);
  try {
    switch(pageId) {
      case 'home':           await loadHomeData().then(() => initAdBanners('home')); break;
      case 'marketplace':    await renderMarketplace().then(() => initAdBanners('shop')); break;
      case 'stores':         await renderStores().then(() => initAdBanners('stores')); break;
      case 'cart':           renderCart(); break;
      case 'checkout':       renderCheckout(); break;
      case 'auth':           renderAuth(); break;
      case 'settings':       await renderSettingsPage(); break;
      case 'support':        await renderSupportPage(); break;
      case 'buyer-dashboard': await renderBuyerDashboard(); break;
      case 'vendor-dashboard':  await renderVendorDashboard(); break;
      case 'vendor-my-store':   await renderVendorMyStorePage(); break;
      case 'vendor-orders':     await renderVendorOrdersPage(); break;
      case 'rendor-dashboard':  await renderRendorDashboard(); break;
      case 'rendor-profile':    await renderRendorProfilePublic(); break;
      case 'admin-dashboard':   await renderAdminDashboard(); break;
      case 'notifications':     await renderNotifications(); break;
      case 'privacy':          await renderPrivacyPage(); break;
      case 'product':          await renderProductDetail(App.currentProductId); break;
      case 'store-detail':     await renderStoreDetail(App.currentStoreId); break;
      case 'storefront':       await renderStorefront(App.currentStoreId); break;
      case 'store-admin':      if (typeof window.renderStorefrontAdminPortalPage === 'function') await window.renderStorefrontAdminPortalPage(App.currentStoreId); break;
    }
    // Mark as loaded successfully
    App.loadedPages[cacheKey] = true;
  } catch (err) {
    console.error(`[runPageInit] Error loading page ${pageId}:`, err);
  }
}

function showPage(pageId, entityId = null) {
  // ── PWA Storefront Guard ─────────────────────────────────────
  // When running as an installed PWA (standalone/fullscreen), storefront pages
  // must open in the real browser — never inside the PWA shell.
  const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                window.matchMedia('(display-mode: fullscreen)').matches ||
                window.navigator.standalone === true;
  const isStorefrontTarget = pageId === 'storefront' || pageId === 'store-admin';
  if (isPWA && isStorefrontTarget && entityId) {
    // Build the storefront URL and open in the browser
    const sf = (App.allStorefronts || []).find(
      s => String(s.store_id) === String(entityId) || String(s.id) === String(entityId)
    );
    const slug = sf?.url_slug || entityId;
    const baseOrigin = window.location.origin;
    const targetPath = pageId === 'store-admin'
      ? `/store-admin/${slug}`
      : `/storefront/${slug}`;
    const targetUrl = baseOrigin + targetPath;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  // Block any attempts to navigate away to main marketplace pages when viewing a standalone storefront
  if (document.body.classList.contains('is-storefront-view')) {
    if (pageId !== 'storefront' && pageId !== 'store-admin' && pageId !== 'auth' && pageId !== 'cart') {
      console.warn(`[Standalone Storefront] Blocked navigation to main site page "${pageId}".`);
      return;
    }
  }

  if (pageId === 'storefront' || pageId === 'store-admin') {
    const splash = document.getElementById('pwa-splash-screen');
    if (splash) splash.remove();
  }

  // Capture the entity currently displayed for this page BEFORE updating it —
  // the guard below compares against this value, and assigning first made
  // same-page navigation (product → product via "You may also like", store →
  // store, rendor → rendor) look like a no-op so clicks silently did nothing.
  const prevEntityId = getPageEntityId(pageId);

  if (entityId) {
    if (pageId === 'store-detail' || pageId === 'storefront' || pageId === 'store-admin') {
      App.currentStoreId = entityId;
    } else if (pageId === 'product') {
      App.currentProductId = entityId;
    } else if (pageId === 'rendor-profile') {
      App.currentRendorId = entityId;
    }
  }

  // Reset PWA manifest when leaving store detail, storefront or store-admin page
  if (pageId !== 'store-detail' && pageId !== 'storefront' && pageId !== 'store-admin') {
    updatePWAManifest('HAPPAMART', '/images/icon-192.png', '#e85d04');
  }

  // map dashboard route
  if (pageId === 'dashboard' || pageId === 'profile') {
    if (!App.currentUser) { showPage('auth'); return; }
    if (App.currentUser.role === 'admin')  { pageId = 'admin-dashboard'; }
    else if (App.currentUser.role === 'vendor' || App.currentUser.role === 'seller') { pageId = 'vendor-dashboard'; }
    else if (App.currentUser.role === 'rendor') { pageId = 'rendor-dashboard'; }
    else { pageId = 'buyer-dashboard'; }
  }

  const targetEntity = entityId || getPageEntityId(pageId);
  const currentEntity = prevEntityId;
  const targetEl = document.getElementById('page-' + pageId);
  if (App.currentPage === pageId && String(targetEntity || '') === String(currentEntity || '') && targetEl && targetEl.classList.contains('active') && targetEl.style.display !== 'none') {
    return;
  }

  App.prevPage = App.currentPage;
  App.currentPage = pageId;

  // The header search bar doubles as an order tracker on the cart page.
  if (window.updateHeaderSearchForPage) window.updateHeaderSearchForPage();

  // Push a browser-history entry so the mobile back button works.
  // Skip when we're already handling a popstate (browser-back) event.
  if (!App._skipPush) {
    try {
      let hash = '#' + pageId;
      if (targetEntity && ['store-detail', 'storefront', 'store-admin', 'product', 'rendor-profile'].includes(pageId)) {
        hash += '/' + targetEntity;
      }
      App._isProgrammaticNav = true;
      history.pushState({ page: pageId, entityId: targetEntity }, '', hash);
      setTimeout(() => { App._isProgrammaticNav = false; }, 100);
    } catch(e) { console.warn('history.pushState failed:', e); }
  }

  // Hide ALL pages completely
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const target = document.getElementById('page-' + pageId);
  if (!target) { console.warn('Unknown page:', pageId); return; }
  // Show target page
  target.classList.add('active');
  target.style.display = 'block';
  
  const cacheKey = getPageCacheKey(pageId);
  const isLoaded = !!App.loadedPages[cacheKey];

  if (isLoaded) {
    App.isBackgroundRefresh = true;
  } else {
    App.isBackgroundRefresh = false;
    // Inject skeletons while content loads asynchronously
    injectSkeletonLoaders(pageId);
  }
  
  const mainContent = document.getElementById('main-content');
  const topNavEl = document.getElementById('top-nav');
  const bNavEl = document.getElementById('bottom-nav');
  if (pageId === 'storefront' || pageId === 'store-admin') {
    document.body.classList.add('is-storefront-view');
    if (topNavEl) topNavEl.style.display = 'none';
    if (bNavEl) bNavEl.style.display = 'none';
    if (mainContent) {
      if (!App.isBackgroundRefresh && App.prevPage !== pageId) {
        mainContent.scrollTop = 0;
      }
      mainContent.style.height = '100vh';
      mainContent.style.paddingBottom = '0';
    }
  } else {
    document.body.classList.remove('is-storefront-view');
    document.documentElement.classList.remove('is-storefront-root');
    App.isStandaloneStorefront = false;
    if (topNavEl) topNavEl.style.display = '';
    if (bNavEl) bNavEl.style.display = '';
    if (mainContent) {
      if (!App.isBackgroundRefresh && App.prevPage !== pageId) {
        mainContent.scrollTop = 0;
      }
      mainContent.style.height = '';
      mainContent.style.paddingBottom = '';
    }
  }

  // update bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  const navMap = { home:'home', marketplace:'marketplace', stores:'stores', cart:'cart',
    'buyer-dashboard':'profile', 'vendor-dashboard':'profile', 'admin-dashboard':'profile', auth:'profile',
    'vendor-my-store':'stores', 'vendor-orders':'orders', 'rendor-dashboard':'profile',
    'rendor-profile':'marketplace' };
  const nid = navMap[pageId];
  if (nid) {
    const el = document.getElementById('bnav-' + nid);
    if (el) el.classList.add('active');
  }

  // ── Adjust top nav & bottom nav visibility based on role ──
  updateNavForUser();

  // Run the page init asynchronously, and clear background refresh status afterwards
  runPageInit(pageId).finally(() => {
    App.isBackgroundRefresh = false;
  });
}
function goBack() {
  const isStorefront = document.body.classList.contains('is-storefront-view') || App.currentPage === 'storefront';
  if (isStorefront) {
    const sfModal = document.getElementById('sf-product-modal') || document.querySelector('.storefront-modal.active');
    if (sfModal && sfModal.style.display !== 'none') {
      sfModal.style.display = 'none';
      return;
    }
    if (window.currentStorefrontTab && window.currentStorefrontTab !== 'home' && App.currentStoreId) {
      switchStorefrontTab('home', App.currentStoreId);
      return;
    }
    if (App.currentStoreId) {
      showPage('storefront', App.currentStoreId);
      if (typeof switchStorefrontTab === 'function') switchStorefrontTab('home', App.currentStoreId);
      return;
    }
    return;
  }

  // If there is real browser history to go back to, use it so the
  // history stack stays consistent. Otherwise fall back to prevPage.
  if (window.history.length > 1) {
    window.history.back();
  } else {
    showPage(App.prevPage || 'home');
  }
}

function handleProfileClick() {
  if (!App.currentUser) { showPage('auth'); return; }
  // If in preview mode, show exit option
  if (App.currentUser._is_admin_preview) {
    if (confirm('You are in preview mode. Exit and return to Admin Panel?')) {
      exitPreviewMode();
    }
    return;
  }
  showPage('dashboard');
}

function toggleProfileMenu(event) {
  event.stopPropagation();
  if (!App.currentUser) {
    showPage('auth');
    return;
  }
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  closeProfileMenu();
  if (isHidden) {
    dropdown.classList.remove('hidden');
  }
}

function closeProfileMenu() {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

function renderSettingsPage() {
  const el = document.getElementById('settings-page-content');
  if (!el) return;
  if (!App.currentUser) { showPage('auth'); return; }
  const u = App.currentUser;
  el.innerHTML = `
    <div class="dashboard-wrap">

      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>👤 Profile Settings</h3></div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input class="form-control" id="set-name" value="${escHtml(u.name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-control" id="set-phone" value="${escHtml(u.phone || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-control" value="${escHtml(u.email || '')}" disabled style="opacity:.6;cursor:not-allowed">
          </div>
          <div class="form-group">
            <label class="form-label">Location</label>
            <input class="form-control" id="set-loc" type="text" value="${escHtml(u.location || '')}" placeholder="Start typing your city…" onfocus="if(typeof initLocationAutocomplete==='function')initLocationAutocomplete('set-loc',LOCATIONS)">
          </div>
          <button class="btn btn-primary btn-sm" onclick="saveProfileSettings('${u.id}')">
            <i class="fas fa-save"></i> Save Changes
          </button>
        </div>
      </div>

      ${(u.role === 'vendor' || u.role === 'seller') ? `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>📲 WhatsApp Order Notifications</h3></div>
        <div class="card-body">
          <p style="font-size:.78rem;color:var(--text-muted);margin:0 0 12px">
            When a customer places an order in your store, we'll send you a WhatsApp message with the order details.
          </p>
          <div class="form-group">
            <label class="form-label">WhatsApp Number (E.164 format, e.g. +23320xxxxxxx)</label>
            <input class="form-control" id="set-wa-phone" placeholder="+23320xxxxxxx" value="${escHtml(u.whatsapp_phone || '')}">
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="set-wa-enabled" ${u.receive_order_notifications_on_whatsapp ? 'checked' : ''} style="width:18px;height:18px">
            <label for="set-wa-enabled" style="margin:0;font-size:.82rem">Receive WhatsApp notifications when a customer places an order</label>
          </div>
          <button class="btn btn-primary btn-sm" onclick="saveProfileSettings('${u.id}')">
            <i class="fas fa-save"></i> Save Changes
          </button>
        </div>
      </div>
      ` : ''}

      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>🔔 Notification Preferences</h3></div>
        <div class="card-body">
          <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 12px">Control what notifications you receive from HAPPA TRADEMART.</p>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <input type="checkbox" id="set-notif-orders" ${u.notify_orders !== false ? 'checked' : ''} style="width:18px;height:18px">
            <label for="set-notif-orders" style="margin:0;font-size:.82rem">Order updates (status changes, delivery)</label>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <input type="checkbox" id="set-notif-marketing" ${u.notify_marketing === true ? 'checked' : ''} style="width:18px;height:18px">
            <label for="set-notif-marketing" style="margin:0;font-size:.82rem">Promotional emails and offers</label>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <input type="checkbox" id="set-notif-support" ${u.notify_support !== false ? 'checked' : ''} style="width:18px;height:18px">
            <label for="set-notif-support" style="margin:0;font-size:.82rem">Support ticket replies</label>
          </div>
          <button class="btn btn-primary btn-sm" onclick="saveNotificationPrefs('${u.id}')">
            <i class="fas fa-save"></i> Save Preferences
          </button>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>🎧 Customer Care</h3></div>
        <div class="card-body">
          <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 10px">Questions about your order, wallet, or store? Contact our support team or open a ticket.</p>
          <button class="btn btn-primary btn-sm btn-block" onclick="showPage('support')">
            <i class="fas fa-headset"></i> Help &amp; Support
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>🔒 Account</h3></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-outline btn-sm btn-block" onclick="showPage('privacy')">
            <i class="fas fa-shield-alt"></i> Privacy Policy
          </button>
          <button class="btn btn-outline btn-sm btn-block" onclick="requestAccountDeletion()">
            <i class="fas fa-user-times"></i> Request Account Deletion
          </button>
          <button class="btn btn-danger btn-sm btn-block" onclick="logout()">
            <i class="fas fa-sign-out-alt"></i> Sign Out
          </button>
        </div>
      </div>

    </div>
  `;
}

// ── Update nav visibility based on current user role ─────
function updateNavForUser() {
  const role = App.currentUser?.role || 'guest';
  const isPreview = App.currentUser?._is_admin_preview;
  const isAdmin   = role === 'admin' && !isPreview;
  const isVendor  = (role === 'vendor' || role === 'seller') && !isPreview;
  const isRendor  = role === 'rendor' && !isPreview;

  const isStorefront = App.currentPage === 'storefront' || App.currentPage === 'store-admin';

  // Top Nav visibility
  const topNav = document.getElementById('top-nav');
  if (topNav) {
    topNav.style.display = isStorefront ? 'none' : '';
  }

  // Cart button in top nav — only visible to buyers (or preview mode as buyer)
  const cartBtn   = document.querySelector('.nav-icon-btn[onclick*="cart"]');
  const cartBnav  = document.getElementById('bnav-cart');
  const isBuyer   = role === 'buyer' || (isPreview && role === 'buyer');

  if (cartBtn)  cartBtn.style.display  = (isBuyer && !isStorefront) ? '' : 'none';
  if (cartBnav) cartBnav.style.display = (isBuyer && !isStorefront) ? '' : 'none';

  // Bottom nav — hide entirely for admins or when on a storefront
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    if (isAdmin || isStorefront) {
      bottomNav.style.display = 'none';
      document.body.style.paddingBottom = '0';
    } else {
      bottomNav.style.display = '';
      document.body.style.paddingBottom = '';
    }
  }

  // Bottom-nav marketplace item: relabel based on role
  const bnavMarket = document.getElementById('bnav-marketplace');
  if (bnavMarket) {
    // All roles: show Shop / Marketplace
    bnavMarket.innerHTML = '<i class="fas fa-th-large"></i><span>Shop</span>';
    bnavMarket.onclick = () => showPage('marketplace');
  }

  // Bottom-nav orders item (vendor only)
  const bnavOrders = document.getElementById('bnav-orders');
  if (bnavOrders) {
    bnavOrders.style.display = isVendor ? '' : 'none';
  }

  // Bottom-nav stores item:
  //   • Vendors → "My Store" (links to vendor-my-store page)
  //   • Everyone else → "Stores" (links to public stores page)
  const bnavStores = document.getElementById('bnav-stores');
  if (bnavStores) {
    if (isVendor) {
      bnavStores.innerHTML = '<i class="fas fa-store"></i><span>My Store</span>';
      bnavStores.onclick = () => showPage('vendor-my-store');
    } else {
      bnavStores.innerHTML = '<i class="fas fa-store"></i><span>Stores</span>';
      bnavStores.onclick = () => showPage('stores');
    }
  }

  // Cart hidden for rendors (they don't shop)
  if (isRendor) {
    if (cartBtn)  cartBtn.style.display  = 'none';
    if (cartBnav) cartBnav.style.display = 'none';
  }
}

// ── Vendor My Store — renders as a full home page section ─
function showVendorMyStore() {
  if (!App.currentUser || (App.currentUser.role !== 'vendor' && App.currentUser.role !== 'seller')) {
    showPage('marketplace');
    return;
  }
  showPage('vendor-my-store');
}

// ── Vendor My Store — full page renderer ─────────────────
async function renderVendorMyStorePage() {
  const el = document.getElementById('vendor-my-store-content');
  if (!el) return;
  if (!App.currentUser) { showPage('auth'); return; }

  const u = App.currentUser;
  // Fetch vendor's store
  const storeRes = await apiGet('stores', 'limit=200');
  const myStore  = (storeRes?.data || []).find(s => s.vendor_id === u.id);

  if (!myStore) {
    el.innerHTML = `
<div class="dashboard-wrap">
  <div class="empty-state" style="padding:60px 20px">
    <i class="fas fa-store-slash" style="font-size:2.5rem;color:var(--text-muted)"></i>
    <h3 style="margin-top:12px">No Store Assigned Yet</h3>
    <p>Your store will be set up by admin after account approval.</p>
    <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showPage('vendor-dashboard')">
      <i class="fas fa-arrow-left"></i> Back to Dashboard
    </button>
  </div>
</div>`;
    return;
  }

  // Fetch fresh store + products
  const freshStore = await apiFetch('stores/' + myStore.id) || myStore;
  const prodRes    = await apiGet('products', `search=${myStore.id}&limit=100`);
  const products   = (prodRes?.data || []).filter(p => p.store_id === myStore.id && p.status !== 'archived');

  // Compute total sales and orders from vendor's active packages as reliable fallback
  const vendorId = App.currentUser?.id;
  const pkgRes = vendorId ? await apiGet('packages', `vendor_id=${encodeURIComponent(vendorId)}`).catch(() => null) : null;
  const vendorPkgs = (pkgRes?.data || (Array.isArray(pkgRes) ? pkgRes : [])).filter(p => String(p.vendor_id) === String(vendorId));
  const activePkgs = vendorPkgs.filter(p => p.status !== 'cancelled' && p.vendor_status !== 'rejected');

  const calcSales = activePkgs.reduce((sum, p) => sum + (parseFloat(p.gross_amount || p.vendor_amount || p.total) || 0), 0);
  const calcOrders = activePkgs.length;

  const displaySales = Math.max(parseFloat(freshStore.total_sales || 0), calcSales);
  const displayOrders = Math.max(parseInt(freshStore.total_orders || 0), calcOrders);

  const stars  = renderStars(freshStore.avg_rating || 0);

  el.innerHTML = `
<div style="padding-bottom:20px">
  <!-- Banner -->
  <div style="position:relative">
    <img src="${freshStore.banner_url||'https://via.placeholder.com/800x200?text=Store+Banner'}"
         style="width:100%;height:140px;object-fit:cover"
         onerror="this.src='https://via.placeholder.com/800x200?text=Store+Banner'">
    <!-- Logo overlay -->
    <div style="position:absolute;bottom:-28px;left:16px;width:60px;height:60px;border-radius:50%;border:3px solid #fff;overflow:hidden;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15)">
      <img src="${freshStore.logo_url||'https://via.placeholder.com/80x80?text=Logo'}"
           style="width:100%;height:100%;object-fit:cover"
           onerror="this.src='https://via.placeholder.com/80x80?text=S'">
    </div>
  </div>

  <!-- Store Info -->
  <div style="padding:40px 16px 0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div>
        <div style="font-weight:800;font-size:1.1rem">${escHtml(freshStore.name)}</div>
        <div style="font-size:.8rem;color:var(--text-muted)">${escHtml(freshStore.category||'')}</div>
      </div>
      <span class="status-badge status-${freshStore.status}">${freshStore.status}</span>
    </div>
    <div style="font-size:.8rem;color:var(--text-light);margin-bottom:8px">
      <i class="fas fa-map-marker-alt" style="color:var(--primary)"></i> ${escHtml(freshStore.location || '')}
    </div>
    <div style="font-size:.8rem;margin-bottom:10px">${stars} <span style="color:var(--text-muted)">(${freshStore.review_count||0} reviews)</span></div>
    ${freshStore.description ? `<p style="font-size:.82rem;color:var(--text-light);margin-bottom:12px;line-height:1.6">${escHtml(freshStore.description)}</p>` : ''}

    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div class="stat-card" style="text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:var(--primary)">${products.length}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">Products</div>
      </div>
      <div class="stat-card" style="text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:var(--success)">GHS ${displaySales.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">Total Sales</div>
      </div>
      <div class="stat-card" style="text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:var(--secondary)">${displayOrders}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">Orders</div>
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="editStoreInfo('${freshStore.id}')">
        <i class="fas fa-edit"></i> Edit Store
      </button>
      <button class="btn btn-outline btn-sm" onclick="showPage('vendor-dashboard')">
        <i class="fas fa-tachometer-alt"></i> Dashboard
      </button>
    </div>

    <!-- Products section -->
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="font-size:.9rem;font-weight:700;margin:0">Products (${products.length})</h3>
        <button class="btn btn-primary btn-sm" onclick="showAddProductModal('${freshStore.id}','${u.id}')">
          <i class="fas fa-plus"></i> Add Product
        </button>
      </div>
      ${products.length ? `
      <div class="product-grid">
        ${products.map(p => vendorProductCardHTML(p)).join('')}
      </div>` : `
      <div class="empty-state" style="padding:30px">
        <i class="fas fa-box-open"></i>
        <h3>No products yet</h3>
        <p>Add your first product to start selling</p>
      </div>`}
    </div>
  </div>
</div>`;
}

// ── Vendor Orders Page ────────────────────────────────────
async function renderVendorOrdersPage() {
  const el = document.getElementById('vendor-orders-page-content');
  if (!el) return;
  if (!App.currentUser) { showPage('auth'); return; }

  const u = App.currentUser;
  if (!App.isBackgroundRefresh) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading orders…</div>';
  }

  const pkgRes     = await apiGet('packages', `vendor_id=${encodeURIComponent(u.id)}&limit=200`);
  const myPackages = (pkgRes?.data || []).filter(p => String(p.vendor_id) === String(u.id));

  el.innerHTML = `
<div style="padding:12px 16px 8px">
  <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">
    Receive → Process → wait for admin dispatch. Reject if you cannot fulfil.
  </p>
  <div id="vendor-orders-list">
    ${myPackages.length
      ? myPackages.map(pkg => packageDetailHTML(pkg)).join('')
      : '<div class="empty-state" style="padding:40px"><i class="fas fa-inbox"></i><h3>No orders yet</h3><p>New orders will appear here</p></div>'}
  </div>
</div>`;
}

async function refreshVendorOrdersPage() {
  await renderVendorOrdersPage();
  showToast('Orders refreshed', 'info');
}

// ── Local mock database for static deployment ─────────────────
function localDbKey(table) {
  return `happa_db_${table}`;
}
function parseQueryParams(qs) {
  const params = {};
  if (!qs) return params;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = pair.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    const value = decodeURIComponent(rawValue || '').trim().replace(/\+/g, ' ');
    if (key) params[key] = value;
  }
  return params;
}
function loadLocalTable(table) {
  const raw = localStorage.getItem(localDbKey(table));
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to parse local table', table, e);
    }
  }
  return seedLocalTable(table);
}
function saveLocalTable(table, data) {
  try {
    localStorage.setItem(localDbKey(table), JSON.stringify(data || []));
    return true;
  } catch (e) {
    // Most common cause: QuotaExceededError — base64 images are too big.
    // Try to recover by removing the oldest image-heavy products and retrying.
    if (table === 'products' && e && e.name === 'QuotaExceededError') {
      try {
        const trimmed = trimProductsForQuota(data || []);
        localStorage.setItem(localDbKey(table), JSON.stringify(trimmed));
        console.warn('[LocalDB] Quota exceeded — trimmed older product images to fit. Lost data:',
          (data || []).length - trimmed.length, 'products');
        return true;
      } catch (e2) {
        console.error('[LocalDB] save failed even after trim:', e2);
        throw new Error('Browser storage is full. Try removing some products or images.');
      }
    }
    console.error('[LocalDB] save failed:', e);
    throw e;
  }
}

// Drop the images of the oldest products so a new one fits in localStorage.
// We keep the product records but strip their base64 image arrays to reduce footprint.
function trimProductsForQuota(products) {
  const working = (products || []).map(p => ({ ...p }));
  let iterations = 0;
  while (working.length && iterations < 100) {
    iterations++;
    try {
      const blob = JSON.stringify(working);
      if (blob.length < 3.2 * 1024 * 1024) break;
      let victim = null;
      for (let i = working.length - 1; i >= 0; i--) {
        if (Array.isArray(working[i].images) && working[i].images.length > 0) {
          victim = working[i];
          break;
        }
      }
      if (victim) {
        if (victim.images.length > 1) {
          victim.images = [victim.images[0]];
        } else {
          victim.images = [];
        }
      } else {
        if (working.length > 1) {
          working.pop();
        } else {
          break;
        }
      }
    } catch (_) { break; }
  }
  return working;
}
function seedLocalTable(table) {
  let data = [];
  if (table === 'users') {
    data = [
      {
        id: 'admin',
        name: 'Admin User',
        email: 'admin@happatrademart.com',
        phone: '0000000000',
        password_hash: 'admin123',
        role: 'admin',
        status: 'active',
        location: 'Accra',
        wallet_balance: 0,
        referral_code: 'ADMIN001',
        registered_at: new Date().toISOString()
      },
      {
        id: 'vendor',
        name: 'Kwame Mensah',
        email: 'kwame@test.com',
        phone: '0240000000',
        password_hash: 'vendor123',
        role: 'vendor',
        status: 'active',
        location: 'Kumasi',
        wallet_balance: 0,
        referral_code: 'KMEN001',
        registered_at: new Date().toISOString()
      },
      {
        id: 'buyer',
        name: 'Ama Serwaa',
        email: 'ama@test.com',
        phone: '0540000000',
        password_hash: 'buyer123',
        role: 'buyer',
        status: 'active',
        location: 'Takoradi',
        wallet_balance: 0,
        referral_code: 'AMA001',
        registered_at: new Date().toISOString()
      },
      {
        id: 'rendor',
        name: 'Nana Ama',
        email: 'nana@test.com',
        phone: '0200000000',
        password_hash: 'rendor123',
        role: 'rendor',
        status: 'active',
        location: 'Accra',
        wallet_balance: 0,
        referral_code: 'NANA001',
        registered_at: new Date().toISOString(),
        is_verified: true,
        id_verified: true,
        rendor_display_name: 'Nana Creative',
        rendor_service_cat: 'Graphic Design',
        rendor_bio: 'I create scroll-stopping visuals for brands, businesses and entrepreneurs across Ghana. From logos and social media content to full brand kits — I\'ve got you covered. Fast delivery, clean designs, affordable rates.',
        rendor_starting_price: 120,
        rendor_tags: ['branding', 'logo design', 'social media', 'flyers', 'business cards'],
        rendor_whatsapp: '0249999999',
        rendor_email: 'nana@test.com',
        rendor_instagram: '@nana.creative',
        rendor_twitter: '@nana_creative',
        rendor_facebook: 'Nana Creative',
        rendor_website: 'https://example.com',
        rendor_contact_other: 'Available Mon–Sat, 8am–8pm. WhatsApp preferred.',
        rendor_sub_status: 'active',
        rendor_sub_expiry: '1800000000000',
        rendor_sub_plan: 'monthly'
      }
    ];
  } else if (table === 'services') {
    data = [
      {
        id: 'svc-1',
        rendor_id: 'rendor',
        title: 'Social Media Content Pack',
        category: 'Graphic Design',
        description: 'Get 10 custom-designed social media posts for Instagram, Facebook or TikTok. Includes branded templates, captions and a cover image. Perfect for launching or refreshing your online presence.',
        price: 200,
        image_url: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-2',
        rendor_id: 'rendor',
        title: 'Logo & Brand Identity Design',
        category: 'Graphic Design',
        description: 'Full brand identity package — logo (3 concepts), colour palette, typography guide, and business card design. Delivered in PNG, SVG and PDF formats. Ideal for new businesses and rebrands.',
        price: 350,
        image_url: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-3',
        rendor_id: 'rendor',
        title: 'Event Flyer & Poster Design',
        category: 'Graphic Design',
        description: 'Eye-catching flyer or poster design for any event — parties, concerts, seminars, product launches. Turnaround in 24 hours. Includes 2 revision rounds. Print-ready and digital formats included.',
        price: 80,
        image_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-4',
        rendor_id: 'rendor',
        title: 'Business Card Design',
        category: 'Graphic Design',
        description: 'Professional double-sided business card design. Clean, modern layouts that reflect your brand. Delivered ready for print. Add-on: digital VCard version available on request.',
        price: 60,
        image_url: 'https://images.unsplash.com/photo-1598520106830-8c45c2035460?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      },
      {
        id: 'svc-5',
        rendor_id: 'rendor',
        title: 'WhatsApp & Telegram Broadcast Design',
        category: 'Graphic Design',
        description: 'Branded graphics and message templates for your WhatsApp Business or Telegram channel. Includes promo banners, product highlight cards and story-size visuals. Great for daily posts.',
        price: 120,
        image_url: 'https://images.unsplash.com/photo-1611746872915-64382b5c76da?w=600&q=80',
        status: 'active',
        created_at: new Date().toISOString()
      }
    ];
  } else if (table === 'settings') {
    data = [
      {
        id: 'vendor_auto_approve',
        key: 'vendor_auto_approve',
        value: 'false',
        label: 'Vendor Auto Approve',
        type: 'text',
        updated_at: new Date().toISOString()
      }
    ];
  } else if (table === 'ad_campaigns') {
    data = [
      {
        id: 'adc-default-1',
        name: 'Featured Platform Store Banners',
        status: 'active',
        pages: ['home', 'shop', 'stores'],
        store_ids: [],
        store_budgets: '{}',
        interval_value: 3,
        interval_unit: 'seconds',
        show_store_name: true,
        start_date: Date.now() - 86400000,
        end_date: Date.now() + (365 * 86400000),
        created_at: new Date().toISOString()
      }
    ];
  }
  saveLocalTable(table, data);
  return data;
}
function getTableId(table, record) {
  if (record && record.id != null) return String(record.id);
  return `${table.slice(0,3)}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}
function normalizeRecord(record) {
  return {
    ...record,
    id: record.id != null ? String(record.id) : getTableId('item')
  };
}
function matchesSearch(record, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return Object.values(record).some(value => {
    if (value == null) return false;
    return String(value).toLowerCase().includes(needle);
  });
}
function applyFilters(data, params) {
  let result = [...data];
  const { search, limit, page, sort, ...filters } = params;
  if (search) {
    result = result.filter(record => matchesSearch(record, search));
  }
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    result = result.filter(record => String(record[key] ?? '').toLowerCase() === value.toLowerCase());
  }
  if (sort) {
    result.sort((a, b) => {
      const aVal = a[sort];
      const bVal = b[sort];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') return bVal - aVal;
      return String(bVal).localeCompare(String(aVal));
    });
  }
  const max = parseInt(limit, 10);
  const pageNum = parseInt(page, 10) || 1;
  if (!Number.isNaN(max) && max > 0) {
    const start = (pageNum - 1) * max;
    result = result.slice(start, start + max);
  }
  return result;
}
function localTablesApi(table, opts = {}) {
  let [path, queryString = ''] = table.split('?');
  // Server-only helper endpoint (used by signup): offline mode has no
  // authoritative data — report non-existence so signup proceeds locally.
  if (path === 'auth/check-email') {
    return (opts.method || 'GET').toUpperCase() === 'POST' ? { exists: false } : null;
  }
  // Legacy alias: old code wrote to a `transactions` table nothing reads — route
  // those writes into the visible wallet ledger here too (mirrors the server shim).
  if (path === 'transactions' || path.startsWith('transactions/')) {
    path = 'wallet_transactions' + path.slice('transactions'.length);
  }
  const [tableName, id] = path.split('/');
  const params = parseQueryParams(queryString);
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : {};
  const tableData = loadLocalTable(tableName);

  if (method === 'GET') {
    if (id) {
      return tableData.find(item => String(item.id) === String(id)) || null;
    }
    return { data: applyFilters(tableData, params) };
  }

  if (method === 'POST') {
    const record = normalizeRecord(body);
    saveLocalTable(tableName, [...tableData, record]);
    return record;
  }

  if (method === 'PUT' || method === 'PATCH') {
    if (!id) return null;
    let found = false;
    const updatedData = tableData.map(item => {
      if (String(item.id) !== String(id)) return item;
      found = true;
      return { ...item, ...body, id: String(id) };
    });
    if (!found) {
      updatedData.push({ id: String(id), ...body });
    }
    saveLocalTable(tableName, updatedData);
    return updatedData.find(item => String(item.id) === String(id)) || { id: String(id), ...body };
  }

  if (method === 'DELETE') {
    if (!id) return null;
    const remaining = tableData.filter(item => String(item.id) !== String(id));
    saveLocalTable(tableName, remaining);
    return { success: true };
  }

  return null;
}

// ── API Helpers ───────────────────────────────────────────
const apiCache = {
  data: {},
  get(key) {
    const entry = this.data[key];
    if (entry && (Date.now() - entry.timestamp < 30000)) { // 30 seconds cache TTL
      return entry.promise;
    }
    return null;
  },
  set(key, promise) {
    this.data[key] = {
      promise,
      timestamp: Date.now()
    };
  },
  clear() {
    this.data = {};
  }
};

function getAuthToken() {
  return localStorage.getItem('happa_auth_token') || '';
}

function setAuthToken(token) {
  if (token) {
    localStorage.setItem('happa_auth_token', token);
  } else {
    localStorage.removeItem('happa_auth_token');
  }
}

async function apiFetch(table, opts = {}) {
  if (API === 'tables/') {
    return localTablesApi(table, opts);
  }

  const token = getAuthToken();
  const headers = { ...(opts.headers || {}) };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = API + table;
  const method = (opts.method || 'GET').toUpperCase();
  const isWrite = method !== 'GET';
  try {
    let resp;
    try {
      resp = await fetch(url, { ...opts, headers });
      if (!resp.ok && url.startsWith('/api/') && window.location.port !== '9000') {
        resp = await fetch('http://localhost:9000' + url, { ...opts, headers });
      }
    } catch (netErr) {
      if (url.startsWith('/api/') && window.location.port !== '9000') {
        resp = await fetch('http://localhost:9000' + url, { ...opts, headers });
      } else {
        throw netErr;
      }
    }
    if (!resp || !resp.ok) {
      let errDetail = `HTTP ${resp ? resp.status : 'Error'}`;
      try {
        const errJson = await resp.json();
        if (errJson && (errJson.error || errJson.message)) {
          errDetail += `: ${errJson.error || errJson.message}`;
        }
      } catch(_) {}
      const err = new Error(errDetail);
      err.status = resp ? resp.status : 0;
      throw err;
    }
    if (resp.status === 204) return { success: true };
    return await resp.json();
  } catch(e) {
    console.warn('API Error:', table, e);
    window.lastApiError = e.message || String(e);
    // Writes (POST/PATCH/PUT/DELETE) must NEVER silently fall back to localStorage
    // on a server error: an order that "succeeds" only in the local browser is
    // invisible to the vendor, buyer and admin. Only a pure network failure
    // (offline) may fall back so the offline mode keeps working.
    const isNetworkFailure = !e || !e.status || e.status === 0;
    if (isWrite && !isNetworkFailure) {
      console.error('[API] Write rejected by server — NOT saving locally:', table, e.message);
      window.lastApiError = 'Server rejected the save: ' + (e.message || 'unknown error');
      return null;
    }
    try {
      const localRes = localTablesApi(table, opts);
      if (localRes) return localRes;
      // local returned null but no error — surface a clear message
      window.lastApiError = window.lastApiError || 'Server unavailable and local storage returned no result';
    } catch(localErr) {
      window.lastApiError = localErr.message || String(localErr);
    }
    return null;
  }
}
async function apiGet(table, params = '') {
  const cacheKey = table + (params ? '?' + params : '');
  let cachedPromise = apiCache.get(cacheKey);
  if (!cachedPromise) {
    cachedPromise = apiFetch(table + (params ? '?' + params : ''));
    apiCache.set(cacheKey, cachedPromise);
  }
  return cachedPromise;
}
function invalidateAppState(table = '') {
  apiCache.clear();
  delete App.loadedPages['admin-dashboard'];
  delete App.loadedPages['vendor-dashboard'];
  delete App.loadedPages['vendor-orders'];
  delete App.loadedPages['buyer-dashboard'];
  delete App.loadedPages['notifications'];
}

async function apiPost(table, data) {
  invalidateAppState(table);
  return apiFetch(table, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiPut(table, id, data) {
  invalidateAppState(table);
  return apiFetch(table + '/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiPatch(table, id, data) {
  invalidateAppState(table);
  return apiFetch(table + '/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiDelete(table, id) {
  invalidateAppState(table);
  return apiFetch(table + '/' + id, { method: 'DELETE' });
}

// Server-side wallet engine calls (POST /api/wallet/:action). The only way a
// balance-changing ledger row is created — the client never patches
// wallet_balance or wallet_transactions directly.
async function apiWallet(action, data) {
  return apiFetch('wallet/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {})
  });
}

// Remove a product from every in-memory cache so a deleted product can't keep
// rendering on the home page, shop, storefront, search results or the admin's
// vendor-profile view. Every delete path (admin, vendor, storefront, auto-cleanup)
// must call this after the server confirms the delete.
function removeProductFromCaches(productId) {
  const id = String(productId);
  if (Array.isArray(App.allProducts)) {
    App.allProducts = App.allProducts.filter(p => String(p.id) !== id);
  }
  // Admin vendor-profile cache (admin-profiles.js) may hold the product too
  if (window._apCache && typeof window._apCache === 'object') {
    Object.keys(window._apCache).forEach(uid => {
      const entry = window._apCache[uid];
      if (entry && Array.isArray(entry.products)) {
        entry.products = entry.products.filter(p => String(p.id) !== id);
      }
    });
  }
  // Ad banners keep their own product copy (ads.js / admin.js)
  if (typeof AdEngine !== 'undefined' && AdEngine && Array.isArray(AdEngine.products)) {
    AdEngine.products = AdEngine.products.filter(p => String(p.id) !== id);
  }
  apiCache.clear();
}

// ── WhatsApp link helper ─────────────────────────────────
// Build a wa.me link from a phone number (any format). Returns '' if no digits.
function waMeHref(number) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

// ── Settings Helper ───────────────────────────────────────
async function getSetting(key, defaultValue = '') {
  try {
    const res = await apiGet('settings', `search=${encodeURIComponent(key)}&limit=5`);
    const settings = res?.data || [];
    const setting = settings.find(s => s.key === key);
    return setting ? setting.value : defaultValue;
  } catch(e) {
    return defaultValue;
  }
}

// ── Commission Calculator ─────────────────────────────────
function getCommission(price) {
  for (const [min, max, pct] of COMMISSION) {
    if (price >= min && price <= max) return pct;
  }
  return 2;
}

// ── Package Code Generator ────────────────────────────────
function generatePackageCode(location) {
  const prefix = LOCATION_PREFIXES[location] || 'XX';
  const num = Math.floor(10000 + Math.random() * 89999);
  return `${prefix}-${num}`;
}

// ── Next Saturday Calculator ──────────────────────────────
function getNextSaturday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const diff = (6 - day + 7) % 7 || 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() + diff);
  sat.setHours(8, 0, 0, 0);
  return sat;
}

// ── Flash Sale Countdown & Group Rotation ──────────────────
function syncFlashSaleStates() {
  if (!App.allProducts || !App.allProducts.length) return;

  const allFlash = App.allProducts.filter(p => p.is_flash_sale_flag || p.is_flash_sale);
  allFlash.forEach(p => {
    if (p.is_flash_sale_flag === undefined) {
      p.is_flash_sale_flag = p.is_flash_sale;
    }
  });

  allFlash.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Distribute items into 5 groups
  const groups = [[], [], [], [], []];
  allFlash.forEach((p, idx) => {
    let groupIdx;
    if (idx < 25) {
      groupIdx = Math.floor(idx / 5);
    } else {
      groupIdx = (idx - 25) % 5;
    }
    groups[groupIdx].push(p);
  });

  const activeGroupsCount = groups.filter(g => g.length > 0).length;
  const fiveHoursMs = 5 * 3600 * 1000;
  const nowMs = Date.now();
  
  let activeGroupIndex = -1;
  let nextResetTime;
  let isPaused = false;

  if (activeGroupsCount === 1) {
    const cycleMs = 15 * 3600 * 1000;
    const positionInCycle = nowMs % cycleMs;
    if (positionInCycle < fiveHoursMs) {
      activeGroupIndex = 0;
      nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + fiveHoursMs);
    } else {
      activeGroupIndex = -1;
      nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + cycleMs);
      isPaused = true;
    }
  } else if (activeGroupsCount === 2) {
    const cycleMs = 20 * 3600 * 1000;
    const positionInCycle = nowMs % cycleMs;
    if (positionInCycle < fiveHoursMs) {
      activeGroupIndex = 0;
      nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + fiveHoursMs);
    } else if (positionInCycle < 2 * fiveHoursMs) {
      activeGroupIndex = -1;
      nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + 2 * fiveHoursMs);
      isPaused = true;
    } else if (positionInCycle < 3 * fiveHoursMs) {
      activeGroupIndex = 1;
      nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + 3 * fiveHoursMs);
    } else {
      activeGroupIndex = -1;
      nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + cycleMs);
      isPaused = true;
    }
  } else if (activeGroupsCount > 2) {
    const cycleMs = activeGroupsCount * fiveHoursMs;
    const positionInCycle = nowMs % cycleMs;
    const periodIdx = Math.floor(positionInCycle / fiveHoursMs);
    activeGroupIndex = periodIdx;
    nextResetTime = new Date(Math.floor(nowMs / cycleMs) * cycleMs + (periodIdx + 1) * fiveHoursMs);
  } else {
    activeGroupIndex = -1;
    nextResetTime = new Date(nowMs + fiveHoursMs);
  }

  App.flashSaleEnd = nextResetTime;
  App.flashSaleState = isPaused ? 'paused' : 'active';

  let stateChanged = false;
  groups.forEach((groupItems, gIdx) => {
    const isThisGroupActive = (gIdx === activeGroupIndex);
    groupItems.forEach(p => {
      const shouldBeFlash = isThisGroupActive;
      if (p.is_flash_sale !== shouldBeFlash) {
        p.is_flash_sale = shouldBeFlash;
        stateChanged = true;
      }
      if (shouldBeFlash) {
        if (p.original_price && p.original_price > p.price) {
          // Keep it
        } else {
          p.original_price = p.price;
          p.price = Math.round(p.price * 0.8 * 100) / 100;
        }
      } else {
        if (p.original_price) {
          p.price = p.original_price;
        }
      }
    });
  });

  if (stateChanged && typeof renderFlashSale === 'function') {
    renderFlashSale();
  }
}

function initCountdown() {
  syncFlashSaleStates();
  updateCountdown();
  setInterval(() => {
    syncFlashSaleStates();
    updateCountdown();
  }, 1000);
}
function updateCountdown() {
  if (!App.flashSaleEnd) return;
  const now = new Date();
  let diff = Math.max(0, App.flashSaleEnd - now);
  const h = String(Math.floor(diff / 3600000)).padStart(2,'0');
  diff %= 3600000;
  const m = String(Math.floor(diff / 60000)).padStart(2,'0');
  diff %= 60000;
  const s = String(Math.floor(diff / 1000)).padStart(2,'0');
  const eh = document.getElementById('cd-h');
  const em = document.getElementById('cd-m');
  const es = document.getElementById('cd-s');
  if (eh) eh.textContent = h;
  if (em) em.textContent = m;
  if (es) es.textContent = s;

  // Sync banner dynamic status title
  const bannerTitle = document.getElementById('flash-sale-banner-title');
  if (bannerTitle) {
    bannerTitle.textContent = (App.flashSaleState === 'paused') ? 'Next Sale Starts In' : 'Limited Time Deals';
  }

  // Sync detail page countdown values
  document.querySelectorAll('.cd-detail-h').forEach(el => el.textContent = h);
  document.querySelectorAll('.cd-detail-m').forEach(el => el.textContent = m);
  document.querySelectorAll('.cd-detail-s').forEach(el => el.textContent = s);
}

// ── Load Home Data ────────────────────────────────────────
async function loadHomeData() {
  const MOCK_PRODUCTS = []; const MOCK_PRODUCTS_OLD = [
    {
      id: '1',
      name: 'Designer Sneakers',
      price: 199,
      original_price: 249,
      category: 'Sneakers',
      stock_qty: 12,
      images: ['product/d.jpg'],
      is_flash_sale: true,
      status: 'active',
      location: 'Accra',
      views: 1400,
      sold_count: 95,
      avg_rating: 4.9,
      store_id: '1',
      description: 'Elevate your footwear game with premium sneakers. Designed for comfort.'
    },
    {
      id: '2',
      name: 'Leather Sandals',
      price: 85,
      original_price: 120,
      category: 'Sandals',
      stock_qty: 25,
      images: ['product/photo_2026-05-30_17-19-10 - Copy.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Accra',
      views: 650,
      sold_count: 38,
      avg_rating: 4.5,
      store_id: '1',
      description: 'Handcrafted leather sandals. Durable straps and comfortable footbed.'
    },
    {
      id: '3',
      name: 'Chelsea Boots',
      price: 299,
      original_price: 349,
      category: 'Boots',
      stock_qty: 8,
      images: ['product/photo_2026-05-30_17-19-10.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Kumasi',
      views: 920,
      sold_count: 22,
      avg_rating: 4.8,
      store_id: '2',
      description: 'Classic Chelsea boots crafted from premium suede leather.'
    },
    {
      id: '4',
      name: 'Smart Watch Series 5',
      price: 450,
      original_price: 550,
      category: 'Electronics',
      stock_qty: 15,
      images: ['product/photo_2026-05-30_17-19-18.jpg'],
      is_flash_sale: true,
      status: 'active',
      location: 'Accra',
      views: 1800,
      sold_count: 110,
      avg_rating: 4.7,
      store_id: '1',
      description: 'Stay connected with notifications, fitness tracking, and battery life.'
    },
    {
      id: '5',
      name: 'Wireless Headphones',
      price: 280,
      original_price: 320,
      category: 'Audio',
      stock_qty: 18,
      images: ['product/photo_2026-05-30_17-19-27.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Kumasi',
      views: 1200,
      sold_count: 65,
      avg_rating: 4.6,
      store_id: '2',
      description: 'High-fidelity audio with active noise cancellation.'
    },
    {
      id: '6',
      name: 'Vitamin C Serum',
      price: 120,
      original_price: 150,
      category: 'Skincare',
      stock_qty: 40,
      images: ['product/photo_2026-05-30_17-19-35.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Tamale',
      views: 740,
      sold_count: 45,
      avg_rating: 4.8,
      store_id: '3',
      description: 'Brighten and smooth your skin with organic ingredients.'
    },
    {
      id: '7',
      name: 'Matte Lipstick Combo',
      price: 95,
      original_price: 130,
      category: 'Makeup',
      stock_qty: 30,
      images: ['product/photo_2026-05-30_17-19-44.jpg'],
      is_flash_sale: true,
      status: 'active',
      location: 'Tamale',
      views: 890,
      sold_count: 70,
      avg_rating: 4.5,
      store_id: '3',
      description: 'Vibrant matte shades that stay fresh all day.'
    },
    {
      id: '8',
      name: 'Leather Backpack',
      price: 180,
      original_price: 220,
      category: 'Accessories',
      stock_qty: 14,
      images: ['product/photo_2026-05-31_06-35-46.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Accra',
      views: 520,
      sold_count: 15,
      avg_rating: 4.4,
      store_id: '1',
      description: 'Spacious backpack for work, school, or travel.'
    },
    {
      id: '9',
      name: 'Running Shoes',
      price: 160,
      original_price: 210,
      category: 'Sneakers',
      stock_qty: 20,
      images: ['product/photo_2026-05-31_06-35-57.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Kumasi',
      views: 1100,
      sold_count: 80,
      avg_rating: 4.7,
      store_id: '2',
      description: 'Lightweight trainers designed for running performance.'
    },
    {
      id: '10',
      name: 'Comfort Slides',
      price: 50,
      original_price: 75,
      category: 'Sandals',
      stock_qty: 50,
      images: ['product/photo_2026-05-31_06-36-03.jpg'],
      is_flash_sale: true,
      status: 'active',
      location: 'Tamale',
      views: 1300,
      sold_count: 120,
      avg_rating: 4.6,
      store_id: '3',
      description: 'Perfect for quick errands and comfortable indoor wear.'
    },
    {
      id: '11',
      name: 'Classic Casual Wear',
      price: 149,
      original_price: 199,
      category: 'Fashion',
      stock_qty: 12,
      images: ['product/photo_2026-05-31_06-36-39.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Accra',
      views: 800,
      sold_count: 34,
      avg_rating: 4.6,
      store_id: '1',
      description: 'Elegant casual outfit perfect for warm weather styling.'
    },
    {
      id: '12',
      name: 'Premium Streetwear',
      price: 179,
      original_price: 209,
      category: 'Fashion',
      stock_qty: 14,
      images: ['product/photo_2026-05-31_06-36-50.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Takoradi',
      views: 850,
      sold_count: 46,
      avg_rating: 4.7,
      store_id: '2',
      description: 'A stylish and comfortable unisex streetwear piece.'
    },
    {
      id: '13',
      name: 'Trendy Fashion Piece',
      price: 95,
      original_price: 125,
      category: 'Fashion',
      stock_qty: 23,
      images: ['product/photo_2026-05-31_06-36-56.jpg'],
      is_flash_sale: true,
      status: 'active',
      location: 'Accra',
      views: 1100,
      sold_count: 60,
      avg_rating: 4.8,
      store_id: '1',
      description: 'Turn heads with this classic trending fashion design.'
    },
    {
      id: '14',
      name: 'Exclusive Outfit',
      price: 229,
      original_price: 279,
      category: 'Fashion',
      stock_qty: 11,
      images: ['product/photo_2026-05-31_06-37-03.jpg'],
      is_flash_sale: false,
      status: 'active',
      location: 'Tamale',
      views: 950,
      sold_count: 52,
      avg_rating: 4.8,
      store_id: '3',
      description: 'Exquisite custom-made local outfit.'
    }
  ];

  const MOCK_STORES = [];
  const MOCK_STORES_OLD = [
    {
      id: '1',
      vendor_id: 'u-vendor-001',
      name: 'Accra Streetwear Co.',
      category: 'Fashion',
      location: 'Accra',
      status: 'active',
      logo_url: 'product/photo_2026-05-30_17-19-35.jpg',
      banner_url: 'product/d.jpg',
      avg_rating: 4.7,
      total_sales: 5200,
      total_orders: 189,
      keywords: ['streetwear', 'fashion', 'tees'],
      slogan: 'Best Gadgets and Streetwear in Ghana',
      about_us: 'We deliver high-end streetwear and premium quality outfits to keep you fresh.',
      verified: true,
      followers: 128,
      primary_color: '#e85d04',
      secondary_color: '#0d0d0d',
      theme: 'custom',
      facebook: 'accrastreetwear',
      instagram: '@accrastreetwear',
      business_hours: 'Mon - Sat: 9:00 AM - 7:00 PM',
      shipping_policy: 'Instant Accra delivery in 2-3 hours. Out of station orders ship via VIP coach.',
      return_policy: '7-day replacement for size and fitting issues. Products must be unworn.'
    }
  ];


  // Progressive Loading: Quick initial fetch for above-the-fold content (12 products, 6 stores)
  try {
    const [quickProdRes, quickStoreRes] = await Promise.all([
      apiGet('products', 'limit=12'),
      apiGet('stores', 'limit=6')
    ]);
    App.allProducts = quickProdRes?.data || [];
    App.allStores = quickStoreRes?.data || [];
    syncFlashSaleStates();
  } catch (e) {
    console.warn('[loadHomeData] Quick load error, falling back to empty lists:', e);
    App.allProducts = MOCK_PRODUCTS;
    App.allStores = MOCK_STORES;
    syncFlashSaleStates();
  }

  // Render initial quick load data immediately to unlock the screen
  renderFlashSale();
  renderLocalProducts();
  renderFeaturedStores();
  renderTrending();
  renderHomeServices();

  // Background Prefetch: Load the remaining full datasets in the background without blocking the UI
  (async () => {
    try {
      const [fullProdRes, fullStoreRes] = await Promise.all([
        apiGet('products', 'limit=500'),
        apiGet('stores', 'limit=500')
      ]);
      App.allProducts = fullProdRes?.data || App.allProducts;
      App.allStores = fullStoreRes?.data || App.allStores;
      syncFlashSaleStates();
      
      // Re-render only if the user is still on the home page
      if (App.currentPage === 'home') {
        renderFlashSale();
        renderLocalProducts();
        renderFeaturedStores();
        renderTrending();
        renderHomeServices();
      }
    } catch (e) {
      console.warn('[loadHomeData] Background prefetch failed:', e);
    }
  })();
}

// ── Flash Sale ────────────────────────────────────────────
function renderFlashSale() {
  const list = document.getElementById('flash-sale-list');
  if (!list) return;
  const items = App.allProducts.filter(p => p.is_flash_sale && p.status !== 'archived' && shouldShowProductOnMainWebsite(p));
  if (items.length) {
    list.innerHTML = items.map(p => productCardSmall(p)).join('');
  } else {
    list.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:6px">
      <i class="fas fa-clock" style="color:var(--primary)"></i> 
      ${App.flashSaleState === 'paused' ? 'Current flash sale ended. Stay tuned for the next batch!' : 'No flash sales right now'}
    </div>`;
  }
}

// ── Local Products ─────────────────────────────────────────
function renderLocalProducts() {
  const list = document.getElementById('local-products-list');
  const sec  = document.getElementById('local-section');
  if (!list) return;
  const ul = App.currentUser ? App.currentUser.location : null;
  const items = App.allProducts.filter(p => p.status !== 'archived' && (!ul || p.location === ul) && shouldShowProductOnMainWebsite(p)).slice(0, 8);
  if (!items.length && !ul) {
    if (sec) sec.style.display = 'none';
    return;
  }
  if (sec) sec.style.display = '';
  list.innerHTML = items.map(p => productCardSmall(p)).join('');
}

// ── Featured Stores ────────────────────────────────────────
function renderFeaturedStores() {
  const list = document.getElementById('featured-stores-list');
  if (!list) return;
  const stores = App.allStores.filter(s => isStoreVisibleOnMain(s) && s.vendor_id !== 'admin' && !(s.name || '').toLowerCase().includes('admin') && shouldShowStoreOnMainWebsite(s)).slice(0, 6);
  list.innerHTML = stores.map(s => storeCardHTML(s, true)).join('');
}

// ── Trending Products ─────────────────────────────────────
function renderTrending() {
  const list = document.getElementById('trending-list');
  if (!list) return;
  const items = [...App.allProducts]
    .filter(p => p.status !== 'archived' && shouldShowProductOnMainWebsite(p))
    .sort((a,b) => (b.views||0) - (a.views||0))
    .slice(0, 6);
  list.innerHTML = items.map(p => productCardHTML(p)).join('');
}

// ── Helper: build slideshow HTML for a product (≥2 images) ─
// _pcSlide(btn, dir) — called by prev/next arrow buttons.
// btn  : the clicked arrow element (used to find parent .pc-slideshow)
// dir  : -1 for prev, +1 for next
function _pcSlide(btn, dir) {
  const ss = btn.closest('.pc-slideshow');
  if (!ss) return;
  const slides = ss.querySelectorAll('.pc-slide');
  const dots   = ss.querySelectorAll('.pc-slide-dot');
  let cur = 0;
  slides.forEach((s, i) => { if (s.classList.contains('active')) cur = i; });
  const next = (cur + dir + slides.length) % slides.length;
  slides[cur].classList.remove('active');
  slides[next].classList.add('active');
  dots[cur].classList.remove('active');
  dots[next].classList.add('active');
}

function _pcSlideshowHTML(images, altText) {
  const imgs = (images && images.length) ? images : ['https://via.placeholder.com/300x300?text=No+Image'];
  if (imgs.length === 1) {
    return `<img class="product-img" src="${imgs[0]}" alt="${altText}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">`;
  }
  const slidesHTML = imgs.map((src, i) =>
    `<div class="pc-slide${i === 0 ? ' active' : ''}">
      <img src="${src}" alt="${altText} ${i+1}" loading="lazy" decoding="async" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
    </div>`
  ).join('');
  const dotsHTML = imgs.map((_, i) =>
    `<button class="pc-slide-dot${i === 0 ? ' active' : ''}" onclick="event.stopPropagation();_pcDot(this,${i})" aria-label="Image ${i+1}"></button>`
  ).join('');
  return `<div class="pc-slideshow">
    ${slidesHTML}
    <button class="pc-slide-arrow prev" onclick="event.stopPropagation();_pcSlide(this,-1)" aria-label="Previous image"><i class="fas fa-chevron-left"></i></button>
    <button class="pc-slide-arrow next" onclick="event.stopPropagation();_pcSlide(this,1)" aria-label="Next image"><i class="fas fa-chevron-right"></i></button>
    <div class="pc-slide-dots">${dotsHTML}</div>
  </div>`;
}

// Jump directly to a specific dot index
function _pcDot(dot, idx) {
  const ss = dot.closest('.pc-slideshow');
  if (!ss) return;
  const slides = ss.querySelectorAll('.pc-slide');
  const dots   = ss.querySelectorAll('.pc-slide-dot');
  slides.forEach((s, i) => s.classList.toggle('active', i === idx));
  dots.forEach((d, i)   => d.classList.toggle('active', i === idx));
}

// ── Helper: Product Card HTML (grid) ──────────────────────
function productCardHTML(p) {
  const isSoldOut = p.stock_qty === 0 || p.status === 'sold_out';
  const discount = p.original_price > p.price
    ? `<span class="product-original-price">GHS ${p.original_price}</span>` : '';
  const flash = p.is_flash_sale ? '<span class="flash-badge">FLASH</span>' : '';
  const soldOut = isSoldOut ? '<div class="sold-out-overlay">SOLD OUT</div>' : '';
  const stars = renderStars(p.avg_rating || 0);
  const imageBlock = _pcSlideshowHTML(p.images, escHtml(p.name));
  const syncing = p._isOptimistic ? '<span style="position:absolute;top:6px;right:6px;background:var(--primary);color:#fff;font-size:.6rem;font-weight:700;padding:2px 6px;border-radius:100px;z-index:2"><i class="fas fa-spinner fa-spin"></i> SYNCING</span>' : '';
  return `
<div class="product-card" data-prod-id="${p.id}" onclick="openProduct('${p.id}')" style="${p._isOptimistic ? 'opacity:.85;border:1px dashed var(--primary)' : ''}">
  ${flash}
  ${syncing}
  ${soldOut}
  ${imageBlock}
  <div class="product-body">
    <div class="product-name">${escHtml(itemDisplayName(p.name))}</div>
    <div style="display:flex;align-items:center;flex-wrap:wrap">
      <span class="product-price">GHS ${p.price}</span>${discount}
    </div>
    <div class="product-meta">
      <span class="product-rating">${stars}</span>
      <span class="product-sold">${p.sold_count||0} sold</span>
    </div>
    <div class="product-location">
      <i class="fas fa-map-marker-alt"></i>${p.location || ''}
    </div>
  </div>
</div>`;
}

// ── Helper: Vendor Product Card (My Store grid) ───────────
// Same buyer-style card, plus vendor management actions (edit / archive / delete).
// Only rendered on the vendor's own My Store page — never on public pages.
function vendorProductCardHTML(p) {
  const isSoldOut = p.stock_qty === 0 || p.status === 'sold_out';
  const discount = p.original_price > p.price
    ? `<span class="product-original-price">GHS ${p.original_price}</span>` : '';
  const flash = p.is_flash_sale ? '<span class="flash-badge">FLASH</span>' : '';
  const soldOut = isSoldOut ? '<div class="sold-out-overlay">SOLD OUT</div>' : '';
  const stars = renderStars(p.avg_rating || 0);
  const imageBlock = _pcSlideshowHTML(p.images, escHtml(p.name));
  const stockBadge = p.stock_qty === 0
    ? '<span style="color:var(--danger);font-size:.68rem;font-weight:700">SOLD OUT</span>'
    : p.stock_qty <= 3
      ? `<span style="color:var(--warning);font-size:.68rem;font-weight:700">${p.stock_qty} left</span>`
      : `<span style="color:var(--success);font-size:.68rem">${p.stock_qty} in stock</span>`;
  return `
<div class="product-card" data-prod-id="${p.id}" onclick="openProduct('${p.id}')" style="position:relative">
  ${flash}
  ${soldOut}
  ${imageBlock}
  <div class="product-body">
    <div class="product-name">${escHtml(itemDisplayName(p.name))}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
      <span style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span class="product-price">GHS ${p.price}</span>${discount}</span>
      ${stockBadge}
    </div>
    <div class="product-meta">
      <span class="product-rating">${stars}</span>
      <span class="product-sold">${p.sold_count||0} sold</span>
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="event.stopPropagation();showEditProductModal('${p.id}')" title="Edit product"><i class="fas fa-edit"></i> Edit</button>
      <button class="btn btn-ghost btn-sm" style="flex:1;color:var(--warning)" onclick="event.stopPropagation();archiveProduct('${p.id}')" title="Archive product"><i class="fas fa-archive"></i></button>
      <button class="btn btn-ghost btn-sm" style="flex:1;color:var(--danger)" onclick="event.stopPropagation();deleteVendorProduct('${p.id}')" title="Delete product permanently"><i class="fas fa-trash"></i></button>
    </div>
  </div>
</div>`;
}

// ── Helper: Product Card Small (scroll) ──────────────────
function productCardSmall(p) {
  const isSoldOut = p.stock_qty === 0 || p.status === 'sold_out';
  const flash = p.is_flash_sale ? '<span class="flash-badge">FLASH</span>' : '';
  const soldOut = isSoldOut ? '<div class="sold-out-overlay">SOLD OUT</div>' : '';
  const imageBlock = _pcSlideshowHTML(p.images, escHtml(p.name));
  return `
<div class="product-card scroll-product-card" onclick="openProduct('${p.id}')">
  ${flash}${soldOut}
  ${imageBlock}
  <div class="product-body">
    <div class="product-name">${escHtml(itemDisplayName(p.name))}</div>
    <span class="product-price">GHS ${p.price}</span>
  </div>
</div>`;
}

// ── Helper: Store Card HTML ───────────────────────────────
function storeCardHTML(s, compact = false) {
  const stars = renderStars(s.avg_rating || 0);
  const banner = s.banner_url || 'https://via.placeholder.com/800x200?text=Store+Banner';
  const logo   = s.logo_url  || 'https://via.placeholder.com/100x100?text=Logo';
  const storeName = s.name || s.slug || 'Store';
  const storeLoc  = s.location || '';
  if (compact) {
    // 2-column layout: smaller logo, tighter padding, taller banner
    return `
<div class="store-card store-card-compact" onclick="openStore('${s.id}')">
  <div class="store-banner-wrap">
    <img class="store-banner" src="${banner}" alt="${escHtml(storeName)}" loading="lazy" decoding="async" onerror="this.src='https://via.placeholder.com/800x200?text=Store+Banner'">
    <img class="store-logo store-logo-compact" src="${logo}" alt="${escHtml(storeName)}" loading="lazy" decoding="async" onerror="this.src='https://via.placeholder.com/100x100?text=Logo'">
  </div>
  <div class="store-info">
    <div class="store-name">${escHtml(storeName)}</div>
    <div class="store-cat">${s.category || ''}</div>
    <div class="store-meta">
      <span class="store-rating">${stars} (${s.review_count || 0})</span>
      <span class="store-location-tag"><i class="fas fa-map-marker-alt"></i> ${storeLoc || '—'}</span>
    </div>
  </div>
</div>`;
  }
  return `
<div class="store-card" onclick="openStore('${s.id}')">
  <img class="store-banner" src="${banner}" alt="${escHtml(storeName)}" loading="lazy" onerror="this.src='https://via.placeholder.com/800x200?text=Store+Banner'">
  <img class="store-logo" src="${logo}" alt="${escHtml(storeName)}" onerror="this.src='https://via.placeholder.com/100x100?text=Logo'">
  <div class="store-info">
    <div class="store-name">${escHtml(storeName)}</div>
    <div class="store-cat">${s.category || ''}</div>
    <div class="store-meta">
      <span class="store-rating">${stars} (${s.review_count || 0})</span>
      <span class="store-location-tag"><i class="fas fa-map-marker-alt"></i> ${storeLoc || '—'}</span>
    </div>
  </div>
</div>`;
}

// ── Stars renderer ────────────────────────────────────────
function renderStars(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += i <= Math.round(rating)
      ? '<i class="fas fa-star" style="color:var(--accent);font-size:.75rem"></i>'
      : '<i class="far fa-star" style="color:var(--border);font-size:.75rem"></i>';
  }
  return html;
}

// ── Product & Store Open ──────────────────────────────────
async function openProduct(id) {
  if (App.currentPage === 'store-detail' || App.currentPage === 'storefront') {
    App.currentProductId = id;
    if (typeof openStorefrontProductModal === 'function') {
      openStorefrontProductModal(id);
    }
  } else {
    // Do NOT pre-set App.currentProductId here: showPage's "already showing this
    // page+entity" guard derives the current entity from that field, so setting
    // it first made product → product navigation (e.g. "You may also like") look
    // like a no-op and the clicked product never opened.
    showPage('product', id);
  }
}
async function openStore(id) {
  showPage('store-detail', id);
}

// ── Cart Badge ────────────────────────────────────────────
function updateCartBadge() {
  const total = App.cart.reduce((s, i) => s + i.qty, 0);
  ['cart-badge-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (total > 0) { el.textContent = total > 99 ? '99+' : total; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });
}

// ── Location Filter from Hero ─────────────────────────────
function setLocationFilter(loc) {
  if (App.currentUser) {
    App.currentUser.location = loc;
    saveSessions();
  }
  App.marketFilter = 'local';
  showPage('marketplace');
  showToast(`Showing items near ${loc}`, 'info');
}

// ── Escape HTML ───────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Item names that were never entered fall back to the category "Other" in old
// records — always display them as blank instead (matches the share caption fix).
function itemDisplayName(name) {
  const n = String(name || '').trim();
  return (n === 'Other') ? '' : n;
}

// Build a row of small item thumbnails for order cards. Items without an image
// are skipped; a "+N" chip shows how many more items the order contains.
function buildItemThumbsHTML(items, max = 3) {
  const all = items || [];
  if (!all.length) return '';
  const thumbs = all.slice(0, max).map(i => {
    const img = String(i.image || (i.images && i.images[0]) || '').trim();
    if (!img) return '';
    return `<img src="${escHtml(img)}" alt="" loading="lazy" style="width:30px;height:30px;border-radius:6px;object-fit:cover;border:1px solid var(--border);flex-shrink:0;background:var(--bg)" onerror="this.onerror=null;this.style.display='none'">`;
  }).filter(Boolean);
  if (!thumbs.length) return '';
  const extra = all.length > max ? `<span style="font-size:.68rem;font-weight:700;color:var(--text-muted);flex-shrink:0">+${all.length - max}</span>` : '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0">${thumbs.join('')}${extra}</span>`;
}

// ── Format Date ───────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' ? ts : ts);
  return d.toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric' });
}
function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' ? ts : ts);
  return d.toLocaleString('en-GH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = '', durationMs = 3500) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success:'check-circle', error:'exclamation-circle', warning:'exclamation-triangle', info:'info-circle' };
  const icon = icons[type] || 'bell';
  t.innerHTML = `<i class="fas fa-${icon}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, durationMs);
}

// ── Modal Helpers ─────────────────────────────────────────
function showModal(html, center = false) {
  const c = document.getElementById('modal-container');
  c.innerHTML = `<div class="modal-backdrop${center?' center':''}" onclick="closeModal(event)">
    <div class="modal-${center?'center':'sheet'}">${html}</div>
  </div>`;
}
function closeModal(e) {
  if (typeof e === 'string') {
    const targetEl = document.getElementById(e);
    if (targetEl) targetEl.remove();
  }
  if (e && e.target && e.currentTarget && e.target !== e.currentTarget) return;
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';
  document.querySelectorAll('#modal-sf-review').forEach(m => m.remove());
}
function closeModalForce(id) {
  if (id && typeof id === 'string') {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';
  document.querySelectorAll('#modal-sf-review').forEach(m => m.remove());
}

// ── Admin Profile Panel (full-screen slide-in) ────────────
function showAdminPanel(html) {
  const root = document.getElementById('ap-panel-root');
  if (!root) return;
  root.innerHTML = html;
  root.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  root.onclick = function(e) {
    if (e.target === root) {
      closeAdminPanel();
    }
  };
}
function closeAdminPanel() {
  const root = document.getElementById('ap-panel-root');
  if (!root) return;
  root.classList.add('ap-panel-closing');
  setTimeout(() => {
    root.style.display = 'none';
    root.classList.remove('ap-panel-closing');
    root.innerHTML = '';
    document.body.style.overflow = '';
  }, 260);
}

// ── Filter Toggle ─────────────────────────────────────────
function toggleFilterModal() {
  const ul = App.currentUser ? App.currentUser.location : '';
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">Filter Products</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="form-group">
    <label class="form-label">Location</label>
    <select class="form-control form-select" id="filter-loc">
      <option value="">All Locations</option>
      ${LOCATIONS.map(l => `<option value="${l}"${l===ul?' selected':''}>${l}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Category</label>
    <select class="form-control form-select" id="filter-cat">
      <option value="">All Categories</option>
      ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Price Range (GHS)</label>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="number" class="form-control" id="filter-min" placeholder="Min" min="0">
      <span>–</span>
      <input type="number" class="form-control" id="filter-max" placeholder="Max" min="0">
    </div>
  </div>
  <button class="btn btn-primary btn-block" onclick="applyAdvancedFilter()">
    <i class="fas fa-filter"></i> Apply Filters
  </button>
</div>`);
}

function applyAdvancedFilter() {
  const loc    = document.getElementById('filter-loc')?.value;
  const cat    = document.getElementById('filter-cat')?.value;
  const min    = parseFloat(document.getElementById('filter-min')?.value) || 0;
  const max    = parseFloat(document.getElementById('filter-max')?.value) || Infinity;

  App.advancedFilter = { loc, cat, min, max };
  closeModalForce();
  showPage('marketplace');
  renderMarketplace();
  showToast('Filters applied', 'success');
}

// ── Delivery Rate Calculator (the platform does not handle or charge delivery;
//     delivery is arranged directly between the vendor and the customer) ──
function calcDelivery(originLoc, destLoc, weightKg = 0.5) {
  /* 
  // ORIGINAL DELIVERY RATE CALCULATOR (Hashed out for mean time — to be restored when delivery partner is active):
  if (originLoc === destLoc) return { rate: 15, intercity: false, days: 0 };
  const zones = {
    'Accra-Kumasi': 35, 'Kumasi-Accra': 35,
    'Accra-Takoradi': 45, 'Takoradi-Accra': 45,
    'Kumasi-Takoradi': 40, 'Takoradi-Kumasi': 40,
    'Accra-Tamale': 70, 'Tamale-Accra': 70,
    'Accra-Cape Coast': 35, 'Cape Coast-Accra': 35,
    'Accra-Tema': 20, 'Tema-Accra': 20,
  };
  const key = `${originLoc}-${destLoc}`;
  const base = zones[key] || 55;
  const weightExtra = Math.max(0, (weightKg - 0.5)) * 4;
  return { rate: base + weightExtra, intercity: true, days: 1 };
  */

  // The platform does not handle or charge delivery — it is arranged directly
  // between the vendor and the customer, so no delivery fee is ever added.
  return { rate: 0, intercity: false, days: 0, partner: 'Standard Delivery' };
}

// ── Privacy Page ───────────────────────────────────────────
async function renderPrivacyPage() {
  const c = document.getElementById('privacy-content');
  if (!c) return;

  // Fetch admin's real contact info for the DPO section
  let adminEmail = 'privacy@happatrademart.com';
  let adminPhone = '+233 000 000 000';
  try {
    const adminRes = await apiGet('users', 'limit=50');
    const admin = (adminRes?.data || []).find(u => u.role === 'admin');
    if (admin) {
      if (admin.email) adminEmail = admin.email;
      if (admin.phone) adminPhone = admin.phone;
    }
  } catch (e) {}

  c.innerHTML = `

<!-- Header -->
<div style="background:#fff;border-bottom:1px solid var(--border);padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
  <div style="width:42px;height:42px;border-radius:var(--radius-md);background:var(--primary-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <i class="fas fa-shield-alt" style="color:var(--primary);font-size:1.1rem"></i>
  </div>
  <div>
    <div style="font-weight:800;font-size:1rem;line-height:1.2">Privacy &amp; Data Protection Policy</div>
    <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">Last updated: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})} · Compliant with Ghana Data Protection Act, 2012 (Act 843)</div>
  </div>
</div>

<!-- Intro -->
<div style="padding:0 16px;margin-bottom:20px">
  <p style="font-size:.84rem;color:var(--text-light);line-height:1.65;margin-bottom:10px">
    <strong style="color:var(--text)">HAPPA TRADEMART</strong> ("we", "us", or "the Platform") is a Ghanaian online marketplace connecting buyers with vendors and service providers. This Privacy Policy explains in plain language how we handle your personal information.
  </p>
  <p style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    By creating an account, placing an order, or simply browsing our website, you agree to the practices described here. If you do not agree, please do not use the Service.
  </p>
</div>

<!-- 1. Scope -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">1. Who we are &amp; what this covers</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    <p>This policy applies to everyone who interacts with HAPPA TRADEMART — whether you are buying, selling, providing services, or just visiting the site. It covers our website, mobile app, and all official communication channels (email, SMS, WhatsApp, push notifications).</p>
    <p style="margin-top:8px">We are a <strong style="color:var(--text)">marketplace platform</strong>, not a party to transactions between buyers and vendors. We facilitate connections but do not manufacture, store, or ship products unless explicitly stated. Each vendor operates independently and is responsible for their own products, services, and business practices.</p>
    <p style="margin-top:8px">This policy does <strong style="color:var(--text)">not</strong> apply to third-party websites, payment processors, or delivery services linked from our platform. Those entities have their own privacy policies — review them before sharing your information with them.</p>
  </div>
</div>

<!-- 2. Information we collect -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">2. What information we collect</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);line-height:1.65;padding:12px 14px 8px">We collect only what is necessary to operate the marketplace:</p>
    ${[
      ['Account data',       'Name, email, phone number, hashed password, role (buyer/vendor/rendor/admin)',    'When you register'],
      ['Profile data',       'Profile photo, location, bio, ID verification documents (for vendors/rendors)',   'When you complete your profile'],
      ['Transaction data',   'Order details, delivery addresses, payment references, ratings &amp; reviews',     'When you buy or sell'],
      ['Wallet data',        'Balance, deposits, withdrawals, transaction history',                            'When you use the wallet'],
      ['Device information', 'IP address, browser type, device model, app version, pages visited',             'Automatically collected'],
      ['Communications',     'Support tickets, messages, notification preferences',                           'When you contact us'],
      ['Vendor content',     'Product images, descriptions, prices, store branding',                          'Provided by vendors'],
    ].map(([cat, ex, src]) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-top:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:2px">${cat}</div>
        <div style="font-size:.78rem;color:var(--text-light);line-height:1.5">${ex}</div>
      </div>
      <div style="font-size:.72rem;color:var(--text-muted);white-space:nowrap;padding-top:2px">${src}</div>
    </div>`).join('')}
    <p style="font-size:.8rem;color:var(--text-muted);padding:10px 14px;border-top:1px solid var(--border);line-height:1.55">
      <i class="fas fa-lock" style="color:var(--primary);margin-right:4px"></i>
      <strong style="color:var(--text)">Sensitive data:</strong> We only collect government-issued ID documents for vendor/KYC verification. These are encrypted at rest and access is restricted to authorized admin staff.
    </p>
  </div>
</div>

<!-- 3. Why we collect it -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">3. Why we collect your information</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    ${[
      ['fa-file-contract',  '#dbeafe', '#1d4ed8', 'To provide the Service',           'Process orders, deliver packages, pay vendors, manage your wallet — the basics of running a marketplace.'],
      ['fa-balance-scale',  '#dcfce7', '#15803d', 'To keep the platform safe',        'Prevent fraud, enforce our Terms, resolve disputes between buyers and vendors.'],
      ['fa-hand-paper',     '#fef3c7', '#b45309', 'With your consent',                'Marketing emails, promotional notifications, analytics — you can opt out at any time.'],
      ['fa-gavel',          '#f3e8ff', '#7c3aed', 'Legal requirements',               'Tax records, anti-money-laundering compliance, responding to valid court orders under Ghanaian law.'],
    ].map(([icon, bg, col, title, desc], i) => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
      <div style="width:32px;height:32px;border-radius:var(--radius-sm);background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
        <i class="fas ${icon}" style="color:${col};font-size:.8rem"></i>
      </div>
      <div>
        <div style="font-size:.84rem;font-weight:700;color:var(--text);margin-bottom:3px">${title}</div>
        <div style="font-size:.8rem;color:var(--text-light);line-height:1.55">${desc}</div>
      </div>
    </div>`).join('')}
  </div>
</div>

<!-- 4. Cookies -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">4. Cookies &amp; local storage</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);line-height:1.65;padding:12px 14px 10px">We use cookies and browser storage to keep you signed in, remember your cart, and understand how the site is used.</p>
    ${[
      ['ESSENTIAL',  '#fee2e2', '#991b1b', 'Login session, shopping cart, security tokens',         'Required — the site will not work without these', 'Cannot be disabled'],
      ['FUNCTIONAL', '#dbeafe', '#1e40af', 'Language, theme, recently viewed items',                'Optional — improves your experience',              'Disable in browser settings'],
      ['ANALYTICS',  '#ede9fe', '#5b21b6', 'Anonymous usage stats, error reporting',               'Optional',                                         'Respect "Do Not Track"'],
    ].map(([label, bg, col, ex, req, dis], i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-top:1px solid var(--border)">
      <span style="display:inline-block;padding:3px 8px;border-radius:var(--radius-full);background:${bg};color:${col};font-size:.67rem;font-weight:800;letter-spacing:.3px;white-space:nowrap;margin-top:1px">${label}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.79rem;color:var(--text-light);line-height:1.5;margin-bottom:3px">${ex}</div>
        <div style="font-size:.73rem;color:var(--text-muted)">${req} · ${dis}</div>
      </div>
    </div>`).join('')}
  </div>
</div>

<!-- 5. Sharing -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">5. Who we share your information with</h3>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-md);padding:10px 14px;margin:0 16px 10px;display:flex;align-items:center;gap:10px">
  <i class="fas fa-ban" style="color:#15803d;font-size:1rem;flex-shrink:0"></i>
  <span style="font-size:.83rem;color:#14532d;font-weight:600">We do not sell, rent, or trade your personal data to third parties for their marketing purposes.</span>
</div>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    ${[
      ['Other users',                    'Vendors see your delivery city and contact details only after you place an order. Buyers see a vendor\'s public profile (name, store, ratings).'],
      ['Payment processors',             'Mobile-money and card processors receive only the data needed to complete your payment.'],
      ['Delivery partners',              'Your name, phone, and delivery address are shared with the courier to complete handover.'],
      ['Cloud &amp; hosting providers', 'Our servers are hosted by vetted providers who are contractually bound to protect your data.'],
      ['Law enforcement',                'Only when we receive a valid court order or legal request under Ghanaian law.'],
    ].map(([who, why], i) => `
    <div style="padding:10px 14px;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
      <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:2px">${who}</div>
      <div style="font-size:.79rem;color:var(--text-light);line-height:1.5">${why}</div>
    </div>`).join('')}
    <div style="background:#fffbeb;border-top:1px solid var(--border);padding:10px 14px;display:flex;gap:8px;align-items:flex-start">
      <i class="fas fa-exclamation-triangle" style="color:#b45309;margin-top:2px;flex-shrink:0;font-size:.85rem"></i>
      <p style="font-size:.8rem;color:#78350f;line-height:1.55;margin:0"><strong>Public content:</strong> Product listings, store descriptions, reviews, and rendor profiles are visible to everyone. Do not include personal information in public content that you do not want shared.</p>
    </div>
  </div>
</div>

<!-- 6. Retention -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">6. How long we keep your data</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);padding:12px 14px 8px;line-height:1.55">We retain your data only as long as needed to provide the Service and comply with legal obligations.</p>
    ${[
      ['Account profile',          'Until you delete your account + 30 days',          'Allows recovery if you change your mind'],
      ['Orders &amp; invoices',    '7 years after the order date',                      'Required by Ghanaian tax law'],
      ['Wallet transactions',      '7 years after the transaction date',                'Required by Ghanaian tax law'],
      ['Support tickets',          '3 years after resolution',                          'For quality assurance and dispute reference'],
      ['ID verification files',    'Until document expires or 5 years (whichever is first)', 'KYC compliance'],
      ['Server logs',              '90 days',                                           'Security monitoring and abuse prevention'],
    ].map(([data, period, reason], i) => `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:9px 14px;border-top:1px solid var(--border)">
      <div style="font-size:.81rem;font-weight:600;color:var(--text);flex:1">${data}</div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:.8rem;color:var(--primary);font-weight:700">${period}</div>
        <div style="font-size:.71rem;color:var(--text-muted)">${reason}</div>
      </div>
    </div>`).join('')}
  </div>
</div>

<!-- 7. Security -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">7. How we protect your data</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    ${[
      'All data transmitted between your device and our servers is encrypted (HTTPS/TLS)',
      'Passwords are hashed using bcrypt and never stored in plain text',
      'Access to user data is restricted to authorized staff on a need-to-know basis',
      'Database backups are stored securely',
    ].map((item, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
      <i class="fas fa-check-circle" style="color:var(--success);flex-shrink:0"></i>
      <span style="font-size:.83rem;color:var(--text-light)">${item}</span>
    </div>`).join('')}
    <p style="font-size:.78rem;color:var(--text-muted);padding:10px 14px;border-top:1px solid var(--border);line-height:1.55">
      <i class="fas fa-info-circle" style="margin-right:4px"></i>No online system is completely secure. If we discover a data breach affecting your information, we will notify you and the Data Protection Commission within 72 hours as required by Act 843.
    </p>
  </div>
</div>

<!-- 7b. DPC Registration -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">7b. Data controller registration</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    HAPPA TRADEMART is registered as a data controller with the Data Protection Commission of Ghana as required by the Data Protection Act, 2012 (Act 843). Our registration is subject to periodic renewal and compliance audits.
  </div>
</div>

<!-- 8. Your rights -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">8. Your rights</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 16px;margin-bottom:16px">
  ${[
    ['🔍', 'Access',        'View all personal data we hold about you'],
    ['✏️', 'Correction',    'Fix any inaccurate or incomplete information'],
    ['🗑️', 'Deletion',      'Request deletion of your account and data (subject to legal retention requirements)'],
    ['⛔', 'Object',        'Object to certain uses of your data, including marketing'],
    ['↩️', 'Withdraw',      'Withdraw your consent at any time'],
    ['📞', 'Complain',      'File a complaint with the Data Protection Commission of Ghana'],
  ].map(([emoji, label, desc]) => `
  <div class="card">
    <div class="card-body" style="padding:10px 12px">
      <div style="font-size:1.1rem;margin-bottom:5px">${emoji}</div>
      <div style="font-size:.8rem;font-weight:700;color:var(--text);margin-bottom:3px">${label}</div>
      <div style="font-size:.73rem;color:var(--text-muted);line-height:1.4">${desc}</div>
    </div>
  </div>`).join('')}
</div>
<p style="font-size:.82rem;color:var(--text-light);padding:0 16px;margin-bottom:20px;line-height:1.55">
  Most of these rights can be exercised from your account settings. For anything else, contact our Data Protection Officer. We respond to all valid requests within <strong style="color:var(--text)">30 days</strong>.
</p>

<!-- 9. Children -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">9. Children's privacy</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    HAPPA TRADEMART is not directed at children under 18. We do not intentionally collect data from minors. If you believe a minor has created an account, contact us and we will delete it promptly.
  </div>
</div>

<!-- 9b. DPO Registration -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">9b. Data Protection Officer</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    We have appointed a Data Protection Officer responsible for overseeing compliance with this policy and the Data Protection Act. You may contact our DPO using the details provided in Section 14 below.
  </div>
</div>

<!-- 10. Cross-border -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">10. Data storage location</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    Your data is primarily stored in Ghana. Where we use cloud providers outside Ghana, we ensure they apply equivalent data protection standards through contractual agreements.
  </div>
</div>

<!-- 11. Off-Platform Disclaimer -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">11. Off-platform transactions &amp; liability</h3>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius-md);padding:12px 14px;margin:0 16px 12px;display:flex;gap:10px;align-items:flex-start">
  <i class="fas fa-exclamation-circle" style="color:#dc2626;font-size:1rem;flex-shrink:0;margin-top:2px"></i>
  <div>
    <div style="font-size:.84rem;font-weight:700;color:#991b1b;margin-bottom:4px">Important: HAPPA TRADEMART is not responsible for off-platform activity</div>
    <p style="font-size:.82rem;color:#7f1d1d;line-height:1.55;margin:0">HAPPA TRADEMART facilitates connections between buyers, vendors, and service providers <strong>within the Platform</strong>. We are not a party to, and bear no responsibility or liability for, any transactions, agreements, communications, disputes, losses, or interactions that occur <strong>outside the scope of the Platform</strong>, including but not limited to:</p>
  </div>
</div>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    ${[
      'Meetups, cash transactions, or deliveries arranged directly between buyers and vendors without using the Platform\'s order system',
      'Payments made outside the Platform (e.g. direct mobile money transfers, cash on hand, bank transfers not processed through HAPPA TRADEMART)',
      'Communications via personal phone numbers, WhatsApp, social media, or other channels outside the Platform',
      'Products, services, or promises made by vendors that are not listed or transacted through HAPPA TRADEMART',
      'Disputes, fraud, or quality issues arising from off-platform dealings',
      'Any loss of money, data, or personal information resulting from sharing details with third parties outside the Platform',
    ].map((item, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
      <i class="fas fa-times-circle" style="color:#dc2626;flex-shrink:0;margin-top:2px;font-size:.8rem"></i>
      <span style="font-size:.82rem;color:var(--text-light);line-height:1.55">${item}</span>
    </div>`).join('')}
    <div style="background:#fff7ed;border-top:1px solid var(--border);padding:12px 14px;display:flex;gap:8px;align-items:flex-start">
      <i class="fas fa-shield-alt" style="color:#ea580c;margin-top:2px;flex-shrink:0;font-size:.85rem"></i>
      <p style="font-size:.82rem;color:#9a3412;line-height:1.55;margin:0"><strong>For your protection:</strong> Always complete transactions through the Platform. This ensures you are covered by our buyer protection policies, order tracking, dispute resolution, and refund processes. Off-platform transactions are entirely at your own risk.</p>
    </div>
  </div>
</div>

<!-- 12. Changes -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">12. Changes to this policy</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    We may update this policy occasionally. When we make significant changes, we will notify you through the Platform or by email at least <strong style="color:var(--text)">14 days</strong> before they take effect. Your continued use of HAPPA TRADEMART after that date means you accept the updated policy.
  </div>
</div>

<!-- 13. Contact -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">13. Contact us</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="display:flex;align-items:center;gap:14px">
    <div style="width:46px;height:46px;border-radius:var(--radius-md);background:var(--primary);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i class="fas fa-user-shield" style="color:#fff;font-size:1.1rem"></i>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:800;font-size:.9rem;margin-bottom:6px">Data Protection Officer</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);margin-bottom:4px">
        <i class="fas fa-envelope" style="width:12px;color:var(--primary)"></i>
        <a href="mailto:${adminEmail}" style="color:var(--primary);font-weight:600">${escHtml(adminEmail)}</a>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);margin-bottom:4px">
        <i class="fas fa-phone" style="width:12px;color:var(--primary)"></i>
        <a href="tel:${adminPhone.replace(/[^+\d]/g, '')}" style="color:var(--primary);font-weight:600">${escHtml(adminPhone)}</a>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted)">
        <i class="fas fa-building" style="width:12px;color:var(--primary)"></i>
        HAPPA TRADEMART HQ, Accra, Ghana
      </div>
    </div>
  </div>
</div>

<p style="font-size:.76rem;color:var(--text-muted);text-align:center;padding:4px 16px 8px;line-height:1.6">
  You also have the right to lodge a complaint with the
  <a href="https://dataprotection.org.gh/" target="_blank" rel="noopener" style="color:var(--primary);font-weight:600">Data Protection Commission of Ghana</a>.
</p>

<!-- 14. Governing Law -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">14. Governing law</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    This Privacy Policy is governed by the laws of the Republic of Ghana. Any disputes arising from this policy shall be subject to the exclusive jurisdiction of the courts of Ghana.
  </div>
</div>`;
}

async function saveNotificationPrefs(userId) {
  const data = {
    notify_orders: document.getElementById('set-notif-orders')?.checked ?? true,
    notify_marketing: document.getElementById('set-notif-marketing')?.checked ?? false,
    notify_support: document.getElementById('set-notif-support')?.checked ?? true,
  };
  try {
    await apiPatch('users', userId, data);
    if (App.currentUser) Object.assign(App.currentUser, data);
    showToast('Notification preferences saved ✓', 'success');
  } catch (err) {
    console.error('Failed to save notification prefs:', err);
    showToast('Failed to save preferences', 'error');
  }
}

async function requestAccountDeletion() {
  if (!App.currentUser) { showToast('Please sign in first', 'warning'); return; }
  if (confirm('Are you sure you want to permanently delete your account? This action is irreversible.\n\nAll your data including store, notifications, and orders will be deleted immediately.')) {
    const uid = App.currentUser.id;
    if (typeof _apDeleteUser === 'function') {
      await _apDeleteUser(uid);
    } else {
      await apiDelete('users', uid).catch(() => {});
      logout(true);
    }
  }
}

window._autoCreateStoreLock = window._autoCreateStoreLock || {};
window.autoCreateStoreForVendor = async function(vendor) {
  if (!vendor) return null;
  if (vendor.role === 'admin' || vendor.id === 'admin') return null;
  
  // Prevent concurrent calls for the same vendor
  if (window._autoCreateStoreLock[vendor.id]) return window._autoCreateStoreLock[vendor.id];
  let _resolve;
  window._autoCreateStoreLock[vendor.id] = new Promise(r => { _resolve = r; });
  
  // 1. Double check if store already exists to prevent duplicate stores
  const storeRes = await apiGet('stores', 'limit=200').catch(() => null);
  const existing = (storeRes?.data || []).find(s => String(s.vendor_id) === String(vendor.id));
  if (existing) return existing;

  // 2. Build store properties
  const storeName = (vendor.preferred_store_name || '').trim() || `${vendor.name || 'New'}'s Store`;
  const loc = vendor.location || 'Accra';
  const prefix = (typeof LOCATION_PREFIXES !== 'undefined' ? LOCATION_PREFIXES[loc] : null) || 'XX';
  const slug = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const newStore = {
    id:                    'store-' + vendor.id,
    name:                  storeName,
    slug,
    description:           vendor.preferred_store_desc || '',
    logo_url:              '',
    banner_url:            '',
    location:              loc,
    category:              vendor.preferred_store_cat || 'General',
    vendor_id:             vendor.id,
    intended_vendor_email: vendor.email,
    status:                'active',
    storefront_status:     'none',
    avg_rating:            0,
    review_count:          0,
    total_sales:           0,
    total_orders:          0,
    location_prefix:       prefix,
    store_price:           0,
    is_paid:               false,
    acquired_by_referral:  false,
    handover_date:         new Date().toISOString()
  };

  // Optimistically push to frontend state
  if (!App.allStores) App.allStores = [];
  let alreadyInState = App.allStores.find(s => String(s.vendor_id) === String(vendor.id));
  if (!alreadyInState) {
    App.allStores.push(newStore);
  }
  try { localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores)); } catch(e){}

  const store = await apiPost('stores', newStore).catch(() => null);
  let finalStore = store || newStore;
  
  // Update App.allStores with the real store from API if we got one
  if (store) {
    // Remove any existing store for this vendor
    App.allStores = App.allStores.filter(s => String(s.vendor_id) !== String(vendor.id));
    App.allStores.push(store);
    try { localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores)); } catch(e){}
  }

  addNotification(vendor.id, 'system', '🏪 Store Automatically Set Up!',
    `Your store "${storeName}" has been successfully set up. You can customize details and upload product listings now.`);

  if (_resolve) _resolve(finalStore);
  return finalStore;
};

// ── Referral Balance Calculation ──────────────────────────
// Balance = referral_reward ledger rows actually paid to this user, minus what
// they've already spent as a REF- checkout discount. Using the user's own
// wallet ledger keeps the math honest: it only counts money the server actually
// credited (at delivery), and it never requires reading other people's orders
// (which are PII-scrubbed for non-owners).
async function calculateUserReferralBalance(userId) {
  try {
    const res = await apiGet('wallet_transactions', `search=${encodeURIComponent(userId)}&limit=500`);
    const txns = Array.isArray(res?.data) ? res.data : [];
    const totalEarned = txns
      .filter(t => t.type === 'referral_reward' && String(t.status) !== 'failed')
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    const usersRes = await apiGet('users', 'limit=500').catch(() => null);
    const allUsers = usersRes?.data || [];
    const user = allUsers.find(u => String(u.id) === String(userId));
    const totalUsed = parseFloat(user?.referral_commission_used) || 0;

    const balance = totalEarned - totalUsed;
    return balance > 0 ? balance : 0;
  } catch (err) {
    console.error('Error calculating referral balance:', err);
    return 0;
  }
}

// ── Hero Banners Setup ─────────────────────────────────────
let _heroBannerTimer = null;
async function initHeroBanners() {
  try {
    const res = await apiGet('settings', 'key=hero_banners');
    const heroRow = res?.data?.find(r => r.key === 'hero_banners');
    let heroBanners = [];
    if (heroRow && heroRow.value) {
      heroBanners = JSON.parse(heroRow.value);
    }
    
    const container = document.getElementById('hero-default');
    if (!container || heroBanners.length === 0) return;
    
    // Clear interval if already set
    if (_heroBannerTimer) clearInterval(_heroBannerTimer);
    
    let currentIndex = 0;
    
    const renderBanner = () => {
      const imgUrl = heroBanners[currentIndex];
      // Keep its size, just resize the image to fit
      container.style.backgroundImage = `url("${imgUrl}")`;
      container.style.backgroundSize = 'contain';
      container.style.backgroundPosition = 'center';
      container.style.backgroundRepeat = 'no-repeat';
      container.style.backgroundColor = 'transparent'; 
      container.innerHTML = ''; // Clear default text/chips
    };
    
    renderBanner();
    
    if (heroBanners.length > 1) {
      _heroBannerTimer = setInterval(() => {
        currentIndex = (currentIndex + 1) % heroBanners.length;
        renderBanner();
      }, 3000); // 3 seconds
    }
    
  } catch(e) {
    console.error('Failed to load hero banners', e);
  }
}

