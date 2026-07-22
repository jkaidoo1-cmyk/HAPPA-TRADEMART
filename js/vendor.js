/* ============================================================
   HAPPA TRADEMART — Vendor Dashboard
   ============================================================ */

async function renderVendorDashboard() {
  const c = document.getElementById('vendor-dashboard-content');
  if (!c) return;
  if (!App.currentUser) { showPage('auth'); return; }
  // Accept both 'vendor' and legacy 'seller' role
  if (App.currentUser.role !== 'vendor' && App.currentUser.role !== 'seller') {
    c.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3><p>Vendor accounts only</p></div>';
    return;
  }

  // Re-fetch the vendor's latest data from the server so admin approval
  // is reflected without requiring a logout/login cycle.
  try {
    const freshUser = await apiFetch('users/' + App.currentUser.id);
    // Only merge if the result is a plain user object with same id — never an array or list wrapper.
    if (freshUser && typeof freshUser === 'object' && !Array.isArray(freshUser) &&
        !freshUser.data && freshUser.id && String(freshUser.id) === String(App.currentUser.id) &&
        (freshUser.role === 'vendor' || freshUser.role === 'seller')) {
      Object.assign(App.currentUser, freshUser);
      saveSessions();
    }
  } catch(e) { /* offline / error — proceed with cached data */ }

  // Pending approval — show waiting screen
  if (App.currentUser.status === 'pending_approval') {
    c.innerHTML = `
<div class="dashboard-wrap" style="text-align:center;padding:40px 20px">
  <div style="font-size:3rem;margin-bottom:16px">⏳</div>
  <h2 style="font-weight:800;font-size:1.1rem;margin-bottom:8px">Account Under Review</h2>
  <p style="font-size:.875rem;color:var(--text-light);margin-bottom:20px;line-height:1.7">
    Your vendor account is <strong>awaiting admin approval</strong>.<br>
    You'll receive an in-app notification once approved — usually within 24 hours.
  </p>

  <div style="background:linear-gradient(90deg,#dbeafe,#ede9fe);border:1.5px solid #93c5fd;border-radius:var(--radius-sm);padding:12px 14px;text-align:left;margin-bottom:16px">
    <div style="font-weight:700;font-size:.83rem;margin-bottom:4px;color:#1e3a8a">
      <i class="fas fa-sign-in-alt"></i> You're already logged in!
    </div>
    <div style="font-size:.8rem;color:#1e3a8a;line-height:1.6">
      Your account is pending approval. Once admin approves it and sets up your store, you can log back in with your registered email and password to start selling.
    </div>
  </div>

  <div style="background:#fef9c3;border:1.5px solid #fde047;border-radius:var(--radius-sm);padding:14px;text-align:left;margin-bottom:24px">
    <div style="font-weight:700;font-size:.85rem;margin-bottom:6px;color:#713f12"><i class="fas fa-info-circle"></i> What happens next?</div>
    <ol style="font-size:.82rem;color:#713f12;padding-left:16px;line-height:1.9;margin:0">
      <li>Admin reviews your registration</li>
      <li>You get a notification when approved</li>
      <li>Admin creates your store with the details you provided</li>
      <li>Log in to start adding products and selling!</li>
    </ol>
  </div>
  <button class="btn btn-primary btn-block" onclick="showPage('marketplace')">
    <i class="fas fa-store"></i> Browse Marketplace While You Wait
  </button>
</div>`;
    return;
  }
  // Silently upgrade legacy 'seller' role
  if (App.currentUser.role === 'seller') {
    App.currentUser.role = 'vendor';
    saveSessions();
    apiPatch('users', App.currentUser.id, { role: 'vendor' }).catch(() => {});
  }
  const u = App.currentUser;

  // Fetch all stores then filter client-side by vendor_id (most reliable approach)
  const storeRes = await apiGet('stores', `limit=200`);
  let allStores = storeRes?.data || [];
  if (u.id === 'u-vendor-001') {
    const s1 = allStores.find(s => s.id === '1');
    if (s1 && s1.vendor_id !== 'u-vendor-001') {
      s1.vendor_id = 'u-vendor-001';
      apiPatch('stores', '1', { vendor_id: 'u-vendor-001' }).catch(() => {});
    }
  }
  let stores   = allStores.filter(s => s.vendor_id === u.id);
  let myStore  = stores[0] || null;
  
  // If no store exists for this vendor, auto-create one
  if (!myStore) {
    myStore = await window.autoCreateStoreForVendor(u);
    // Refresh stores from API to get the newly created store
    const newStoreRes = await apiGet('stores', `limit=200`);
    const newAllStores = newStoreRes?.data || [];
    stores = newAllStores.filter(s => s.vendor_id === u.id);
    myStore = stores[0] || myStore;
    // Update App.allStores with fresh data
    App.allStores = newAllStores;
  }

  // Fetch vendor's products
  let myProducts = [];
  if (myStore) {
    const prodRes = await apiGet('products', `search=${myStore.id}&limit=100`);
    myProducts = (prodRes?.data || []).filter(p => String(p.store_id) === String(myStore.id));
    App.allProducts = [...App.allProducts.filter(p => String(p.store_id) !== String(myStore.id)), ...myProducts];
  }

  // Fetch orders/packages for vendor
  // Use vendor_id field filter for reliable package fetching
  const pkgRes = await apiGet('packages', `search=${encodeURIComponent(u.id)}&limit=100`);
  const myPackages = (pkgRes?.data || []).filter(p => p.vendor_id === u.id);

  // Fetch storefront (separate entity) for this vendor's store, if any
  let myStorefront = null;
  if (myStore) {
    const sfRes = await apiGet('storefronts', `limit=200`);
    const allSF = sfRes?.data || [];
    myStorefront = allSF.find(s => String(s.store_id) === String(myStore.id) || String(s.vendor_id) === String(u.id)) || null;
    App.myStorefront = myStorefront;
  }

  // Helper variables for storefront configuration form to decouple from stores
  const sfTheme = myStorefront?.theme || myStore?.theme || 'classic';
  const sfPrimaryColor = myStorefront?.primary_color || myStore?.primary_color || '#e85d04';
  const sfSecondaryColor = myStorefront?.secondary_color || myStore?.secondary_color || '#faf9f6';
  const sfFontFamily = myStorefront?.font_family || myStore?.font_family || 'Outfit';
  const sfLogoUrl = myStorefront?.logo_url || myStore?.logo_url || '';
  const sfBannerUrl = myStorefront?.banner_url || myStore?.banner_url || '';
  const sfName = myStorefront?.name || myStore?.name || '';
  const sfSlogan = myStorefront?.slogan || myStore?.slogan || '';
  const sfDescription = myStorefront?.about_us || myStore?.description || '';
  const sfHours = myStorefront?.business_hours || myStore?.business_hours || 'Mon - Sat: 8:00 AM - 6:00 PM';
  const sfShipping = myStorefront?.shipping_policy || myStore?.shipping_policy || '';
  const sfReturn = myStorefront?.return_policy || myStore?.return_policy || '';
  const sfFacebook = myStorefront?.facebook_url || myStore?.facebook_url || '';
  const sfInstagram = myStorefront?.instagram_url || myStore?.instagram_url || '';
  const sfYoutube = myStorefront?.youtube_url || myStore?.youtube_url || '';
  const sfSlug = myStorefront?.url_slug || myStore?.slug || myStore?.name?.toLowerCase()?.replace(/[^a-z0-9]+/g, '-') || '';
  const sfMetaDesc = myStorefront?.meta_description || myStore?.meta_description || '';

  c.innerHTML = `
<div class="tab-nav" id="vendor-tabs">
  <div class="tab-btn active" onclick="switchTab(this,'vendor-overview')">Overview</div>
  <div class="tab-btn" onclick="switchTab(this,'vendor-products')">Products</div>
  <div class="tab-btn" onclick="switchTab(this,'vendor-earnings')">Earnings</div>
  <div class="tab-btn" onclick="switchTab(this,'vendor-wallet');renderWalletHistory('vendor-txn-list')">Wallet</div>
  <div class="tab-btn" onclick="switchTab(this,'vendor-referral')">Referrals</div>
  <div class="tab-btn" onclick="switchTab(this,'vendor-verify')">Verify</div>
  <div class="tab-btn" onclick="switchTab(this,'vendor-storefront')">Storefront</div>
</div>

<!-- ── Overview Tab ── -->
<div class="tab-content active" id="vendor-overview">
  <div class="dashboard-wrap">
    ${!u.is_verified ? `<div class="verify-banner"><i class="fas fa-exclamation-triangle"></i><p>Please verify your phone number to unlock all features</p></div>` : ''}
    ${!u.id_verified ? `<div class="verify-banner" style="background:linear-gradient(90deg,#fff7ed,#ffedd5);border-color:#fb923c"><i class="fas fa-id-card" style="color:#ea580c"></i><p>Upload your ID to complete vendor verification</p></div>` : ''}

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:#fef9c3"><i class="fas fa-box" style="color:#ca8a04"></i></div>
        <div class="stat-value">${myProducts.filter(p=>p.status==='active').length}</div>
        <div class="stat-label">Active Products</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dbeafe"><i class="fas fa-shopping-bag" style="color:#1d4ed8"></i></div>
        <div class="stat-value">${myPackages.length}</div>
        <div class="stat-label">Total Orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#d1fae5"><i class="fas fa-wallet" style="color:var(--success)"></i></div>
        <div class="stat-value">GHS ${parseFloat(u.wallet_balance||0).toFixed(0)}</div>
        <div class="stat-label">Wallet Balance</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#ede9fe"><i class="fas fa-star" style="color:#7c3aed"></i></div>
        <div class="stat-value">${(myStore?.avg_rating||0).toFixed(1)}</div>
        <div class="stat-label">Store Rating</div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div style="margin-bottom:16px">
      <h3 style="font-size:.9rem;font-weight:700;margin-bottom:10px">Quick Actions</h3>
      <div class="admin-actions-grid">
        <div class="admin-action-btn" onclick="showPage('vendor-my-store')">
          <i class="fas fa-store"></i><span>My Store</span>
        </div>
        <div class="admin-action-btn" onclick="showAddProductModal('${myStore?.id||''}','${u.id}')">
          <i class="fas fa-plus-circle"></i><span>Add Product</span>
        </div>
        <div class="admin-action-btn" onclick="showBulkAddPanel('${myStore?.id||''}','${u.id}')" style="position:relative">
          <i class="fas fa-layer-group"></i><span>Bulk Add</span>
          <span style="position:absolute;top:4px;right:4px;background:var(--primary);color:#fff;font-size:.5rem;font-weight:800;padding:1px 4px;border-radius:20px;line-height:1.4">NEW</span>
        </div>
        <div class="admin-action-btn" onclick="showPage('vendor-orders')">
          <i class="fas fa-shopping-bag"></i><span>Orders</span>
        </div>
        <div class="admin-action-btn" onclick="switchTab(document.querySelector('[onclick*=vendor-earnings]'),'vendor-earnings')">
          <i class="fas fa-chart-line"></i><span>Analytics</span>
        </div>
        <div class="admin-action-btn" onclick="window.triggerPWAInstall()" style="background:rgba(232,93,4,0.06);border:1px solid rgba(232,93,4,0.15);">
          <i class="fas fa-download" style="color:var(--primary)"></i><span style="color:var(--primary);font-weight:700">Install App</span>
        </div>
      </div>
    </div>

    <!-- Recent Orders -->
    <h3 style="font-size:.9rem;font-weight:700;margin-bottom:10px">Recent Packages</h3>
    ${myPackages.slice(0,5).map(pkg => packageRowHTML(pkg)).join('') ||
      '<div class="empty-state" style="padding:24px"><i class="fas fa-inbox"></i><h3>No orders yet</h3></div>'}
  </div>
</div>

<!-- ── Products Tab ── -->
<div class="tab-content" id="vendor-products">
  <div class="dashboard-wrap">
    ${myStore ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px">
      <div style="font-size:.9rem;color:var(--text-muted);flex:1">${myProducts.length} product${myProducts.length!==1?'s':''}</div>
      <button class="btn btn-ghost btn-sm" onclick="showBulkAddPanel('${myStore.id}','${u.id}')" style="display:flex;align-items:center;gap:5px;border:1.5px solid var(--primary);color:var(--primary)">
        <i class="fas fa-layer-group"></i> Bulk Add
      </button>
      <button class="btn btn-primary btn-sm" onclick="showAddProductModal('${myStore.id}','${u.id}')">
        <i class="fas fa-plus"></i> Add
      </button>
    </div>
    ${myProducts.length ? myProducts.map(p => vendorProductRowHTML(p)).join('') :
      '<div class="empty-state" style="padding:24px"><i class="fas fa-box-open"></i><h3>No products yet</h3><p>Add your first product to start selling</p></div>'}
    ` : `<div class="empty-state"><i class="fas fa-store-slash"></i><h3>No store assigned</h3></div>`}
  </div>
</div>



<!-- ── Earnings Tab ── -->
<div class="tab-content" id="vendor-earnings">
  <div class="dashboard-wrap">

    <!-- Balance + Action Buttons -->
    <div style="background:linear-gradient(135deg,var(--success),#16a34a);border-radius:var(--radius-md);padding:18px;color:#fff;margin-bottom:16px">
      <div style="font-size:.78rem;opacity:.8;margin-bottom:4px">Available Balance</div>
      <div style="font-size:2rem;font-weight:800;line-height:1">GHS ${parseFloat(u.wallet_balance||0).toFixed(2)}</div>
      <div style="font-size:.75rem;opacity:.7;margin:4px 0 14px">Earnings release after delivery is confirmed</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:1.5px solid rgba(255,255,255,.4)"
                onclick="showWithdrawalModal()">
          <i class="fas fa-arrow-up"></i> Withdraw Earnings
        </button>
      </div>
    </div>

    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-icon" style="background:#d1fae5"><i class="fas fa-coins" style="color:var(--success)"></i></div>
        <div class="stat-value">GHS ${myPackages.filter(p=>p.balance_released).reduce((s,p)=>s+(p.vendor_amount||0),0).toFixed(0)}</div>
        <div class="stat-label">Total Earned</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fef3c7"><i class="fas fa-hourglass-half" style="color:#d97706"></i></div>
        <div class="stat-value">GHS ${myPackages.filter(p=>!p.balance_released).reduce((s,p)=>s+(p.vendor_amount||0),0).toFixed(0)}</div>
        <div class="stat-label">Pending Release</div>
      </div>
    </div>

    <!-- Commission reminder -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>Commission Rates</h3></div>
      <div class="card-body" style="padding:0">
        <table class="commission-table">
          <thead><tr><th>Price Range</th><th>Platform Takes</th><th>You Keep</th></tr></thead>
          <tbody>
            <tr><td>GHS 1–50</td><td>8%</td><td>92%</td></tr>
            <tr><td>GHS 51–100</td><td>6%</td><td>94%</td></tr>
            <tr><td>GHS 101–500</td><td>4%</td><td>96%</td></tr>
            <tr><td>GHS 501–1000</td><td>3%</td><td>97%</td></tr>
            <tr><td>GHS 1000+</td><td>2%</td><td>98%</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Analytics Chart -->
    <div class="card">
      <div class="card-header"><h3><i class="fas fa-chart-bar"></i> Sales This Month</h3></div>
      <div class="card-body">
        <div class="chart-container">
          <canvas id="vendor-sales-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- Top Products -->
    <div class="card" style="margin-top:14px">
      <div class="card-header"><h3>🏆 Top Products</h3></div>
      <div class="card-body" style="padding:0">
        ${myProducts.sort((a,b)=>(b.sold_count||0)-(a.sold_count||0)).slice(0,5).map((p,i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">
          <span style="font-weight:700;color:var(--text-muted);width:16px">${i+1}</span>
          <img src="${p.images?.[0]||'https://via.placeholder.com/40x40?text=P'}" style="width:36px;height:36px;border-radius:6px;object-fit:cover" onerror="this.src='https://via.placeholder.com/40x40?text=P'">
          <div style="flex:1;font-size:.82rem"><strong>${escHtml(p.name)}</strong><br><span style="color:var(--text-muted)">${p.sold_count||0} sold · GHS ${p.price}</span></div>
          <span style="font-weight:700;color:var(--primary)">GHS ${((p.sold_count||0)*p.price).toFixed(0)}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>
</div>

<!-- Wallet Tab -->
<div class="tab-content" id="vendor-wallet">
  <div class="dashboard-wrap">

    <!-- Balance Header -->
    <div style="background:linear-gradient(135deg,var(--secondary),#16213e);border-radius:var(--radius-md);padding:18px;color:#fff;margin-bottom:16px">
      <div style="font-size:.78rem;opacity:.75;margin-bottom:4px">Wallet Balance</div>
      <div style="font-size:2rem;font-weight:800;line-height:1">GHS ${parseFloat(u.wallet_balance||0).toFixed(2)}</div>
      <div style="font-size:.73rem;opacity:.7;margin:4px 0 0">Your earnings from sales</div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff;border:1.5px solid rgba(255,255,255,.3)"
                onclick="showWithdrawalModal()">
          <i class="fas fa-paper-plane"></i> Withdraw
        </button>
      </div>
    </div>

    <!-- Withdrawal Info -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-body" style="display:flex;gap:10px;align-items:flex-start">
        <i class="fas fa-info-circle" style="color:var(--info);margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:.82rem;color:var(--text-light);line-height:1.6">
          Withdrawal requests are reviewed and paid within <strong>1–2 business days</strong>.
          Minimum withdrawal is <strong>GHS ${MIN_WITHDRAWAL}</strong>.
          Vendor must be fully verified (phone + ID) to withdraw.
        </div>
      </div>
    </div>

    <!-- Transaction History -->
    <div class="card">
      <div class="card-header">
        <h3>Transaction History</h3>
        <button class="btn btn-ghost btn-sm" onclick="renderWalletHistory('vendor-txn-list')">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
      <div id="vendor-txn-list" style="padding:0 14px">
        <div style="text-align:center;padding:20px;color:var(--text-muted)">
          <i class="fas fa-spinner fa-spin"></i> Loading…
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ── Referral Tab ── -->
<div class="tab-content" id="vendor-referral">
  <div class="dashboard-wrap">
    <!-- Referral Link Card -->
    <div class="referral-code-card" style="margin-bottom:16px">
      <div style="font-size:.78rem;opacity:.8;margin-bottom:4px">Your Referral Link</div>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:2px;opacity:.9">
        Share your link — when someone signs up, your store is automatically saved for them!
      </div>
      <div style="background:rgba(0,0,0,.25);border-radius:8px;padding:8px 10px;margin:10px 0;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="copyRefLink('${u.referral_code||''}')">
        <i class="fas fa-link" style="flex-shrink:0;font-size:.8rem"></i>
        <span style="font-size:.72rem;word-break:break-all;flex:1;text-align:left">${buildRefLink(u.referral_code||'')}</span>
        <i class="fas fa-copy" style="flex-shrink:0;font-size:.8rem"></i>
      </div>
      <div style="font-size:.75rem;opacity:.75;margin-bottom:12px">
        <strong>${u.referral_count||0}</strong> people have signed up via your link
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-accent btn-sm" onclick="copyRefLink('${u.referral_code||''}')">
          <i class="fas fa-copy"></i> Copy Link
        </button>
        <button class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.5);color:#fff" onclick="shareRefLink('${u.referral_code||''}')">
          <i class="fas fa-share-alt"></i> Share
        </button>
        <button class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.5);color:#fff" onclick="shareRefWhatsApp('${u.referral_code||''}')">
          <i class="fab fa-whatsapp"></i> WhatsApp
        </button>
      </div>
    </div>

    <!-- Store auto-save perk -->
    ${myStore ? `
    <div class="card" style="margin-bottom:16px;border:2px solid var(--success)">
      <div class="card-body" style="background:linear-gradient(90deg,#d1fae5,#a7f3d0);padding:12px 14px">
          <i class="fas fa-store" style="margin-right:6px"></i> Your Store Gets Auto-Saved!
        <div style="font-size:.8rem;color:#065f46;line-height:1.6">
          When someone signs up through your referral link, <strong>"${escHtml(myStore.name)}"</strong> is automatically added to their saved stores and they see it first. More exposure for your store!
        </div>
      </div>
    </div>` : ''}

    <!-- How it works -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-body" style="padding:14px">
        <div style="font-weight:700;font-size:.9rem;margin-bottom:10px">💡 How Referrals Work</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">1</div>
            <div style="color:var(--text-light)">Share your referral link with potential buyers and anyone who wants to shop on HAPPA TRADEMART</div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">2</div>
            <div style="color:var(--text-light)">They sign up via your link — no code needed. They go straight to sign-up, already linked to your store.</div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">3</div>
            <div style="color:var(--text-light)">Your store is automatically saved for them — they discover your store first when they start shopping!</div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--success);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:.7rem">4</div>
            <div style="color:var(--text-light)">The more referrals you get, the more people see your store — boosting your sales and reach!</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Referral History (from referrals table) -->
    <div class="card">
      <div class="card-header">
        <h3>Referral History</h3>
        <span style="font-size:.75rem;color:var(--text-muted)">${u.referral_count||0} referral(s)</span>
      </div>
      <div id="vendor-referral-list">
        <div style="text-align:center;padding:20px;color:var(--text-muted)">
          <i class="fas fa-spinner fa-spin"></i> Loading…
        </div>
    </div>
    </div>
  </div>
</div>

