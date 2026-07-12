/* ============================================================
   HAPPA TRADEMART — Core App State & Navigation
   ============================================================ */

'use strict';

// ── Constants ──────────────────────────────────────────────
const API = '/api/';
const LOCATIONS = ['Accra','Kumasi','Takoradi','Tamale','Cape Coast','Tema','Sunyani','Koforidua'];
const CATEGORIES = ['Fashion & Footwear','Electronics','Beauty & Skincare','Food & Groceries',
                    'Books & Stationery','Health & Fitness','Home & Living','Sports & Outdoor'];
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
  currentProductId: null,
  currentStoreId: null,
  currentRendorId: null,
  flashSaleEnd: null,
};

// ── Initialize ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
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
  calcDaysToSaturday();
  loadHomeData().then(() => initAdBanners('home'));

  initSearch();
  renderNotifBadge();
  // Pre-warm AI config (used by vendor product auto-fill) so the first
  // upload isn't blocked on a network round-trip
  if (typeof window.loadAIConfig === 'function') {
    window.loadAIConfig().catch(err => console.warn('[AI] preload failed:', err.message));
  }

  // Fetch server-side notifications (e.g. announcements) shortly after load
  if (App.currentUser) {
    setTimeout(() => fetchServerNotifications().then(renderNotifBadge), 1500);
    // Start polling every 60s for new notifications/announcements
    setTimeout(() => startNotifPolling(), 3000);
  }
  
  // Handle storefront links in hash e.g. #store/elsbee or ?store=elsbee on startup
  const startupHash = window.location.hash;
  const searchParams = new URLSearchParams(window.location.search);
  const isStoreAdmin = startupHash.startsWith('#store-admin/');
  const storeSlug = searchParams.get('store') || 
                    (startupHash.startsWith('#store/') ? startupHash.substring(7) : null) ||
                    (isStoreAdmin ? startupHash.substring(13) : null);
  
  if (startupHash === '#register-vendor' || startupHash === '#auth-vendor') {
    showPage('auth');
    setTimeout(() => {
      if (typeof switchRole === 'function') {
        switchRole('vendor');
      }
    }, 150);
  } else if (storeSlug) {
    apiGet('stores', 'limit=200').then(res => {
      const all = res ? res.data || [] : [];
      App.allStores = all;
      const found = all.find(s => s.slug === storeSlug || s.id === storeSlug);
      if (found) {
        if (isStoreAdmin) {
          showPage('store-admin');
          if (typeof renderStorefrontAdminPortalPage === 'function') {
            renderStorefrontAdminPortalPage(found.id);
          }
        } else {
          showPage('store-detail');
          if (typeof renderStoreDetail === 'function') {
            renderStoreDetail(found.id);
          }
        }
      } else {
        showPage('home');
      }
    }).catch(() => showPage('home'));
  } else {
    showPage('home');
  }

  // Listen to hash changes dynamically
  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash;
    if (newHash.startsWith('#store/')) {
      const slug = newHash.substring(7);
      const found = App.allStores.find(s => s.slug === slug || s.id === slug);
      if (found) {
        showPage('store-detail');
        if (typeof renderStoreDetail === 'function') {
          renderStoreDetail(found.id);
        }
      }
    } else if (newHash.startsWith('#store-admin/')) {
      const slug = newHash.substring(13);
      const found = App.allStores.find(s => s.slug === slug || s.id === slug);
      if (found) {
        showPage('store-admin');
        if (typeof renderStorefrontAdminPortalPage === 'function') {
          renderStorefrontAdminPortalPage(found.id);
        }
      }
    } else if (newHash === '#register-vendor' || newHash === '#auth-vendor') {
      showPage('auth');
      if (typeof switchRole === 'function') {
        switchRole('vendor');
      }
    }
  });

  // ── Browser back-button support ──
  // Replace the initial entry so it has state, then listen for popstate
  history.replaceState({ page: App.currentPage }, '');
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.page) {
      // Navigate to the page stored in the history entry without pushing
      // a new entry (the browser already moved the pointer).
      App._skipPush = true;
      showPage(e.state.page);
      App._skipPush = false;
    }
  });

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
  updateCartBadge();
}
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
function logout() {
  if (!confirm('Sign out of HAPPA TRADEMART?')) return;
  App.currentUser = null;
  localStorage.removeItem('happa_session');
  showPage('home');
  showToast('Signed out successfully', 'info');
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
    const list = document.getElementById('marketplace-list');
    if (list) list.innerHTML = Array(8).fill(cardHtml).join('');
  } else if (pageId === 'stores') {
    const list = document.getElementById('stores-list');
    if (list) list.innerHTML = Array(8).fill(rowHtml).join('');
  } else if (pageId === 'notifications') {
    const list = document.getElementById('notifications-content');
    if (list) list.innerHTML = Array(6).fill(rowHtml).join('');
  }
}

