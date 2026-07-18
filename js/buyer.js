/* ============================================================
   HAPPA TRADEMART — Buyer Dashboard
   ============================================================ */

async function renderBuyerDashboard() {
  const c = document.getElementById('buyer-dashboard-content');
  if (!c) return;
  if (!App.currentUser) { showPage('auth'); return; }
  const u = App.currentUser;

  // Fetch orders & packages
  const [ordersRes, pkgsRes, refsRes, refBalance] = await Promise.all([
    apiGet('orders', `search=${u.id}&limit=50`),
    apiGet('packages', `search=${u.id}&limit=50`),
    apiGet('referrals', `search=${u.id}&limit=50`),
    calculateUserReferralBalance(u.id)
  ]);

  const myOrders   = (ordersRes?.data || []).filter(o => o.buyer_id === u.id);
  const myPackages = (pkgsRes?.data || []).filter(p => p.buyer_id === u.id);
  const myRefs     = (refsRes?.data || []).filter(r => r.referrer_id === u.id);

  // Saved stores
  const savedStoresList = App.allStores.filter(s => App.savedStores.includes(s.id));

  c.innerHTML = `
<div class="tab-nav" id="buyer-tabs" style="display:flex;overflow-x:auto;white-space:nowrap;gap:8px;padding-bottom:8px">
  <div class="tab-btn active" id="nav-buyer-overview" onclick="switchTab(this,'buyer-overview')">Overview</div>
  <div class="tab-btn" id="nav-buyer-wishlist" onclick="switchTab(this,'buyer-wishlist');renderBuyerWishlist()">Wishlist</div>
  <div class="tab-btn" id="nav-buyer-addresses" onclick="switchTab(this,'buyer-addresses');renderBuyerAddresses()">Addresses</div>
  <div class="tab-btn" id="nav-buyer-reviews" onclick="switchTab(this,'buyer-reviews');renderBuyerReviews()">My Reviews</div>
  <div class="tab-btn" id="nav-buyer-settings" onclick="showPage('settings')">Settings</div>
  
  <!-- Hidden tabs for programmatic switching -->
  <div class="tab-btn" id="nav-buyer-orders" style="display:none" onclick="switchTab(this,'buyer-orders')">Orders</div>
  <div class="tab-btn" id="nav-buyer-referral" style="display:none" onclick="switchTab(this,'buyer-referral')">Referrals</div>
  <div class="tab-btn" id="nav-buyer-saved" style="display:none" onclick="switchTab(this,'buyer-saved')">Saved Stores</div>
</div>

<!-- ── Overview ── -->
<div class="tab-content active" id="buyer-overview">
  <div class="dashboard-wrap">
    <!-- Profile Header -->
    <div style="display:flex;align-items:center;gap:14px;background:#fff;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);margin-bottom:16px;box-shadow:var(--shadow-sm)">
      <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.4rem;color:#fff;flex-shrink:0">
        ${(u.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1">
        <div style="font-weight:800;font-size:1rem">${escHtml(u.name)}</div>
        <div style="font-size:.78rem;color:var(--text-muted)">${u.email}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
          <span class="store-location-tag"><i class="fas fa-map-marker-alt"></i> ${u.location||'No location'}</span>
          <button class="btn btn-outline" onclick="window.triggerPWAInstall()" style="padding:2px 8px;font-size:.72rem;display:inline-flex;align-items:center;gap:4px;height:auto;line-height:1">
            <i class="fas fa-download"></i> Install App
          </button>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" style="cursor:pointer" onclick="document.getElementById('nav-buyer-orders').click()">
        <div class="stat-icon" style="background:#dbeafe"><i class="fas fa-shopping-bag" style="color:#1d4ed8"></i></div>
        <div class="stat-value">${myOrders.length}</div>
        <div class="stat-label">Total Orders</div>
      </div>

      <div class="stat-card" style="cursor:pointer" onclick="document.getElementById('nav-buyer-referral').click()">
        <div class="stat-icon" style="background:#ede9fe"><i class="fas fa-users" style="color:#7c3aed"></i></div>
        <div class="stat-value">${u.referral_count||0}</div>
        <div class="stat-label">Referrals</div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="document.getElementById('nav-buyer-saved').click()">
        <div class="stat-icon" style="background:#fef3c7"><i class="fas fa-bookmark" style="color:#d97706"></i></div>
        <div class="stat-value">${App.savedStores.length}</div>
        <div class="stat-label">Saved Stores</div>
      </div>
    </div>

    <!-- Phone verification notice -->
    ${!u.is_verified ? `
    <div class="verify-banner">
      <i class="fas fa-exclamation-circle"></i>
      <p>Verify your phone to get order updates via SMS. <a href="#" onclick="resendOTP()" style="color:var(--primary);font-weight:700">Verify now →</a></p>
    </div>` : ''}

    <!-- Recent Orders -->
    <h3 style="font-size:.9rem;font-weight:700;margin-bottom:10px">Recent Orders</h3>
    ${myPackages.slice(0,3).map(pkg => buyerPackageCard(pkg)).join('') ||
      `<div class="empty-state" style="padding:24px">
        <i class="fas fa-shopping-bag"></i>
        <h3>No orders yet</h3>
        <p>Start shopping to see your orders here</p>
        <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showPage('marketplace')">
          <i class="fas fa-store"></i> Browse Marketplace
        </button>
      </div>`}
  </div>
</div>

<!-- ── Orders Tab ── -->
<div class="tab-content" id="buyer-orders">
  <div class="dashboard-wrap">
    <div class="tab-nav" id="order-filter-tabs" style="margin-bottom:14px">
      <div class="tab-btn active" onclick="filterBuyerOrders('all',this)">All</div>
      <div class="tab-btn" onclick="filterBuyerOrders('pending',this)">Processing</div>
      <div class="tab-btn" onclick="filterBuyerOrders('on_delivery',this)">In Transit</div>
      <div class="tab-btn" onclick="filterBuyerOrders('delivered',this)">Delivered</div>
      <div class="tab-btn" onclick="filterBuyerOrders('rejected',this)">Rejected</div>
    </div>
    <div id="buyer-orders-list">
      ${myPackages.length ? myPackages.map(pkg => buyerPackageCard(pkg)).join('') :
        '<div class="empty-state" style="padding:30px"><i class="fas fa-inbox"></i><h3>No orders yet</h3><p>Your orders will appear here after checkout</p></div>'}
    </div>
  </div>
</div>

<!-- ── Referral Tab ── -->
<div class="tab-content" id="buyer-referral">
  <div class="dashboard-wrap">
    
    <!-- Personal Referral Coupon Card -->
    <div class="referral-code-card" style="margin-bottom:16px; background: linear-gradient(135deg, #1d4ed8, #3b82f6)">
      <div style="font-size:.78rem;opacity:.8;margin-bottom:4px;color:#fff">Your Personal Referral Coupon</div>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:12px;opacity:.9;color:#fff">Use this code at checkout to spend your referral earnings!</div>
      
      <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
        <div style="flex:1;background:rgba(255,255,255,.15);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:1px">REF-${u.id}</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.15);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:.75rem;color:rgba(255,255,255,.8);text-transform:uppercase;letter-spacing:.5px">Available Balance</div>
          <div style="font-size:1.4rem;font-weight:800;color:#fff">GHS ${refBalance.toFixed(2)}</div>
        </div>
      </div>
      
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.5);color:#fff;background:rgba(255,255,255,.1)" onclick="navigator.clipboard.writeText('REF-${u.id}'); showToast('Coupon code copied!', 'success')">
          <i class="fas fa-copy"></i> Copy Coupon Code
        </button>
      </div>
    </div>

    <!-- Referral Link Card -->
    <div class="referral-code-card" style="margin-bottom:16px">
      <div style="font-size:.78rem;opacity:.8;margin-bottom:4px">Your Referral Link</div>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:2px;opacity:.9">Share your link — when someone signs up, your referral count grows!</div>
      <div style="background:rgba(0,0,0,.25);border-radius:8px;padding:8px 10px;margin:10px 0;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="copyRefLink('${u.referral_code||''}')">
        <i class="fas fa-link" style="flex-shrink:0;font-size:.8rem"></i>
        <span id="user-ref-link" style="font-size:.72rem;word-break:break-all;flex:1;text-align:left">${buildRefLink(u.referral_code||'')}</span>
        <i class="fas fa-copy" style="flex-shrink:0;font-size:.8rem"></i>
      </div>
      <div style="font-size:.75rem;opacity:.75;margin-bottom:12px">
        Referrals: <strong>${u.referral_count||0}</strong> people have signed up via your link
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-accent btn-sm" onclick="copyRefLink('${u.referral_code||''}')">
          <i class="fas fa-copy"></i> Copy Link
        </button>
        <button class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.5);color:#fff" onclick="shareRefLink('${u.referral_code||''}')">
          <i class="fas fa-share-alt"></i> Share Link
        </button>
        <button class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.5);color:#fff" onclick="shareRefWhatsApp('${u.referral_code||''}')">
          <i class="fab fa-whatsapp"></i> WhatsApp
        </button>
      </div>
    </div>

    <!-- How it works -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-body" style="padding:14px">
        <div style="font-weight:700;font-size:.9rem;margin-bottom:10px">💡 How Referrals Work</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">1</div>
            <div style="color:var(--text-light)">Copy and share your referral link with friends</div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">2</div>
            <div style="color:var(--text-light)">They click your link — taken straight to signup, already linked to you. No code needed!</div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">3</div>
            <div style="color:var(--text-light)">When they sign up your referral count goes up — track your impact in Referral History below!</div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--success);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">✓</div>
            <div style="color:var(--text-light)">Help grow the community — the more you share, the bigger the marketplace becomes for everyone!</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Referral History -->
    <div class="card">
      <div class="card-header"><h3>Referral History (${myRefs.length})</h3></div>
      <div>
        ${myRefs.length ? myRefs.map(r => {
          const referredName = r.referred_email || 'A friend';
          const statusBadge  = r.status === 'active'
            ? `<span class="status-badge status-active">Active</span>`
            : `<span class="status-badge status-pending">${r.status||'pending'}</span>`;
          const joinedOn = r.created_at
            ? new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
            : '—';
          return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:.82rem;font-weight:600"><i class="fas fa-user-plus" style="color:var(--primary)"></i> ${escHtml(referredName)}</div>
            <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">Joined: ${joinedOn}</div>
          </div>
          <div style="text-align:right">${statusBadge}</div>
        </div>`;
        }).join('') :
        `<div class="empty-state" style="padding:24px">
          <i class="fas fa-users"></i>
          <h3>No referrals yet</h3>
          <p>Share your referral link above to invite friends to HAPPA TRADEMART!</p>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="copyRefLink('${u.referral_code||''}')">
            <i class="fas fa-copy"></i> Copy Your Link
          </button>
        </div>`}
      </div>
    </div>
  </div>