<!-- ── Verify Tab ── -->
<div class="tab-content" id="vendor-verify">
  <div class="dashboard-wrap">
    <h3 style="font-size:1rem;font-weight:700;margin-bottom:14px">Vendor Verification</h3>
    <div class="verify-steps">
      <div class="verify-step ${u.is_verified?'done':'pending-step'}">
        <div class="verify-step-icon"><i class="fas fa-${u.is_verified?'check':'phone'}"></i></div>
        <div>
          <div style="font-weight:700;font-size:.875rem">Phone OTP Verification</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${u.is_verified?'✅ Verified':'Pending — verify your phone number'}</div>
          ${!u.is_verified ? `<button class="btn btn-warning btn-sm" style="margin-top:6px" onclick="resendOTP()">Resend OTP</button>` : ''}
        </div>
      </div>
      <div class="verify-step ${u.id_verified?'done':(u.id_image?'done':'pending-step')}">
        <div class="verify-step-icon"><i class="fas fa-${u.id_verified?'check':(u.id_image?'clock':'id-card')}"></i></div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.875rem">ID & Vendor Verification Uploads</div>
          <div style="font-size:.78rem;color:var(--text-muted)">
            ${u.id_verified ? '✅ Verified' : (u.id_image ? '⏳ Awaiting Admin Approval' : 'Upload ID, sales proofs, and status sharing screenshots')}
          </div>
          ${!u.id_verified ? `
            <button class="btn btn-warning btn-sm" style="margin-top:8px" onclick="simulateIdUpload('${u.id}')">
              <i class="fas fa-cloud-upload-alt"></i> ${u.id_image ? 'Update / Re-upload Documents' : 'Upload Documents'}
            </button>
          ` : ''}
        </div>
      </div>
      <div class="verify-step ${u.id_verified&&u.is_verified?'done':'pending-step'}">
        <div class="verify-step-icon"><i class="fas fa-${u.id_verified&&u.is_verified?'check':'shield-alt'}"></i></div>
        <div>
          <div style="font-weight:700;font-size:.875rem">Admin Approval</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${u.id_verified&&u.is_verified?'✅ Approved — Store is active':'Awaiting verification completion'}</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ── Storefront Tab ── -->
<div class="tab-content" id="vendor-storefront">
  <div class="dashboard-wrap">
    ${myStore ? `

      ${(myStorefront && myStorefront.status === 'pending_approval') ? `
        <!-- State 2: Pending Approval -->
        <div style="text-align:center;padding:40px 20px;background:#fff;border-radius:12px;border:1px solid var(--border);margin-bottom:16px">
          <div style="font-size:3rem;margin-bottom:16px;">⏳</div>
          <h2 style="font-weight:800;font-size:1.25rem;margin-bottom:8px;color:#d97706">Storefront Request Under Review</h2>
          <p style="font-size:.875rem;color:var(--text-light);margin-bottom:24px;line-height:1.7;max-width:500px;margin-left:auto;margin-right:auto">
            Your custom storefront layout is pending admin review and approval. Once approved, your storefront link will automatically go live.
          </p>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="btn btn-outline" onclick="window.setStorefrontStatus('${myStore.id}', 'draft')">
              <i class="fas fa-edit"></i> Edit Customization
            </button>
          </div>
        </div>
        
        <div class="card">
          <div class="card-header"><h3>Customization Preview</h3></div>
          <div class="card-body" style="font-size:.85rem;color:var(--text-light);display:grid;gap:8px">
            <div><strong>Slogan:</strong> ${escHtml(sfSlogan || 'None')}</div>
            <div><strong>Friendly URL Slug:</strong> ${window.location.origin}/#storefront/${sfSlug}</div>
            <div><strong>Primary Color:</strong> <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${sfPrimaryColor}"></span> ${sfPrimaryColor}</div>
            <div><strong>Secondary Color:</strong> <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${sfSecondaryColor}"></span> ${sfSecondaryColor}</div>
            <div><strong>About Us:</strong> ${escHtml(sfDescription || 'None')}</div>
          </div>
        </div>
      ` : ''}

      ${(myStorefront && myStorefront.status === 'approved_pending_payment') ? `
        <!-- State 2.5: Approved, Pending Payment -->
        <div style="text-align:center;padding:40px 20px;background:#fff;border-radius:12px;border:1px solid var(--border);margin-bottom:16px">
          <div style="font-size:3rem;margin-bottom:16px;">🎉</div>
          <h2 style="font-weight:800;font-size:1.25rem;margin-bottom:8px;color:#16a34a">Storefront Approved!</h2>
          <p style="font-size:.875rem;color:var(--text-light);margin-bottom:24px;line-height:1.7;max-width:500px;margin-left:auto;margin-right:auto">
            Your custom storefront layout has been approved. Please select a subscription plan below to activate your storefront.
          </p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;max-width:800px;margin:0 auto">
            <!-- Starter Plan -->
            <div style="border:1px solid var(--border);border-radius:14px;padding:22px 18px;text-align:center;background:#fff">
              <div style="font-size:1.6rem;margin-bottom:6px">🌱</div>
              <div style="font-weight:800;font-size:.95rem;margin-bottom:4px">Starter</div>
              <div style="font-size:1.5rem;font-weight:900;color:var(--text);margin-bottom:2px">GH₵ ${myStorefront.plan_prices?.starter || 50}<span style="font-size:.75rem;font-weight:500;color:var(--text-muted)">/mo</span></div>
              <button class="btn btn-outline btn-sm" style="width:100%;margin-top:16px;font-size:.8rem" onclick="window.activateStorefrontPlan('${myStore.id}', 'starter', ${myStorefront.plan_prices?.starter || 50})">
                Pay & Activate
              </button>
            </div>
            <!-- Growth Plan -->
            <div style="border:2px solid var(--primary);border-radius:14px;padding:22px 18px;text-align:center;background:#fff;position:relative">
              <div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:var(--primary);color:#fff;font-size:.68rem;font-weight:700;padding:3px 10px;border-radius:20px">RECOMMENDED</div>
              <div style="font-size:1.6rem;margin-bottom:6px">🚀</div>
              <div style="font-weight:800;font-size:.95rem;margin-bottom:4px">Growth</div>
              <div style="font-size:1.5rem;font-weight:900;color:var(--primary);margin-bottom:2px">GH₵ ${myStorefront.plan_prices?.growth || 100}<span style="font-size:.75rem;font-weight:500;color:var(--text-muted)">/mo</span></div>
              <button class="btn btn-primary btn-sm" style="width:100%;margin-top:16px;font-size:.8rem" onclick="window.activateStorefrontPlan('${myStore.id}', 'growth', ${myStorefront.plan_prices?.growth || 100})">
                Pay & Activate
              </button>
            </div>
            <!-- Pro Plan -->
            <div style="border:1px solid var(--border);border-radius:14px;padding:22px 18px;text-align:center;background:#fff">
              <div style="font-size:1.6rem;margin-bottom:6px">💎</div>
              <div style="font-weight:800;font-size:.95rem;margin-bottom:4px">Pro</div>
              <div style="font-size:1.5rem;font-weight:900;color:#7c3aed;margin-bottom:2px">GH₵ ${myStorefront.plan_prices?.pro || 200}<span style="font-size:.75rem;font-weight:500;color:var(--text-muted)">/mo</span></div>
              <button class="btn btn-outline btn-sm" style="width:100%;margin-top:16px;font-size:.8rem;border-color:#7c3aed;color:#7c3aed" onclick="window.activateStorefrontPlan('${myStore.id}', 'pro', ${myStorefront.plan_prices?.pro || 200})">
                Pay & Activate
              </button>
            </div>
          </div>
        </div>
      ` : ''}

      ${(!myStorefront || myStorefront.status === 'draft' || myStorefront.status === 'approved') ? `
        <!-- State 3: Editing / Approved Customization Form -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <h3 style="font-size:1rem;font-weight:700">Storefront Customization</h3>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-primary" onclick="window.saveVendorStoreSettings('${myStore.id}')">
              <i class="fas fa-save"></i> ${(!myStorefront || myStorefront.status === 'draft') ? 'Save Draft' : 'Save Settings'}
            </button>
            ${(!myStorefront || myStorefront.status === 'draft') ? `
              <button class="btn btn-sm btn-success" style="background:#16a34a;border:none;color:#fff" onclick="window.submitStorefrontRequest('${myStore.id}')">
                <i class="fas fa-paper-plane"></i> Request Storefront
              </button>
            ` : ''}
          </div>
        </div>

        <div id="sf-status-card" style="margin-bottom:8px"></div>

        ${(myStorefront && myStorefront.status === 'approved') ? `
          ${window.getSubscriptionBannerHTML ? window.getSubscriptionBannerHTML(myStore) : ''}
          <div style="background:#d1fae5;border:1.5px solid #a7f3d0;color:#065f46;border-radius:12px;padding:14px 16px;margin-bottom:16px;display:grid;gap:8px">
            <div style="font-weight:800;font-size:.9rem"><i class="fas fa-check-circle"></i> Storefront Live!</div>
            <div style="font-size:.8rem;line-height:1.5">
              Your independent storefront is active. Use the links below to share with customers or manage settings:
              <div style="margin-top:6px;display:grid;gap:4px">
                <div><strong>Storefront Website (Buyer Link):</strong> <a href="#storefront/${sfSlug}" style="font-weight:700;color:#065f46;text-decoration:underline">${window.location.origin}/#storefront/${sfSlug}</a></div>
                <div><strong>Storefront Admin Control (Vendor Link):</strong> <a href="#store-admin/${sfSlug}" style="font-weight:700;color:#065f46;text-decoration:underline">${window.location.origin}/#store-admin/${sfSlug}</a></div>
              </div>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm" style="background:#065f46;color:#fff;border:none" onclick="showPage('storefront'); renderStorefront('${myStore.id}')">
                <i class="fas fa-external-link-alt"></i> View Storefront
              </button>
              <button class="btn btn-sm" style="background:#0284c7;color:#fff;border:none" onclick="window.location.hash = '#store-admin/${sfSlug}'">
                <i class="fas fa-cog"></i> Open Admin Panel
              </button>
              <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none" onclick="window.showSubscriptionDetails('${myStore.id}')">
                <i class="fas fa-credit-card"></i> Manage Subscription
              </button>
            </div>
          </div>
        ` : ''}

        <div class="storefront-split-wrap" style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
          
          <!-- Left Panel: Form Inputs -->
          <div style="flex:1.2;min-width:320px;display:flex;flex-direction:column;gap:16px">
            <div class="card">
              <div class="card-header"><h3>🎨 Design & Colors</h3></div>
              <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
                
                <!-- Theme Selector UI -->
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:6px">Select Storefront UI Theme</label>
                  <style>
                    .theme-option {
                      flex: 1;
                      border-radius: 12px;
                      padding: 12px 10px;
                      text-align: center;
                      cursor: pointer;
                      display: block;
                      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                      position: relative;
                      overflow: hidden;
                    }
                    .theme-option:hover {
                      transform: translateY(-2px);
                      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                    }
                    .theme-icon {
                      font-size: 1.4rem;
                      margin-bottom: 6px;
                      display: inline-block;
                      transition: transform 0.3s ease;
                    }
                    .theme-option:hover .theme-icon {
                      transform: scale(1.1);
                    }
                    .theme-title {
                      font-weight: 800;
                      font-size: .85rem;
                      margin-bottom: 2px;
                    }
                    .theme-desc {
                      font-size: .65rem;
                      color: var(--text-light);
                    }
                  </style>
                  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                    <label class="theme-option" style="border:2px solid ${sfTheme === 'classic' ? 'var(--primary)' : 'var(--border)'};background:${sfTheme === 'classic' ? 'var(--primary-light)' : 'transparent'};min-width:130px;" id="theme-label-classic">
                      <input type="radio" name="store-theme" value="classic" ${sfTheme === 'classic' ? 'checked' : ''} style="display:none" onchange="window.updateStoreTheme('classic')">
                      <div class="theme-icon">🖼️</div>
                      <div class="theme-title">Classic</div>
                      <div class="theme-desc">Top menu banner</div>
                    </label>
                    <label class="theme-option" style="border:2px solid ${sfTheme === 'bold' ? 'var(--primary)' : 'var(--border)'};background:${sfTheme === 'bold' ? 'var(--primary-light)' : 'transparent'};min-width:130px;" id="theme-label-bold">
                      <input type="radio" name="store-theme" value="bold" ${sfTheme === 'bold' ? 'checked' : ''} style="display:none" onchange="window.updateStoreTheme('bold')">
                      <div class="theme-icon">🎯</div>
                      <div class="theme-title">Modern Bold</div>
                      <div class="theme-desc">Centered logo</div>
                    </label>
                    <label class="theme-option" style="border:2px solid ${sfTheme === 'modern' ? 'var(--primary)' : 'var(--border)'};background:${sfTheme === 'modern' ? 'var(--primary-light)' : 'transparent'};min-width:130px;" id="theme-label-modern">
                      <input type="radio" name="store-theme" value="modern" ${sfTheme === 'modern' ? 'checked' : ''} style="display:none" onchange="window.updateStoreTheme('modern')">
                      <div class="theme-icon">✨</div>
                      <div class="theme-title">Modern Glass</div>
                      <div class="theme-desc">Neon glassmorphism</div>
                    </label>
                    <label class="theme-option" style="border:2px solid ${sfTheme === 'neumorphic' ? 'var(--primary)' : 'var(--border)'};background:${sfTheme === 'neumorphic' ? 'var(--primary-light)' : 'transparent'};min-width:130px;" id="theme-label-neumorphic">
                       <input type="radio" name="store-theme" value="neumorphic" ${sfTheme === 'neumorphic' ? 'checked' : ''} style="display:none" onchange="window.updateStoreTheme('neumorphic')">
                       <div class="theme-icon">☁️</div>
                       <div class="theme-title">Neumorphic Soft</div>
                       <div class="theme-desc">3D soft shadow relief</div>
                     </label>
                  </div>
                 </div>

                 <!-- Color Controls (Primary and Secondary) -->
                 <div style="display:flex;gap:12px;flex-wrap:wrap">
                   <div style="flex:1;min-width:140px">
                     <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Primary Color (Accents/Buttons)</label>
                     <div style="display:flex;align-items:center;gap:6px">
                       <input type="color" id="store-primary-color" value="${sfPrimaryColor}" style="width:36px;height:36px;padding:0;border:1px solid var(--border);border-radius:6px;cursor:pointer" oninput="document.getElementById('store-primary-text').value = this.value; window.updateStorefrontPreview()">
                       <input type="text" id="store-primary-text" value="${sfPrimaryColor}" class="form-control" style="font-size:.8rem" oninput="document.getElementById('store-primary-color').value = this.value; window.updateStorefrontPreview()">
                     </div>
                   </div>
                   <div style="flex:1;min-width:140px">
                     <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Secondary Color (Page Background)</label>
                     <div style="display:flex;align-items:center;gap:6px">
                       <input type="color" id="store-secondary-color" value="${sfSecondaryColor}" style="width:36px;height:36px;padding:0;border:1px solid var(--border);border-radius:6px;cursor:pointer" oninput="document.getElementById('store-secondary-text').value = this.value; window.updateStorefrontPreview()">
                       <input type="text" id="store-secondary-text" value="${sfSecondaryColor}" class="form-control" style="font-size:.8rem" oninput="document.getElementById('store-secondary-color').value = this.value; window.updateStorefrontPreview()">
                     </div>
                   </div>
                 </div>

                 <div style="margin-top:4px">
                    <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Storefront Font Style</label>
                    <select id="store-font-family" class="form-control" style="font-size:.8rem; background:#fff; border:1.5px solid var(--border); border-radius:8px; padding:6px 12px; width:100%; height:36px; color:var(--text); cursor:pointer" onchange="window.updateStorefrontPreview()">
                      <option value="Outfit" ${sfFontFamily === 'Outfit' ? 'selected' : ''}>Outfit (Default Clean)</option>
                      <option value="Inter" ${sfFontFamily === 'Inter' ? 'selected' : ''}>Inter (Professional Neo-Grotesque)</option>
                      <option value="Playfair Display" ${sfFontFamily === 'Playfair Display' ? 'selected' : ''}>Playfair Display (Elegant Serif)</option>
                      <option value="Oswald" ${sfFontFamily === 'Oswald' ? 'selected' : ''}>Oswald (Condensed Display)</option>
                      <option value="Barlow" ${sfFontFamily === 'Barlow' ? 'selected' : ''}>Barlow (Sleek Architectural)</option>
                      <option value="Josefin Sans" ${sfFontFamily === 'Josefin Sans' ? 'selected' : ''}>Josefin Sans (Vintage Geometric)</option>
                      <option value="Courier New" ${sfFontFamily === 'Courier New' ? 'selected' : ''}>Courier New (Retro Monospace)</option>
                      <option value="DM Sans" ${sfFontFamily === 'DM Sans' ? 'selected' : ''}>DM Sans (Modern Minimalist)</option>
                      <option value="Space Grotesk" ${sfFontFamily === 'Space Grotesk' ? 'selected' : ''}>Space Grotesk (Tech Geometric)</option>
                      <option value="Syne" ${sfFontFamily === 'Syne' ? 'selected' : ''}>Syne (Artistic Display)</option>
                      <option value="Manrope" ${sfFontFamily === 'Manrope' ? 'selected' : ''}>Manrope (Sleek Architectural)</option>
                    </select>
                  </div>

                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Store Logo Image</label>
                  <input type="file" id="store-logo-file" accept="image/*" class="form-control" style="font-size:.8rem" onchange="window.handleImageUpload('logo')">
                  <input type="hidden" id="store-logo-url" value="${sfLogoUrl}">
                </div>

                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Store Banner Image</label>
                  <input type="file" id="store-banner-file" accept="image/*" class="form-control" style="font-size:.8rem" onchange="window.handleImageUpload('banner')">
                  <input type="hidden" id="store-banner-url" value="${sfBannerUrl}">
                </div>
                
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Storefront Name</label>
                  <input type="text" id="store-name" value="${sfName}" class="form-control" placeholder="e.g. Accra Streetwear Co." oninput="window.handleStoreNameChange(this.value)">
                </div>
                
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Store Slogan</label>
                  <input type="text" id="store-slogan" value="${sfSlogan}" class="form-control" placeholder="Best Gadgets in Ghana" oninput="window.updateStorefrontPreview()">
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header"><h3>📝 Store Info & Policies</h3></div>
              <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">About Us / Description</label>
                  <textarea id="store-description" class="form-control" rows="3" placeholder="Describe your store..." oninput="window.updateStorefrontPreview()">${sfDescription}</textarea>
                </div>
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Business Hours</label>
                  <input type="text" id="store-hours" value="${sfHours}" class="form-control" placeholder="e.g. Mon - Fri: 8 AM - 6 PM">
                </div>
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Shipping Policy</label>
                  <textarea id="store-shipping-policy" class="form-control" rows="2" placeholder="Describe shipping estimates, rates...">${sfShipping}</textarea>
                </div>
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Return Policy</label>
                  <textarea id="store-return-policy" class="form-control" rows="2" placeholder="Describe return periods, terms...">${sfReturn}</textarea>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header"><h3>🔗 Social Links</h3></div>
              <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
                <div style="display:flex;align-items:center;gap:8px">
                  <i class="fab fa-facebook" style="color:#1877f2;width:20px;text-align:center"></i>
                  <input type="text" id="store-facebook" value="${sfFacebook}" class="form-control" placeholder="Facebook URL">
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <i class="fab fa-instagram" style="color:#e1306c;width:20px;text-align:center"></i>
                  <input type="text" id="store-instagram" value="${sfInstagram}" class="form-control" placeholder="Instagram URL">
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <i class="fab fa-youtube" style="color:#ff0000;width:20px;text-align:center"></i>
                  <input type="text" id="store-youtube" value="${sfYoutube}" class="form-control" placeholder="YouTube Channel URL">
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header"><h3>🔍 SEO & Search Optimization</h3></div>
              <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Store Slug / Friendly URL</label>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-size:.8rem;color:var(--text-muted)">${window.location.origin}/#storefront/</span>
                    <input type="text" id="store-slug" value="${sfSlug}" class="form-control" style="font-size:.8rem;font-weight:700" placeholder="my-store-link" oninput="window.handleSlugChange(this.value)">
                  </div>
                </div>
                <div>
                  <label style="display:block;font-size:.78rem;font-weight:700;margin-bottom:4px">Meta Description</label>
                  <input type="text" id="store-meta-desc" value="${sfMetaDesc}" class="form-control" placeholder="Brief SEO snippet for Google search">
                </div>
              </div>
            </div>

            <button class="btn btn-primary btn-block" onclick="window.saveVendorStoreSettings('${myStore.id}')">
              <i class="fas fa-save"></i> ${(!myStorefront || myStorefront.status === 'draft') ? 'Save Draft' : 'Save Settings'}
            </button>
          </div>
          
          <!-- Right Panel: Live Mock Preview -->
          <div style="flex:1;min-width:300px;position:sticky;top:80px;align-self:start">
            <div style="font-size:0.75rem;font-weight:700;color:var(--text-light);margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <i class="fas fa-eye" style="color:var(--primary)"></i> Live Mock Preview
            </div>
            <div class="card" style="overflow:hidden;border-radius:16px;border:1px solid var(--border);box-shadow:var(--shadow-md)">
              <div class="card-header" style="background:#f1f5f9;padding:10px 14px;display:flex;align-items:center;gap:8px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444"></span>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b"></span>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981"></span>
                <span style="font-size:0.75rem;color:#64748b;font-weight:700;margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="preview-url-bar">${window.location.origin}/#storefront/${myStore?.slug || myStore?.name?.toLowerCase()?.replace(/[^a-z0-9]+/g, '-') || ''}</span>
              </div>
              <div class="card-body" style="padding:0;background:#f8f9fa;max-height:480px;position:relative;overflow-y:scroll !important" id="storefront-live-preview-box">
                <!-- Rendered dynamically -->
              </div>
            </div>
          </div>
          
        </div>
      ` : ''}
    ` : `<div class="empty-state"><i class="fas fa-store-slash"></i><h3>No store assigned</h3></div>`}
  </div>