function updatePWAManifest(name, logoUrl, themeColor) {
  let link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
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
    short_name: name.substring(0, 12),
    icons: [
      { src: fullLogoUrl, sizes: '192x192', type: 'image/png' },
      { src: fullLogoUrl, sizes: '512x512', type: 'image/png' }
    ],
    start_url: window.location.href,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: themeColor
  };

  const stringManifest = JSON.stringify(dynamicManifest);
  const blob = new Blob([stringManifest], {type: 'application/json'});
  const manifestURL = URL.createObjectURL(blob);
  link.setAttribute('href', manifestURL);
}

// ── Page Navigation ───────────────────────────────────────
function showPage(pageId) {
  // Reset PWA manifest when leaving store detail page
  if (pageId !== 'store-detail') {
    updatePWAManifest('HAPPA TRADEMART', 'images/icon-192.png', '#e85d04');
  }

  // map dashboard route
  if (pageId === 'dashboard' || pageId === 'profile') {
    if (!App.currentUser) { showPage('auth'); return; }
    if (App.currentUser.role === 'admin')  { pageId = 'admin-dashboard'; }
    else if (App.currentUser.role === 'vendor' || App.currentUser.role === 'seller') { pageId = 'vendor-dashboard'; }
    else if (App.currentUser.role === 'rendor') { pageId = 'rendor-dashboard'; }
    else { pageId = 'buyer-dashboard'; }
  }

  App.prevPage = App.currentPage;
  App.currentPage = pageId;

  // Push a browser-history entry so the mobile back button works.
  // Skip when we're already handling a popstate (browser-back) event.
  if (!App._skipPush) {
    history.pushState({ page: pageId }, '');
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
  
  // Inject skeletons while content loads asynchronously
  injectSkeletonLoaders(pageId);
  
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.scrollTop = 0;
    if (pageId === 'store-detail' || pageId === 'store-admin') {
      mainContent.style.height = '100vh';
      mainContent.style.paddingBottom = '0';
    } else {
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

  // page-specific init
  switch(pageId) {
    case 'home':           loadHomeData().then(() => initAdBanners('home')); break;
    case 'marketplace':    renderMarketplace().then(() => initAdBanners('shop')); calcDaysToSaturday(); break;
    case 'stores':         renderStores().then(() => initAdBanners('stores')); break;
    case 'cart':           renderCart(); calcDaysToSaturday(); break;
    case 'checkout':       renderCheckout(); break;
    case 'auth':           renderAuth(); break;
    case 'settings':       renderSettingsPage(); break;
    case 'buyer-dashboard': renderBuyerDashboard(); break;
    case 'vendor-dashboard':  renderVendorDashboard(); break;
    case 'vendor-my-store':   renderVendorMyStorePage(); break;
    case 'vendor-orders':     renderVendorOrdersPage(); break;
    case 'rendor-dashboard':  renderRendorDashboard(); break;
    case 'rendor-profile':    renderRendorProfilePublic(); break;
    case 'admin-dashboard':   renderAdminDashboard(); if (typeof window.refreshAIBadge==='function') window.refreshAIBadge(); break;
    case 'notifications':     renderNotifications(); break;
    case 'delivery':         renderDeliveryPage(); break;
    case 'privacy':          renderPrivacyPage(); break;
  }
}
function goBack() {
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
            <select class="form-control form-select" id="set-loc">
              ${LOCATIONS.map(l => `<option value="${l}"${l === u.location ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick="saveProfileSettings('${u.id}')">
            <i class="fas fa-save"></i> Save Changes
          </button>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>📱 App Installation</h3></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <p style="font-size:.8rem;color:var(--text-muted);margin:0">Add HAPPA TRADEMART to your device home screen for a faster, offline-enabled app experience.</p>
          <button class="btn btn-primary btn-sm btn-block" onclick="window.triggerPWAInstall()">
            <i class="fas fa-download"></i> Install HAPPA PWA App
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

  const isStorefront = App.currentPage === 'store-detail' || App.currentPage === 'store-admin';

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
      <i class="fas fa-map-marker-alt" style="color:var(--primary)"></i> ${escHtml(freshStore.location)}
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
        <div style="font-size:1.1rem;font-weight:800;color:var(--success)">GHS ${(freshStore.total_sales||0).toLocaleString()}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">Total Sales</div>
      </div>
      <div class="stat-card" style="text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:var(--secondary)">${freshStore.total_orders||0}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">Orders</div>
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="editStoreInfo('${freshStore.id}')">
        <i class="fas fa-edit"></i> Edit Store
      </button>
      <button class="btn btn-outline btn-sm" onclick="editKeywords('${freshStore.id}')">
        <i class="fas fa-tags"></i> Keywords
      </button>
      <button class="btn btn-outline btn-sm" onclick="showPage('vendor-dashboard')">
        <i class="fas fa-tachometer-alt"></i> Dashboard
      </button>
    </div>

    <!-- Keywords -->
    ${(freshStore.keywords||[]).length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:.8rem;font-weight:700;margin-bottom:6px;color:var(--text-muted)">TAGS</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${(freshStore.keywords||[]).map(k=>`<span class="tag">${escHtml(k)}</span>`).join('')}
      </div>
    </div>` : ''}

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
        ${products.map(p => productCardHTML(p)).join('')}
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
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading orders…</div>';

  const pkgRes     = await apiGet('packages', `search=${encodeURIComponent(u.id)}&limit=100`);
  const myPackages = (pkgRes?.data || []).filter(p => p.vendor_id === u.id);

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
  localStorage.setItem(localDbKey(table), JSON.stringify(data || []));
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
  const [path, queryString = ''] = table.split('?');
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
    const updatedData = tableData.map(item => {
      if (String(item.id) !== String(id)) return item;
      return { ...item, ...body, id: String(id) };
    });
    saveLocalTable(tableName, updatedData);
    return updatedData.find(item => String(item.id) === String(id)) || null;
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

async function apiFetch(table, opts = {}) {
  if (API === 'tables/') {
    return localTablesApi(table, opts);
  }

  const url = API + table;
  try {
    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (resp.status === 204) return null;
    return await resp.json();
  } catch(e) {
    console.warn('API Error, falling back to local tables:', table, e);
    return localTablesApi(table, opts);
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
async function apiPost(table, data) {
  apiCache.clear();
  return apiFetch(table, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiPut(table, id, data) {
  apiCache.clear();
  return apiFetch(table + '/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiPatch(table, id, data) {
  apiCache.clear();
  return apiFetch(table + '/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiDelete(table, id) {
  apiCache.clear();
  return apiFetch(table + '/' + id, { method: 'DELETE' });
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
function calcDaysToSaturday() {
  const sat = getNextSaturday();
  const diff = Math.ceil((sat - new Date()) / (1000 * 60 * 60 * 24));
  const el = document.getElementById('days-to-saturday');
  if (el) el.textContent = diff;
}

// ── Flash Sale Countdown ──────────────────────────────────
function initCountdown() {
  // Set flash sale end to next 6 hours from now
  App.flashSaleEnd = new Date(Date.now() + 6 * 3600 * 1000);
  updateCountdown();
  setInterval(updateCountdown, 1000);
}
function updateCountdown() {
  const now = new Date();
  let diff = Math.max(0, App.flashSaleEnd - now);
  if (diff === 0) App.flashSaleEnd = new Date(Date.now() + 6 * 3600 * 1000);
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


  try {
    const [prodRes, storeRes] = await Promise.all([
      apiGet('products', 'limit=500'),
      apiGet('stores', 'limit=500')
    ]);

    App.allProducts = prodRes?.data || [];
    App.allStores = storeRes?.data || [];

  } catch (e) {
    console.warn('[loadHomeData] API error, falling back to mock lists:', e);
    App.allProducts = MOCK_PRODUCTS;
    App.allStores = MOCK_STORES;
  }

  renderFlashSale();
  renderLocalProducts();
  renderFeaturedStores();
  renderTrending();
  renderHomeServices();
}

// ── Flash Sale ────────────────────────────────────────────
function renderFlashSale() {
  const list = document.getElementById('flash-sale-list');
  if (!list) return;
  const items = App.allProducts.filter(p => p.is_flash_sale && p.status !== 'archived');
  list.innerHTML = items.length ? items.map(p => productCardSmall(p)).join('') :
    '<div style="padding:20px;color:var(--text-muted);font-size:.85rem">No flash sales right now</div>';
}

// ── Local Products ─────────────────────────────────────────
function renderLocalProducts() {
  const list = document.getElementById('local-products-list');
  const sec  = document.getElementById('local-section');
  if (!list) return;
  const ul = App.currentUser ? App.currentUser.location : null;
  const items = App.allProducts.filter(p => p.status !== 'archived' && (!ul || p.location === ul)).slice(0, 8);
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
  const stores = App.allStores.filter(s => s.status === 'active').slice(0, 6);
  list.innerHTML = stores.map(s => storeCardHTML(s, true)).join('');
}

// ── Trending Products ─────────────────────────────────────
function renderTrending() {
  const list = document.getElementById('trending-list');
  if (!list) return;
  const items = [...App.allProducts]
    .filter(p => p.status !== 'archived')
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
      <img src="${src}" alt="${altText} ${i+1}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
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
    <div class="product-name">${escHtml(p.name)}</div>
    <div style="display:flex;align-items:center;flex-wrap:wrap">
      <span class="product-price">GHS ${p.price}</span>${discount}
    </div>
    <div class="product-meta">
      <span class="product-rating">${stars}</span>
      <span class="product-sold">${p.sold_count||0} sold</span>
    </div>
    <div class="product-location">
      <i class="fas fa-map-marker-alt"></i>${p.location}
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
    <div class="product-name">${escHtml(p.name)}</div>
    <span class="product-price">GHS ${p.price}</span>
  </div>
</div>`;
}

// ── Helper: Store Card HTML ───────────────────────────────
function storeCardHTML(s, compact = false) {
  const stars = renderStars(s.avg_rating || 0);
  const banner = s.banner_url || 'https://via.placeholder.com/800x200?text=Store+Banner';
  const logo   = s.logo_url  || 'https://via.placeholder.com/100x100?text=Logo';
  if (compact) {
    // 2-column layout: smaller logo, tighter padding, taller banner
    return `
<div class="store-card store-card-compact" onclick="openStore('${s.id}')">
  <div class="store-banner-wrap">
    <img class="store-banner" src="${banner}" alt="${escHtml(s.name)}" loading="lazy" onerror="this.src='https://via.placeholder.com/800x200?text=Store+Banner'">
    <img class="store-logo store-logo-compact" src="${logo}" alt="${escHtml(s.name)}" onerror="this.src='https://via.placeholder.com/100x100?text=Logo'">
  </div>
  <div class="store-info">
    <div class="store-name">${escHtml(s.name)}</div>
    <div class="store-cat">${s.category || ''}</div>
    <div class="store-meta">
      <span class="store-rating">${stars} (${s.review_count || 0})</span>
      <span class="store-location-tag"><i class="fas fa-map-marker-alt"></i> ${s.location}</span>
    </div>
  </div>
</div>`;
  }
  return `
<div class="store-card" onclick="openStore('${s.id}')">
  <img class="store-banner" src="${banner}" alt="${escHtml(s.name)}" loading="lazy" onerror="this.src='https://via.placeholder.com/800x200?text=Store+Banner'">
  <img class="store-logo" src="${logo}" alt="${escHtml(s.name)}" onerror="this.src='https://via.placeholder.com/100x100?text=Logo'">
  <div class="store-info">
    <div class="store-name">${escHtml(s.name)}</div>
    <div class="store-cat">${s.category || ''}</div>
    <div class="store-meta">
      <span class="store-rating">${stars} (${s.review_count || 0})</span>
      <span class="store-location-tag"><i class="fas fa-map-marker-alt"></i> ${s.location}</span>
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
  App.currentProductId = id;
  if (App.currentPage === 'store-detail') {
    if (typeof openStorefrontProductModal === 'function') {
      openStorefrontProductModal(id);
    }
  } else {
    showPage('product');
    await renderProductDetail(id);
  }
}
async function openStore(id) {
  App.currentStoreId = id;
  showPage('store-detail');
  await renderStoreDetail(id);
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
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal-container').innerHTML = '';
}
function closeModalForce() {
  document.getElementById('modal-container').innerHTML = '';
}

// ── Admin Profile Panel (full-screen slide-in) ────────────
function showAdminPanel(html) {
  const root = document.getElementById('ap-panel-root');
  if (!root) return;
  root.innerHTML = html;
  root.style.display = 'flex';
  document.body.style.overflow = 'hidden';
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

// ── Delivery Rate Calculator ──────────────────────────────
function calcDelivery(originLoc, destLoc, weightKg = 0.5) {
  if (originLoc === destLoc) return { rate: 15, intercity: false, days: 0 };
  // Simple zone table
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
}

// ── Delivery Page ──────────────────────────────────────────
function renderDeliveryPage() {
  const c = document.getElementById('delivery-content');
  if (!c) return;
  c.innerHTML = `
<h3 style="font-weight:700;margin-bottom:12px">📦 Shipping Schedule</h3>
<div class="ship-schedule-card" style="margin-bottom:16px">
  <div style="font-size:2rem">📅</div>
  <div>
    <div style="font-weight:700">Weekly Saturday Shipping</div>
    <div style="font-size:.8rem;opacity:.8;margin-top:4px">All orders placed during the week are bundled for shipping every Saturday. Track via SMS once dispatched.</div>
  </div>
</div>
<h3 style="font-weight:700;margin-bottom:12px">🚚 Delivery Rates by Route</h3>
<div class="zone-card">
  <div>
    <div class="zone-cities">Local (Same City)</div>
    <div class="zone-days">Next dispatch day</div>
  </div>
  <div class="zone-rate">GHS 15</div>
</div>
<div class="zone-card">
  <div>
    <div class="zone-cities">Accra ↔ Kumasi</div>
    <div class="zone-days">1–2 days after dispatch</div>
  </div>
  <div class="zone-rate">GHS 35+</div>
</div>
<div class="zone-card">
  <div>
    <div class="zone-cities">Accra ↔ Takoradi</div>
    <div class="zone-days">1–2 days after dispatch</div>
  </div>
  <div class="zone-rate">GHS 45+</div>
</div>
<div class="zone-card">
  <div>
    <div class="zone-cities">Kumasi ↔ Takoradi</div>
    <div class="zone-days">1–2 days after dispatch</div>
  </div>
  <div class="zone-rate">GHS 40+</div>
</div>
<div class="zone-card">
  <div>
    <div class="zone-cities">Accra ↔ Tamale / Far North</div>
    <div class="zone-days">2–3 days after dispatch</div>
  </div>
  <div class="zone-rate">GHS 70+</div>
</div>
<div class="zone-card">
  <div>
    <div class="zone-cities">Accra ↔ Cape Coast / Tema</div>
    <div class="zone-days">1 day after dispatch</div>
  </div>
  <div class="zone-rate">GHS 20–35</div>
</div>
<p style="font-size:.8rem;color:var(--text-muted);margin-top:12px">
  <i class="fas fa-info-circle"></i> Weight surcharge: +GHS 4/kg after first 0.5kg. Same-city items in one order are auto-bundled into a single package.
</p>
<h3 style="font-weight:700;margin:20px 0 12px">🤝 Delivery Partners</h3>
<div style="display:flex;gap:12px;flex-wrap:wrap">
  <div class="card" style="flex:1;min-width:130px">
    <div class="card-body" style="text-align:center">
      <div style="font-size:1.5rem">⚡</div>
      <div style="font-weight:700;font-size:.875rem">Bolt Send</div>
      <div style="font-size:.75rem;color:var(--text-muted)">Express local</div>
    </div>
  </div>
  <div class="card" style="flex:1;min-width:130px">
    <div class="card-body" style="text-align:center">
      <div style="font-size:1.5rem">📮</div>
      <div style="font-weight:700;font-size:.875rem">Ghana Post</div>
      <div style="font-size:.75rem;color:var(--text-muted)">National coverage</div>
    </div>
  </div>
  <div class="card" style="flex:1;min-width:130px">
    <div class="card-body" style="text-align:center">
      <div style="font-size:1.5rem">🚚</div>
      <div style="font-weight:700;font-size:.875rem">DHL Ghana</div>
      <div style="font-size:.75rem;color:var(--text-muted)">Premium intercity</div>
    </div>
  </div>
</div>`;
}

// ── Privacy Page ───────────────────────────────────────────
function renderPrivacyPage() {
  const c = document.getElementById('privacy-content');
  if (!c) return;
  c.innerHTML = `

<!-- Header -->
<div style="background:#fff;border-bottom:1px solid var(--border);padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
  <div style="width:42px;height:42px;border-radius:var(--radius-md);background:var(--primary-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <i class="fas fa-shield-alt" style="color:var(--primary);font-size:1.1rem"></i>
  </div>
  <div>
    <div style="font-weight:800;font-size:1rem;line-height:1.2">Privacy &amp; Data Protection</div>
    <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">Updated ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})} · Ghana DPA 2012 (Act 843)</div>
  </div>
</div>

<!-- Intro -->
<p style="font-size:.84rem;color:var(--text-light);line-height:1.65;padding:0 16px;margin-bottom:20px">
  This policy explains how <strong style="color:var(--text)">HAPPA TRADEMART</strong> collects, uses, stores,
  shares, and protects your personal information. By creating an account or using the Service,
  you acknowledge that you have read and understood this policy.
</p>

<!-- 1. Scope -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">1. Scope &amp; who this applies to</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    <p>This policy applies to every person who uses HAPPA TRADEMART, including buyers, vendors, rendors (service providers), administrators, and anyone who simply browses the Service. It covers information collected through our website, mobile apps, and any official communication channel we operate (email, SMS, push, in-app messaging).</p>
    <p style="margin-top:8px">It does <strong style="color:var(--text)">not</strong> cover third-party websites or services that we link to (for example, an external payment processor or courier). Those services have their own privacy policies, which we encourage you to read.</p>
  </div>
</div>

<!-- 2. Information we collect -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">2. Information we collect</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);line-height:1.65;padding:12px 14px 8px">We collect three broad categories of information:</p>
    ${[
      ['Account data',       'Name, email, phone, password (hashed), role',                                                        'You, on signup'],
      ['Profile data',       'Avatar, location, bio, display name, ID verification files',                                 'You, in settings'],
      ['Transaction data',   'Orders, packages, payment references, delivery addresses, ratings &amp; reviews',                    'Generated by your use'],
      ['Wallet data',        'Wallet balance, deposits, withdrawals, top-ups, transaction history',                                'Generated by your use'],
      ['Device &amp; usage', 'IP address, browser type, OS, screen size, app version, crash reports, pages visited',              'Automatic'],
      ['Communications',     'Support messages, in-app chats, notifications, marketing preferences',                               'You, when you contact us'],
      ['Product content',    'Product images, descriptions, prices, and any AI-generated text associated with them',               'Vendors / Rendors'],
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
      <strong style="color:var(--text)">Sensitive data:</strong> We do <em>not</em> knowingly collect government ID numbers, biometric data, or health data except where strictly required for KYC verification of vendors and rendors, in which case it is encrypted at rest.
    </p>
  </div>
</div>

<!-- 3. Lawful basis -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">3. Why we collect it (lawful basis)</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    ${[
      ['fa-file-contract',  '#dbeafe', '#1d4ed8', 'Performance of a contract',  'To process and deliver orders, pay vendors/rendors, and manage your wallet.'],
      ['fa-balance-scale',  '#dcfce7', '#15803d', 'Legitimate interests',        'To keep the platform safe, prevent fraud, enforce our Terms of Service, and improve features.'],
      ['fa-hand-paper',     '#fef3c7', '#b45309', 'Your consent',                'For marketing communications, optional analytics, and non-essential cookies. Withdraw at any time.'],
      ['fa-gavel',          '#f3e8ff', '#7c3aed', 'Legal obligation',            'To comply with tax, anti-money-laundering, and law-enforcement requests as required by Ghanaian law.'],
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
    <p style="font-size:.8rem;color:var(--text-muted);padding:10px 14px;border-top:1px solid var(--border)">If we ever need to use your data for a purpose not described here, we will ask for your consent first.</p>
  </div>
</div>

<!-- 4. Cookies -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">4. Cookies, local storage &amp; tracking</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);line-height:1.65;padding:12px 14px 10px">We use cookies, <code style="background:var(--bg);border:1px solid var(--border);padding:1px 5px;border-radius:4px;font-size:.78rem">localStorage</code>, and similar technologies to keep you signed in, remember your preferences, measure usage, and show relevant banners.</p>
    ${[
      ['ESSENTIAL',  '#fee2e2', '#991b1b', 'Session token, auth cookie, cart, app cache',         'Required — Service won\'t work without these', 'No'],
      ['FUNCTIONAL', '#dbeafe', '#1e40af', 'Location filter, language, theme, recently viewed',    'Optional — disabling reduces convenience',       'Yes, in your browser'],
      ['ANALYTICS',  '#ede9fe', '#5b21b6', 'Anonymised page views, error reports, performance',   'Optional',                                        'Yes, via "Do Not Track"'],
      ['MARKETING',  '#fef3c7', '#92400e', 'Personalised banners, re-engagement emails',           'Optional',                                        'Yes, in account settings'],
    ].map(([label, bg, col, ex, req, dis], i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-top:1px solid var(--border)">
      <span style="display:inline-block;padding:3px 8px;border-radius:var(--radius-full);background:${bg};color:${col};font-size:.67rem;font-weight:800;letter-spacing:.3px;white-space:nowrap;margin-top:1px">${label}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.79rem;color:var(--text-light);line-height:1.5;margin-bottom:3px">${ex}</div>
        <div style="font-size:.73rem;color:var(--text-muted)">${req} · Disable: ${dis}</div>
      </div>
    </div>`).join('')}
  </div>
</div>

<!-- 5. Sharing -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">5. How we share your information</h3>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-md);padding:10px 14px;margin:0 16px 10px;display:flex;align-items:center;gap:10px">
  <i class="fas fa-ban" style="color:#15803d;font-size:1rem;flex-shrink:0"></i>
  <span style="font-size:.83rem;color:#14532d;font-weight:600">We never sell your personal data.</span>
</div>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    ${[
      ['Other users on the platform',      'When strictly necessary — e.g. a vendor sees your delivery city; a buyer sees a vendor\'s public profile.'],
      ['Payment processors',               'Mobile-money aggregators receive only the data needed to process deposits, withdrawals, and order payments.'],
      ['Couriers &amp; delivery partners', 'Name, phone, and delivery address required to complete the handover.'],
      ['Cloud infrastructure providers',   'Hosting, email, push notifications — all bound by data-processing agreements.'],
      ['Law-enforcement &amp; regulators', 'When we receive a valid legal request or are required to do so by Ghanaian law.'],
      ['Auditors &amp; advisors',          'Under strict confidentiality.'],
    ].map(([who, why], i) => `
    <div style="padding:10px 14px;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
      <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:2px">${who}</div>
      <div style="font-size:.79rem;color:var(--text-light);line-height:1.5">${why}</div>
    </div>`).join('')}
    <div style="background:#fffbeb;border-top:1px solid var(--border);padding:10px 14px;display:flex;gap:8px;align-items:flex-start">
      <i class="fas fa-exclamation-triangle" style="color:#b45309;margin-top:2px;flex-shrink:0;font-size:.85rem"></i>
      <p style="font-size:.8rem;color:#78350f;line-height:1.55;margin:0"><strong>Public content:</strong> Anything you post publicly (store description, product photos, rendor bio, reviews) is visible to everyone. Don't post personal data you don't want shared.</p>
    </div>
  </div>
</div>

<!-- 6. Retention -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">6. How long we keep your data</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);padding:12px 14px 8px;line-height:1.55">We keep your data only as long as necessary, then delete or anonymise it.</p>
    ${[
      ['Account profile',          'Until deleted + 30 days',                          'Cooling-off period'],
      ['Orders &amp; invoices',    '7 years after order date',                          'Tax &amp; accounting law'],
      ['Wallet transactions',      '7 years after transaction date',                    'Tax &amp; accounting law'],
      ['Support messages',         '3 years after last contact',                        'Service quality &amp; disputes'],
      ['ID verification files',    'Until expired or 5 years, whichever is sooner',     'KYC &amp; AML'],
      ['Server logs (IP, etc.)',   '90 days',                                           'Security &amp; abuse prevention'],
      ['Marketing consent record', 'Until consent withdrawn + 3 years',                 'Proof of consent'],
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
      'TLS 1.2+ encryption for all data in transit',
      'Passwords hashed with bcrypt (never stored in plain text)',
      'Role-based access controls and least-privilege principles for staff',
      'Two-factor authentication available to all accounts',
      'Regular vulnerability scanning and penetration testing',
      'Encrypted backups stored in geographically separate locations',
      '24/7 incident-response team',
    ].map((item, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
      <i class="fas fa-check-circle" style="color:var(--success);flex-shrink:0"></i>
      <span style="font-size:.83rem;color:var(--text-light)">${item}</span>
    </div>`).join('')}
    <p style="font-size:.78rem;color:var(--text-muted);padding:10px 14px;border-top:1px solid var(--border);line-height:1.55">
      <i class="fas fa-info-circle" style="margin-right:4px"></i>No system is 100% secure. If we discover a breach affecting your data, we will notify you and the Data Protection Commission within 72 hours, as required by Act 843.
    </p>
  </div>
</div>

<!-- 8. Your rights -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">8. Your rights &amp; how to exercise them</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 16px;margin-bottom:16px">
  ${[
    ['🔍', 'Access',        'View the personal data we hold about you'],
    ['✏️', 'Rectification', 'Correct inaccurate or incomplete data'],
    ['🗑️', 'Erasure',       'Right to be forgotten in certain cases'],
    ['⛔',  'Restriction',  'Object to certain processing activities'],
    ['↩️', 'Withdraw',      'Withdraw consent at any time'],
    ['📞', 'Complain',      'Lodge a complaint with the DPC Ghana'],
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
  You can exercise most of these rights directly from your account settings. For anything else, contact our DPO below. We respond to all valid requests within <strong style="color:var(--text)">30 days</strong>.
</p>

<!-- 9. Children -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">9. Children's privacy</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    HAPPA TRADEMART is not intended for children under 18. We do not knowingly collect personal data from children. If you believe a child has created an account, please contact our DPO and we will delete the account within 7 days.
  </div>
</div>

<!-- 10. Cross-border -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">10. Cross-border transfers</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    Your data is primarily stored and processed in Ghana. Where we use a sub-processor located outside Ghana (for example, a global cloud provider), we ensure an equivalent level of protection through contractual safeguards, encryption, and (where required) explicit consent.
  </div>
</div>

<!-- 11. AI -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">11. AI-generated content</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="padding:0">
    <p style="font-size:.84rem;color:var(--text-light);line-height:1.65;padding:12px 14px 8px">To help vendors list products faster, our optional "AI Auto-Generation" feature suggests a name and description for a product image.</p>
    ${[
      'The product image is sent to a third-party AI provider (e.g. Google Gemini, OpenAI) whose API keys are managed by the platform administrator.',
      'AI providers are contractually prohibited from using your images to train their models.',
      'No personal data is sent with the image — only the image itself.',
      'You are never required to use AI-generated content; you can always edit or replace it before publishing.',
    ].map((item, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-top:1px solid var(--border)">
      <i class="fas fa-microchip" style="color:var(--primary);flex-shrink:0;margin-top:2px;font-size:.8rem"></i>
      <span style="font-size:.82rem;color:var(--text-light);line-height:1.55">${item}</span>
    </div>`).join('')}
  </div>
</div>

<!-- 12. Changes -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">12. Changes to this policy</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="font-size:.84rem;color:var(--text-light);line-height:1.65">
    We may update this policy from time to time. When we do, we will change the "Last updated" date at the top and, for material changes, notify you via in-app banner and/or email at least <strong style="color:var(--text)">14 days</strong> before the new policy takes effect. Your continued use of the Service after that date constitutes acceptance of the changes.
  </div>
</div>

<!-- 13. Contact DPO -->
<h3 style="font-weight:700;font-size:.88rem;padding:0 16px;margin-bottom:8px">13. Contact our Data Protection Officer</h3>
<div class="card" style="margin:0 16px 16px">
  <div class="card-body" style="display:flex;align-items:center;gap:14px">
    <div style="width:46px;height:46px;border-radius:var(--radius-md);background:var(--primary);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i class="fas fa-user-shield" style="color:#fff;font-size:1.1rem"></i>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:800;font-size:.9rem;margin-bottom:6px">Data Protection Officer</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);margin-bottom:4px">
        <i class="fas fa-envelope" style="width:12px;color:var(--primary)"></i>
        <a href="mailto:privacy@happatrademart.com" style="color:var(--primary);font-weight:600">privacy@happatrademart.com</a>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);margin-bottom:4px">
        <i class="fas fa-phone" style="width:12px;color:var(--primary)"></i>
        <a href="tel:+233000000000" style="color:var(--primary);font-weight:600">+233 (0) 000 000 000</a>
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
</p>`;
}

function requestAccountDeletion() {
  if (!App.currentUser) { showToast('Please sign in first', 'warning'); return; }
  if (confirm('Are you sure you want to delete your account? This is irreversible.\n\nA confirmation email will be sent and your data will be permanently deleted within 30 days.')) {
    showToast('Account deletion request submitted. Check your email for the next step.', 'info', 5000);
    // In a real implementation, call apiPost('account-deletion-requests', {...})
  }
}