</div>

<!-- ── Saved Stores ── -->
<div class="tab-content" id="buyer-saved">
  <div class="dashboard-wrap">
    <h3 style="font-size:.9rem;font-weight:700;margin-bottom:12px">Saved Stores (${savedStoresList.length})</h3>
    ${savedStoresList.length ? savedStoresList.map(s => storeCardHTML(s)).join('') :
      `<div class="empty-state" style="padding:40px 20px">
        <i class="fas fa-bookmark"></i>
        <h3>No saved stores</h3>
        <p>Tap the bookmark icon on any store to save it</p>
        <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showPage('stores')">Browse Stores</button>
      </div>`}
  </div>
</div>



<!-- ── Wishlist Tab ── -->
<div class="tab-content" id="buyer-wishlist">
  <div class="dashboard-wrap">
    <div class="card">
      <div class="card-header"><h3>💖 My Wishlist</h3></div>
      <div class="card-body" id="wishlist-container" style="padding:16px">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>
</div>

<!-- ── Addresses Tab ── -->
<div class="tab-content" id="buyer-addresses">
  <div class="dashboard-wrap">
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>📍 Add New Address</h3></div>
      <div class="card-body">
        <form onsubmit="event.preventDefault(); addNewAddress(this)" style="display:grid;gap:8px">
          <input class="form-control" name="address" placeholder="House number, street, landmark, city" required>
          <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Add Address</button>
        </form>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Saved Addresses</h3></div>
      <div class="card-body" id="addresses-container">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>