</div>`;

  // Render chart and load referral history
  setTimeout(() => {
    renderVendorChart(myPackages);
    loadVendorReferralHistory(u.id);
    if (typeof window.updateStorefrontPreview === 'function') {
      window.updateStorefrontPreview();
    }
  }, 200);
}

function renderVendorChart(packages = []) {
  const canvas = document.getElementById('vendor-sales-chart');
  if (!canvas) return;
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const data = [0, 0, 0, 0, 0, 0, 0];

  const now = new Date();
  const currentDay = now.getDay();
  const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - distanceToMonday);
  startOfWeek.setHours(0,0,0,0);

  packages.forEach(p => {
    if (!['delivered', 'confirmed'].includes(p.status)) return;
    if (!p.created_at) return;
    const pDate = new Date(p.created_at);
    if (pDate >= startOfWeek) {
      const dayIdx = pDate.getDay();
      const mappedIdx = dayIdx === 0 ? 6 : dayIdx - 1;
      if (mappedIdx >= 0 && mappedIdx < 7) {
        data[mappedIdx] += parseFloat(p.gross_amount || p.vendor_amount || 0);
      }
    }
  });

  const roundedData = data.map(v => parseFloat(v.toFixed(2)));

  if (window._vendorChart) window._vendorChart.destroy();
  window._vendorChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: days, datasets: [{ label: 'GHS', data: roundedData, backgroundColor: 'rgba(232,93,4,0.8)', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => 'GHS '+v } } } }
  });
}

async function loadVendorReferralHistory(vendorId) {
  const list = document.getElementById('vendor-referral-list');
  if (!list) return;

  const res  = await apiGet('referrals', `search=${encodeURIComponent(vendorId)}&limit=50`);
  const refs = (res?.data || []).filter(r => r.referrer_id === vendorId);

  if (!refs.length) {
    list.innerHTML = `
<div class="empty-state" style="padding:24px">
  <i class="fas fa-users"></i>
  <h3>No referrals yet</h3>
  <p>Share your referral link to grow your store's visibility!</p>
</div>`;
    return;
  }

  list.innerHTML = refs.map(r => {
    const joinedOn = r.created_at
      ? new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
      : '—';
    const statusBadge = r.status === 'active'
      ? `<span class="status-badge status-active">Active</span>`
      : `<span class="status-badge status-pending">${r.status||'pending'}</span>`;
    return `
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
  <div>
    <div style="font-size:.82rem;font-weight:600">
      <i class="fas fa-user-plus" style="color:var(--primary)"></i>
      ${escHtml(r.referred_email || 'Referred user')}
    </div>
    <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">
      Joined: ${joinedOn}
    </div>
  </div>
  <div style="text-align:right">${statusBadge}</div>
</div>`;
  }).join('');
}

function vendorProductRowHTML(p) {
  const stockClass = p.stock_qty === 0 ? 'stock-zero' : p.stock_qty <= 3 ? 'stock-low' : 'stock-ok';
  return `
<div class="card" style="margin-bottom:10px">
  <div class="card-body" style="display:flex;gap:10px;align-items:flex-start">
    <img src="${p.images?.[0]||'https://via.placeholder.com/70x70?text=P'}" style="width:64px;height:64px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0"
         onerror="this.src='https://via.placeholder.com/70x70?text=P'">
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:.875rem;margin-bottom:2px">${escHtml(p.name)}</div>
      <div style="font-size:.78rem;color:var(--text-muted)">GHS ${p.price} · ${p.sold_count||0} sold · ${p.views||0} views</div>
      <div style="font-size:.75rem;margin-top:4px" class="${stockClass}">
        <i class="fas fa-${p.stock_qty===0?'times-circle':'box'}"></i>
        Stock: ${p.stock_qty} ${p.stock_qty===0?'(SOLD OUT)': p.stock_qty<=3?'(LOW!)':''}
      </div>
      <span class="status-badge status-${p.status}" style="margin-top:4px;display:inline-flex">${p.status}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <button class="btn btn-outline btn-sm" onclick="showEditProductModal('${p.id}')" title="Edit product"><i class="fas fa-edit"></i></button>
      <button class="btn btn-ghost btn-sm" style="color:var(--warning)" onclick="archiveProduct('${p.id}')" title="Archive product"><i class="fas fa-archive"></i></button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteVendorProduct('${p.id}')" title="Delete product permanently"><i class="fas fa-trash"></i></button>
    </div>
  </div>
</div>`;
}

function packageRowHTML(pkg) {
  return `
<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
  <code style="background:var(--secondary);color:var(--accent);padding:3px 7px;border-radius:4px;font-size:.75rem;font-weight:700;flex-shrink:0">${pkg.package_code||'—'}</code>
  <div style="flex:1;font-size:.8rem;color:var(--text-muted)">${(pkg.items||[]).length} item(s) · ${pkg.origin_location||''}</div>
  <span class="status-badge status-${pkg.status}">${pkg.status}</span>
</div>`;
}

// NOTE: packageDetailHTML is defined in js/orders.js

// ── Add Product Modal ──────────────────────────────────────
function showAddProductModal(storeId, vendorId) {
  // Block product uploads for unapproved vendors
  if (App.currentUser && App.currentUser.status === 'pending_approval') {
    showToast('Your vendor account is still pending approval. You cannot add products yet.', 'warning');
    return;
  }
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">Add New Product</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body" style="overflow-y:auto;max-height:80vh">
  <form onsubmit="submitAddProduct(event,'${storeId}','${vendorId}')">
    <div class="form-group">
      <label class="form-label">Product Images <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(up to 5 · first = cover)</span></label>
      <div id="new-p-img-slots" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
        <button type="button" id="new-p-add-img-btn" onclick="_addProductImgSlot('new-p')" style="display:flex;align-items:center;gap:6px;background:var(--bg);border:1.5px dashed var(--border);border-radius:8px;padding:8px 14px;cursor:pointer;font-size:.8rem;color:var(--primary);font-weight:600">
          <i class="fas fa-plus-circle"></i> Add Image
        </button>
      </div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-top:2px">JPG, PNG or WEBP · Max 5MB each</div>
    </div>
    <div class="form-group">
      <label class="form-label">Product Name *</label>
      <div style="display:flex;gap:8px">
        <input class="form-control" id="new-p-name" placeholder="e.g. Nike Air Max 90" required style="flex:1">
        <button type="button" onclick="_localAutoFill('new-p', true)" style="display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer;font-size:.8rem;font-weight:700">
          <i class="fas fa-wand-magic-sparkles"></i> Autofill
        </button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-control" id="new-p-desc" rows="3" placeholder="Describe your product..." oninput="this.dataset.autoGenerated='false'"></textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group">
        <label class="form-label">Price (GHS) *</label>
        <input class="form-control" id="new-p-price" type="number" min="1" step="0.01" required>
      </div>
      <div class="form-group">
        <label class="form-label">Original Price</label>
        <input class="form-control" id="new-p-orig" type="number" min="1" step="0.01">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group">
        <label class="form-label">Stock Qty *</label>
        <input class="form-control" id="new-p-stock" type="number" min="0" required>
      </div>
      <div class="form-group">
        <label class="form-label">Weight (kg)</label>
        <input class="form-control" id="new-p-weight" type="number" step="0.1" min="0.1" value="0.5">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Category</label>
      <select class="form-control form-select" id="new-p-cat" onchange="this.dataset.autoGenerated='false'">
        <option>Sneakers</option><option>Sandals</option><option>Boots</option><option>Electronics</option>
        <option>Accessories</option><option>Audio</option><option>Skincare</option><option>Makeup</option><option>Other</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Tags (comma separated)</label>
      <input class="form-control" id="new-p-tags" placeholder="e.g. shoes, nike, white, sneakers">
      <div class="form-hint">These help buyers find your product</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <input type="checkbox" id="new-p-flash">
      <label for="new-p-flash" style="font-size:.875rem;font-weight:600">⚡ Flash Sale Item</label>
    </div>
    <!-- Buyer Note Toggle -->
    <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:var(--radius-md);padding:12px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:0">
        <input type="checkbox" id="new-p-allow-note" onchange="_toggleNotePrompt('new-p-note-prompt-wrap',this.checked)">
        <span style="font-size:.875rem;font-weight:700;color:#166534">💬 Allow Buyer to Add a Note</span>
      </label>
      <p style="font-size:.72rem;color:#166534;margin:4px 0 8px 24px;line-height:1.5">Buyers can specify color, size, customisation, etc. before adding to cart.</p>
      <div id="new-p-note-prompt-wrap" style="display:none">
        <input class="form-control" id="new-p-note-prompt" placeholder="e.g. Specify your color and size" style="font-size:.8rem">
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:3px">This shows as the hint text in the buyer's note box.</div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" type="submit">
    <button class="btn btn-primary btn-block" type="submit">
      <i class="fas fa-plus-circle"></i> Add Product
    </button>
  </form>
</div>`);
  // Automatically initialize first image slot (Cover Image) for convenience
  setTimeout(() => {
    _addProductImgSlot('new-p');
  }, 50);
}

// ── Note prompt visibility toggle ───────────────────────────
function _toggleNotePrompt(wrapperId, show) {
  const wrap = document.getElementById(wrapperId);
  if (wrap) wrap.style.display = show ? 'block' : 'none';
}

// ── Multi-image slot helpers (used in Add & Edit modals) ──
function _addProductImgSlot(prefix) {
  const slots = document.getElementById(prefix + '-img-slots');
  const btn   = document.getElementById(prefix + '-add-img-btn');
  if (!slots) return;
  const count = slots.querySelectorAll('.pi-slot').length;
  if (count >= 5) { showToast('Maximum 5 images allowed', 'info'); return; }
  const idx   = count; // 0-based
  const fileId  = prefix + '-img-file-' + idx;
  const b64Id   = prefix + '-img-b64-'  + idx;
  const slotId  = prefix + '-slot-'     + idx;
  const thumbId = prefix + '-thumb-'    + idx;
  const slot = document.createElement('div');
  slot.className = 'pi-slot';
  slot.id = slotId;
  slot.style.cssText = 'position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:2px solid var(--border);background:var(--bg);flex-shrink:0';
  slot.innerHTML = `
    <img id="${thumbId}" style="width:100%;height:100%;object-fit:cover;display:none">
    <div id="${prefix}-slot-placeholder-${idx}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:1.4rem" onclick="document.getElementById('${fileId}').click()">
      <i class="fas fa-image"></i>
    </div>
    <input type="file" id="${fileId}" accept="image/*" style="display:none" onchange="_onProductImgPick(this,'${prefix}',${idx})">
    <input type="hidden" id="${b64Id}">
    <button type="button" onclick="_removeProductImgSlot('${prefix}',${idx})" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;font-size:.6rem;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="fas fa-times"></i></button>
    ${idx === 0 ? '<span style="position:absolute;bottom:2px;left:2px;background:var(--primary);color:#fff;font-size:.55rem;font-weight:700;padding:1px 4px;border-radius:3px">COVER</span>' : ''}
  `;
  slots.appendChild(slot);
  // Hide Add button when 5 slots reached
  const newCount = slots.querySelectorAll('.pi-slot').length;
  if (btn && newCount >= 5) btn.style.display = 'none';
}

async function _onProductImgPick(input, prefix, idx) {
  const file = input.files?.[0];
  if (!file) return;
  const maxBytes = 15 * 1024 * 1024;
  if (file.size > maxBytes) { showToast('Image too large. Max 15MB.', 'warning'); input.value = ''; return; }
  
  try {
    const base64 = await compressImage(file, 1200, 0.8);
    const thumb       = document.getElementById(prefix + '-thumb-' + idx);
    const placeholder = document.getElementById(prefix + '-slot-placeholder-' + idx);
    const hid         = document.getElementById(prefix + '-img-b64-' + idx);
    if (thumb)       { thumb.src = base64; thumb.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (hid)         hid.value = base64;
    
    if (idx === 0) {
      _aiAutoFill(prefix, base64);
    }
  } catch (err) {
    showToast('Failed to process image', 'error');
    console.error(err);
  }
}

// ── AI Auto-Fill helper ─────────────────────────────────────
// Called when a cover image (idx=0) is picked in Add or Edit modals.
// prefix = 'new-p' (Add modal) or 'edit-p' (Edit modal)
async function _aiAutoFill(prefix, base64Image) {
  // Determine field IDs for this prefix
  const nameId = prefix === 'new-p' ? 'new-p-name' : (prefix === 'edit-p' ? 'edit-p-name' : null);
  const descId = prefix === 'new-p' ? 'new-p-desc' : (prefix === 'edit-p' ? 'edit-p-desc' : null);
  const catId  = prefix === 'new-p' ? 'new-p-cat'  : (prefix === 'edit-p' ? 'edit-p-cat'  : null);

  // Show spinner badge near the image slot
  const spinId  = prefix + '-ai-spin';
  let spinner   = document.getElementById(spinId);
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.id = spinId;
    spinner.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--primary);font-weight:600;margin-top:6px;padding:5px 8px;background:#ffe4cc;border-radius:6px;border:1px solid var(--primary)';
    spinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI is analysing your image…';
    const slots = document.getElementById(prefix + '-img-slots');
    if (slots && slots.parentNode) slots.parentNode.insertBefore(spinner, slots.nextSibling);
  } else {
    spinner.style.display = 'flex';
    spinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI is analysing your image…';
  }

  // Pre-fill fields with loading text if it's the Add modal
  const nameEl = nameId ? document.getElementById(nameId) : null;
  const descEl = descId ? document.getElementById(descId) : null;
  const catEl  = catId  ? document.getElementById(catId)  : null;
  if (nameEl) nameEl.placeholder = '✨ Generating…';
  if (descEl) descEl.placeholder = '✨ Generating description…';

  try {
    const result = await autoGenerateProductInfo(base64Image);

    if (nameEl && result.name)        nameEl.value = result.name;
    if (descEl && result.description) descEl.value = result.description;
    if (catEl && result.category) {
      const option = Array.from(catEl.options).find(opt => opt.value === result.category);
      if (option) catEl.value = result.category;
    }

    spinner.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i> AI filled name & description ✨';
    spinner.style.background = '#dcfce7';
    spinner.style.borderColor = 'var(--success)';
    spinner.style.color = '#166534';
    showToast('Product info generated! ✨', 'success');

    setTimeout(() => { if (spinner) spinner.style.display = 'none'; }, 4000);
  } catch (err) {
    console.error('[AI AutoFill]', err);
    if (nameEl) nameEl.placeholder = 'e.g. Nike Air Max 90';
    if (descEl) descEl.placeholder = 'Describe your product…';
    spinner.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--danger)"></i> AI failed — fill manually';
    spinner.style.background = '#fee2e2';
    spinner.style.borderColor = 'var(--danger)';
    spinner.style.color = '#991b1b';
    setTimeout(() => { if (spinner) spinner.style.display = 'none'; }, 5000);
  }
}

// ── Manual re-trigger button (used in Add modal) ────────
function _localAutoFill(prefix, isManual = false) {
  const nameId = prefix === 'new-p' ? 'new-p-name' : (prefix === 'edit-p' ? 'edit-p-name' : null);
  const descId = prefix === 'new-p' ? 'new-p-desc' : (prefix === 'edit-p' ? 'edit-p-desc' : null);
  const catId  = prefix === 'new-p' ? 'new-p-cat'  : (prefix === 'edit-p' ? 'edit-p-cat'  : null);
  
  const nameEl = nameId ? document.getElementById(nameId) : null;
  const descEl = descId ? document.getElementById(descId) : null;
  const catEl  = catId  ? document.getElementById(catId)  : null;
  
  if (!nameEl) return;
  
  const name = nameEl.value.trim();
  if (!name) return;

  const applyResult = (result) => {
    if (catEl && result.category) {
      if (isManual || !catEl.value || catEl.value === 'Other' || catEl.dataset.autoGenerated === 'true') {
        const option = Array.from(catEl.options).find(opt => opt.value === result.category);
        if (option) {
          catEl.value = result.category;
          catEl.dataset.autoGenerated = 'true';
        }
      }
    }
    if (descEl && result.description) {
      if (isManual || !descEl.value.trim() || descEl.dataset.autoGenerated === 'true') {
        descEl.value = result.description;
        descEl.dataset.autoGenerated = 'true';
      }
    }
    if (isManual) showToast('Category & description filled!', 'success');
  };

  if (isManual) {
    // Manual trigger: run immediately, no debounce
    applyResult(localPredictAndGenerate(name));
  } else {
    // Auto-trigger: debounce to avoid re-running on every keystroke
    localPredictDebounced(prefix, name, applyResult);
  }
}

async function _aiRefill(prefix) {
  const hid = document.getElementById(prefix + '-img-b64-0');
  if (!hid || !hid.value) { showToast('Upload a cover image first', 'warning'); return; }
  await _aiAutoFill(prefix, hid.value);
}

function _removeProductImgSlot(prefix, idx) {
  const slot  = document.getElementById(prefix + '-slot-' + idx);
  const slots = document.getElementById(prefix + '-img-slots');
  const btn   = document.getElementById(prefix + '-add-img-btn');
  if (slot) slot.remove();
  // Re-number remaining slots so indices stay contiguous
  if (slots) {
    slots.querySelectorAll('.pi-slot').forEach((s, i) => {
      s.id = prefix + '-slot-' + i;
      const thumb   = s.querySelector('img[id]');   if (thumb)   thumb.id   = prefix + '-thumb-' + i;
      const hid     = s.querySelector('input[type=hidden]'); if (hid) hid.id = prefix + '-img-b64-' + i;
      const fileInp = s.querySelector('input[type=file]');   if (fileInp) fileInp.id = prefix + '-img-file-' + i;
      // Re-wire the onclick for placeholder
      const ph = s.querySelector('[id*="slot-placeholder"]');
      if (ph) { ph.id = prefix + '-slot-placeholder-' + i; ph.setAttribute('onclick', `document.getElementById('${prefix}-img-file-${i}').click()`); }
      // Re-wire the file input onchange
      if (fileInp) fileInp.setAttribute('onchange', `_onProductImgPick(this,'${prefix}',${i})`);
      // Re-wire the remove button
      const rmBtn = s.querySelector('button[type=button]');
      if (rmBtn) rmBtn.setAttribute('onclick', `_removeProductImgSlot('${prefix}',${i})`);
      // Keep COVER badge only on slot 0
      const badge = s.querySelector('span[style*="COVER"], span');
      if (badge && badge.textContent.trim() === 'COVER') { if (i !== 0) badge.remove(); }
      if (i === 0 && !s.querySelector('span[style*="bottom:2px"]')) {
        const b = document.createElement('span');
        b.style.cssText = 'position:absolute;bottom:2px;left:2px;background:var(--primary);color:#fff;font-size:.55rem;font-weight:700;padding:1px 4px;border-radius:3px';
        b.textContent = 'COVER'; s.appendChild(b);
      }
    });
  }
  if (btn) btn.style.display = 'flex';
}

function _collectProductImages(prefix) {
  const slots = document.getElementById(prefix + '-img-slots');
  if (!slots) return [];
  const imgs = [];
  slots.querySelectorAll('.pi-slot').forEach((s, i) => {
    const hid = document.getElementById(prefix + '-img-b64-' + i);
    if (hid && hid.value.trim()) imgs.push(hid.value.trim());
  });
  return imgs;
}

async function submitAddProduct(e, storeId, vendorId) {
  e.preventDefault();
  // Double-check approval status (in case the modal was already open)
  if (App.currentUser && App.currentUser.status === 'pending_approval') {
    showToast('Your vendor account is still pending approval. You cannot add products yet.', 'warning');
    return;
  }
  const name     = document.getElementById('new-p-name')?.value.trim();
  const desc     = document.getElementById('new-p-desc')?.value.trim();
  const price    = parseFloat(document.getElementById('new-p-price')?.value);
  const orig     = parseFloat(document.getElementById('new-p-orig')?.value) || price;
  const stock    = parseInt(document.getElementById('new-p-stock')?.value);
  const weight   = parseFloat(document.getElementById('new-p-weight')?.value) || 0.5;
  const cat      = document.getElementById('new-p-cat')?.value;
  const tagsStr  = document.getElementById('new-p-tags')?.value;
  const images   = _collectProductImages('new-p');
  const isFlash  = document.getElementById('new-p-flash')?.checked;
  const allowBuyerNote  = document.getElementById('new-p-allow-note')?.checked || false;
  const buyerNotePrompt = (document.getElementById('new-p-note-prompt')?.value || '').trim() || 'Add a note (e.g. color, size)';
  const store    = App.allStores.find(s => s.id === storeId) || {};
  const tags     = tagsStr ? tagsStr.split(',').map(t=>t.trim()).filter(Boolean) : [];

  if (!name || isNaN(price) || isNaN(stock)) { showToast('Fill in all required fields with valid numbers', 'warning'); return; }

  // Learn from user's input
  if (name && cat && desc) {
    localLearnCorrection(name, cat, desc);
  }

  const commission = getCommission(price);
  const prod = await apiPost('products', {
    name, description: desc, price, original_price: orig,
    store_id: storeId, vendor_id: vendorId, category: cat,
    images,
    stock_qty: stock, sold_count: 0, views: 0,
    avg_rating: 0, review_count: 0,
    location: store.location || App.currentUser?.location,
    is_flash_sale: isFlash, flash_sale_end: '',
    status: stock > 0 ? 'active' : 'sold_out',
    tags, commission_pct: commission, weight_kg: weight,
    allow_buyer_note: allowBuyerNote,
    buyer_note_prompt: allowBuyerNote ? buyerNotePrompt : ''
  });

  if (!prod) { showToast('Failed to add product. Try again.', 'error'); return; }
  App.allProducts.push(prod);
  closeModalForce();
  showToast(`"${name}" added successfully! 🎉`, 'success');
  if (App.currentPage === 'vendor-my-store') {
    renderVendorMyStorePage();
  } else {
    renderVendorDashboard();
  }
}