</div>



<!-- ── Reviews Tab ── -->
<div class="tab-content" id="buyer-reviews">
  <div class="dashboard-wrap">
    <div class="card">
      <div class="card-header"><h3>My Reviews</h3></div>
      <div class="card-body" id="buyer-reviews-container" style="padding:14px">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>
</div>`;
}

// NOTE: buyerPackageCard, showPackageDetailModal, filterBuyerOrders,
//       showOrderReviewModal, selectRating, submitOrderReview, refreshBuyerOrdersList
//       are all defined in js/orders.js

// ── Build the referral link ────────────────────────────────
function buildRefLink(code) {
  if (!code) return window.location.origin + window.location.pathname;
  // Use clean base URL (strip existing query params)
  const base = window.location.origin + window.location.pathname;
  return `${base}?ref=${encodeURIComponent(code)}`;
}

// ── Copy full referral link to clipboard ──────────────────
function copyRefLink(code) {
  const link = buildRefLink(code);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(() => showToast('Referral link copied! 🔗', 'success'));
  } else {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Referral link copied! 🔗', 'success');
  }
}

// ── Legacy alias kept so old onclick="copyRefCode(...)" still works ──
function copyRefCode(code) { copyRefLink(code); }

// ── Native share sheet (mobile) ───────────────────────────
function shareRefLink(code) {
  const link = buildRefLink(code);
  const text = `🛒 Join me on HAPPA TRADEMART — Ghana's best marketplace! Sign up here and start shopping:`;
  if (navigator.share) {
    navigator.share({ title: 'Join HAPPA TRADEMART!', text, url: link })
      .catch(() => copyRefLink(code));
  } else {
    copyRefLink(code);
  }
}