function showEditProductModal(productId) {
  const p = App.allProducts.find(p => p.id === productId);
  if (!p) return;

  // Build existing-image rows HTML
  const existingImgs = Array.isArray(p.images) ? p.images : (p.images ? [p.images] : []);
  const existingSlotsHTML = existingImgs.map((src, i) => `
    <div class="pi-slot" id="edit-p-slot-${i}" style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:2px solid var(--border);background:var(--bg);flex-shrink:0">
      <img id="edit-p-thumb-${i}" src="${escHtml(src)}" style="width:100%;height:100%;object-fit:cover;display:block">
      <div id="edit-p-slot-placeholder-${i}" style="display:none"></div>
      <input type="file" id="edit-p-img-file-${i}" accept="image/*" style="display:none" onchange="_onProductImgPick(this,'edit-p',${i})">
      <input type="hidden" id="edit-p-img-b64-${i}" value="${escHtml(src)}">
      <button type="button" onclick="_removeProductImgSlot('edit-p',${i})" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;font-size:.6rem;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="fas fa-times"></i></button>
      ${i === 0 ? '<span style="position:absolute;bottom:2px;left:2px;background:var(--primary);color:#fff;font-size:.55rem;font-weight:700;padding:1px 4px;border-radius:3px">COVER</span>' : ''}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);cursor:pointer" onclick="document.getElementById('edit-p-img-file-${i}').click()" title="Replace image"></div>
    </div>`).join('');

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">Edit Product</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body" style="overflow-y:auto;max-height:80vh">
  <div class="form-group">
    <label class="form-label">Product Images <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(up to 5 · first = cover)</span></label>
    <div id="edit-p-img-slots" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">${existingSlotsHTML}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
      <button type="button" id="edit-p-add-img-btn" onclick="_addProductImgSlot('edit-p')" style="display:${existingImgs.length < 5 ? 'flex' : 'none'};align-items:center;gap:6px;background:var(--bg);border:1.5px dashed var(--border);border-radius:8px;padding:8px 14px;cursor:pointer;font-size:.8rem;color:var(--primary);font-weight:600">
        <i class="fas fa-plus-circle"></i> Add Image
      </button>
    </div>
    <div style="font-size:.7rem;color:var(--text-muted);margin-top:2px">Tap an image to replace it · X to remove</div>
  </div>
  <div class="form-group">
    <label class="form-label">Product Name</label>
    <div style="display:flex;gap:8px">
      <input class="form-control" id="edit-p-name" value="${escHtml(p.name)}" oninput="_localAutoFill('edit-p')" style="flex:1">
      <button type="button" onclick="_localAutoFill('edit-p', true)" style="display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer;font-size:.8rem;font-weight:700">
        <i class="fas fa-wand-magic-sparkles"></i> Autofill
      </button>
    </div>
  </div>
  <div class="form-group">
    <label class="form-label">Description</label>
    <textarea class="form-control" id="edit-p-desc" rows="3">${escHtml(p.description||'')}</textarea>
  </div>
  <div class="form-group">
    <label class="form-label">Category</label>
    <select class="form-control form-select" id="edit-p-cat">
      <option ${p.category==='Sneakers'?'selected':''}>Sneakers</option>
      <option ${p.category==='Sandals'?'selected':''}>Sandals</option>
      <option ${p.category==='Boots'?'selected':''}>Boots</option>
      <option ${p.category==='Electronics'?'selected':''}>Electronics</option>
      <option ${p.category==='Accessories'?'selected':''}>Accessories</option>
      <option ${p.category==='Audio'?'selected':''}>Audio</option>
      <option ${p.category==='Skincare'?'selected':''}>Skincare</option>
      <option ${p.category==='Makeup'?'selected':''}>Makeup</option>
      <option ${p.category==='Other'?'selected':''}>Other</option>
    </select>
  </div>
  <div class="form-group"><label class="form-label">Stock Quantity</label>
    <input class="form-control" id="edit-p-stock" type="number" min="0" value="${p.stock_qty||0}">
  </div>
  <div class="form-group"><label class="form-label">Price (GHS)</label>
    <input class="form-control" id="edit-p-price" type="number" value="${p.price}">
  </div>
  <div class="form-group"><label class="form-label">Flash Sale</label>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="edit-p-flash" ${p.is_flash_sale?'checked':''}>
      <label for="edit-p-flash">Mark as Flash Sale</label>
    </div>
  </div>
  <!-- Buyer Note Toggle -->
  <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:var(--radius-md);padding:12px;margin-bottom:12px">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:0">
      <input type="checkbox" id="edit-p-allow-note" ${p.allow_buyer_note?'checked':''} onchange="_toggleNotePrompt('edit-p-note-prompt-wrap',this.checked)">
      <span style="font-size:.875rem;font-weight:700;color:#166534">💬 Allow Buyer Note</span>
    </label>
    <p style="font-size:.72rem;color:#166534;margin:4px 0 8px 24px;line-height:1.5">Let buyers specify color, size, or any preference before adding to cart.</p>
    <div id="edit-p-note-prompt-wrap" style="display:${p.allow_buyer_note?'block':'none'}">
      <input class="form-control" id="edit-p-note-prompt" value="${escHtml(p.buyer_note_prompt||'')}" placeholder="e.g. Specify your color and size" style="font-size:.8rem">
    </div>
  </div>
  <button class="btn btn-primary btn-block" onclick="saveProductEdit('${productId}')">
    <i class="fas fa-save"></i> Save Changes
  </button>
</div>`);
}

async function saveProductEdit(productId) {
  const name            = document.getElementById('edit-p-name')?.value.trim();
  const description     = document.getElementById('edit-p-desc')?.value.trim();
  const category        = document.getElementById('edit-p-cat')?.value;
  const stock           = parseInt(document.getElementById('edit-p-stock')?.value);
  const price           = parseFloat(document.getElementById('edit-p-price')?.value);
  const flash           = document.getElementById('edit-p-flash')?.checked;
  const images          = _collectProductImages('edit-p');
  const allowBuyerNote  = document.getElementById('edit-p-allow-note')?.checked || false;
  const buyerNotePrompt = (document.getElementById('edit-p-note-prompt')?.value || '').trim() || 'Add a note (e.g. color, size)';
  const status = stock === 0 ? 'sold_out' : 'active';
  
  if (name && category && description) {
    localLearnCorrection(name, category, description);
  }
  
  await apiPatch('products', productId, {
    name, description, category,
    stock_qty: stock, price, is_flash_sale: flash, status, images,
    allow_buyer_note: allowBuyerNote,
    buyer_note_prompt: allowBuyerNote ? buyerNotePrompt : ''
  });

  const p = App.allProducts.find(p => String(p.id) === String(productId));
  if (p) {
    p.name = name; p.description = description; p.category = category;
    p.stock_qty = stock; p.price = price; p.is_flash_sale = flash; p.status = status; p.images = images;
    p.allow_buyer_note = allowBuyerNote; p.buyer_note_prompt = allowBuyerNote ? buyerNotePrompt : '';
  }
  closeModalForce();
  showToast('Product updated! ✅', 'success');
  if (App.currentPage === 'vendor-my-store') {
    renderVendorMyStorePage();
  } else {
    renderVendorDashboard();
  }
}

async function archiveProduct(productId) {
  if (!confirm('Archive this product? It will be hidden from buyers.')) return;
  await apiPatch('products', productId, { status: 'archived' });
  const p = App.allProducts.find(p => String(p.id) === String(productId));
  if (p) p.status = 'archived';
  showToast('Product archived', 'info');
  if (App.currentPage === 'vendor-my-store') {
    renderVendorMyStorePage();
  } else {
    renderVendorDashboard();
  }
}

async function deleteVendorProduct(productId) {
  if (!confirm('Permanently delete this product? This cannot be undone.')) return;
  await apiDelete('products', productId);
  // Remove from global cache immediately so it doesn't reappear
  if (Array.isArray(App.allProducts)) {
    const idx = App.allProducts.findIndex(p => String(p.id) === String(productId));
    if (idx > -1) App.allProducts.splice(idx, 1);
  }
  showToast('Product deleted', 'warning');
  if (App.currentPage === 'vendor-my-store') {
    renderVendorMyStorePage();
  } else {
    renderVendorDashboard();
  }
}

function editKeywords(storeId) {
  const store = App.allStores.find(s => s.id === storeId);
  if (!store) return;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">Edit Store Keywords</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Add searchable words so buyers find your store. Separate with commas.</p>
  <div class="form-group">
    <textarea class="form-control" id="kw-input" rows="3">${(store.keywords||[]).join(', ')}</textarea>
  </div>
  <button class="btn btn-primary btn-block" onclick="saveKeywords('${storeId}')">
    <i class="fas fa-save"></i> Save Keywords
  </button>
</div>`);
}

async function saveKeywords(storeId) {
  const val = document.getElementById('kw-input')?.value;
  const kws = val.split(',').map(k=>k.trim()).filter(Boolean);
  await apiPatch('stores', storeId, { keywords: kws });
  const s = App.allStores.find(s => s.id === storeId);
  if (s) s.keywords = kws;
  closeModalForce();
  showToast('Keywords updated!', 'success');
  renderVendorDashboard();
}

function editStoreInfo(storeId) {
  const s = App.allStores.find(s => s.id === storeId);
  if (!s) return;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">Edit Store Info</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="form-group"><label class="form-label">Store Name</label>
    <input class="form-control" id="s-name" value="${escHtml(s.name)}">
  </div>
  <div class="form-group"><label class="form-label">Description</label>
    <textarea class="form-control" id="s-desc" rows="3">${escHtml(String(s.description||''))}</textarea>
  </div>

  <!-- Logo upload -->
  <div class="form-group">
    <label class="form-label">Store Logo</label>
    ${s.logo_url ? `<img src="${s.logo_url}" style="width:60px;height:60px;border-radius:8px;object-fit:cover;border:2px solid var(--border);margin-bottom:8px;display:block" onerror="this.style.display='none'">` : ''}
    <div class="upload-area" onclick="document.getElementById('s-logo-file').click()" style="cursor:pointer">
      <i class="fas fa-image" style="color:var(--primary)"></i>
      <p>Tap to upload logo from gallery</p>
      <p style="font-size:.72rem;color:var(--text-muted)">JPG, PNG · Max 2MB · Recommended: square image</p>
    </div>
    <input type="file" id="s-logo-file" accept="image/*" style="display:none" onchange="previewProductImage(this,'s-logo-preview','s-logo-b64')">
    <div id="s-logo-preview" style="margin-top:8px;display:none">
      <img id="s-logo-thumb" style="width:60px;height:60px;border-radius:8px;object-fit:cover;border:2px solid var(--border)">
      <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);margin-left:8px" onclick="clearProductImage('s-logo-preview','s-logo-file','s-logo-b64')"><i class="fas fa-times"></i> Remove</button>
    </div>
    <input type="hidden" id="s-logo-b64" value="${s.logo_url||''}">
  </div>

  <!-- Banner upload -->
  <div class="form-group">
    <label class="form-label">Store Banner</label>
    ${s.banner_url ? `<img src="${s.banner_url}" style="width:100%;height:70px;object-fit:cover;border-radius:8px;border:2px solid var(--border);margin-bottom:8px;display:block" onerror="this.style.display='none'">` : ''}
    <div class="upload-area" onclick="document.getElementById('s-banner-file').click()" style="cursor:pointer">
      <i class="fas fa-panorama" style="color:var(--primary)"></i>
      <p>Tap to upload banner from gallery</p>
      <p style="font-size:.72rem;color:var(--text-muted)">JPG, PNG · Max 3MB · Recommended: 800×200</p>
    </div>
    <input type="file" id="s-banner-file" accept="image/*" style="display:none" onchange="previewProductImage(this,'s-banner-preview','s-banner-b64')">
    <div id="s-banner-preview" style="margin-top:8px;display:none">
      <img id="s-banner-thumb" style="width:100%;height:70px;object-fit:cover;border-radius:8px;border:2px solid var(--border)">
      <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);margin-top:4px" onclick="clearProductImage('s-banner-preview','s-banner-file','s-banner-b64')"><i class="fas fa-times"></i> Remove</button>
    </div>
    <input type="hidden" id="s-banner-b64" value="${s.banner_url||''}">
  </div>

  <button class="btn btn-primary btn-block" onclick="saveStoreInfo('${storeId}')">
    <i class="fas fa-save"></i> Save Changes
  </button>
</div>`);
}

async function saveStoreInfo(storeId) {
  const name   = document.getElementById('s-name')?.value.trim();
  const desc   = document.getElementById('s-desc')?.value.trim();
  // Prefer newly uploaded base64 images; fall back to existing URLs
  const logo   = document.getElementById('s-logo-b64')?.value.trim() || '';
  const banner = document.getElementById('s-banner-b64')?.value.trim() || '';
  await apiPatch('stores', storeId, { name, description: desc, logo_url: logo, banner_url: banner });
  const s = App.allStores.find(s => s.id === storeId);
  if (s) { s.name = name; s.description = desc; s.logo_url = logo; s.banner_url = banner; }
  closeModalForce();
  showToast('Store updated!', 'success');
  renderVendorDashboard();
}

function resendOTP() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  console.log('[DEMO] OTP:', otp);
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header"><span class="modal-title">📱 Verify Phone</span></div>
<div class="modal-body">
  <p style="font-size:.875rem;color:var(--text-light);margin-bottom:16px">
    New OTP sent to <strong>${App.currentUser?.phone}</strong><br>
    <span style="color:var(--primary)">[Demo OTP: <strong>${otp}</strong>]</span>
  </p>
  <div class="form-group">
    <input class="form-control" id="otp-input" type="text" placeholder="6-digit code" maxlength="6" style="text-align:center;font-size:1.3rem;letter-spacing:8px">
  </div>
  <button class="btn btn-primary btn-block" onclick="verifyOTP('${App.currentUser?.id}','${otp}')">Verify</button>
</div>`);
}

function simulateIdUpload(userId) {
  const u = App.currentUser || {};
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">Vendor Verification Uploads</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body" style="max-height:75vh;overflow-y:auto;padding-bottom:20px">
  <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px;line-height:1.4">
    Please upload the required verification items. All fields are mandatory to apply for vendor verification.
  </p>

  <!-- 1. ID document -->
  <div class="form-group" style="margin-bottom:14px">
    <label class="form-label" style="font-weight:700">1. ID Document (Ghana Card / Passport / License)</label>
    <div class="upload-area" id="id-upload-area" style="cursor:pointer;padding:12px;border:${u.id_image ? '1px solid var(--border)' : '2px dashed var(--border)'};border-radius:var(--radius-sm);text-align:center;min-height:100px;display:flex;flex-direction:column;justify-content:center;${u.id_image ? `background-image:url('${u.id_image}');background-size:contain;background-position:center;background-repeat:no-repeat;` : ''}">
      <div style="${u.id_image ? 'display:none;' : ''}">
        <i class="fas fa-id-card" style="color:var(--primary);font-size:1.4rem;margin-bottom:4px"></i>
        <p style="font-size:.78rem;margin:0">Tap to upload ID photo</p>
      </div>
    </div>
    <input type="file" id="id-doc-file" accept="image/*" style="display:none" onchange="previewDocField(this, 'id-doc-preview', 'id-doc-thumb')">
    <img id="id-doc-thumb" src="${u.id_image || ''}" style="display:none">
  </div>

  <!-- 2. Proof of Previous Sales (3 images) -->
  <div class="form-group" style="margin-bottom:14px">
    <label class="form-label" style="font-weight:700">2. Proof of Previous Sales (Upload exactly 3 images)</label>
    <p style="font-size:.72rem;color:var(--text-muted);margin-bottom:6px">Invoices, screenshots of customer chats, or package deliveries.</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <!-- Slot 1 -->
      <div>
        <div class="upload-area" id="sales-1-area" style="cursor:pointer;padding:10px 4px;border:${u.proof_sales_1 ? '1px solid var(--border)' : '2px dashed var(--border)'};border-radius:var(--radius-sm);text-align:center;min-height:80px;display:flex;flex-direction:column;justify-content:center;${u.proof_sales_1 ? `background-image:url('${u.proof_sales_1}');background-size:contain;background-position:center;background-repeat:no-repeat;` : ''}">
          <div style="${u.proof_sales_1 ? 'display:none;' : ''}">
            <i class="fas fa-receipt" style="color:var(--primary);font-size:1.1rem;margin-bottom:4px"></i>
            <p style="font-size:.7rem;margin:0">Image 1</p>
          </div>
        </div>
        <input type="file" id="sales-1-file" accept="image/*" style="display:none" onchange="previewDocField(this, 'sales-1-preview', 'sales-1-thumb')">
        <img id="sales-1-thumb" src="${u.proof_sales_1 || ''}" style="display:none">
      </div>
      <!-- Slot 2 -->
      <div>
        <div class="upload-area" id="sales-2-area" style="cursor:pointer;padding:10px 4px;border:${u.proof_sales_2 ? '1px solid var(--border)' : '2px dashed var(--border)'};border-radius:var(--radius-sm);text-align:center;min-height:80px;display:flex;flex-direction:column;justify-content:center;${u.proof_sales_2 ? `background-image:url('${u.proof_sales_2}');background-size:contain;background-position:center;background-repeat:no-repeat;` : ''}">
          <div style="${u.proof_sales_2 ? 'display:none;' : ''}">
            <i class="fas fa-receipt" style="color:var(--primary);font-size:1.1rem;margin-bottom:4px"></i>
            <p style="font-size:.7rem;margin:0">Image 2</p>
          </div>
        </div>
        <input type="file" id="sales-2-file" accept="image/*" style="display:none" onchange="previewDocField(this, 'sales-2-preview', 'sales-2-thumb')">
        <img id="sales-2-thumb" src="${u.proof_sales_2 || ''}" style="display:none">
      </div>
      <!-- Slot 3 -->
      <div>
        <div class="upload-area" id="sales-3-area" style="cursor:pointer;padding:10px 4px;border:${u.proof_sales_3 ? '1px solid var(--border)' : '2px dashed var(--border)'};border-radius:var(--radius-sm);text-align:center;min-height:80px;display:flex;flex-direction:column;justify-content:center;${u.proof_sales_3 ? `background-image:url('${u.proof_sales_3}');background-size:contain;background-position:center;background-repeat:no-repeat;` : ''}">
          <div style="${u.proof_sales_3 ? 'display:none;' : ''}">
            <i class="fas fa-receipt" style="color:var(--primary);font-size:1.1rem;margin-bottom:4px"></i>
            <p style="font-size:.7rem;margin:0">Image 3</p>
          </div>
        </div>
        <input type="file" id="sales-3-file" accept="image/*" style="display:none" onchange="previewDocField(this, 'sales-3-preview', 'sales-3-thumb')">
        <img id="sales-3-thumb" src="${u.proof_sales_3 || ''}" style="display:none">
      </div>
    </div>
  </div>

  <!-- 3. Proof of link sharing -->
  <div class="form-group" style="margin-bottom:18px">
    <label class="form-label" style="font-weight:700">3. Proof of Link Sharing</label>
    <p style="font-size:.72rem;color:var(--text-muted);margin-bottom:6px">Screenshot showing HAPPA website link shared to your status or group chat.</p>
    <div class="upload-area" id="share-upload-area" style="cursor:pointer;padding:12px;border:${u.proof_share ? '1px solid var(--border)' : '2px dashed var(--border)'};border-radius:var(--radius-sm);text-align:center;min-height:100px;display:flex;flex-direction:column;justify-content:center;${u.proof_share ? `background-image:url('${u.proof_share}');background-size:contain;background-position:center;background-repeat:no-repeat;` : ''}">
      <div style="${u.proof_share ? 'display:none;' : ''}">
        <i class="fas fa-share-alt" style="color:var(--primary);font-size:1.4rem;margin-bottom:4px"></i>
        <p style="font-size:.78rem;margin:0">Tap to upload screenshot</p>
      </div>
    </div>
    <input type="file" id="share-file" accept="image/*" style="display:none" onchange="previewDocField(this, 'share-preview', 'share-thumb')">
    <img id="share-thumb" src="${u.proof_share || ''}" style="display:none">
  </div>

  <button class="btn btn-primary btn-block" id="id-confirm-btn" onclick="submitVerificationDocuments('${userId}')" disabled>
    <i class="fas fa-upload"></i> Submit Verification Documents
  </button>
</div>`);

  // Wire up upload triggers
  setTimeout(() => {
    document.getElementById('id-upload-area').onclick = () => document.getElementById('id-doc-file').click();
    document.getElementById('sales-1-area').onclick = () => document.getElementById('sales-1-file').click();
    document.getElementById('sales-2-area').onclick = () => document.getElementById('sales-2-file').click();
    document.getElementById('sales-3-area').onclick = () => document.getElementById('sales-3-file').click();
    document.getElementById('share-upload-area').onclick = () => document.getElementById('share-file').click();
    checkVerificationFormReady();
  }, 100);
}

async function previewDocField(input, previewId, thumbId) {
  const file = input.files?.[0];
  if (!file) return;
  const maxBytes = 15 * 1024 * 1024;
  if (file.size > maxBytes) { showToast('File too large. Max 15MB.', 'warning'); input.value = ''; return; }

  try {
    const base64 = await compressImage(file, 1200, 0.8);
    const thumb = document.getElementById(thumbId);
    if (thumb) { thumb.src = base64; }
    
    const area = input.previousElementSibling;
    if (area && area.classList.contains('upload-area')) {
      area.style.backgroundImage = `url('${base64}')`;
      area.style.backgroundSize = 'contain';
      area.style.backgroundPosition = 'center';
      area.style.backgroundRepeat = 'no-repeat';
      area.style.border = '1px solid var(--border)';
      Array.from(area.children).forEach(c => c.style.display = 'none');
    }
    
    checkVerificationFormReady();
  } catch (e) {
    console.error('Error compressing image:', e);
    showToast('Failed to process image.', 'error');
  }
}

function checkVerificationFormReady() {
  const btn = document.getElementById('id-confirm-btn');
  const idThumb = document.getElementById('id-doc-thumb');
  const s1Thumb = document.getElementById('sales-1-thumb');
  const s2Thumb = document.getElementById('sales-2-thumb');
  const s3Thumb = document.getElementById('sales-3-thumb');
  const shareThumb = document.getElementById('share-thumb');

  const ready = idThumb?.src && !idThumb.src.endsWith('/') &&
                s1Thumb?.src && !s1Thumb.src.endsWith('/') &&
                s2Thumb?.src && !s2Thumb.src.endsWith('/') &&
                s3Thumb?.src && !s3Thumb.src.endsWith('/') &&
                shareThumb?.src && !shareThumb.src.endsWith('/');
  if (btn) {
    btn.disabled = !ready;
  }
}

async function submitVerificationDocuments(userId) {
  const btn = document.getElementById('id-confirm-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
  }

  const idImage = document.getElementById('id-doc-thumb').src;
  const s1 = document.getElementById('sales-1-thumb').src;
  const s2 = document.getElementById('sales-2-thumb').src;
  const s3 = document.getElementById('sales-3-thumb').src;
  const share = document.getElementById('share-thumb').src;

  try {
    await apiPatch('users', userId, {
      id_image: idImage,
      proof_sales_1: s1,
      proof_sales_2: s2,
      proof_sales_3: s3,
      proof_share: share,
      id_verified: false
    });

    if (App.currentUser) {
      App.currentUser.id_image = idImage;
      App.currentUser.proof_sales_1 = s1;
      App.currentUser.proof_sales_2 = s2;
      App.currentUser.proof_sales_3 = s3;
      App.currentUser.proof_share = share;
      App.currentUser.id_verified = false;
    }
    saveSessions();
    closeModalForce();
    showToast('Verification documents submitted for review ✅', 'success');
    renderVendorDashboard();
  } catch (err) {
    console.error(err);
    showToast('Failed to submit documents: ' + (err?.message || 'Network error'), 'danger');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-upload"></i> Submit Verification Documents';
    }
  }
}

// ══════════ STORE ACQUISITION (admin-assigned only) ══════════
// Stores are assigned exclusively by admin. Vendors do not purchase or acquire stores directly.
// The functions below are kept for the referral-unlock flow only, which is triggered by admin.
async function showAvailableStores() {
  const storeRes = await apiGet('stores', 'limit=200');
  const allStores = storeRes?.data || [];
  // Available = no vendor assigned yet (regardless of status)
  const availableStores = allStores.filter(s => !s.vendor_id || s.vendor_id === '');
  
  const u = App.currentUser;
  const threshold = parseInt(await getSetting('store_referral_threshold', '10'));
  const userReferralCount = u.referral_count || 0;
  const canUnlockViaReferrals = userReferralCount >= threshold;
  
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🏪 Available Stores</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="verify-banner" style="background:linear-gradient(90deg,#dbeafe,#e0f2fe);border-color:#0ea5e9;margin-bottom:16px">
    <i class="fas fa-gift" style="color:#0284c7"></i>
    <div>
      <p style="margin:0;font-weight:600">Referral Progress: ${userReferralCount}/${threshold}</p>
      <p style="margin:0;font-size:.8rem">${canUnlockViaReferrals ? '✅ You can unlock a store for FREE!' : `Refer ${threshold - userReferralCount} more user(s) to unlock a store without payment`}</p>
    </div>
  </div>
  ${availableStores.length > 0 ? availableStores.map(s => `
  <div class="card" style="margin-bottom:12px">
    <div class="card-body">
      <div style="display:flex;gap:10px;align-items:center">
        <img src="${s.logo_url||'https://via.placeholder.com/50x50?text=S'}" style="width:44px;height:44px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0"
             onerror="this.src='https://via.placeholder.com/50x50?text=S'">
        <div style="flex:1">
          <div style="font-weight:700;font-size:.9rem">${escHtml(s.name)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">${s.location}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">Price: <strong>GHS ${(s.store_price||500).toFixed(0)}</strong></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${canUnlockViaReferrals ? `
          <button class="btn btn-success btn-sm" onclick="acquireStoreViaReferrals('${s.id}')">
            <i class="fas fa-gift"></i> Unlock FREE
          </button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="purchaseStore('${s.id}', ${s.store_price||500})">
            <i class="fas fa-shopping-cart"></i> Buy
          </button>
        </div>
      </div>
    </div>
  </div>`).join('') : `
  <div class="empty-state">
    <i class="fas fa-inbox"></i>
    <h3>No Stores Available</h3>
    <p>Check back later for new stores</p>
  </div>`}
</div>`);
}

async function acquireStoreViaReferrals(storeId) {
  const threshold = parseInt(await getSetting('store_referral_threshold', '10'));
  const u = App.currentUser;
  const userReferralCount = u.referral_count || 0;
  
  if (userReferralCount < threshold) {
    showToast(`You need ${threshold - userReferralCount} more referrals to unlock a store`, 'warning');
    return;
  }
  
  if (!confirm('Use your referral progress to unlock this store for FREE? Your referral count will be reset.')) return;
  
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  // Fetch latest store data to confirm still available
  const storeCheck = await apiFetch('stores/' + storeId);
  if (!storeCheck) {
    showToast('Store not found. Please try again.', 'error');
    return;
  }
  if (storeCheck.vendor_id && storeCheck.vendor_id !== '') {
    showToast('This store has already been assigned to another vendor.', 'error');
    closeModalForce();
    return;
  }

  // Update store — link to this vendor and activate
  const updatedStore = await apiPatch('stores', storeId, {
    vendor_id:            u.id,
    is_paid:              true,
    acquired_by_referral: true,
    handover_date:        new Date().toISOString(),
    status:               'active'
  });

  if (!updatedStore) {
    showToast('Failed to acquire store. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-gift"></i> Unlock FREE'; }
    return;
  }

  // Deduct referral count (reset after use)
  const newReferralCount = Math.max(0, userReferralCount - threshold);
  await apiPatch('users', u.id, { referral_count: newReferralCount });
  App.currentUser.referral_count = newReferralCount;
  saveSessions();

  // Update local store cache
  const cached = App.allStores.find(s => s.id === storeId);
  if (cached) {
    cached.vendor_id = u.id;
    cached.status = 'active';
    cached.is_paid = true;
    cached.acquired_by_referral = true;
  }

  closeModalForce();
  showToast('🎉 Store unlocked successfully via referrals!', 'success');
  addNotification(u.id, 'system', '🏪 Store Acquired!',
    `Your store "${storeCheck.name || 'new store'}" is ready! Go to My Store tab and start adding products.`);
  renderVendorDashboard();
}

async function purchaseStore(storeId, price) {
  const u = App.currentUser;
  const currentBalance = u.wallet_balance || 0;

  if (currentBalance < price) {
    showToast(`Insufficient balance. You need GHS ${(price - currentBalance).toFixed(2)} more. Please top up your wallet.`, 'error');
    return;
  }
  
  if (!confirm(`Purchase this store for GHS ${price.toFixed(2)} from your wallet balance?`)) return;
  
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Purchasing…'; }

  // Fetch latest store data to confirm still available
  const storeCheck = await apiFetch('stores/' + storeId);
  if (!storeCheck) {
    showToast('Store not found. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shopping-cart"></i> Buy'; }
    return;
  }
  if (storeCheck.vendor_id && storeCheck.vendor_id !== '') {
    showToast('This store has already been purchased by another vendor.', 'error');
    closeModalForce();
    return;
  }

  // Deduct from wallet
  const newBalance = currentBalance - price;
  await apiPatch('users', u.id, { wallet_balance: newBalance });
  App.currentUser.wallet_balance = newBalance;
  saveSessions();
  
  // Update store — link to this vendor and activate
  const updatedStore = await apiPatch('stores', storeId, {
    vendor_id:            u.id,
    is_paid:              true,
    acquired_by_referral: false,
    handover_date:        new Date().toISOString(),
    status:               'active'
  });

  if (!updatedStore) {
    // Rollback wallet deduction on failure
    await apiPatch('users', u.id, { wallet_balance: currentBalance });
    App.currentUser.wallet_balance = currentBalance;
    saveSessions();
    showToast('Failed to acquire store. Wallet balance restored.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shopping-cart"></i> Buy'; }
    return;
  }
  
  // Create wallet transaction record
  await apiPost('wallet_transactions', {
    user_id:    u.id,
    type:       'purchase',
    amount:     -price,
    method:     'wallet',
    status:     'completed',
    note:       `Store purchase: ${storeCheck.name || storeId}`,
    created_at: new Date().toISOString()
  });

  // Update local store cache
  const cached = App.allStores.find(s => s.id === storeId);
  if (cached) {
    cached.vendor_id = u.id;
    cached.status = 'active';
    cached.is_paid = true;
    cached.acquired_by_referral = false;
  }
  
  closeModalForce();
  showToast('🎉 Store purchased successfully!', 'success');
  addNotification(u.id, 'system', '🏪 Store Acquired!',
    `Your store "${storeCheck.name || 'new store'}" is ready! Go to My Store tab and start adding products.`);
  renderVendorDashboard();
}

// NOTE: packageDetailHTML, updateVendorStatus, showRejectOrderModal,
//       confirmRejectOrder  are all defined in js/orders.js

// NOTE: previewProductImage and clearProductImage are defined in js/utils.js

function switchTab(el, tabId) {
  if (!el) return;
  const parent = el.closest('.tab-nav') || el.parentElement;
  if (parent) parent.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  // Look inside the dashboard-content wrapper first, then the whole page
  const dashContent = el.closest('#vendor-dashboard-content, #buyer-dashboard-content, #admin-dashboard-content, #rendor-dashboard-content');
  const container   = dashContent || el.closest('.page') || document.getElementById('main-content');
  container.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
}


/* ============================================================
   BULK ADD PRODUCTS
   Lets vendors pick multiple images at once, fill in a draft
   card per image, then submit all to the store in one go.
   ============================================================ */

// Internal state — reset each time the panel opens
let _bap = {
  storeId:  '',
  vendorId: '',
  drafts:   [],   // [{ b64, name, desc, price, orig, stock, weight, cat, tags, flash }]
  step:     1,    // 1 = pick images, 2 = fill cards
};

const PRODUCT_CATS = [
  'Sneakers','Sandals','Boots','Electronics','Accessories',
  'Audio','Skincare','Makeup','Fashion','Food & Drinks',
  'Home & Living','Books','Sports','Toys','Art','Services','Other'
];

// ── Open the panel ──────────────────────────────────────────
function showBulkAddPanel(storeId, vendorId) {
  // Block bulk product uploads for unapproved vendors
  if (App.currentUser && App.currentUser.status === 'pending_approval') {
    showToast('Your vendor account is still pending approval. You cannot add products yet.', 'warning');
    return;
  }
  _bap = { storeId, vendorId, drafts: [], step: 1 };
  const panel = document.getElementById('bulk-add-panel');
  if (!panel) return;
  panel.classList.add('open');
  document.body.style.overflow = 'hidden';
  _bapRenderStep1();
}

// ── Close the panel ─────────────────────────────────────────
function closeBulkAddPanel() {
  const panel = document.getElementById('bulk-add-panel');
  if (!panel) return;
  panel.classList.remove('open');
  document.body.style.overflow = '';
  _bap = { storeId: '', vendorId: '', drafts: [], step: 1 };
}

// ── Render helpers ───────────────────────────────────────────
function _bapHeader(title, subtitle) {
  return `
<div class="bap-header">
  <button class="bap-close" onclick="closeBulkAddPanel()" aria-label="Close"><i class="fas fa-times"></i></button>
  <h2>${title}</h2>
  ${subtitle ? `<span style="font-size:.72rem;color:var(--text-muted)">${subtitle}</span>` : ''}
</div>
<div class="bap-step-bar">
  <div class="bap-step ${_bap.step >= 1 ? (_bap.step > 1 ? 'done' : 'active') : ''}">
    <i class="fas fa-${_bap.step > 1 ? 'check' : 'images'}"></i> 1 · Pick Images
  </div>
  <div class="bap-step ${_bap.step >= 2 ? 'active' : ''}">
    <i class="fas fa-pen"></i> 2 · Fill Details
  </div>
</div>`;
}

// ── STEP 1: Image picker ─────────────────────────────────────
function _bapRenderStep1() {
  const panel = document.getElementById('bulk-add-panel');
  if (!panel) return;

  panel.innerHTML = `
${_bapHeader('Bulk Add Products', 'up to 10 items at once')}
<div class="bap-body">

  <div class="bap-drop-zone" onclick="document.getElementById('bap-file-input').click()">
    <i class="fas fa-images"></i>
    <h3>Tap to select product images</h3>
    <p>Choose 1-10 images from your gallery</p>
    <p style="margin-top:6px;font-size:.72rem">JPG, PNG, WEBP · Max 5MB each</p>
  </div>
  <input type="file" id="bap-file-input" accept="image/*" multiple style="display:none"
         onchange="_bapOnFilePick(this)">

  <div id="bap-thumb-strip" class="bap-thumb-strip"></div>

  <div id="bap-step1-hint" style="font-size:.78rem;color:var(--text-muted);text-align:center;padding:8px 0;display:none">
    <i class="fas fa-info-circle"></i> Tap a thumbnail ├ù to remove it before continuing
  </div>

</div>
<div class="bap-footer">
  <span class="bap-count" id="bap-sel-count">No images selected</span>
  <button class="btn btn-primary" id="bap-next-btn" onclick="_bapGoStep2()" disabled
          style="min-width:110px">
    Next <i class="fas fa-arrow-right"></i>
  </button>
</div>`;
}

// ── Handle file selection ────────────────────────────────────
async function _bapOnFilePick(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;

  // Reset file input so same files can be re-selected if needed
  input.value = '';

  const strip   = document.getElementById('bap-thumb-strip');
  const hint    = document.getElementById('bap-step1-hint');
  const nextBtn = document.getElementById('bap-next-btn');
  const countEl = document.getElementById('bap-sel-count');
  if (!strip) return;

  for (const file of files) {
    if (_bap.drafts.length >= 10) break;
    const maxBytes = 15 * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(`"${file.name}" is too large (max 15MB)`, 'warning');
      continue;
    }

    const idx = _bap.drafts.length;
    _bap.drafts.push({ b64: '', name: '', desc: '', price: '', orig: '', stock: '', weight: '0.5', cat: 'Other', tags: '', flash: false, allowNote: false, notePrompt: '' });

    try {
      const base64 = await compressImage(file, 1200, 0.8);
      _bap.drafts[idx].b64 = base64;

      // ── AI Auto-Generation for bulk drafts ──────────────────
      if (typeof autoGenerateProductInfo === 'function') {
        autoGenerateProductInfo(base64).then(res => {
          if (_bap.drafts[idx]) {
            if (res.name)        _bap.drafts[idx].name = res.name;
            if (res.description) _bap.drafts[idx].desc = res.description;
            // If Step 2 is already rendered, fill the fields live
            const nameEl = document.getElementById('bap-name-' + idx);
            const descEl = document.getElementById('bap-desc-' + idx);
            if (nameEl && res.name)        nameEl.value = res.name;
            if (descEl && res.description) descEl.value = res.description;
          }
        }).catch(() => { /* silent — user can fill manually */ });
      }

      // Create thumbnail in strip
      const thumb = document.createElement('div');
      thumb.className = 'bap-thumb';
      thumb.id = 'bap-thumb-' + idx;
      thumb.innerHTML = `
        <img src="${base64}" alt="Image ${idx+1}">
        <button class="bap-thumb-rm" onclick="_bapRemoveDraft(${idx})" type="button" aria-label="Remove">
          <i class="fas fa-times"></i>
        </button>`;
      strip.appendChild(thumb);

      // Update UI
      const filled = _bap.drafts.filter(d => d && d.b64).length;
      if (countEl) countEl.textContent = `${filled} image${filled !== 1 ? 's' : ''} selected`;
      if (nextBtn) nextBtn.disabled = filled === 0;
      if (hint)    hint.style.display = filled > 0 ? 'block' : 'none';
    } catch (err) {
      console.error(err);
      showToast(`Failed to process ${file.name}`, 'error');
    }
  }

  if (_bap.drafts.length >= 10) showToast('Maximum 10 images reached', 'info');
}

// ── Remove a draft from step 1 ───────────────────────────────
function _bapRemoveDraft(idx) {
  // Mark as empty (keep array indices stable until step 2)
  _bap.drafts[idx] = null;
  const thumb = document.getElementById('bap-thumb-' + idx);
  if (thumb) thumb.remove();

  const filled  = _bap.drafts.filter(d => d !== null && d.b64).length;
  const countEl = document.getElementById('bap-sel-count');
  const nextBtn = document.getElementById('bap-next-btn');
  const hint    = document.getElementById('bap-step1-hint');
  if (countEl) countEl.textContent = filled === 0 ? 'No images selected' : `${filled} image${filled !== 1 ? 's' : ''} selected`;
  if (nextBtn) nextBtn.disabled = filled === 0;
  if (hint)    hint.style.display = filled > 0 ? 'block' : 'none';
}

// ── Advance to Step 2 ─────────────────────────────────────────
function _bapGoStep2() {
  // Compact away nulls
  _bap.drafts = _bap.drafts.filter(d => d !== null && d.b64);
  if (_bap.drafts.length === 0) { showToast('Please select at least one image', 'warning'); return; }
  _bap.step = 2;
  _bapRenderStep2();
}

// ── STEP 2: Fill card details ────────────────────────────────
function _bapRenderStep2() {
  const panel = document.getElementById('bulk-add-panel');
  if (!panel) return;

  const catOptions = PRODUCT_CATS.map(c => `<option value="${c}">${c}</option>`).join('');

  const cardsHTML = _bap.drafts.map((d, i) => `
<article class="bap-draft-card" id="bap-card-${i}">
  <div class="bap-card-header-row">
    <span>Item ${i + 1} of ${_bap.drafts.length}</span>
    <button type="button" onclick="_bapRemoveCard(${i})" title="Remove this item">
      <i class="fas fa-trash-alt"></i> Remove
    </button>
  </div>
  <!-- Image -->
  <div class="bap-draft-img-wrap">
    <img src="${d.b64}" alt="Product ${i + 1}">
    <span class="bap-card-num">#${i + 1}</span>
    <div class="bap-card-status" id="bap-status-${i}"></div>
  </div>
  <!-- Multi-image slot (cover already set to d.b64; vendor can add more) -->
  <div style="padding:8px 10px 0;border-top:1px solid var(--border)">
    <div style="font-size:.68rem;font-weight:700;color:var(--text-muted);margin-bottom:5px">
      <i class="fas fa-images"></i> Images (cover + extras, up to 5)
    </div>
    <div id="bap-img-slots-${i}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
      <!-- Cover slot pre-filled from picked image -->
      <div class="pi-slot" id="bap-p-slot-0-${i}" style="position:relative;width:52px;height:52px;border-radius:6px;overflow:hidden;border:2px solid var(--primary);background:var(--bg);flex-shrink:0">
        <img id="bap-p-thumb-0-${i}" src="${d.b64}" style="width:100%;height:100%;object-fit:cover;display:block">
        <div id="bap-p-slot-placeholder-0-${i}" style="display:none"></div>
        <input type="file" id="bap-p-img-file-0-${i}" accept="image/*" style="display:none" onchange="_bapSlotPick(this,${i},0)">
        <input type="hidden" id="bap-p-img-b64-0-${i}" value="">
        <button type="button" onclick="_bapRemoveSlot(${i},0)" style="position:absolute;top:1px;right:1px;width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;font-size:.5rem;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="fas fa-times"></i></button>
        <span style="position:absolute;bottom:1px;left:1px;background:var(--primary);color:#fff;font-size:.48rem;font-weight:700;padding:1px 3px;border-radius:2px">CVR</span>
      </div>
    </div>
    <button type="button" id="bap-add-slot-${i}" onclick="_bapAddSlot(${i})"
            style="display:flex;align-items:center;gap:4px;background:var(--bg);border:1.5px dashed var(--border);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:.72rem;color:var(--primary);font-weight:600;margin-bottom:6px">
      <i class="fas fa-plus"></i> Add Image
    </button>
  </div>
  <!-- Form fields -->
  <div class="bap-draft-form">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:2px">
      <button type="button" onclick="_bapAiFill(${i})"
              style="display:flex;align-items:center;gap:5px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;border:none;border-radius:7px;padding:6px 12px;cursor:pointer;font-size:.75rem;font-weight:700;white-space:nowrap">
        <i class="fas fa-magic"></i> ✨ AI Fill
      </button>
      <span id="bap-ai-status-${i}" style="font-size:.7rem;color:var(--text-muted)"></span>
    </div>
    <input class="form-control" id="bap-name-${i}" placeholder="Product name *" value="${escHtml(d.name)}" oninput="_bapHandleNameInput(${i},this.value)">
    <textarea class="form-control" id="bap-desc-${i}" rows="2" placeholder="Description (optional)" oninput="_bapHandleDescInput(${i},this.value)">${escHtml(d.desc)}</textarea>
    <div class="bap-row2">
      <input class="form-control" id="bap-price-${i}" type="number" min="1" step="0.01" placeholder="Price (GHS) *" value="${d.price}" oninput="_bapSyncDraft(${i},'price',this.value)">
      <input class="form-control" id="bap-orig-${i}"  type="number" min="1" step="0.01" placeholder="Orig. price"   value="${d.orig}"  oninput="_bapSyncDraft(${i},'orig',this.value)">
    </div>
    <div class="bap-row2">
      <input class="form-control" id="bap-stock-${i}" type="number" min="0" placeholder="Stock qty *" value="${d.stock}"  oninput="_bapSyncDraft(${i},'stock',this.value)">
      <input class="form-control" id="bap-weight-${i}" type="number" step="0.1" min="0.1" placeholder="Weight (kg)" value="${d.weight}" oninput="_bapSyncDraft(${i},'weight',this.value)">
    </div>
    <select class="form-control form-select" id="bap-cat-${i}" onchange="_bapHandleCategoryChange(${i},this.value)">
      ${PRODUCT_CATS.map(c => `<option value="${c}" ${c === d.cat ? 'selected' : ''}>${c}</option>`).join('')}
    </select>
    <input class="form-control" id="bap-tags-${i}" placeholder="Tags (comma separated)" value="${escHtml(d.tags)}" oninput="_bapSyncDraft(${i},'tags',this.value)">
    <label style="display:flex;align-items:center;gap:7px;font-size:.8rem;font-weight:600;cursor:pointer">
      <input type="checkbox" id="bap-flash-${i}" ${d.flash ? 'checked' : ''} onchange="_bapSyncDraft(${i},'flash',this.checked)">
      ⚡ Flash Sale
    </label>
    <!-- Buyer Note Toggle -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.78rem;font-weight:700;color:#166534;margin-bottom:0">
        <input type="checkbox" id="bap-allow-note-${i}" onchange="_bapSyncDraft(${i},'allowNote',this.checked);_toggleNotePrompt('bap-note-prompt-wrap-${i}',this.checked)">
        💬 Allow Buyer Note
      </label>
      <div id="bap-note-prompt-wrap-${i}" style="display:none;margin-top:5px">
        <input class="form-control" id="bap-note-prompt-${i}" placeholder="e.g. Specify color and size" style="font-size:.75rem" oninput="_bapSyncDraft(${i},'notePrompt',this.value)">
      </div>
    </div>
  </div>
</article>`).join('');

  panel.innerHTML = `
${_bapHeader('Fill Product Details', `${_bap.drafts.length} item${_bap.drafts.length !== 1 ? 's' : ''}`)}
<div class="bap-body">
  <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
    <i class="fas fa-info-circle" style="color:var(--primary)"></i>
    Fill in the details for each product. Fields marked <strong>*</strong> are required. You can also add more images per card.
  </p>
  <div class="bap-cards-grid" id="bap-cards-grid">
    ${cardsHTML}
  </div>
</div>
<div class="bap-footer" style="flex-direction:column;align-items:stretch;gap:8px">
  <div class="bap-progress-wrap" id="bap-progress-wrap">
    <div class="bap-progress-bar" id="bap-progress-bar"></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <button class="btn btn-ghost btn-sm" onclick="_bapBackToStep1()" style="flex-shrink:0">
      <i class="fas fa-arrow-left"></i> Back
    </button>
    <span class="bap-count" id="bap-upload-status"></span>
    <button class="btn btn-primary" id="bap-submit-btn" onclick="_bapSubmitAll()"
            style="margin-left:auto;min-width:140px">
      <i class="fas fa-store"></i> Add All to Store
    </button>
  </div>
</div>`;

  // Initialise each card's cover image into the slot's b64 hidden field
  // (slot 0 is the cover; b64 value needs to be the actual data URL)
  _bap.drafts.forEach((d, i) => {
    const hid = document.getElementById(`bap-p-img-b64-0-${i}`);
    if (hid) hid.value = d.b64;
  });
}

// ── Sync a field value back into the draft array ─────────────────
function _bapSyncDraft(idx, field, val) {
  if (_bap.drafts[idx]) _bap.drafts[idx][field] = val;
}

function _bapHandleNameInput(idx, name) {
  _bapSyncDraft(idx, 'name', name);
}

function _bapHandleCategoryChange(idx, cat) {
  _bapSyncDraft(idx, 'cat', cat);
  const catEl = document.getElementById(`bap-cat-${idx}`);
  if (catEl) catEl.dataset.autoGenerated = 'false';
  const name = (document.getElementById(`bap-name-${idx}`)?.value || '').trim();
  const desc = (document.getElementById(`bap-desc-${idx}`)?.value || '').trim();
  if (name && typeof localLearnCorrection === 'function') {
    localLearnCorrection(name, cat, desc);
  }
}

function _bapHandleDescInput(idx, desc) {
  _bapSyncDraft(idx, 'desc', desc);
  const descEl = document.getElementById(`bap-desc-${idx}`);
  if (descEl) descEl.dataset.autoGenerated = 'false';
  const name = (document.getElementById(`bap-name-${idx}`)?.value || '').trim();
  const cat = document.getElementById(`bap-cat-${idx}`)?.value || 'Other';
  if (name && typeof localLearnCorrection === 'function') {
    localLearnCorrection(name, cat, desc);
  }
}


// ── Per-card AI Fill (manual trigger from step-2 card) ───────
async function _bapAiFill(idx) {
  const draft    = _bap.drafts[idx];
  if (!draft) return;
  if (!draft.b64) { showToast('No image for this card', 'warning'); return; }
  if (typeof autoGenerateProductInfo !== 'function') { showToast('AI module not loaded', 'error'); return; }

  const nameEl     = document.getElementById('bap-name-' + idx);
  const descEl     = document.getElementById('bap-desc-' + idx);
  const statusEl   = document.getElementById('bap-ai-status-' + idx);

  if (statusEl) statusEl.textContent = '⏳ Generating...';

  try {
    const result = await autoGenerateProductInfo(draft.b64);
    if (result.name) {
      draft.name = result.name;
      if (nameEl) nameEl.value = result.name;
    }
    if (result.description) {
      draft.desc = result.description;
      if (descEl) descEl.value = result.description;
    }
    if (statusEl) statusEl.textContent = '✅ Done!';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    showToast(`Card ${idx + 1} filled by AI ✨`, 'success');
  } catch (err) {
    console.error('[_bapAiFill]', err);
    if (statusEl) statusEl.textContent = '❌ AI failed';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
    showToast('AI failed — fill manually', 'warning');
  }
}

// ── Remove a card from step 2 ────────────────────────────────
function _bapRemoveCard(idx) {
  _bap.drafts[idx] = null;
  const card = document.getElementById('bap-card-' + idx);
  if (card) card.remove();

  const remaining = _bap.drafts.filter(d => d !== null).length;
  const header = document.querySelector('.bap-header h2');
  if (header) {
    // Update subtitle count
    const sub = document.querySelector('.bap-header span');
    if (sub) sub.textContent = `${remaining} item${remaining !== 1 ? 's' : ''}`;
  }
  if (remaining === 0) {
    showToast('All cards removed. Going back to image picker.', 'info');
    setTimeout(_bapBackToStep1, 700);
  }
}

// ── Go back to step 1 ────────────────────────────────────────
function _bapBackToStep1() {
  _bap.step = 1;
  // Keep drafts if vendor wants to re-pick — but clear them for a fresh start
  _bap.drafts = [];
  _bapRenderStep1();
}

// ── Per-card extra image slots ───────────────────────────────
function _bapAddSlot(cardIdx) {
  const container = document.getElementById('bap-img-slots-' + cardIdx);
  const addBtn    = document.getElementById('bap-add-slot-' + cardIdx);
  if (!container) return;
  const count = container.querySelectorAll('.pi-slot').length;
  if (count >= 5) { showToast('Maximum 5 images per product', 'info'); return; }
  const slotIdx = count;
  const slot = document.createElement('div');
  slot.className = 'pi-slot';
  slot.id = `bap-p-slot-${slotIdx}-${cardIdx}`;
  slot.style.cssText = 'position:relative;width:52px;height:52px;border-radius:6px;overflow:hidden;border:2px solid var(--border);background:var(--bg);flex-shrink:0';
  slot.innerHTML = `
    <img id="bap-p-thumb-${slotIdx}-${cardIdx}" style="width:100%;height:100%;object-fit:cover;display:none">
    <div id="bap-p-slot-placeholder-${slotIdx}-${cardIdx}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:1.1rem" onclick="document.getElementById('bap-p-img-file-${slotIdx}-${cardIdx}').click()">
      <i class="fas fa-image"></i>
    </div>
    <input type="file" id="bap-p-img-file-${slotIdx}-${cardIdx}" accept="image/*" style="display:none" onchange="_bapSlotPick(this,${cardIdx},${slotIdx})">
    <input type="hidden" id="bap-p-img-b64-${slotIdx}-${cardIdx}" value="">
    <button type="button" onclick="_bapRemoveSlot(${cardIdx},${slotIdx})" style="position:absolute;top:1px;right:1px;width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;border:none;font-size:.5rem;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="fas fa-times"></i></button>
  `;
  container.appendChild(slot);
  const newCount = container.querySelectorAll('.pi-slot').length;
  if (addBtn && newCount >= 5) addBtn.style.display = 'none';
}

function _bapSlotPick(input, cardIdx, slotIdx) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large. Max 5MB.', 'warning'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const thumb  = document.getElementById(`bap-p-thumb-${slotIdx}-${cardIdx}`);
    const ph     = document.getElementById(`bap-p-slot-placeholder-${slotIdx}-${cardIdx}`);
    const hid    = document.getElementById(`bap-p-img-b64-${slotIdx}-${cardIdx}`);
    if (thumb) { thumb.src = ev.target.result; thumb.style.display = 'block'; }
    if (ph)    ph.style.display = 'none';
    if (hid)   hid.value = ev.target.result;
    // Also update the card's cover image display if slot 0
    if (slotIdx === 0 && _bap.drafts[cardIdx]) {
      _bap.drafts[cardIdx].b64 = ev.target.result;
      const coverImg = document.querySelector(`#bap-card-${cardIdx} .bap-draft-img-wrap img`);
      if (coverImg) coverImg.src = ev.target.result;
    }
  };
  reader.readAsDataURL(file);
}