// ── Share via WhatsApp ────────────────────────────────────
function shareRefWhatsApp(code) {
  const link = buildRefLink(code);
  const msg  = encodeURIComponent(`🛒 Join me on HAPPA TRADEMART — Ghana's best multi-vendor marketplace!\n\nSign up here: ${link}`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}


async function saveProfileSettings(userId) {
  const btn = event?.target?.closest('button') || event?.currentTarget;
  const setBtn = OptimisticUI.button(btn, '<i class="fas fa-save"></i> Save Changes');
  setBtn('saving');

  const name   = document.getElementById('set-name')?.value.trim();
  const phone  = document.getElementById('set-phone')?.value.trim();
  const loc    = document.getElementById('set-loc')?.value;

  // Snapshot for rollback
  const u = App.currentUser;
  const snap = u ? { name: u.name, phone: u.phone, location: u.location } : null;

  // Optimistic local update
  if (u) {
    u.name = name; u.phone = phone; u.location = loc;
    saveSessions();
    OptimisticUI.pulse(btn);
  }

  try {
    await apiPatch('users', userId, { name, phone, location: loc });
    setBtn('saved');
    showToast('Profile updated ✅', 'success', 2000);
  } catch (err) {
    if (snap && u) {
      Object.assign(u, snap);
      saveSessions();
    }
    setBtn('failed');
    OptimisticUI.shake(btn);
    showToast('Could not save profile: ' + (err?.message || 'network error'), 'error', 4000);
  }
}

// ── Buyer Helper Functions ──────────────────────────────────────────
window.renderBuyerWishlist = function() {
  const container = document.getElementById('wishlist-container');
  if (!container) return;
  const wish = JSON.parse(localStorage.getItem('happa_wishlist') || '[]');
  const items = App.allProducts.filter(p => wish.includes(p.id));
  if (!items.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:.85rem">Your wishlist is empty. Save products here!</p>';
    return;
  }
  container.innerHTML = `
    <div class="product-grid">
      ${items.map(p => productCardHTML(p)).join('')}
    </div>
  `;
};

window.toggleWishlist = function(prodId) {
  const wish = JSON.parse(localStorage.getItem('happa_wishlist') || '[]');
  const index = wish.indexOf(prodId);
  if (index === -1) {
    wish.push(prodId);
    showToast('Added to wishlist! 💖', 'success');
  } else {
    wish.splice(index, 1);
    showToast('Removed from wishlist', 'info');
  }
  localStorage.setItem('happa_wishlist', JSON.stringify(wish));
  
  // Refresh wishlist view if active
  renderBuyerWishlist();
};

window.renderBuyerAddresses = function() {
  const container = document.getElementById('addresses-container');
  if (!container) return;
  if (!App.currentUser) return;
  const list = App.currentUser.addresses || [App.currentUser.location || 'Accra, Ghana'];
  container.innerHTML = list.map((a, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:.85rem;color:var(--text-light)"><i class="fas fa-map-marker-alt" style="color:var(--primary)"></i> ${escHtml(a)}</span>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteAddress(${i})"><i class="fas fa-trash-alt"></i></button>
    </div>
  `).join('') || '<p style="text-align:center;color:var(--text-muted);font-size:.85rem">No saved addresses. Add one above.</p>';
};

window.addNewAddress = function(form) {
  const addr = form.address.value.trim();
  if (!addr) return;
  App.currentUser.addresses = App.currentUser.addresses || [];
  App.currentUser.addresses.push(addr);
  saveSessions();
  apiPatch('users', App.currentUser.id, { addresses: App.currentUser.addresses });
  showToast('Address added! 📍', 'success');
  form.reset();
  renderBuyerAddresses();
};

window.deleteAddress = function(index) {
  if (!confirm('Delete this address?')) return;
  App.currentUser.addresses.splice(index, 1);
  saveSessions();
  apiPatch('users', App.currentUser.id, { addresses: App.currentUser.addresses });
  showToast('Address removed', 'info');
  renderBuyerAddresses();
};

window.renderBuyerReviews = async function() {
  const container = document.getElementById('buyer-reviews-container');
  if (!container) return;
  const res = await apiGet('reviews', `search=${App.currentUser.id}&limit=50`);
  const myReviews = (res?.data || []).filter(r => r.customer_id === App.currentUser.id);
  if (!myReviews.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:.85rem">You have not submitted any reviews yet.</p>';
    return;
  }
  container.innerHTML = myReviews.map(r => `
    <div style="border-bottom:1px solid var(--border);padding:10px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${escHtml(r.target_id)}</strong>
        <div>${renderStars(r.rating)}</div>
      </div>
      <p style="font-size:.82rem;color:var(--text-light);margin-top:4px">${escHtml(r.review)}</p>
    </div>
  `).join('');
};