function _bapRemoveSlot(cardIdx, slotIdx) {
  const slot = document.getElementById(`bap-p-slot-${slotIdx}-${cardIdx}`);
  if (slot) slot.remove();
  
  // Re-number remaining slots for this card so indices stay contiguous
  const container = document.getElementById('bap-img-slots-' + cardIdx);
  const addBtn = document.getElementById('bap-add-slot-' + cardIdx);
  if (container) {
    container.querySelectorAll('.pi-slot').forEach((s, i) => {
      s.id = `bap-p-slot-${i}-${cardIdx}`;
      const thumb = s.querySelector('img[id]');
      if (thumb) thumb.id = `bap-p-thumb-${i}-${cardIdx}`;
      
      const ph = s.querySelector('[id*="-slot-placeholder-"]');
      if (ph) {
        ph.id = `bap-p-slot-placeholder-${i}-${cardIdx}`;
        ph.setAttribute('onclick', `document.getElementById('bap-p-img-file-${i}-${cardIdx}').click()`);
      }
      
      const fileInp = s.querySelector('input[type=file]');
      if (fileInp) {
        fileInp.id = `bap-p-img-file-${i}-${cardIdx}`;
        fileInp.setAttribute('onchange', `_bapSlotPick(this,${cardIdx},${i})`);
      }
      
      const hid = s.querySelector('input[type=hidden]');
      if (hid) hid.id = `bap-p-img-b64-${i}-${cardIdx}`;
      
      const rmBtn = s.querySelector('button[type=button]');
      if (rmBtn) rmBtn.setAttribute('onclick', `_bapRemoveSlot(${cardIdx},${i})`);
      
      // Update cover badge or styles
      const badge = s.querySelector('span');
      if (badge && (badge.textContent.trim() === 'CVR' || badge.textContent.trim() === 'COVER')) {
        if (i !== 0) badge.remove();
      }
      if (i === 0 && !s.querySelector('span[style*="bottom:1px"]')) {
        const b = document.createElement('span');
        b.style.cssText = 'position:absolute;bottom:1px;left:1px;background:var(--primary);color:#fff;font-size:.48rem;font-weight:700;padding:1px 3px;border-radius:2px';
        b.textContent = 'CVR';
        s.appendChild(b);
      }
    });
  }
  
  if (addBtn) {
    const count = container ? container.querySelectorAll('.pi-slot').length : 0;
    if (count < 5) addBtn.style.display = 'flex';
  }
}

// ── Collect all images for a card ───────────────────────────
function _bapCollectCardImages(cardIdx) {
  const container = document.getElementById('bap-img-slots-' + cardIdx);
  if (!container) return [_bap.drafts[cardIdx]?.b64].filter(Boolean);
  const imgs = [];
  container.querySelectorAll('input[type=hidden][id^="bap-p-img-b64-"]').forEach(hid => {
    if (hid.value.trim()) imgs.push(hid.value.trim());
  });
  return imgs.length ? imgs : [_bap.drafts[cardIdx]?.b64].filter(Boolean);
}

// ── Submit all drafts ────────────────────────────────────────
async function _bapSubmitAll() {
  const { storeId, vendorId } = _bap;
  const store = App.allStores.find(s => s.id === storeId) || {};

  // Compact: skip removed cards
  const active = _bap.drafts
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d !== null);

  if (active.length === 0) { showToast('No products to add.', 'warning'); return; }

  // Validate all
  let firstError = null;
  for (const { d, i } of active) {
    const name  = (document.getElementById('bap-name-' + i)?.value || '').trim();
    const price = parseFloat(document.getElementById('bap-price-' + i)?.value);
    const stock = document.getElementById('bap-stock-' + i)?.value;
    if (!name || isNaN(price) || price <= 0 || stock === '' || stock === undefined) {
      firstError = i;
      break;
    }
  }
  if (firstError !== null) {
    showToast(`Item #${firstError + 1} is missing required fields (name, price, stock).`, 'warning');
    document.getElementById('bap-card-' + firstError)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Lock UI
  const submitBtn  = document.getElementById('bap-submit-btn');
  const statusEl   = document.getElementById('bap-upload-status');
  const progressWr = document.getElementById('bap-progress-wrap');
  const progressBr = document.getElementById('bap-progress-bar');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...'; }
  if (progressWr) progressWr.classList.add('visible');

  let done = 0, failed = 0;

  for (const { d, i } of active) {
    // Read current field values (vendor may have edited them)
    const name   = (document.getElementById('bap-name-'   + i)?.value || '').trim();
    const desc   = (document.getElementById('bap-desc-'   + i)?.value || '').trim();
    const price  = parseFloat(document.getElementById('bap-price-'  + i)?.value) || 0;
    const orig   = parseFloat(document.getElementById('bap-orig-'   + i)?.value) || price;
    const stock  = parseInt(document.getElementById('bap-stock-'  + i)?.value)   || 0;
    const weight = parseFloat(document.getElementById('bap-weight-' + i)?.value) || 0.5;
    const cat    = document.getElementById('bap-cat-'   + i)?.value || 'Other';
    const tagsRaw= document.getElementById('bap-tags-'  + i)?.value || '';
    const flash        = document.getElementById('bap-flash-' + i)?.checked || false;
    const allowBuyerNote  = document.getElementById('bap-allow-note-' + i)?.checked || false;
    const buyerNotePrompt = (document.getElementById('bap-note-prompt-' + i)?.value || '').trim() || 'Add a note (e.g. color, size)';
    const images = _bapCollectCardImages(i);
    const tags   = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    // Show uploading state on card
    const statusDiv = document.getElementById('bap-status-' + i);
    if (statusDiv) { statusDiv.style.display = 'flex'; statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:var(--primary)"></i>'; }

    const commission = getCommission(price);
    const prod = await apiPost('products', {
      name, description: desc, price, original_price: orig,
      store_id: storeId, vendor_id: vendorId, category: cat,
      images,
      stock_qty: stock, sold_count: 0, views: 0,
      avg_rating: 0, review_count: 0,
      location: store.location || App.currentUser?.location || '',
      is_flash_sale: flash, flash_sale_end: '',
      status: stock > 0 ? 'active' : 'sold_out',
      tags, commission_pct: commission, weight_kg: weight,
      allow_buyer_note: allowBuyerNote,
      buyer_note_prompt: allowBuyerNote ? buyerNotePrompt : ''
    });

    if (prod) {
      App.allProducts.push(prod);
      done++;
      const card = document.getElementById('bap-card-' + i);
      if (card) card.classList.add('bap-card-done');
      if (statusDiv) statusDiv.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i>';
    } else {
      failed++;
      const card = document.getElementById('bap-card-' + i);
      if (card) card.classList.add('bap-card-error');
      if (statusDiv) statusDiv.innerHTML = '<i class="fas fa-times-circle" style="color:var(--danger)"></i>';
    }

    // Update progress
    const pct = Math.round(((done + failed) / active.length) * 100);
    if (progressBr) progressBr.style.width = pct + '%';
    if (statusEl)   statusEl.textContent    = `${done + failed} / ${active.length} uploaded...`;
  }

  // Done
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-check"></i> Done'; }
  if (statusEl) statusEl.textContent = `✅ ${done} added${failed ? `, ❌ ${failed} failed` : ''}`;

  if (done > 0) {
    showToast(`${done} product${done !== 1 ? 's' : ''} added to your store! 🎁`, 'success');
    renderVendorDashboard();
  }
  if (failed > 0) {
    showToast(`${failed} product${failed !== 1 ? 's' : ''} failed to upload. Check your connection.`, 'error');
  }

  // Auto-close after short delay if everything succeeded
  if (failed === 0) {
    setTimeout(closeBulkAddPanel, 1800);
  }
}

window.saveVendorStoreSettings = async function(storeId) {
  if (!storeId) { showToast('No store assigned', 'warning'); return; }
  
  const name = document.getElementById('store-name')?.value || 'Accra Streetwear Co.';
  const primary_color = document.getElementById('store-primary-color')?.value || '#faf9f6';
  const secondary_color = document.getElementById('store-secondary-color')?.value || '#faf9f6';
  const logo_url = document.getElementById('store-logo-url')?.value || '';
  const banner_url = document.getElementById('store-banner-url')?.value || '';
  const slogan = document.getElementById('store-slogan')?.value || '';
  const description = document.getElementById('store-description')?.value || '';
  const business_hours = document.getElementById('store-hours')?.value || '';
  const shipping_policy = document.getElementById('store-shipping-policy')?.value || '';
  const return_policy = document.getElementById('store-return-policy')?.value || '';
  
  const facebook_url = document.getElementById('store-facebook')?.value || '';
  const instagram_url = document.getElementById('store-instagram')?.value || '';
  const youtube_url = document.getElementById('store-youtube')?.value || '';
  
  const slug = document.getElementById('store-slug')?.value?.trim() || '';
  // Auto-generate slug from store name if empty
  let cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!cleanSlug) {
    const nameEl = document.getElementById('store-name');
    const nameVal = nameEl?.value?.trim() || '';
    cleanSlug = nameVal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || `store-${storeId}`;
    if (document.getElementById('store-slug')) document.getElementById('store-slug').value = cleanSlug;
  }
  
  const duplicate = (App.allStorefronts || []).find(sf => 
    String(sf.url_slug).toLowerCase() === cleanSlug && 
    String(sf.store_id) !== String(storeId)
  );
  if (duplicate) {
    showToast('This URL slug is already taken. Please choose another.', 'error');
    return;
  }

  const meta_description = document.getElementById('store-meta-desc')?.value || '';
  const theme = document.querySelector('input[name="store-theme"]:checked')?.value || 'classic';
  const font_family = document.getElementById('store-font-family')?.value || 'Outfit';

  // Show loading toast or lock btn
  showToast('Saving storefront settings...', 'info');

  const sfFields = {
    name,
    primary_color,
    secondary_color,
    logo_url,
    banner_url,
    slogan,
    about_us: description,
    business_hours,
    shipping_policy,
    return_policy,
    facebook_url,
    instagram_url,
    youtube_url,
    url_slug: cleanSlug,
    meta_description,
    theme,
    font_family
  };

  if (App.myStorefront) {
    Object.assign(App.myStorefront, sfFields);
    const sfIdx = App.allStorefronts ? App.allStorefronts.findIndex(s => String(s.id) === String(App.myStorefront.id)) : -1;
    if (sfIdx !== -1) App.allStorefronts[sfIdx] = App.myStorefront;
    try { localStorage.setItem('happa_all_storefronts', JSON.stringify(App.allStorefronts)); } catch(e){}
    const patchRes = await apiPatch('storefronts', App.myStorefront.id, sfFields);
    if (!patchRes) {
      showToast('⚠️ Could not reach server — changes saved locally only.', 'warning');
    }
  } else {
    const payload = { ...sfFields, store_id: storeId, vendor_id: App.currentUser?.id || '', status: 'draft' };
    const res = await apiPost('storefronts', payload);
    if (res) {
      App.myStorefront = res.data || res;
      if (!App.allStorefronts) App.allStorefronts = [];
      // Avoid duplicates
      const existing = App.allStorefronts.findIndex(s => String(s.id) === String(App.myStorefront.id));
      if (existing === -1) App.allStorefronts.push(App.myStorefront);
      else App.allStorefronts[existing] = App.myStorefront;
      try { localStorage.setItem('happa_all_storefronts', JSON.stringify(App.allStorefronts)); } catch(e){}
    } else {
      showToast('❌ Failed to create storefront record. Check your connection.', 'error');
      return;
    }
  }

  showToast('Storefront settings saved! 🎉', 'success');
  
  // Update sf-status-card in-place (no full re-render)
  try {
    const statusCard = document.getElementById('sf-status-card');
    if (statusCard && App.myStorefront) {
      const slug = App.myStorefront.url_slug || '';
      const liveUrl = `${window.location.origin}/#storefront/${slug}`;
      statusCard.innerHTML = `<div style="font-size:.82rem;background:#d1fae5;border:1px solid #a7f3d0;border-radius:8px;padding:8px 12px;color:#065f46;font-weight:600"><i class="fas fa-check-circle"></i> Settings saved. URL: <a href="${liveUrl}" target="_blank" style="color:#0284c7;text-decoration:underline">${liveUrl}</a></div>`;
    }
  } catch(e){}
  if (typeof window.updateStorefrontPreview === 'function') window.updateStorefrontPreview();
  return true; // signal success to callers
};

window.setStorefrontStatus = async function(storeId, status) {
  if (!App.myStorefront) {
    showToast('Storefront record not found. Save settings first.', 'error');
    return;
  }
  
  App.myStorefront.status = status;
  const sfIdx = App.allStorefronts ? App.allStorefronts.findIndex(s => String(s.id) === String(App.myStorefront.id)) : -1;
  if (sfIdx !== -1) App.allStorefronts[sfIdx].status = status;
  
  try {
    localStorage.setItem('happa_all_storefronts', JSON.stringify(App.allStorefronts));
  } catch(e){}
  
  await apiPatch('storefronts', App.myStorefront.id, { status }).catch(() => {});
  
  // Notify admin
  if (status === 'pending_approval') {
    const storeObj = App.allStores?.find(s => String(s.id) === String(storeId));
    const storeName = storeObj?.name || App.currentUser?.name || 'A vendor';
    // Find any admin user, fallback to hardcoded ID
    const adminUser = (App.allUsers || []).find(u => u.role === 'admin');
    const adminId = adminUser?.id || 'u-admin-001';
    if (typeof addNotification === 'function') {
      addNotification(adminId, 'system', '🎨 New Storefront Request',
        `${storeName} has requested storefront layout approval.`,
        '#admin-dashboard');
    }
  }

  showToast(status === 'pending_approval' ? 'Storefront request submitted! 🚀' : 'Storefront status updated', 'success');
  
  // Update the status badge in-place without a full dashboard re-render
  try {
    const statusCard = document.getElementById('sf-status-card');
    if (statusCard) {
      const msg = status === 'pending_approval'
        ? '⏳ Storefront request submitted! Admin will review it shortly.'
        : `Status updated to: ${status}`;
      statusCard.innerHTML = `<div style="font-size:.82rem;background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:8px 12px;color:#713f12;font-weight:600">${msg}</div>`;
    }
  } catch(e){}
};

window.activateStorefrontPlan = async function(storeId, planKey, price) {
  if (!App.myStorefront || App.myStorefront.status !== 'approved_pending_payment') return;
  
  // Check wallet balance
  if (App.walletBalance < price) {
    showToast(`Insufficient balance. You need GH₵ ${price} to activate this plan.`, 'error');
    return;
  }
  
  if (!confirm(`Pay GH₵ ${price} to activate the ${planKey.toUpperCase()} plan?`)) return;
  
  showToast('Processing payment & activating storefront...', 'info');
  
  // 1. Deduct balance (mock via API)
  await apiPost('wallet_transactions', {
    user_id: App.currentUser.id,
    type: 'payment',
    amount: price,
    description: `Storefront Subscription: ${planKey.toUpperCase()} Plan`,
    status: 'completed'
  }).catch(() => {});
  
  App.walletBalance -= price;
  if (typeof updateWalletUI === 'function') updateWalletUI();
  
  // 2. Update storefront status
  App.myStorefront.status = 'approved';
  await apiPatch('storefronts', App.myStorefront.id, { status: 'approved' }).catch(() => {});
  const sfIdx = App.allStorefronts ? App.allStorefronts.findIndex(s => String(s.id) === String(App.myStorefront.id)) : -1;
  if (sfIdx !== -1) App.allStorefronts[sfIdx].status = 'approved';
  
  // 3. Update store subscription details
  const storeIdx = App.allStores ? App.allStores.findIndex(s => String(s.id) === String(storeId)) : -1;
  const now = new Date();
  const newEnd = new Date(now);
  newEnd.setMonth(newEnd.getMonth() + 1);
  
  if (storeIdx !== -1) {
    App.allStores[storeIdx].subscription_plan = planKey;
    App.allStores[storeIdx].subscription_status = 'active';
    App.allStores[storeIdx].subscription_start = now.toISOString();
    App.allStores[storeIdx].subscription_end = newEnd.toISOString();
    App.allStores[storeIdx].subscription_method = 'vendor_paid';
    
    await apiPatch('stores', storeId, {
      subscription_plan: planKey,
      subscription_status: 'active',
      subscription_start: now.toISOString(),
      subscription_end: newEnd.toISOString()
    }).catch(() => {});
  }
  
  try {
    localStorage.setItem('happa_all_storefronts', JSON.stringify(App.allStorefronts));
    localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores));
  } catch(e){}
  
  showToast('Storefront activated successfully! 🎉', 'success');
  renderVendorDashboard();
};

window.handleImageUpload = async function(type) {
  const fileInput = document.getElementById(`store-${type}-file`);
  const hiddenInput = document.getElementById(`store-${type}-url`);
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  
  try {
    const base64 = await compressImage(fileInput.files[0], 1200, 0.8);
    hiddenInput.value = base64;
    window.updateStorefrontPreview();
  } catch (err) {
    console.error('Failed to compress image:', err);
    showToast('Failed to process image.', 'error');
  }
};

window.applyColorCombo = function(primary, secondary) {
  const pColor = document.getElementById('store-primary-color');
  const pText = document.getElementById('store-primary-text');
  const sColor = document.getElementById('store-secondary-color');
  const sText = document.getElementById('store-secondary-text');
  
  if (pColor) pColor.value = primary;
  if (pText) pText.value = primary;
  if (sColor) sColor.value = secondary;
  if (sText) sText.value = secondary;
  
  window.updateStorefrontPreview();
};

window.previewActiveTab = 'home';
window.previewTheme = 'classic';

window.setPreviewTab = function(tab) {
  window.previewActiveTab = tab;
  window.updateStorefrontPreview();
};

window.updateStoreTheme = function(theme) {
  window.previewTheme = theme;
  // Update selection UI border and background highlights
  ['classic', 'bold', 'modern', 'neumorphic'].forEach(t => {
    const el = document.getElementById(`theme-label-${t}`);
    if (el) {
      if (t === theme) {
        el.style.borderColor = 'var(--primary)';
        el.style.background = 'var(--primary-light)';
      } else {
        el.style.borderColor = 'var(--border)';
        el.style.background = 'transparent';
      }
    }
  });
  window.updateStorefrontPreview();
};

window.updateStorefrontPreview = function() {
  const storeName = document.getElementById('store-name')?.value || 'Preview Store';
  const primary = document.getElementById('store-primary-color')?.value || '#faf9f6';
  const secondary = document.getElementById('store-secondary-color')?.value || '#ffffff';
  const tertiary = document.getElementById('store-tertiary-color')?.value || '#e85d04';
  const logo = document.getElementById('store-logo-url')?.value || '';
  const banner = document.getElementById('store-banner-url')?.value || '';
  const slogan = document.getElementById('store-slogan')?.value || 'Your Brand Slogan';
  const desc = document.getElementById('store-description')?.value || 'About our shop...';
  const slug = document.getElementById('store-slug')?.value || 'my-link';
  
  const hours = document.getElementById('store-hours')?.value || 'Mon - Sat: 8:00 AM - 6:00 PM';
  const shipping = document.getElementById('store-shipping-policy')?.value || 'Instant delivery.';
  const returns = document.getElementById('store-return-policy')?.value || '7-day replacement.';
  const font_family = document.getElementById('store-font-family')?.value || 'Outfit';

  // Update preview URL bar
  const urlBar = document.getElementById('preview-url-bar');
  if (urlBar) urlBar.textContent = `${window.location.origin}/#storefront/${slug}`;

  const previewBox = document.getElementById('storefront-live-preview-box');
  if (!previewBox) return;

  // Retrieve products from the main site context
  let displayProducts = [];
  if (window.App && Array.isArray(App.allProducts)) {
    const storeNameVal = document.getElementById('store-name')?.value || '';
    const myStore = (App.allStores || []).find(s => s.name === storeNameVal || s.id === 1 || s.id === '1') || {};
    displayProducts = App.allProducts.filter(p => String(p.store_id) === String(myStore.id) && p.status === 'active');
    if (displayProducts.length === 0) {
      displayProducts = App.allProducts.filter(p => p.status === 'active');
    }
  }
  if (displayProducts.length === 0) {
    displayProducts = [
      { name: 'Ghana Premium Wear', price: 120, image_url: '👕', rating: 4.8, sold_count: 12 },
      { name: 'Sneaker Classic', price: 350, image_url: '👟', rating: 4.9, sold_count: 8 },
      { name: 'Gold Quartz Watch', price: 850, image_url: '⌚', rating: 5.0, sold_count: 5 },
      { name: 'Leather Tote Bag', price: 240, image_url: '👜', rating: 4.7, sold_count: 20 }
    ];
  }

  const getProductImageHTML = (p) => {
    if (p.image_url && (p.image_url.startsWith('http') || p.image_url.startsWith('data:') || p.image_url.includes('/') || p.image_url.includes('.'))) {
      return `<img src="${p.image_url}" style="width:100%; height:100%; object-fit:cover" onerror="this.outerHTML='📦'">`;
    }
    return p.image_url || '📦';
  };

  // Choose placeholder images if none provided
  const bannerSrc = banner ? banner : 'images/photo_2026-05-30_17-40-49-Photoroom.png';
  const logoSrc = logo ? logo : 'images/photo_2026-05-30_17-40-49-Photoroom.png';

  // Base layout styles based on selected theme
  let headerHTML = '';
  let themeStyles = '';

  if (window.previewTheme === 'bold') {
    // Modern Bold Theme: Sleek high-contrast layout, rounded cards, bold typography, soft modern shadows
    themeStyles = `
      <style>
        #storefront-live-preview-box .prev-store-header { background: ${secondary}; color: #fff; padding: 12px; text-align: center; }
        #storefront-live-preview-box .prev-btn-theme { background: ${primary}; color: #fff; border: none; padding: 6px 12px; border-radius: 8px; font-weight:800; font-size:.75rem; transition: transform 0.1s; text-transform: uppercase; box-shadow: 0 4px 10px color-mix(in srgb, ${primary} 30%, transparent); }
        #storefront-live-preview-box .prev-btn-theme:active { transform: scale(0.95); }
        #storefront-live-preview-box .prev-tab-list { background: #ffffff; border-bottom: 2px solid color-mix(in srgb, ${primary} 20%, transparent); }
        #storefront-live-preview-box .prev-tab { flex:1; padding:10px 0; cursor:pointer; color:var(--text-light); transition: all 0.2s; border-bottom: 2px solid transparent; font-weight:800; text-transform:uppercase; font-size:0.7rem; }
        #storefront-live-preview-box .prev-tab.active { border-bottom-color: ${primary}; color: ${primary}; }
        
        #storefront-live-preview-box .prev-body-container { background: #f8f9fa !important; color: var(--text) !important; }
        #storefront-live-preview-box .product-card { background: #ffffff !important; border: 1px solid var(--border) !important; border-radius: 12px !important; color: var(--text) !important; box-shadow: 0 4px 15px rgba(0,0,0,0.07) !important; transition: all 0.25s ease-in-out !important; }
        #storefront-live-preview-box .product-card:hover { transform: translateY(-3px) !important; box-shadow: 0 12px 24px rgba(0,0,0,0.12) !important; }
        #storefront-live-preview-box .product-card .product-name { color: var(--text) !important; font-weight: 700 !important; font-size: 0.85rem !important; }
        #storefront-live-preview-box .product-card .product-price { color: ${primary} !important; font-weight: 800 !important; font-size: 0.95rem !important; }
        #storefront-live-preview-box .product-card .product-img { background: var(--bg) !important; border-radius: 8px 8px 0 0 !important; }
        #storefront-live-preview-box .prev-about-title { color: var(--text) !important; font-weight: 800 !important; text-transform: uppercase; }
        #storefront-live-preview-box .prev-about-text { color: var(--text-light) !important; }
      </style>
    `;
    headerHTML = `
      <div style="position:relative; text-align:center; padding-bottom:12px; background:#fff; border-bottom:1px solid var(--border)">
        <div style="width:100%; height:90px; background:${secondary}; display:flex; align-items:center; justify-content:center; overflow:hidden">
          <img src="${bannerSrc}" style="width:100%; height:100%; object-fit:cover" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        </div>
        <div style="margin:-30px auto 6px auto; width:64px; height:64px; border-radius:50%; border:3px solid #fff; background:#fff; overflow:hidden; box-shadow:var(--shadow-md); position:relative; z-index:2">
          <img src="${logoSrc}" style="width:100%; height:100%; object-fit:cover" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
        </div>
        <h4 style="font-size:1rem; font-weight:900; margin:0; color:var(--text); text-transform:uppercase">${storeName}</h4>
        <div style="font-size:0.65rem; color:var(--text-light); font-weight:700; margin-top:2px"><i class="fas fa-star" style="color:#fbbf24"></i> 4.9 (15 reviews)</div>
      </div>
      <div class="prev-store-header" style="background:${secondary}; padding:8px 12px; text-align:center">
        <h5 style="font-size:0.75rem; font-weight:800; margin:0; color:#fff; text-transform:uppercase">${slogan}</h5>
      </div>
    `;
  } else if (window.previewTheme === 'modern') {
    // Modern Glass Theme: Light glassy layout, frosted cards, logo over banner background
    themeStyles = `
      <style>
        #storefront-live-preview-box .prev-store-header { background: color-mix(in srgb, ${secondary} 20%, rgba(255, 255, 255, 0.4)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); padding: 12px; }
        #storefront-live-preview-box .prev-btn-theme { background: ${primary}; color: #fff; border: none; padding: 6px 14px; border-radius: 20px; font-weight:700; font-size:.7rem; box-shadow: 0 4px 10px rgba(0,0,0,0.1); transition: transform 0.1s; }
        #storefront-live-preview-box .prev-btn-theme:active { transform: scale(0.95); }
        #storefront-live-preview-box .prev-tab-list { background: color-mix(in srgb, ${secondary} 20%, rgba(255, 255, 255, 0.6)); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
        #storefront-live-preview-box .prev-tab { flex:1; padding:10px 0; cursor:pointer; color:var(--text-light) !important; transition: all 0.2s; border-bottom: 2px solid transparent; font-size: 0.72rem; }
        #storefront-live-preview-box .prev-tab.active { color: ${primary} !important; font-weight: 800; border-bottom-color: ${primary}; }
        
        #storefront-live-preview-box .prev-body-container { background: color-mix(in srgb, ${secondary} 20%, #faf9f6) !important; color: var(--text) !important; }
        #storefront-live-preview-box .product-card { background: rgba(255,255,255,0.75) !important; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.4) !important; color: var(--text) !important; box-shadow: 0 4px 15px rgba(0,0,0,0.03) !important; border-radius: 12px !important; }
        #storefront-live-preview-box .product-card .product-name { color: var(--text) !important; font-weight: 700 !important; font-size: 0.85rem !important; }
        #storefront-live-preview-box .product-card .product-price { color: ${primary} !important; font-weight: 800 !important; }
        #storefront-live-preview-box .product-card .product-img { background: rgba(255,255,255,0.4) !important; border-radius: 8px !important; }
        #storefront-live-preview-box .prev-about-title { color: ${primary} !important; font-weight: 800 !important; }
        #storefront-live-preview-box .prev-about-text { color: var(--text-light) !important; }
      </style>
    `;
    headerHTML = `
      <div style="position:relative; overflow:hidden; min-height:165px; display:flex; align-items:center; justify-content:center; padding:20px 10px;">
        <!-- Full-screen hero banner in background -->
        <img src="${bannerSrc}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:1;" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        <div style="position:absolute; inset:0; background:rgba(15, 23, 42, 0.45); z-index:1;"></div>
        
        <!-- Frosted Glass Card overlay containing logo, title, slogan -->
        <div style="position:relative; z-index:2; width:88%; background:color-mix(in srgb, ${secondary} 20%, rgba(255, 255, 255, 0.7)); backdrop-filter:blur(16px) saturate(180%); -webkit-backdrop-filter:blur(16px) saturate(180%); border:1px solid rgba(255, 255, 255, 0.4); border-radius:14px; padding:16px 12px 12px 12px; text-align:center; box-shadow:0 8px 32px 0 rgba(0, 0, 0, 0.08);">
          <div style="display:flex; justify-content:center; margin-top:-38px; margin-bottom:8px;">
            <img src="${logoSrc}" style="width:48px; height:48px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px rgba(0,0,0,0.15); object-fit:cover; background:#fff" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
          </div>
          <h4 style="font-family:'Outfit', 'Inter', sans-serif; font-size:0.9rem; font-weight:800; margin:0; color:var(--text); letter-spacing:0.5px">${storeName}</h4>
          <p style="font-size:0.68rem; color:var(--text-muted); margin:4px 0 0 0; font-weight:500; font-style:italic;">${slogan}</p>
          <div style="display:inline-block; font-size:0.58rem; color:${primary}; background:color-mix(in srgb, ${primary} 12%, transparent); border:1px solid color-mix(in srgb, ${primary} 25%, transparent); padding:2px 8px; border-radius:20px; margin-top:8px; font-weight:700">🔮 GLASSY STYLE</div>
        </div>
      </div>
    `;
  } else if (window.previewTheme === 'neumorphic') {
    // Neumorphic Soft Theme: Extruded 3D shadows, pill buttons, soft relief elements
    themeStyles = `
      <style>
        #storefront-live-preview-box {
          --neu-bg: color-mix(in srgb, ${secondary} 10%, #faf9f6);
        }
        #storefront-live-preview-box .prev-store-header { background: var(--neu-bg); color: var(--text); border-bottom: none; padding: 12px; }
        #storefront-live-preview-box .prev-btn-theme { background: var(--neu-bg); color: ${primary} !important; border: 1px solid rgba(255,255,255,0.9); padding: 7px 16px; border-radius: 14px; font-weight:700; font-size:.68rem; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 2px 2px 5px rgba(165,175,190,0.25), -2px -2px 5px #ffffff; transition: all 0.2s ease; }
        #storefront-live-preview-box .prev-btn-theme:hover { box-shadow: 1px 1px 3px rgba(165,175,190,0.25), -1px -1px 3px #ffffff; transform: translateY(1px); }
        #storefront-live-preview-box .prev-btn-theme:active { box-shadow: inset 1px 1px 3px rgba(165,175,190,0.25), inset -1px -1px 3px #ffffff; }
        #storefront-live-preview-box .prev-tab-list { background: var(--neu-bg); padding: 4px; display: flex; gap: 8px; border-bottom: none; }
        #storefront-live-preview-box .prev-tab { flex:1; padding:8px 0; cursor:pointer; color:var(--text-light) !important; transition: all 0.2s; border-radius: 10px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; text-align: center; box-shadow: 2px 2px 5px rgba(165,175,190,0.25), -2px -2px 5px #ffffff; }
        #storefront-live-preview-box .prev-tab.active { color: ${primary} !important; box-shadow: inset 1px 1px 3px rgba(165,175,190,0.25), inset -1px -1px 3px #ffffff; }
        
        #storefront-live-preview-box .prev-body-container { background: var(--neu-bg) !important; color: var(--text) !important; font-family: 'Outfit', sans-serif !important; padding-bottom: 12px; }
        #storefront-live-preview-box .product-card { background: var(--neu-bg) !important; border: none !important; border-radius: 16px !important; color: var(--text) !important; box-shadow: 3px 3px 8px rgba(165,175,190,0.25), -3px -3px 8px #ffffff !important; transition: all 0.25s ease-in-out !important; }
        #storefront-live-preview-box .product-card:hover { transform: translateY(-2px) !important; box-shadow: 5px 5px 12px rgba(165,175,190,0.35), -5px -5px 12px #ffffff !important; }
        #storefront-live-preview-box .product-card .product-name { color: var(--text) !important; font-family: 'Outfit', sans-serif !important; font-size: 0.65rem !important; font-weight: 700 !important; }
        #storefront-live-preview-box .product-card .product-price { color: ${primary} !important; font-family: 'Outfit', sans-serif !important; font-weight: 800 !important; }
        #storefront-live-preview-box .product-card .product-img { background: #ffffff !important; border-radius: 12px 12px 0 0 !important; margin: 4px; box-shadow: none !important; border-bottom: 1px solid rgba(0,0,0,0.03) !important; }
        #storefront-live-preview-box .prev-about-title { color: var(--text) !important; font-family: 'Outfit', sans-serif !important; font-weight: 700 !important; border-bottom: none; padding-bottom: 0; margin-bottom: 6px; }
        #storefront-live-preview-box .prev-about-text { color: var(--text-light) !important; background: var(--neu-bg); padding: 8px; border-radius: 10px; box-shadow: inset 1px 1px 3px rgba(165,175,190,0.25), inset -1px -1px 3px #ffffff; }
      </style>
    `;
    headerHTML = `
      <div style="background:var(--neu-bg); padding:12px; display:flex; flex-direction:column; align-items:center; position:relative; border-bottom: none">
        <!-- Neumorphic Banner Inset Frame -->
        <div style="width:100%; height:90px; background:var(--neu-bg); padding:4px; box-shadow: inset 1px 1px 3px rgba(165,175,190,0.25), inset -1px -1px 3px #ffffff; border-radius:12px; overflow:hidden">
          <img src="${bannerSrc}" style="width:100%; height:100%; object-fit:cover; border-radius:10px" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        </div>
        
        <!-- Raised Profile Logo -->
        <div style="width:58px; height:58px; border-radius:50%; background:var(--neu-bg); display:flex; align-items:center; justify-content:center; box-shadow: 2px 2px 5px rgba(165,175,190,0.25), -2px -2px 5px #ffffff; padding: 4px; margin-top:-28px; position:relative; z-index:2">
          <img src="${logoSrc}" style="width:100%; height:100%; border-radius:50%; object-fit:cover" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
        </div>
        
        <div style="text-align:center; margin-top:6px">
          <h4 style="font-family:'Outfit', sans-serif; font-size:0.95rem; font-weight:800; margin:0; color:var(--text)">${storeName}</h4>
          <p style="font-family:'Outfit', sans-serif; font-size:0.65rem; color:var(--text-muted); margin:4px 0 0 0; font-style: italic">${slogan}</p>
        </div>
        <div style="font-size:0.58rem; color:${primary}; background:var(--neu-bg); padding:4px 12px; border-radius:20px; font-weight:700; box-shadow: inset 2px 2px 5px color-mix(in srgb, var(--neu-bg) 75%, #000), inset -2px -2px 5px #ffffff; margin-top:8px">☁️ NEUMORPHISM</div>
      </div>
    `;
  } else {
    // Classic Theme: standard top banner with floating left logo
    themeStyles = `
      <style>
        #storefront-live-preview-box .prev-store-header { background: ${secondary}; color: #fff; padding: 12px; }
        #storefront-live-preview-box .prev-btn-theme { background: ${primary}; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight:700; font-size:.75rem; transition: transform 0.1s; }
        #storefront-live-preview-box .prev-btn-theme:active { transform: scale(0.95); }
        #storefront-live-preview-box .prev-tab-list { background: #ffffff; border-bottom: 1px solid var(--border); }
        #storefront-live-preview-box .prev-tab { flex:1; padding:10px 0; cursor:pointer; color:var(--text-light); transition: all 0.2s; border-bottom: 2px solid transparent; font-size: 0.72rem; }
        #storefront-live-preview-box .prev-tab.active { border-bottom-color: ${primary}; color: ${primary}; font-weight: 800; }
        
        #storefront-live-preview-box .prev-body-container { background: #f8f9fa !important; color: var(--text) !important; }
        #storefront-live-preview-box .product-card { background: #ffffff !important; border: 1px solid var(--border) !important; border-radius: 8px !important; color: var(--text) !important; box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important; transition: all 0.25s ease-in-out !important; }
        #storefront-live-preview-box .product-card:hover { transform: translateY(-3px) !important; box-shadow: 0 10px 22px rgba(0,0,0,0.12) !important; }
        #storefront-live-preview-box .product-card .product-name { color: var(--text) !important; }
        #storefront-live-preview-box .product-card .product-price { color: ${primary} !important; }
        #storefront-live-preview-box .product-card .product-img { background: #f8f9fa !important; }
        #storefront-live-preview-box .prev-about-title { color: var(--text) !important; }
        #storefront-live-preview-box .prev-about-text { color: var(--text-light) !important; }
      </style>
    `;
    headerHTML = `
      <div style="position:relative">
        <div style="width:100%; height:90px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; overflow:hidden">
          <img src="${bannerSrc}" style="width:100%; height:100%; object-fit:cover" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        </div>
        <div style="padding:10px; background:#fff; border-bottom:1px solid var(--border)">
          <div style="display:flex; align-items:flex-start; gap:8px; margin-top:-22px">
            <img src="${logoSrc}" style="width:40px; height:40px; border-radius:8px; border:2px solid #fff; object-fit:cover; box-shadow:var(--shadow-sm)" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
            <div style="flex:1; padding-top:14px">
              <h4 style="font-size:0.8rem; font-weight:800; margin:0">${storeName}</h4>
              <div style="font-size:0.65rem; color:var(--text-muted); margin-top:1px"><i class="fas fa-star" style="color:#fbbf24"></i> 4.9 (15 reviews)</div>
            </div>
          </div>
        </div>
      </div>
      <div class="prev-store-header" style="padding:8px 12px; text-align:center">
        <h5 style="font-size:0.75rem; font-weight:700; margin:0">${slogan}</h5>
      </div>
    `;
  }

  // Interactive tab content
  let bodyHTML = '';
  if (window.previewActiveTab === 'products') {
    bodyHTML = `
      <div style="padding:12px">
        <div class="prev-body-title" style="font-weight:800; font-size:0.75rem; margin-bottom:8px; display:flex; justify-content:between">
          <span>All Products</span>
          <span style="font-weight:400; color:var(--text-muted); font-size:.65rem; margin-left:auto">${displayProducts.length} Items</span>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
          ${displayProducts.slice(0, 4).map(p => `
            <div class="product-card">
              <div class="product-img" style="height:60px; display:flex; align-items:center; justify-content:center; font-size:1.5rem; overflow:hidden">
                ${getProductImageHTML(p)}
              </div>
              <div class="product-body" style="padding: 6px 8px; display:flex; flex-direction:column; gap:2px">
                <div class="product-name" style="font-size:0.65rem; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escHtml(p.name)}</div>
                <div class="product-price" style="font-size:0.75rem">GHS ${p.price}</div>
                <div class="product-meta" style="font-size:0.55rem; display:flex; align-items:center; gap:4px">
                  <span class="product-rating" style="font-size:0.55rem; color:#fbbf24"><i class="fas fa-star"></i> ${p.rating || '4.8'}</span>
                  <span class="product-sold" style="font-size:0.55rem; color:var(--text-muted)">${p.sold_count || '10'} sold</span>
                </div>
                <button class="prev-btn-theme" onclick="alert('Simulated product checkout for ${escHtml(p.name)}!')" style="width:100%; font-size:.55rem; padding:3px; border-radius:4px; margin-top:4px">Buy Now</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else if (window.previewActiveTab === 'about') {
    bodyHTML = `
      <div style="padding:12px; display:flex; flex-direction:column; gap:10px; font-size:0.7rem;">
        <div>
          <div class="prev-about-title" style="font-weight:800; margin-bottom:2px">📅 Business Hours</div>
          <div class="prev-about-text">${hours}</div>
        </div>
        <div>
          <div class="prev-about-title" style="font-weight:800; margin-bottom:2px">🚀 Shipping & Delivery</div>
          <p class="prev-about-text" style="margin:0">${shipping}</p>
        </div>
        <div>
          <div class="prev-about-title" style="font-weight:800; margin-bottom:2px">↩️ Return Policy</div>
          <p class="prev-about-text" style="margin:0">${returns}</p>
        </div>
        <div>
          <div class="prev-about-title" style="font-weight:800; margin-bottom:4px">🔗 Connected Socials</div>
          <div style="display:flex; gap:8px">
            <i class="fab fa-facebook" style="font-size:1.1rem; color:#1877f2"></i>
            <i class="fab fa-instagram" style="font-size:1.1rem; color:#e1306c"></i>
            <i class="fab fa-youtube" style="font-size:1.1rem; color:#ff0000"></i>
          </div>
        </div>
      </div>
    `;
  } else {
    // Home tab
    bodyHTML = `
      <!-- Bio -->
      <div style="padding:12px 12px 6px 12px; font-size:0.7rem;">
        <div class="prev-about-title" style="font-weight:800; font-size:0.75rem; margin-bottom:2px">About Us</div>
        <p class="prev-about-text" style="line-height:1.4; margin:0">${desc}</p>
      </div>

      <!-- Simulated Featured Products -->
      <div style="padding:10px">
        <div class="prev-about-title" style="font-weight:800; font-size:0.7rem; margin-bottom:6px">🔥 Featured Products</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px">
          
          <div class="product-card">
            <div class="product-img" style="height:50px; display:flex; align-items:center; justify-content:center; font-size:1.2rem">👕</div>
            <div class="product-body" style="padding:4px 6px; display:flex; flex-direction:column">
              <div class="product-name" style="font-size:0.6rem; margin-bottom:2px">Ghana Premium Wear</div>
              <div class="product-price" style="font-size:0.7rem">GHS 120</div>
            </div>
          </div>
          
          <div class="product-card">
            <div class="product-img" style="height:50px; display:flex; align-items:center; justify-content:center; font-size:1.2rem">👟</div>
            <div class="product-body" style="padding:4px 6px; display:flex; flex-direction:column">
              <div class="product-name" style="font-size:0.6rem; margin-bottom:2px">Sneaker Classic</div>
              <div class="product-price" style="font-size:0.7rem">GHS 350</div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  // Combine full mockup view
  previewBox.style.fontFamily = `'${font_family}', sans-serif`;
  previewBox.innerHTML = `
    ${themeStyles}
    ${headerHTML}
    
    <!-- Tab list -->
    <div class="prev-tab-list" style="display:flex; text-align:center">
      <div class="prev-tab ${window.previewActiveTab === 'home' ? 'active' : ''}" onclick="window.setPreviewTab('home')">Home</div>
      <div class="prev-tab ${window.previewActiveTab === 'products' ? 'active' : ''}" onclick="window.setPreviewTab('products')">Products</div>
      <div class="prev-tab ${window.previewActiveTab === 'about' ? 'active' : ''}" onclick="window.setPreviewTab('about')">About</div>
    </div>

    <!-- Active body content wrapper -->
    <div class="prev-body-container" style="min-height:160px; font-family: inherit;">
      ${bodyHTML}
    </div>
  `;
};

window.handleStoreNameChange = function(val) {
  const slugInput = document.getElementById('store-slug');
  if (slugInput) {
    slugInput.value = val.toLowerCase()
                         .replace(/[^a-z0-9]+/g, '-')
                         .replace(/^-+|-+$/g, '');
  }
  window.updateStorefrontPreview();
};

window.handleSlugChange = function(val) {
  const slugInput = document.getElementById('store-slug');
  if (slugInput) {
    slugInput.value = val.toLowerCase()
                         .replace(/[^a-z0-9-]+/g, '-')
                         .replace(/-+/g, '-');
  }
  window.updateStorefrontPreview();
};

window.submitStorefrontRequest = async function(storeId) {
  showToast('Saving settings…', 'info');
  const saved = await window.saveVendorStoreSettings(storeId);
  if (!saved) {
    showToast('❌ Could not save storefront settings. Please try again.', 'error');
    return;
  }
  if (!App.myStorefront || !App.myStorefront.id) {
    showToast('❌ Storefront record missing after save. Please try again.', 'error');
    return;
  }
  await window.setStorefrontStatus(storeId, 'pending_approval');
};

// ── Storefront Subscription System ───────────────────────────────────────────

const STOREFRONT_PLANS = {
  starter: { name: 'Starter', price: 29, color: '#16a34a', icon: '🌱',
    features: ['Custom storefront URL','Basic theme & colors','Up to 20 products','Email support'] },
  growth:  { name: 'Growth',  price: 59, color: 'var(--primary)', icon: '🚀',
    features: ['All Starter features','All 4 premium themes','Up to 100 products','Hero banner & gallery','Priority support'] },
  pro:     { name: 'Pro',     price: 99, color: '#7c3aed', icon: '💎',
    features: ['All Growth features','Unlimited products','Custom domain support','Analytics dashboard','Dedicated support'] }
};

window.getSubscriptionBannerHTML = function(store) {
  const sub = store.subscription_status;
  const plan = store.subscription_plan;
  const end = store.subscription_end ? new Date(store.subscription_end) : null;
  const now = new Date();
  const planInfo = STOREFRONT_PLANS[plan] || null;

  if (!sub || sub === 'none' || !end) {
    return `
      <div style="background:#fff7ed;border:1.5px solid #fed7aa;color:#9a3412;border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><i class="fas fa-exclamation-circle"></i> <strong>No Active Subscription</strong>
          <div style="font-size:.75rem;margin-top:3px">Choose a plan to keep your storefront running.</div>
        </div>
        <button class="btn btn-sm" style="background:#ea580c;color:#fff;border:none" onclick="window.openStorefrontSubscribeModal('${store.id}','growth',59)">
          <i class="fas fa-sync"></i> Subscribe Now
        </button>
      </div>`;
  }

  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const expiring = daysLeft <= 7;
  const expired = end < now;

  if (expired) {
    return `
      <div style="background:#fef2f2;border:1.5px solid #fecaca;color:#991b1b;border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><i class="fas fa-times-circle"></i> <strong>Subscription Expired</strong>
          <div style="font-size:.75rem;margin-top:3px">Your ${planInfo ? planInfo.name : plan} plan expired on ${end.toLocaleDateString()}. Renew to restore storefront access.</div>
        </div>
        <button class="btn btn-sm" style="background:#dc2626;color:#fff;border:none" onclick="window.openStorefrontSubscribeModal('${store.id}','${plan}',${planInfo ? planInfo.price : 59})">
          <i class="fas fa-sync"></i> Renew Now
        </button>
      </div>`;
  }

  const bg = expiring ? '#fff7ed' : '#f0fdf4';
  const border = expiring ? '#fed7aa' : '#bbf7d0';
  const col = expiring ? '#9a3412' : '#14532d';
  const icon = expiring ? 'fa-exclamation-triangle' : 'fa-check-circle';

  return `
    <div style="background:${bg};border:1.5px solid ${border};color:${col};border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div>
        <i class="fas ${icon}"></i>
        <strong>${planInfo ? planInfo.icon + ' ' + planInfo.name : plan} Plan</strong>
        — GH₵ ${planInfo ? planInfo.price : '?'}/mo
        <div style="font-size:.75rem;margin-top:3px">
          ${expiring ? `⚠️ Expires in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>` : `Active until <strong>${end.toLocaleDateString()}</strong>`}
        </div>
      </div>
      <button class="btn btn-sm" style="background:${expiring ? '#ea580c' : '#16a34a'};color:#fff;border:none" onclick="window.openStorefrontSubscribeModal('${store.id}','${plan}',${planInfo ? planInfo.price : 59})">
        <i class="fas fa-sync"></i> ${expiring ? 'Renew Now' : 'Manage Plan'}
      </button>
    </div>`;
};

window.openStorefrontSubscribeModal = function(storeId, preSelectedPlan, price) {
  const existing = document.getElementById('storefront-sub-modal');
  if (existing) existing.remove();

  const store = (App.allStores || []).find(s => String(s.id) === String(storeId)) || {};
  const plan = STOREFRONT_PLANS[preSelectedPlan] || STOREFRONT_PLANS.growth;

  const html = `
  <div id="storefront-sub-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:18px;width:100%;max-width:460px;padding:28px 24px;position:relative;max-height:90vh;overflow-y:auto">
      <button onclick="document.getElementById('storefront-sub-modal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>

      <h2 style="font-weight:900;font-size:1.1rem;margin-bottom:4px">💳 Storefront Subscription</h2>
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:20px">Choose your plan and pay securely via MTN/Vodafone MoMo or wallet.</p>

      <!-- Plan selector -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">
        ${Object.entries(STOREFRONT_PLANS).map(([key, p]) => `
          <label style="cursor:pointer">
            <input type="radio" name="sub-plan" value="${key}" ${key === preSelectedPlan ? 'checked' : ''} style="display:none" onchange="window.updateSubModalTotal('${storeId}','${store.name || ''}')"/>
            <div id="sub-plan-card-${key}" onclick="this.previousElementSibling.checked=true;window.updateSubModalTotal('${storeId}','${store.name || ''}')" style="border:2px solid ${key === preSelectedPlan ? 'var(--primary)' : 'var(--border)'};border-radius:10px;padding:10px 8px;text-align:center;transition:.2s">
              <div style="font-size:1.2rem">${p.icon}</div>
              <div style="font-weight:800;font-size:.8rem">${p.name}</div>
              <div style="font-size:.85rem;font-weight:700;color:${p.color}">GH₵${p.price}</div>
              <div style="font-size:.65rem;color:var(--text-muted)">/month</div>
            </div>
          </label>
        `).join('')}
      </div>

      <!-- Duration picker -->
      <div style="margin-bottom:16px">
        <label style="font-size:.8rem;font-weight:700;margin-bottom:6px;display:block">Billing Duration</label>
        <select id="sub-duration" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem" onchange="window.updateSubModalTotal('${storeId}','${store.name || ''}')">
          <option value="1">1 Month</option>
          <option value="3">3 Months (save 5%)</option>
          <option value="6">6 Months (save 10%)</option>
          <option value="12">12 Months (save 15%)</option>
        </select>
      </div>

      <!-- Payment method -->
      <div style="margin-bottom:16px">
        <label style="font-size:.8rem;font-weight:700;margin-bottom:6px;display:block">Payment Method</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style="cursor:pointer">
            <input type="radio" name="sub-pay" value="momo" checked style="display:none"/>
            <div id="sub-pay-momo" onclick="document.querySelector('[name=sub-pay][value=momo]').checked=true;document.getElementById('sub-momo-field').style.display='';document.getElementById('sub-wallet-field').style.display='none';document.getElementById('sub-pay-momo').style.borderColor='var(--primary)';document.getElementById('sub-pay-wallet').style.borderColor='var(--border)'" style="border:2px solid var(--primary);border-radius:8px;padding:10px;text-align:center;font-size:.8rem;font-weight:700">
              📱 MoMo
            </div>
          </label>
          <label style="cursor:pointer">
            <input type="radio" name="sub-pay" value="wallet" style="display:none"/>
            <div id="sub-pay-wallet" onclick="document.querySelector('[name=sub-pay][value=wallet]').checked=true;document.getElementById('sub-momo-field').style.display='none';document.getElementById('sub-wallet-field').style.display='';document.getElementById('sub-pay-wallet').style.borderColor='var(--primary)';document.getElementById('sub-pay-momo').style.borderColor='var(--border)'" style="border:2px solid var(--border);border-radius:8px;padding:10px;text-align:center;font-size:.8rem;font-weight:700">
              💰 HAPPA Wallet
            </div>
          </label>
        </div>
      </div>

      <div id="sub-momo-field" style="margin-bottom:16px">
        <label style="font-size:.8rem;font-weight:700;margin-bottom:6px;display:block">MoMo Phone Number</label>
        <input id="sub-momo-phone" type="tel" placeholder="e.g. 024 000 0000" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;box-sizing:border-box"/>
        <div style="font-size:.7rem;color:var(--text-muted);margin-top:4px">MTN MoMo, Vodafone Cash, AirtelTigo accepted</div>
      </div>

      <div id="sub-wallet-field" style="margin-bottom:16px;display:none">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:.82rem;color:#14532d">
          <i class="fas fa-info-circle"></i> Payment will be deducted from your HAPPA Wallet balance at checkout.
        </div>
      </div>

      <!-- Total summary -->
      <div id="sub-total-summary" style="background:var(--bg);border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:.82rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span>Plan</span><span id="sub-total-plan" style="font-weight:700">Growth — GH₵59</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span>Duration</span><span id="sub-total-months" style="font-weight:700">1 month</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span>Discount</span><span id="sub-total-discount" style="font-weight:700;color:#16a34a">—</span>
        </div>
        <hr style="margin:8px 0;border-color:var(--border)"/>
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:.9rem">
          <span>Total Due</span><span id="sub-total-amount" style="color:var(--primary)">GH₵ 59.00</span>
        </div>
      </div>

      <button onclick="window.confirmStorefrontSubscription('${storeId}')" style="width:100%;padding:13px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:.9rem;cursor:pointer">
        <i class="fas fa-lock"></i> Confirm & Pay
      </button>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  window.updateSubModalTotal(storeId, store.name || '');
};

window.updateSubModalTotal = function(storeId, storeName) {
  const selectedPlan = document.querySelector('[name="sub-plan"]:checked');
  const durationEl = document.getElementById('sub-duration');
  if (!selectedPlan || !durationEl) return;

  const planKey = selectedPlan.value;
  const plan = STOREFRONT_PLANS[planKey];
  const months = parseInt(durationEl.value, 10);

  // Update card highlights
  Object.keys(STOREFRONT_PLANS).forEach(k => {
    const card = document.getElementById('sub-plan-card-' + k);
    if (card) card.style.borderColor = (k === planKey) ? 'var(--primary)' : 'var(--border)';
  });

  const discountPct = months >= 12 ? 15 : months >= 6 ? 10 : months >= 3 ? 5 : 0;
  const base = plan.price * months;
  const discount = Math.round(base * discountPct / 100 * 100) / 100;
  const total = (base - discount).toFixed(2);

  const planEl = document.getElementById('sub-total-plan');
  const monthsEl = document.getElementById('sub-total-months');
  const discEl = document.getElementById('sub-total-discount');
  const totEl = document.getElementById('sub-total-amount');

  if (planEl) planEl.textContent = `${plan.name} — GH₵${plan.price}/mo`;
  if (monthsEl) monthsEl.textContent = `${months} month${months > 1 ? 's' : ''}`;
  if (discEl) discEl.textContent = discountPct ? `-GH₵${discount.toFixed(2)} (${discountPct}%)` : '—';
  if (totEl) totEl.textContent = `GH₵ ${total}`;
};

window.confirmStorefrontSubscription = async function(storeId) {
  const selectedPlan = document.querySelector('[name="sub-plan"]:checked');
  const payMethod = document.querySelector('[name="sub-pay"]:checked');
  const durationEl = document.getElementById('sub-duration');
  if (!selectedPlan || !durationEl) return;

  const planKey = selectedPlan.value;
  const plan = STOREFRONT_PLANS[planKey];
  const months = parseInt(durationEl.value, 10);
  const method = payMethod ? payMethod.value : 'momo';

  if (method === 'momo') {
    const phone = document.getElementById('sub-momo-phone')?.value?.trim();
    if (!phone || phone.replace(/\D/g,'').length < 9) {
      showToast('Please enter a valid MoMo phone number.', 'error');
      return;
    }
  }

  const discountPct = months >= 12 ? 15 : months >= 6 ? 10 : months >= 3 ? 5 : 0;
  const base = plan.price * months;
  const discount = Math.round(base * discountPct / 100 * 100) / 100;
  const total = (base - discount).toFixed(2);

  // Calculate new expiry
  const idx = App.allStores.findIndex(s => String(s.id) === String(storeId));
  if (idx === -1) { showToast('Store not found.', 'error'); return; }

  const now = new Date();
  const currentEnd = App.allStores[idx].subscription_end ? new Date(App.allStores[idx].subscription_end) : null;
  const startFrom = (currentEnd && currentEnd > now) ? currentEnd : now;
  const newEnd = new Date(startFrom);
  newEnd.setMonth(newEnd.getMonth() + months);

  document.getElementById('storefront-sub-modal')?.remove();
  showToast(`Processing GH₵${total} payment via ${method === 'momo' ? 'MTN MoMo' : 'HAPPA Wallet'}...`, 'info');

  // Simulate payment processing
  await new Promise(r => setTimeout(r, 1800));

  // Update store subscription fields
  App.allStores[idx].subscription_plan = planKey;
  App.allStores[idx].subscription_status = 'active';
  App.allStores[idx].subscription_start = now.toISOString();
  App.allStores[idx].subscription_end = newEnd.toISOString();
  App.allStores[idx].subscription_months = months;
  App.allStores[idx].subscription_method = method;

  try { localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores)); } catch(e){}

  await apiPatch('stores', storeId, {
    subscription_plan: planKey,
    subscription_status: 'active',
    subscription_start: now.toISOString(),
    subscription_end: newEnd.toISOString()
  }).catch(() => {});

  // If storefront wasn't active yet, set to draft so vendor can customize and submit
  if (App.myStorefront) {
    if (App.myStorefront.status === 'inactive') {
      App.myStorefront.status = 'draft';
      const sfIdx = App.allStorefronts ? App.allStorefronts.findIndex(s => String(s.id) === String(App.myStorefront.id)) : -1;
      if (sfIdx !== -1) App.allStorefronts[sfIdx].status = 'draft';
      try { localStorage.setItem('happa_all_storefronts', JSON.stringify(App.allStorefronts)); } catch(e){}
      await apiPatch('storefronts', App.myStorefront.id, { status: 'draft' }).catch(() => {});
    }
  }

  showToast(`🎉 ${plan.name} plan activated! Storefront subscription runs until ${newEnd.toLocaleDateString()}.`, 'success');

  // Notify admin of subscription payment
  if (typeof addNotification === 'function') {
    addNotification('u-admin-001', 'system', '💳 Storefront Subscription Payment', `${App.allStores[idx].name} subscribed to the ${plan.name} plan (GH₵${total}) via ${method === 'momo' ? 'MoMo' : 'Wallet'}.`);
  }

  renderVendorDashboard();
};

window.showSubscriptionDetails = function(storeId) {
  const store = App.allStores.find(s => String(s.id) === String(storeId));
  if (!store) return;
  window.openStorefrontSubscribeModal(storeId, store.subscription_plan || 'growth', (STOREFRONT_PLANS[store.subscription_plan] || STOREFRONT_PLANS.growth).price);
};

// Check if a storefront subscription is valid
window.isStorefrontSubscriptionActive = function(store) {
  if (!store) return false;
  if (store.subscription_status !== 'active') return false;
  if (!store.subscription_end) return false;
  return new Date(store.subscription_end) > new Date();
};


