/* ============================================================
   HAPPA TRADEMART — Admin Dashboard
   ============================================================ */

async function renderAdminDashboard() {
  const c = document.getElementById('admin-dashboard-content');
  if (!c) return;
  if (!App.currentUser || App.currentUser.role !== 'admin') {
    c.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Admin Access Only</h3></div>';
    return;
  }

  // Fetch all data in parallel
  const [usersRes, storesRes, productsRes, ordersRes, pkgsRes] = await Promise.all([
    apiGet('users',    'limit=200'),
    apiGet('stores',   'limit=200'),
    apiGet('products', 'limit=200'),
    apiGet('orders',   'limit=200'),
    apiGet('packages', 'limit=200')
  ]);

  const allUsers    = usersRes?.data    || [];
  const allStores   = storesRes?.data   || [];
  const allProducts = productsRes?.data || [];
  const allOrders   = ordersRes?.data   || [];
  const allPkgs     = pkgsRes?.data     || [];

  App.allStores   = allStores;
  App.allProducts = allProducts;

  const buyers         = allUsers.filter(u => u.role === 'buyer');
  const vendors        = allUsers.filter(u => u.role === 'vendor');
  const rendors        = allUsers.filter(u => u.role === 'rendor');
  const pendingVendors = allUsers.filter(u => u.role === 'vendor' && u.status === 'pending_approval');
  const pendingRendors = allUsers.filter(u => u.role === 'rendor' && u.status === 'pending_approval');
  const pendingStores  = allStores.filter(s => s.status === 'pending');
  const pendingStorefronts = allStores.filter(s => s.storefront_status === 'pending_approval');
  const totalRevenue   = allOrders.reduce((s, o) => s + (o.platform_fee || 0), 0);
  const pendingAll     = pendingVendors.length + pendingRendors.length;

  c.innerHTML = `
<div class="tab-nav" id="admin-tabs">
  <div class="tab-btn active" onclick="switchTab(this,'admin-overview')">Overview</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-vendors');refreshAdminVendorsFull()">
    Vendors ${pendingAll ? `<span style="background:var(--danger);color:#fff;border-radius:10px;padding:1px 6px;font-size:.65rem;margin-left:3px">${pendingAll}</span>` : ''}
  </div>
  <div class="tab-btn" onclick="switchTab(this,'admin-rendors');loadAdminRendors()">
    Rendors ${pendingRendors.length ? `<span style="background:#7c3aed;color:#fff;border-radius:10px;padding:1px 6px;font-size:.65rem;margin-left:3px">${pendingRendors.length}</span>` : ''}
  </div>
  <div class="tab-btn" onclick="switchTab(this,'admin-storefronts');renderAdminStorefronts()">
    Storefronts ${pendingStorefronts.length ? `<span style="background:#ea580c;color:#fff;border-radius:10px;padding:1px 6px;font-size:.65rem;margin-left:3px">${pendingStorefronts.length}</span>` : ''}
  </div>
  <div class="tab-btn" onclick="switchTab(this,'admin-users');refreshAdminUsersList()">Users</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-orders');refreshAdminOrdersList()">Orders</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-create-store')">Add Vendor</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-analytics')">Analytics</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-wallet');renderAdminTransactions('admin-txn-wrap')">Wallet</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-ads');loadAdminAds()">🎯 Ads</div>
  <div class="tab-btn" onclick="switchTab(this,'admin-settings');loadAdminSettings()">Settings</div>
</div>

<!-- ── Ads Manager ── -->
<div class="tab-content" id="admin-ads">
  <div class="dashboard-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div>
        <h3 style="font-size:.95rem;font-weight:700">🎯 Ad Banner Manager</h3>
        <p style="font-size:.78rem;color:var(--text-muted);margin-top:2px">Choose stores whose products appear on the ad banners across Home, Shop &amp; Stores pages.</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="showAddAdCampaignModal()">
        <i class="fas fa-plus"></i> New Campaign
      </button>
    </div>
    <div id="admin-ads-list">
      <div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
    </div>
  </div>
</div>

<!-- ── Overview ── -->
<div class="tab-content active" id="admin-overview">
  <div class="dashboard-wrap">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:#dbeafe"><i class="fas fa-users" style="color:#1d4ed8"></i></div>
        <div class="stat-value">${allUsers.length}</div>
        <div class="stat-label">Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fef9c3"><i class="fas fa-store" style="color:#ca8a04"></i></div>
        <div class="stat-value">${allStores.length}</div>
        <div class="stat-label">Stores</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#d1fae5"><i class="fas fa-shopping-bag" style="color:var(--success)"></i></div>
        <div class="stat-value">${allOrders.length}</div>
        <div class="stat-label">Total Orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#ede9fe"><i class="fas fa-coins" style="color:#7c3aed"></i></div>
        <div class="stat-value">GHS ${totalRevenue.toFixed(0)}</div>
        <div class="stat-label">Platform Revenue</div>
      </div>
    </div>

    <div class="stats-grid" style="margin-top:0">
      <div class="stat-card">
        <div class="stat-icon" style="background:#fef3c7"><i class="fas fa-user-check" style="color:#d97706"></i></div>
        <div class="stat-value">${buyers.length}</div>
        <div class="stat-label">Buyers</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fce7f3"><i class="fas fa-store" style="color:#be185d"></i></div>
        <div class="stat-value">${vendors.length}</div>
        <div class="stat-label">Vendors</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#ffedd5"><i class="fas fa-clock" style="color:#ea580c"></i></div>
        <div class="stat-value">${pendingStores.length}</div>
        <div class="stat-label">Pending Stores</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dcfce7"><i class="fas fa-boxes" style="color:#16a34a"></i></div>
        <div class="stat-value">${allProducts.length}</div>
        <div class="stat-label">Products</div>
      </div>
    </div>

    <!-- Preview Banner -->
    <div style="background:linear-gradient(90deg,#dbeafe,#ede9fe);border:1.5px solid #93c5fd;border-radius:var(--radius-md);padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <i class="fas fa-eye" style="color:#1d4ed8;font-size:1rem;flex-shrink:0"></i>
      <div style="flex:1;font-size:.82rem;color:#1e3a8a">
        <strong>Preview Mode:</strong> Browse the platform as a regular user or vendor would see it.
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" style="background:#1d4ed8;color:#fff;border:none" onclick="previewAsRole('buyer')">
          <i class="fas fa-user"></i> Preview as Buyer
        </button>
        <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none" onclick="previewAsRole('vendor')">
          <i class="fas fa-store"></i> Preview as Vendor
        </button>
        <button class="btn btn-sm btn-outline" style="border-color:var(--primary);color:var(--primary)" onclick="window.triggerPWAInstall()">
          <i class="fas fa-download"></i> Install App
        </button>
      </div>
    </div>

    <h3 style="font-size:.9rem;font-weight:700;margin:16px 0 10px">Admin Actions</h3>
    <div class="admin-actions-grid">
      <div class="admin-action-btn" onclick="switchTab(document.querySelector('[onclick*=admin-vendors]'),'admin-vendors');refreshAdminVendorsFull()">
        <i class="fas fa-store"></i><span>Manage Vendors</span>
      </div>
      <div class="admin-action-btn" onclick="switchTab(document.querySelector('[onclick*=admin-create-store]'),'admin-create-store')">
        <i class="fas fa-plus-circle"></i><span>Add Vendor</span>
      </div>
      <div class="admin-action-btn" onclick="switchTab(document.querySelector('[onclick*=admin-users]'),'admin-users')">
        <i class="fas fa-users"></i><span>Manage Users</span>
      </div>
      <div class="admin-action-btn" onclick="switchTab(document.querySelector('[onclick*=admin-analytics]'),'admin-analytics')">
        <i class="fas fa-chart-bar"></i><span>Analytics</span>
      </div>
      <div class="admin-action-btn" onclick="showAdminReviewsModal()">
        <i class="fas fa-star-half-alt"></i><span>Reviews</span>
      </div>
      <div class="admin-action-btn" onclick="switchTab(document.querySelector('[onclick*=admin-wallet]'),'admin-wallet');renderAdminTransactions('admin-txn-wrap')">
        <i class="fas fa-money-bill-wave"></i><span>Withdrawals</span>
      </div>
      <div class="admin-action-btn" onclick="showPage('delivery')">
        <i class="fas fa-truck"></i><span>Delivery Rates</span>
      </div>
    </div>

    ${pendingVendors.length ? `
    <div class="verify-banner" style="margin-top:8px;background:linear-gradient(90deg,#fef3c7,#fde68a);border-color:#f59e0b">
      <i class="fas fa-user-clock" style="color:#b45309"></i>
      <p style="color:#78350f"><strong>${pendingVendors.length} vendor(s)</strong> awaiting approval.
        <a href="#" onclick="switchTab(document.querySelector('[onclick*=admin-vendors]'),'admin-vendors');refreshAdminVendorsFull()"
           style="color:#b45309;font-weight:700">Approve now →</a></p>
    </div>` : ''}
    ${pendingRendors.length ? `
    <div class="verify-banner" style="margin-top:8px;background:linear-gradient(90deg,#ede9fe,#ddd6fe);border-color:#a78bfa">
      <i class="fas fa-briefcase" style="color:#7c3aed"></i>
      <p style="color:#4c1d95"><strong>${pendingRendors.length} rendor(s)</strong> awaiting approval.
        <a href="#" onclick="switchTab(document.querySelector('[onclick*=admin-rendors]'),'admin-rendors');loadAdminRendors()"
           style="color:#7c3aed;font-weight:700">Approve now →</a></p>
    </div>` : ''}

    <div class="card" style="margin-top:16px">
      <div class="card-header"><h3>📊 Weekly Revenue</h3></div>
      <div class="card-body"><div class="chart-container"><canvas id="admin-revenue-chart"></canvas></div></div>
    </div>
  </div>
</div>

<!-- ── Vendors (merged vendors + stores) ── -->
<div class="tab-content" id="admin-vendors">
  <div class="dashboard-wrap">

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:.78rem;color:var(--text-muted);background:var(--primary-light);padding:7px 10px;border-radius:var(--radius-sm);flex:1;min-width:200px">
        <i class="fas fa-info-circle"></i> Every vendor has exactly one store. Creating a vendor creates their store too.
      </div>
      <button class="btn btn-primary btn-sm"
              onclick="switchTab(document.querySelector('[onclick*=admin-create-store]'),'admin-create-store')">
        <i class="fas fa-plus"></i> Add Vendor
      </button>
    </div>

    ${pendingVendors.length ? `
    <div style="margin-bottom:16px">
      <h3 style="font-weight:700;margin:0 0 8px;font-size:.88rem;color:#b45309">
        <i class="fas fa-user-clock"></i> Pending Approval (${pendingVendors.length})
      </h3>
      ${pendingVendors.map(v => adminPendingVendorRowHTML(v)).join('')}
      <hr style="border-color:var(--border);margin:16px 0">
    </div>` : ''}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="font-weight:700;margin:0;font-size:.88rem">All Vendors &amp; Stores (${vendors.length})</h3>
    </div>
    <div id="admin-vendors-list">
      ${vendors.length
        ? vendors.map(v => adminVendorWithStoreRowHTML(v, allStores, allUsers)).join('')
        : '<div class="empty-state" style="padding:24px 0"><i class="fas fa-store-slash"></i><h3>No vendors yet</h3><p>Add the first vendor using the button above</p></div>'}
    </div>
  </div>
</div>

<!-- ── Rendors Tab ── -->
<div class="tab-content" id="admin-rendors">
  <div class="dashboard-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-size:.78rem;color:var(--text-muted);background:#ede9fe;padding:7px 10px;border-radius:var(--radius-sm);flex:1;min-width:200px">
        <i class="fas fa-info-circle" style="color:#7c3aed"></i> Rendors offer services (writing, design, tutoring…) rather than physical products.
      </div>
    </div>
    <div id="admin-rendors-content">
      <div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
    </div>
  </div>
</div>

<!-- ── Storefronts Tab ── -->
<div class="tab-content" id="admin-storefronts">
  <div class="dashboard-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div>
        <h3 style="font-size:.95rem;font-weight:700">🎨 Custom Storefront Requests</h3>
        <p style="font-size:.78rem;color:var(--text-muted);margin-top:2px">Review and approve storefront configurations requested by vendors.</p>
      </div>
    </div>
    <div id="admin-storefronts-list">
      <div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
    </div>
  </div>
</div>

<!-- ── Users Management ── -->
<div class="tab-content" id="admin-users">
  <div class="dashboard-wrap">
    <div style="margin-bottom:12px">
      <input class="form-control" id="admin-user-search"
             placeholder="Search users by name, email or phone…"
             oninput="filterAdminUsers(this.value,${JSON.stringify(allUsers).replace(/"/g,'&quot;')})">
    </div>
    <div id="admin-users-list">
      ${allUsers.map(u => adminUserRowHTML(u)).join('')}
    </div>
  </div>
</div>

<!-- ── Orders ── -->
<div class="tab-content" id="admin-orders">
  <div class="dashboard-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="font-weight:700;margin:0">All Order Packages (${allPkgs.length})</h3>
      <button class="btn btn-ghost btn-sm" onclick="refreshAdminOrdersList()">
        <i class="fas fa-sync-alt"></i> Refresh
      </button>
    </div>
    <div id="admin-orders-list">
      ${allPkgs.length
        ? allPkgs.map(pkg => adminPackageRowHTML(pkg, allUsers)).join('')
        : '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No packages yet</h3></div>'}
    </div>
  </div>
</div>

<!-- ── Add Vendor (+ auto-create store) ── -->
<div class="tab-content" id="admin-create-store">
  <div class="dashboard-wrap">
    <div style="background:linear-gradient(90deg,#dbeafe,#ede9fe);border:1.5px solid #93c5fd;border-radius:var(--radius-md);padding:10px 14px;margin-bottom:14px;font-size:.82rem;color:#1e3a8a">
      <i class="fas fa-info-circle"></i> <strong>Every vendor = one store.</strong> Creating a vendor here automatically creates their store. The vendor logs in with the credentials you set.
    </div>
    <div class="card">
      <div class="card-header"><h3>➕ Add Vendor &amp; Store</h3></div>
      <div class="card-body">
        <form onsubmit="adminCreateStore(event)" id="create-store-form">

          <!-- ── Store Details ── -->
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px;color:var(--primary)">
            <i class="fas fa-store"></i> Store Details
          </div>
          <div class="form-group">
            <label class="form-label">Store Name *</label>
            <input class="form-control" id="a-store-name" placeholder="e.g. TechHub Accra" required>
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-control" id="a-store-desc" rows="2" placeholder="Brief description of the store…"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Location *</label>
            <select class="form-control form-select" id="a-store-loc" required>
              <option value="">Select city…</option>
              ${LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <select class="form-control form-select" id="a-store-cat">
              ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Store Price (GHS)</label>
            <input class="form-control" id="a-store-price" type="number" value="500" min="0">
            <div class="form-hint">Set to 0 for a free store.</div>
          </div>
          <div class="form-group">
            <label class="form-label">Keywords <span style="color:var(--text-muted)">(comma separated)</span></label>
            <input class="form-control" id="a-store-kws" placeholder="e.g. shoes, sneakers, footwear">
          </div>

          <!-- ── Store Logo ── -->
          <div class="form-group">
            <label class="form-label">Store Logo <span style="color:var(--text-muted)">(optional)</span></label>
            <div class="upload-area" onclick="document.getElementById('a-logo-file').click()" style="cursor:pointer">
              <i class="fas fa-image" style="color:var(--primary)"></i>
              <p>Tap to choose logo from gallery</p>
              <p style="font-size:.72rem;color:var(--text-muted)">JPG, PNG or WEBP · Max 2MB · Recommended: square image</p>
            </div>
            <input type="file" id="a-logo-file" accept="image/*" style="display:none"
                   onchange="previewProductImage(this,'a-logo-preview','a-logo-b64')">
            <div id="a-logo-preview" style="margin-top:8px;display:none;align-items:center;gap:8px">
              <img id="a-logo-thumb" style="width:60px;height:60px;border-radius:8px;object-fit:cover;border:2px solid var(--border)">
              <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)"
                      onclick="clearProductImage('a-logo-preview','a-logo-file','a-logo-b64')">
                <i class="fas fa-times"></i> Remove
              </button>
            </div>
            <input type="hidden" id="a-logo-b64">
          </div>

          <!-- ── Store Banner ── -->
          <div class="form-group">
            <label class="form-label">Store Banner <span style="color:var(--text-muted)">(optional)</span></label>
            <div class="upload-area" onclick="document.getElementById('a-banner-file').click()" style="cursor:pointer">
              <i class="fas fa-panorama" style="color:var(--primary)"></i>
              <p>Tap to choose banner from gallery</p>
              <p style="font-size:.72rem;color:var(--text-muted)">JPG, PNG or WEBP · Max 3MB · Recommended: 800×200</p>
            </div>
            <input type="file" id="a-banner-file" accept="image/*" style="display:none"
                   onchange="previewProductImage(this,'a-banner-preview','a-banner-b64')">
            <div id="a-banner-preview" style="margin-top:8px;display:none;align-items:center;gap:8px">
              <img id="a-banner-thumb" style="width:100%;height:70px;object-fit:cover;border-radius:8px;border:2px solid var(--border)">
              <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);margin-top:4px"
                      onclick="clearProductImage('a-banner-preview','a-banner-file','a-banner-b64')">
                <i class="fas fa-times"></i> Remove
              </button>
            </div>
            <input type="hidden" id="a-banner-b64">
          </div>

          <!-- ── Vendor Account ── -->
          <hr style="border-color:var(--border);margin:16px 0">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px;color:var(--primary)">
            <i class="fas fa-user-tie"></i> Vendor Account
          </div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:10px;background:var(--primary-light);padding:8px 10px;border-radius:var(--radius-sm)">
            <i class="fas fa-info-circle"></i> Fill in OR leave blank to assign an existing vendor by email below.
          </div>
          <div class="form-group">
            <label class="form-label">Vendor Full Name *</label>
            <input class="form-control" id="a-new-vendor-name" placeholder="e.g. Kofi Asante">
          </div>
          <div class="form-group">
            <label class="form-label">Vendor Email *</label>
            <input class="form-control" id="a-new-vendor-email" type="email" placeholder="vendor@email.com">
          </div>
          <div class="form-group">
            <label class="form-label">Phone Number</label>
            <input class="form-control" id="a-new-vendor-phone" type="tel" placeholder="+233 24 000 0000">
          </div>
          <div class="form-group">
            <label class="form-label">Login Password *</label>
            <input class="form-control" id="a-new-vendor-pass" type="text" placeholder="Set a login password for the vendor"
                   autocomplete="new-password">
            <div class="form-hint">Share this with the vendor — they use it to log in and start selling.</div>
          </div>

          <div style="font-size:.8rem;font-weight:600;color:var(--text-muted);margin:6px 0 10px;text-align:center">— OR assign existing vendor —</div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Existing Vendor Email <span style="color:var(--text-muted)">(overrides fields above if found)</span></label>
            <input class="form-control" id="a-store-vendor" placeholder="existing-vendor@email.com"
                   oninput="previewCreateStoreVendor(this.value)">
            <div id="a-vendor-preview" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);font-size:.82rem"></div>
          </div>

          <button class="btn btn-primary btn-block" type="submit" id="a-create-btn">
            <i class="fas fa-plus-circle"></i> Create Store
          </button>
        </form>
      </div>
    </div>
  </div>
</div>

<!-- ── Analytics ── -->
<div class="tab-content" id="admin-analytics">
  <div class="dashboard-wrap">
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-icon" style="background:#d1fae5"><i class="fas fa-money-bill-wave" style="color:var(--success)"></i></div>
        <div class="stat-value">GHS ${allOrders.reduce((s,o)=>s+(o.total||0),0).toLocaleString()}</div>
        <div class="stat-label">Gross Revenue</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dbeafe"><i class="fas fa-percentage" style="color:#1d4ed8"></i></div>
        <div class="stat-value">GHS ${totalRevenue.toFixed(0)}</div>
        <div class="stat-label">Platform Fees</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>📊 Orders by Location</h3></div>
      <div class="card-body"><div class="chart-container"><canvas id="admin-loc-chart"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>🏆 Top Stores by Revenue</h3></div>
      <div class="card-body" style="padding:0">
        ${allStores.sort((a,b)=>(b.total_sales||0)-(a.total_sales||0)).slice(0,5).map((s,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">
          <span style="font-weight:700;color:var(--text-muted);width:16px">${i+1}</span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:.875rem">${escHtml(s.name)}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">${s.location} · ${s.total_orders||0} orders</div>
          </div>
          <span style="font-weight:700;color:var(--primary)">GHS ${(s.total_sales||0).toLocaleString()}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>
</div>

<!-- ── Wallet / Transactions ── -->
<div class="tab-content" id="admin-wallet">
  <div class="dashboard-wrap">
    <h3 style="font-weight:700;margin-bottom:14px">💸 Wallet Transactions</h3>
    <div id="admin-txn-wrap">
      <div style="text-align:center;padding:30px;color:var(--text-muted)">
        <i class="fas fa-spinner fa-spin"></i> Loading…
      </div>
    </div>
  </div>
</div>

<!-- ── Settings ── -->
<!-- ── Platform Settings ── -->
<div class="tab-content" id="admin-settings">
  <div class="dashboard-wrap">
    <h3 style="font-weight:700;margin-bottom:4px">⚙️ Platform Settings</h3>
    <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:16px">Changes take effect immediately after saving.</p>
    <form onsubmit="saveAdminSettings(event)">

      <!-- 2. Commission & Fees -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <h3>💰 Delivery Fees</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Delivery Fee — Same City (GHS)</label>
            <input class="form-control" id="setting-delivery-local" type="number" min="0" step="0.5" value="5">
            <div class="form-hint">Base fee for deliveries within the same city</div>
          </div>
          <div class="form-group">
            <label class="form-label">Delivery Fee — Intercity (GHS)</label>
            <input class="form-control" id="setting-delivery-intercity" type="number" min="0" step="0.5" value="15">
            <div class="form-hint">Base fee for deliveries between cities</div>
          </div>
          <div class="form-group">
            <label class="form-label">Free Delivery Threshold (GHS)</label>
            <input class="form-control" id="setting-free-delivery-threshold" type="number" min="0" value="200">
            <div class="form-hint">Order total above which delivery is free (0 to disable)</div>
          </div>
        </div>
      </div>

      <!-- 3. Wallet & Withdrawals -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <h3>💳 Wallet & Withdrawals</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Minimum Withdrawal Amount (GHS)</label>
            <input class="form-control" id="setting-min-withdrawal" type="number" min="1" value="50">
            <div class="form-hint">Minimum amount vendors can withdraw from their wallet</div>
          </div>
          <div class="form-group">
            <label class="form-label">Maximum Pending Withdrawals</label>
            <input class="form-control" id="setting-max-pending-withdrawals" type="number" min="1" value="3">
            <div class="form-hint">Max number of open withdrawal requests a vendor can have at once</div>
          </div>
          <div class="form-group">
            <label class="form-label">Withdrawal Processing Days</label>
            <input class="form-control" id="setting-withdrawal-days" type="number" min="1" max="14" value="2">
            <div class="form-hint">Business days to process a withdrawal request</div>
          </div>
        </div>
      </div>

      <!-- 4. Referral Programme -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <h3>🎁 Referral Programme</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Default Referral Reward (%)</label>
            <input class="form-control" id="setting-referral-reward-pct" type="number" min="0" max="20" step="0.5" value="3">
            <div class="form-hint">Fallback rate — overridden by referral commission tiers if set</div>
          </div>
        </div>
      </div>

      <!-- 5. Commission Tiers -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <h3>📊 Commission Tiers</h3>
        </div>
        <div class="card-body">
          <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">
            Set both <strong>sales</strong> and <strong>referral</strong> commission percentages per price range.
          </p>

          <!-- Sales Commission Tiers -->
          <div style="font-weight:700;font-size:.82rem;margin-bottom:8px;color:var(--text)">🏷️ Sales Commission (Platform % per sale)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;font-size:.72rem;font-weight:700;color:var(--text-muted);padding:0 2px">
            <span>Min (GHS)</span><span>Max (GHS)</span><span>Platform %</span><span></span>
          </div>
          <div id="commission-tiers-list">
            <!-- Tiers rendered by renderCommissionTiersEditor() -->
          </div>
          <button type="button" class="btn btn-outline btn-sm" style="margin-top:6px" onclick="addCommissionTier()">
            <i class="fas fa-plus"></i> Add Sales Tier
          </button>

          <hr style="border-color:var(--border);margin:16px 0">

          <!-- Referral Commission Tiers -->
          <div style="font-weight:700;font-size:.82rem;margin-bottom:8px;color:var(--text)">🎁 Referral Commission (Referrer earns per purchase)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;font-size:.72rem;font-weight:700;color:var(--text-muted);padding:0 2px">
            <span>Min (GHS)</span><span>Max (GHS)</span><span>Referrer %</span><span></span>
          </div>
          <div id="referral-commission-tiers-list">
            <!-- Referral tiers rendered by renderReferralCommissionTiersEditor() -->
          </div>
          <button type="button" class="btn btn-outline btn-sm" style="margin-top:6px" onclick="addReferralCommissionTier()">
            <i class="fas fa-plus"></i> Add Referral Tier
          </button>

          <div style="margin-top:12px;padding:8px;background:var(--bg);border-radius:var(--radius-sm);font-size:.78rem;color:var(--text-muted)">
            <i class="fas fa-info-circle" style="color:var(--primary)"></i>
            Use <strong>99999</strong> as Max for the last tier (unlimited). Changes apply to new orders only.
          </div>
        </div>
      </div>

      <!-- 6. Vendor Requirements -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <h3>🆔 Vendor Verification Requirements</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="setting-require-phone-verify" checked style="width:16px;height:16px">
              Require Phone Verification to sell
            </label>
            <div class="form-hint">Vendors must verify phone before listing products</div>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="setting-require-id-verify" checked style="width:16px;height:16px">
              Require ID Verification to withdraw
            </label>
            <div class="form-hint">Vendors must upload ID before making withdrawals</div>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="setting-vendor-auto-approve" style="width:16px;height:16px">
              Auto-approve new vendor registrations
            </label>
            <div class="form-hint">Skip manual approval — vendors go active immediately (not recommended)</div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-block" type="submit">
        <i class="fas fa-save"></i> Save All Settings
      </button>
      <div id="settings-saved-msg" style="display:none;text-align:center;margin-top:10px;color:var(--success);font-size:.85rem;font-weight:600">
        <i class="fas fa-check-circle"></i> Settings saved successfully!
      </div>
    </form>

    <!-- Platform Announcement — separate card outside the settings form -->
    <div class="card" style="margin-top:20px;border:2px solid #fde68a">
      <div class="card-header" style="background:linear-gradient(90deg,#fef9c3,#fef3c7)">
        <h3 style="color:#92400e">📢 Platform Announcement</h3>
        <span style="font-size:.72rem;color:#92400e;font-weight:600">Broadcast to all users</span>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Announcement Type</label>
          <select class="form-control form-select" id="setting-announcement-type">
            <option value="info">ℹ️ Info (blue)</option>
            <option value="success">✅ Success (green)</option>
            <option value="warning">⚠️ Warning (yellow)</option>
            <option value="danger">🚨 Urgent (red)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Announcement Message</label>
          <textarea class="form-control" id="setting-announcement-text" rows="3"
            placeholder="e.g. 🎉 Flash sale this weekend — up to 50% off selected stores!"></textarea>
          <div class="form-hint">This banner will appear on the home &amp; marketplace page for all users</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="setting-announcement-active" style="width:16px;height:16px">
            Show banner live
          </label>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)"
                  onclick="clearAnnouncement()">
            <i class="fas fa-times"></i> Clear
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="sendAnnouncement()">
            <i class="fas fa-paper-plane"></i> Send Announcement
          </button>
        </div>
        <div id="announcement-sent-msg" style="display:none;margin-top:8px;color:var(--success);font-size:.8rem;font-weight:600">
          <i class="fas fa-check-circle"></i> Announcement sent!
        </div>
      </div>
    </div>

    <!-- ── Storefronts Tab ── -->
    <div class="tab-content" id="admin-storefronts">
      <div class="dashboard-wrap">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:14px">Storefront Launch Requests</h3>
        <div id="admin-storefronts-list">
          <div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
        </div>
      </div>
    </div>

  </div>
</div>`;

  setTimeout(() => {
    renderAdminRevenueChart(allOrders);
    renderAdminLocationChart(allOrders);
  }, 200);
}

// ── Store row card ─────────────────────────────────────────
function adminStoreRowHTML(s, allUsers) {
  const vendor = allUsers.find(u => u.id === s.vendor_id);
  const isUnassigned = !s.vendor_id || s.vendor_id === '';
  const intendedEmail = s.intended_vendor_email || '';

  return `
<div class="card" style="margin-bottom:10px" id="store-row-${s.id}">
  <div class="card-body">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <img src="${s.logo_url||'https://via.placeholder.com/50x50?text=S'}"
           style="width:46px;height:46px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0"
           onerror="this.src='https://via.placeholder.com/50x50?text=S'">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.9rem">${escHtml(s.name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">
          ${s.location} · ${s.category || 'General'}
        </div>
        <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px">
          Price: <strong>GHS ${(s.store_price||0).toFixed(0)}</strong>
          ${s.is_paid ? ' · <span style="color:var(--success)">Paid ✓</span>' : ' · <span style="color:var(--warning)">Unpaid</span>'}
          ${s.acquired_by_referral ? ' · <span style="color:#7c3aed"><i class="fas fa-gift"></i> Via Referral</span>' : ''}
          ${s.total_orders ? ` · ${s.total_orders} orders` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:5px;flex-wrap:wrap">
          <span class="status-badge status-${s.status}">${s.status}</span>
          ${vendor
            ? `<span style="font-size:.72rem;color:var(--text-muted)">
                 <i class="fas fa-user-tie" style="margin-right:2px"></i>${escHtml(vendor.name)}
               </span>`
            : isUnassigned && intendedEmail
              ? `<span style="font-size:.72rem;color:#0369a1">
                   <i class="fas fa-envelope" style="margin-right:2px"></i>Intended: ${escHtml(intendedEmail)}
                 </span>`
              : `<span style="font-size:.72rem;color:var(--warning);font-weight:600">
                   <i class="fas fa-exclamation-triangle" style="margin-right:2px"></i>No vendor assigned
                 </span>`}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${s.status === 'pending' ? `
          <button class="btn btn-success btn-sm" onclick="activateStore('${s.id}')">
            <i class="fas fa-check"></i> Activate
          </button>` : ''}
        ${s.status === 'active' ? `
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);border:1px solid var(--danger)" onclick="suspendStore('${s.id}')">
            <i class="fas fa-ban"></i> Suspend
          </button>` : ''}
        ${s.status === 'suspended' ? `
          <button class="btn btn-success btn-sm" onclick="activateStore('${s.id}')">
            <i class="fas fa-check"></i> Reactivate
          </button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="showHandoverModal('${s.id}','${escHtml(intendedEmail)}')">
          <i class="fas fa-exchange-alt"></i> ${isUnassigned ? 'Assign Vendor' : 'Re-assign'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="renameStore('${s.id}','${escHtml(s.name)}')">
          <i class="fas fa-edit"></i> Rename
        </button>
      </div>
    </div>
  </div>
</div>`;
}

// ── Refresh just the stores list (no full re-render) ──────
async function refreshAdminStoresList() {
  const listEl = document.getElementById('admin-stores-list');
  if (!listEl) { renderAdminDashboard(); return; }

  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Refreshing…</div>';

  const [storesRes, usersRes] = await Promise.all([
    apiGet('stores', 'limit=200'),
    apiGet('users',  'limit=200')
  ]);
  const stores = storesRes?.data || [];
  const users  = usersRes?.data  || [];
  App.allStores = stores;

  listEl.innerHTML = stores.length
    ? stores.map(s => adminStoreRowHTML(s, users)).join('')
    : '<div class="empty-state"><i class="fas fa-store-slash"></i><h3>No stores yet</h3></div>';
}

// ── Activate a store ──────────────────────────────────────
async function activateStore(storeId) {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  await apiPatch('stores', storeId, { status: 'active' });
  showToast('Store activated ✅', 'success');
  await refreshAdminStoresList();
  await refreshAdminVendorsFull();
}

// Keep old name for compatibility
async function approveStore(storeId) { await activateStore(storeId); }

// ── Rename a store (admin can name/rename any store) ──────
async function renameStore(storeId, currentName) {
  const newName = prompt('Enter new store name:', currentName);
  if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
  const trimmed = newName.trim();
  const slug = trimmed.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  await apiPatch('stores', storeId, { name: trimmed, slug });
  // Update local cache
  const cached = (App.allStores || []).find(s => s.id === storeId);
  if (cached) { cached.name = trimmed; cached.slug = slug; }
  showToast(`Store renamed to "${trimmed}" ✅`, 'success');
  await refreshAdminVendorsFull();
}

// ── Suspend a store ───────────────────────────────────────
async function suspendStore(storeId) {
  if (!confirm('Suspend this store? The vendor will not be able to sell.')) return;

  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  await apiPatch('stores', storeId, { status: 'suspended' });
  showToast('Store suspended', 'warning');
  await refreshAdminVendorsFull();
}

// ── Handover modal ────────────────────────────────────────
async function showHandoverModal(storeId, prefillEmail = '') {
  // Find the store to show its current details in the modal
  const store = App.allStores.find(s => s.id === storeId);
  const storeName = store ? escHtml(store.name) : 'this store';

  // Auto-detect the email: prefer prefillEmail → intended_vendor_email → current vendor's email
  let autoEmail = prefillEmail || store?.intended_vendor_email || '';

  // If the store is already assigned to a vendor, look up their email automatically
  if (!autoEmail && store?.vendor_id) {
    const vendorData = await apiFetch('users/' + store.vendor_id);
    if (vendorData?.email) autoEmail = vendorData.email;
  }

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🤝 Assign Store to Vendor</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">

  <!-- Current store info -->
  <div class="order-alert order-alert-warning" style="margin-bottom:14px">
    <i class="fas fa-store"></i>
    <div>
      <strong>${storeName}</strong>
      <span class="status-badge status-${store?.status||'pending'}" style="margin-left:6px">${store?.status||'pending'}</span><br>
      <span style="font-size:.78rem">
        ${store?.vendor_id
          ? `Currently assigned · Re-assigning will move it to the new vendor`
          : `Unassigned — ready to hand over`}
      </span>
    </div>
  </div>

  <div class="form-group">
    <label class="form-label">Vendor Email <span style="color:var(--danger)">*</span></label>
    <input class="form-control" id="handover-vendor" type="email"
           placeholder="e.g. vendor@email.com" oninput="previewHandoverVendor(this.value)"
           value="${escHtml(autoEmail)}"
           autocomplete="email">
    <div class="form-hint">Auto-filled from the vendor's account. Edit if needed.</div>
    <div id="handover-vendor-preview" style="margin-top:6px;font-size:.8rem;min-height:18px">
      ${autoEmail ? '<i class="fas fa-spinner fa-spin"></i> Looking up…' : ''}
    </div>
  </div>

  <div class="form-group">
    <label class="form-label">Store Price Paid (GHS)</label>
    <input class="form-control" id="handover-price" type="number" value="${store?.store_price || 500}" min="0" step="50">
    <div class="form-hint">Set to 0 for a free / referral-based handover.</div>
  </div>

  <div class="form-group">
    <label class="form-label">Activate store immediately?</label>
    <select class="form-control form-select" id="handover-activate">
      <option value="active">Yes — make active now (vendor can start selling)</option>
      <option value="pending">No — keep as pending (admin will activate later)</option>
    </select>
  </div>

  <button class="btn btn-primary btn-block" id="handover-confirm-btn"
          onclick="confirmHandover('${storeId}')">
    <i class="fas fa-handshake"></i> Confirm Handover
  </button>
  <p style="text-align:center;font-size:.75rem;color:var(--text-muted);margin-top:8px">
    The vendor will receive an in-app notification when the store is assigned.
  </p>
</div>`);

  // Auto-trigger vendor preview if email is already known
  if (autoEmail) {
    setTimeout(() => previewHandoverVendor(autoEmail), 100);
  }
}

// Live-preview the vendor being searched for handover
let _handoverDebounce = null;
function previewHandoverVendor(email) {
  const preview = document.getElementById('handover-vendor-preview');
  if (!preview) return;
  clearTimeout(_handoverDebounce);
  if (!email || !email.includes('@')) { preview.textContent = ''; return; }
  preview.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Looking up…';
  _handoverDebounce = setTimeout(async () => {
    const res = await apiGet('users', `search=${encodeURIComponent(email)}&limit=10`);
    const user = (res?.data || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!user) {
      preview.innerHTML = '<span style="color:var(--danger)"><i class="fas fa-times-circle"></i> No user found with this email</span>';
    } else if (user.role !== 'vendor') {
      preview.innerHTML = `<span style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> ${escHtml(user.name)} is a <strong>${user.role}</strong>, not a vendor</span>`;
    } else {
      preview.innerHTML = `<span style="color:var(--success)"><i class="fas fa-check-circle"></i> <strong>${escHtml(user.name)}</strong> · ${user.location}</span>`;
    }
  }, 500);
}

// Live-preview vendor on the Create Store form
let _createStoreVendorDebounce = null;
function previewCreateStoreVendor(email) {
  const preview = document.getElementById('a-vendor-preview');
  if (!preview) return;
  clearTimeout(_createStoreVendorDebounce);
  if (!email || !email.includes('@')) { preview.style.display = 'none'; preview.innerHTML = ''; return; }
  preview.style.display = 'block';
  preview.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Looking up vendor…';
  _createStoreVendorDebounce = setTimeout(async () => {
    const res = await apiGet('users', `search=${encodeURIComponent(email)}&limit=20`);
    const user = (res?.data || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!user) {
      preview.innerHTML = '<i class="fas fa-times-circle" style="color:var(--danger)"></i> No user found with this email address.';
    } else if (user.role !== 'vendor') {
      preview.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:var(--warning)"></i> <strong>${escHtml(user.name)}</strong> is a <em>${user.role}</em> — not a vendor. This store will be created <strong>without</strong> vendor assignment.`;
    } else {
      preview.innerHTML = `<i class="fas fa-check-circle" style="color:var(--success)"></i> <strong>${escHtml(user.name)}</strong> · ${user.location || '—'} · Wallet: GHS ${(user.wallet_balance||0).toFixed(0)}`;
    }
  }, 500);
}

// ── Confirm handover ──────────────────────────────────────
async function confirmHandover(storeId) {
  const email    = (document.getElementById('handover-vendor')?.value || '').trim().toLowerCase();
  const price    = parseFloat(document.getElementById('handover-price')?.value) || 0;
  const activate = document.getElementById('handover-activate')?.value || 'active';

  if (!email) { showToast('Please enter the vendor\'s email', 'warning'); return; }

  const btn = document.getElementById('handover-confirm-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Assigning…'; }

  // Look up vendor by email
  const res = await apiGet('users', `search=${encodeURIComponent(email)}&limit=20`);
  const vendor = (res?.data || []).find(u => (u.email || '').toLowerCase() === email);

  if (!vendor) {
    showToast('No user found with that email address', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-handshake"></i> Confirm Handover'; }
    return;
  }
  if (vendor.role !== 'vendor') {
    showToast(`${vendor.name} is a ${vendor.role} account, not a vendor. Ask them to register as a vendor first.`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-handshake"></i> Confirm Handover'; }
    return;
  }

  // Fetch fresh store data from API (don't rely only on cache)
  const freshStore = await apiFetch('stores/' + storeId);
  const storeName = freshStore ? freshStore.name : (App.allStores.find(s => s.id === storeId)?.name || 'this store');

  // Patch the store
  const updated = await apiPatch('stores', storeId, {
    vendor_id:            vendor.id,
    status:               activate,
    is_paid:              price > 0,
    store_price:          price,
    handover_date:        new Date().toISOString(),
    acquired_by_referral: false
  });

  if (!updated) {
    showToast('Failed to update store. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-handshake"></i> Confirm Handover'; }
    return;
  }

  // Update local cache
  const cached = App.allStores.find(s => s.id === storeId);
  if (cached) {
    cached.vendor_id  = vendor.id;
    cached.status     = activate;
    cached.is_paid    = price > 0;
    cached.store_price = price;
  }

  // Notify the vendor
  addNotification(vendor.id, 'system', '🏪 Store Assigned to You!',
    `"${storeName}" has been assigned to your account. ${activate === 'active' ? 'It is now live — start adding products!' : 'It will go live once admin activates it.'}`);

  closeModalForce();
  showToast(`Store successfully assigned to ${vendor.name} ✅`, 'success');
  await refreshAdminVendorsFull();
}

// ── Create store ──────────────────────────────────────────
async function adminCreateStore(e) {
  e.preventDefault();

  const name    = document.getElementById('a-store-name')?.value.trim();
  const desc    = document.getElementById('a-store-desc')?.value.trim();
  const loc     = document.getElementById('a-store-loc')?.value;
  const cat     = document.getElementById('a-store-cat')?.value;
  const price   = parseFloat(document.getElementById('a-store-price')?.value) || 0;
  const kwsStr  = document.getElementById('a-store-kws')?.value || '';
  const vendorQ = (document.getElementById('a-store-vendor')?.value || '').trim();

  // New vendor creation fields
  const newVendorName  = (document.getElementById('a-new-vendor-name')?.value || '').trim();
  const newVendorEmail = (document.getElementById('a-new-vendor-email')?.value || '').trim().toLowerCase();
  const newVendorPhone = (document.getElementById('a-new-vendor-phone')?.value || '').trim();
  const newVendorPass  = (document.getElementById('a-new-vendor-pass')?.value || '').trim();

  const kws     = kwsStr.split(',').map(k => k.trim()).filter(Boolean);
  const prefix  = (typeof LOCATION_PREFIXES !== 'undefined' ? LOCATION_PREFIXES[loc] : null) || 'XX';
  const slug    = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const logoB64   = document.getElementById('a-logo-b64')?.value.trim()   || '';
  const bannerB64 = document.getElementById('a-banner-b64')?.value.trim() || '';

  if (!name) { showToast('Store name is required', 'warning'); return; }
  if (!loc)  { showToast('Please select a location', 'warning'); return; }

  const btn = document.getElementById('a-create-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…'; }

  let vendorId   = '';
  let vendorName = '';

  // ── Step 1: Resolve existing vendor by email ──────────────
  if (vendorQ) {
    const sr = await apiGet('users', `search=${encodeURIComponent(vendorQ)}&limit=20`);
    const candidates = sr?.data || [];
    const match = candidates.find(u =>
      (u.email || '').toLowerCase() === vendorQ.toLowerCase() ||
      u.id === vendorQ
    );
    if (!match) {
      showToast(`No existing account for "${vendorQ}". Store will be created unassigned — use the Handover button to assign when they register.`, 'info');
    } else if (match.role !== 'vendor') {
      showToast(`${match.name} is a "${match.role}", not a vendor. Store created unassigned.`, 'warning');
    } else {
      vendorId   = match.id;
      vendorName = match.name;
    }
  }

  // ── Step 2: Create new vendor account if no existing vendor found ──
  if (!vendorId && newVendorEmail && newVendorPass) {
    // Validate required new-vendor fields
    if (!newVendorName) {
      showToast('Please enter the vendor\'s full name to create their account', 'warning');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Store'; }
      return;
    }

    // Check if email already taken
    const emailCheck = await apiGet('users', `search=${encodeURIComponent(newVendorEmail)}&limit=5`);
    const emailExists = (emailCheck?.data || []).find(u => u.email === newVendorEmail);
    if (emailExists) {
      showToast(`Email "${newVendorEmail}" is already registered. Use the "Assign to Existing Vendor" field instead.`, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Store'; }
      return;
    }

    // Generate referral code for the new vendor
    const refCode = 'V' + newVendorName.replace(/\s+/g,'').toUpperCase().slice(0,4) +
                    Math.floor(1000 + Math.random() * 9000);

    const newVendor = await apiPost('users', {
      name:              newVendorName,
      email:             newVendorEmail,
      phone:             newVendorPhone || '',
      role:              'vendor',
      location:          loc,
      is_verified:       false,
      id_verified:       false,
      referral_code:     refCode,
      referred_by:       '',
      referral_earnings: 0,
      referral_count:    0,
      wallet_balance:    0,
      preferred_store_name: name,
      preferred_store_cat:  cat || '',
      preferred_store_desc: desc || '',
      preferred_store_kws:  kwsStr || '',
      status:            'active',           // admin-created → directly active
      password_hash:     newVendorPass,
      registered_at:     new Date().toISOString()
    });

    if (!newVendor || !newVendor.id) {
      showToast('Failed to create vendor account. Please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Store'; }
      return;
    }

    vendorId   = newVendor.id;
    vendorName = newVendorName;
    showToast(`✅ Vendor account created for ${newVendorName}`, 'success');
  }

  // ── Step 3: Create the store ──────────────────────────────
  const store = await apiPost('stores', {
    name,
    slug,
    description:           desc || '',
    logo_url:              logoB64,
    banner_url:            bannerB64,
    location:              loc,
    category:              cat || '',
    keywords:              kws,
    vendor_id:             vendorId,
    intended_vendor_email: (!vendorId && vendorQ) ? vendorQ : (newVendorEmail || ''),
    status:                vendorId ? 'active' : 'pending',
    avg_rating:            0,
    review_count:          0,
    total_sales:           0,
    total_orders:          0,
    location_prefix:       prefix,
    store_price:           price,
    is_paid:               vendorId ? (price > 0) : false,
    acquired_by_referral:  false,
    handover_date:         vendorId ? new Date().toISOString() : ''
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Store'; }

  if (!store || !store.id) {
    showToast('Failed to create store. Please try again.', 'error');
    return;
  }

  App.allStores.push(store);
  showToast(`Store "${name}" created successfully! ✅`, 'success');

  if (vendorId) {
    const isNewAccount = !!(newVendorEmail && newVendorPass && !vendorQ);
    if (isNewAccount) {
      addNotification(vendorId, 'system', '🎉 Account & Store Ready!',
        `Welcome to HAPPA TRADEMART! Your vendor account and store "${name}" in ${loc} are live. Log in with your email (${newVendorEmail}) and the password provided by admin to complete your setup.`);
      showToast(`Store assigned to new vendor: ${vendorName} — credentials shared`, 'info');
    } else {
      addNotification(vendorId, 'system', '🏪 Store Ready!',
        `Your store "${name}" in ${loc} has been set up and is now live. Start adding products!`);
      showToast(`Assigned to vendor: ${vendorName}`, 'info');
    }
  }

  // Reset form and clear image pickers
  document.getElementById('create-store-form')?.reset();
  clearProductImage('a-logo-preview',   'a-logo-file',   'a-logo-b64');
  clearProductImage('a-banner-preview', 'a-banner-file', 'a-banner-b64');
  const preview = document.getElementById('a-vendor-preview');
  if (preview) preview.style.display = 'none';

  // Switch to Vendors tab to show the new vendor+store
  const vendorsTab = document.querySelector('[onclick*="admin-vendors"]');
  if (vendorsTab) switchTab(vendorsTab, 'admin-vendors');
  await refreshAdminVendorsFull();
}

// ── User management ───────────────────────────────────────
// ── Pending vendor card ───────────────────────────────────
function adminPendingVendorRowHTML(v) {
  const registeredAt = v.registered_at ? new Date(v.registered_at).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : 'Unknown';
  const hasStorePrefs = v.preferred_store_name && v.preferred_store_name.trim();
  return `
<div class="card" style="margin-bottom:10px;border-left:4px solid #f59e0b" id="pending-vendor-${v.id}">
  <div class="card-body">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;color:#b45309;flex-shrink:0">
        ${(v.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.9rem">${escHtml(v.name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${v.email}</div>
        <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px">
          📍 ${v.location||'—'} · 📱 ${v.phone||'—'}
        </div>
        ${hasStorePrefs ? `
        <div style="margin-top:6px;background:#fef9c3;border-radius:var(--radius-sm);padding:6px 8px;font-size:.72rem;color:#78350f">
          <strong>🏪 Preferred Store:</strong> ${escHtml(v.preferred_store_name)}
          ${v.preferred_store_cat ? ` · <em>${v.preferred_store_cat}</em>` : ''}
        </div>` : ''}
        <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap">
          <span class="status-badge" style="background:#fef3c7;color:#b45309">⏳ Pending Approval</span>
          ${v.is_verified ? '<span class="status-badge status-paid">Phone ✓</span>' : '<span class="status-badge" style="background:#fee2e2;color:#991b1b">Phone ✗</span>'}
          <span style="font-size:.7rem;color:var(--text-muted);padding-top:2px">Registered: ${registeredAt}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button class="btn btn-success btn-sm" onclick="approveAndCreateStore('${v.id}','${v.email}')">
          <i class="fas fa-store"></i> Approve &amp; Create Store
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="rejectVendorApplication('${v.id}','${v.email}')">
          <i class="fas fa-times"></i> Reject
        </button>
      </div>
    </div>
  </div>
</div>`;
}

// ── Approve a vendor ──────────────────────────────────────
async function approveVendor(userId, email) {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  await apiPatch('users', userId, { status: 'active' });
  addNotification(userId, 'system', '✅ Vendor Account Approved!',
    'Your vendor account has been approved! Log in with your registered email and password — your vendor dashboard is now active.');
  showToast(`Vendor approved ✅`, 'success');

  // Remove the card from the DOM immediately
  const card = document.getElementById('pending-vendor-' + userId);
  if (card) card.remove();

  // Refresh the full vendors tab in background
  await refreshAdminVendorsFull();
}

// ── Approve + auto-create store from vendor's preferences ──
async function approveAndCreateStore(userId, email) {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  // Fetch fresh vendor data to get their store preferences
  const vendorData = await apiFetch('users/' + userId);
  const vendor = vendorData || {};

  // First approve the vendor
  await apiPatch('users', userId, { status: 'active' });
  addNotification(userId, 'system', '✅ Vendor Account Approved!',
    'Your vendor account has been approved! Your store is being set up — you will be notified when it is ready.');

  // Remove the pending card
  const card = document.getElementById('pending-vendor-' + userId);
  if (card) card.remove();

  showToast(`Vendor approved — creating store…`, 'success');

  // Every vendor gets a store — use preferences if provided, or default to vendor's name
  const storeName = (vendor.preferred_store_name || '').trim() || `${vendor.name || 'New'}'s Store`;
  const loc    = vendor.location || 'Accra';
  const prefix = (typeof LOCATION_PREFIXES !== 'undefined' ? LOCATION_PREFIXES[loc] : null) || 'XX';
  const slug   = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const kws    = (vendor.preferred_store_kws || '').split(',').map(k => k.trim()).filter(Boolean);

  const store = await apiPost('stores', {
    name:                  storeName,
    slug,
    description:           vendor.preferred_store_desc || '',
    logo_url:              '',
    banner_url:            '',
    location:              loc,
    category:              vendor.preferred_store_cat || '',
    keywords:              kws,
    vendor_id:             userId,
    intended_vendor_email: email,
    status:                'active',
    avg_rating:            0,
    review_count:          0,
    total_sales:           0,
    total_orders:          0,
    location_prefix:       prefix,
    store_price:           0,
    is_paid:               false,
    acquired_by_referral:  false,
    handover_date:         new Date().toISOString()
  });

  if (store && store.id) {
    App.allStores = [...(App.allStores || []), store];
    addNotification(userId, 'system', '🏪 Your Store is Live!',
      `"${storeName}" has been created and is now active. Log in to your vendor dashboard with your registered email and password to start adding products and selling!`);
    showToast(`Store "${storeName}" created and assigned ✅`, 'success');
  } else {
    showToast('Store creation failed — please create the store manually from the Add Vendor tab', 'warning');
  }

  await refreshAdminVendorsFull();
}

// ── Load Rendors tab ──────────────────────────────────────
async function loadAdminRendors() {
  const el = document.getElementById('admin-rendors-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

  const res     = await apiGet('users', 'limit=200');
  const allRendors = (res?.data || []).filter(u => u.role === 'rendor');
  const pending    = allRendors.filter(u => u.status === 'pending_approval');
  const active     = allRendors.filter(u => u.status === 'active');

  el.innerHTML = `
  ${pending.length ? `
  <div style="margin-bottom:20px">
    <h3 style="font-weight:700;margin:0 0 10px;font-size:.88rem;color:#7c3aed">
      <i class="fas fa-user-clock"></i> Pending Approval (${pending.length})
    </h3>
    ${pending.map(r => adminPendingRendorCardHTML(r)).join('')}
    <hr style="border-color:var(--border);margin:16px 0">
  </div>` : ''}
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <h3 style="font-weight:700;margin:0;font-size:.88rem">All Rendors (${active.length})</h3>
  </div>
  ${active.length === 0
    ? '<div class="empty-state" style="padding:24px 0"><i class="fas fa-briefcase"></i><h3>No active rendors yet</h3></div>'
    : active.map(r => adminActiveRendorCardHTML(r)).join('')}`;
}

function adminPendingRendorCardHTML(r) {
  const registeredAt = r.registered_at
    ? new Date(r.registered_at).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})
    : 'Unknown';
  return `
<div class="card pending-rendor-card" style="margin-bottom:10px" id="pending-rendor-${r.id}">
  <div class="card-body">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#ede9fe,#ddd6fe);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;color:#7c3aed;flex-shrink:0">
        ${(r.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.9rem">${escHtml(r.name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${r.email}</div>
        <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px">
          📍 ${r.location||'—'} · 📱 ${r.phone||'—'}
        </div>
        ${r.rendor_display_name ? `
        <div style="margin-top:6px;background:#ede9fe;border-radius:var(--radius-sm);padding:6px 8px;font-size:.72rem;color:#4c1d95">
          <strong>🎨 Brand Name:</strong> ${escHtml(r.rendor_display_name)}
          ${r.rendor_service_cat ? ` · <em>${escHtml(r.rendor_service_cat)}</em>` : ''}
          ${r.rendor_starting_price ? ` · From GHS ${parseFloat(r.rendor_starting_price).toFixed(2)}` : ''}
        </div>` : ''}
        ${r.rendor_bio ? `
        <div style="margin-top:4px;font-size:.72rem;color:var(--text-muted);-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">
          "${escHtml(r.rendor_bio)}"
        </div>` : ''}
        <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap">
          <span class="status-badge" style="background:#ede9fe;color:#7c3aed">⏳ Pending Approval</span>
          ${r.is_verified ? '<span class="status-badge status-paid">Phone ✓</span>' : '<span class="status-badge" style="background:#fee2e2;color:#991b1b">Phone ✗</span>'}
          <span style="font-size:.7rem;color:var(--text-muted);padding-top:2px">Registered: ${registeredAt}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button class="btn btn-sm" onclick="approveRendor('${r.id}','${r.email}')"
                style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed">
          <i class="fas fa-check"></i> Approve
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="rejectRendorApplication('${r.id}','${r.email}')">
          <i class="fas fa-times"></i> Reject
        </button>
      </div>
    </div>
  </div>
</div>`;
}

function adminActiveRendorCardHTML(r) {
  // Subscription status
  const subStatus = r.rendor_sub_status || null;
  const subExpiry = r.rendor_sub_expiry ? new Date(Number(r.rendor_sub_expiry)) : null;
  const subActive = subStatus === 'active' && subExpiry && subExpiry > new Date();
  const subLabel  = subActive
    ? `Sub active → ${subExpiry.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`
    : 'No subscription';
  const subColor  = subActive ? '#059669' : '#dc2626';
  const subBg     = subActive ? '#d1fae5' : '#fee2e2';

  return `
<div class="card" style="margin-bottom:10px;border-left:4px solid #7c3aed;cursor:pointer" id="rendor-row-${r.id}"
     onclick="adminOpenRendorProfile('${r.id}')">
  <div class="card-body">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#ede9fe,#ddd6fe);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;color:#7c3aed;flex-shrink:0">
        ${(r.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.88rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${escHtml(r.rendor_display_name || r.name)}
          ${r.id_verified ? '<span class="rendor-verified-badge"><i class="fas fa-check-circle"></i> Verified</span>' : ''}
        </div>
        <div style="font-size:.73rem;color:var(--text-muted)">${r.email} · ${r.rendor_service_cat||'—'}</div>
        <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px">
          📍 ${r.location||'—'} · 💳 GHS ${(r.wallet_balance||0).toFixed(2)}
          ${r.rendor_starting_price ? ` · From GHS ${parseFloat(r.rendor_starting_price).toFixed(2)}` : ''}
        </div>
        <!-- Subscription pill -->
        <div style="display:inline-flex;align-items:center;gap:5px;margin-top:5px;background:${subBg};color:${subColor};border-radius:20px;padding:2px 8px;font-size:.7rem;font-weight:700">
          <i class="fas fa-${subActive?'check-circle':'times-circle'}"></i> ${subLabel}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
        <button class="btn btn-sm" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;font-size:.72rem;padding:4px 8px"
                onclick="event.stopPropagation();adminActivateRendorSub('${r.id}','${escHtml(r.rendor_display_name||r.name)}')">
          <i class="fas fa-star"></i> Sub
        </button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();adminNotifyUser('${r.id}')">
          <i class="fas fa-bell"></i>
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="event.stopPropagation();adminSuspendUser('${r.id}')">
          <i class="fas fa-ban"></i>
        </button>
      </div>
    </div>
  </div>
</div>`;
}

async function approveRendor(userId, email) {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  await apiPatch('users', userId, { status: 'active' });
  addNotification(userId, 'system', '✅ Rendor Profile Approved!',
    'Your rendor profile has been approved and is now live! Log in to your Rendor Hub, add your contact info and posts, then subscribe to keep your profile visible to clients.');
  showToast('Rendor approved ✅', 'success');

  const card = document.getElementById('pending-rendor-' + userId);
  if (card) card.remove();
  await loadAdminRendors();
}

async function rejectRendorApplication(userId, email) {
  if (!confirm('Reject this rendor application? The user will be notified.')) return;
  await apiPatch('users', userId, { status: 'suspended' });
  addNotification(userId, 'system', '❌ Rendor Application Not Approved',
    'Your rendor application was not approved at this time. Please contact support for more information.');
  showToast('Application rejected', 'warning');
  const card = document.getElementById('pending-rendor-' + userId);
  if (card) card.remove();
}

// ── Rendor subscription activation (admin-side) ───────────
function adminActivateRendorSub(userId, displayName) {
  const PLANS = [
    { id:'monthly',   label:'Monthly (30 days)',   days:30,  price:30  },
    { id:'quarterly', label:'3 Months (90 days)',  days:90,  price:80  },
    { id:'biannual',  label:'6 Months (180 days)', days:180, price:150 },
  ];

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">⭐ Activate Subscription</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.85rem;color:var(--text-light);margin-bottom:16px;line-height:1.6">
    Activate a subscription for <strong>${escHtml(displayName)}</strong> after confirming their payment.
  </p>
  <div class="form-group">
    <label class="form-label">Plan *</label>
    <select class="form-control form-select" id="sub-plan-sel">
      ${PLANS.map(p => `<option value="${p.id}" data-days="${p.days}">${p.label} — GHS ${p.price}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Start Date</label>
    <input class="form-control" type="date" id="sub-start-date" value="${new Date().toISOString().slice(0,10)}">
  </div>
  <button class="btn btn-block" id="sub-activate-btn"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;margin-top:8px"
          onclick="_doActivateRendorSub('${userId}')">
    <i class="fas fa-star"></i> Activate Subscription
  </button>
</div>`);
}

function adminDeactivateRendorSub(userId) {
  if (confirm('Are you sure you want to deactivate this rendor\'s subscription?')) {
    apiPatch('users', userId, {
      rendor_sub_status: 'inactive',
      rendor_sub_expiry: null
    });
    showToast('Subscription deactivated!', 'info');
    loadAdminRendors(); // Refresh if needed
  }
}

async function _doActivateRendorSub(userId) {
  const sel       = document.getElementById('sub-plan-sel');
  const planId    = sel?.value;
  const days      = parseInt(sel?.selectedOptions[0]?.dataset.days || '30');
  const startRaw  = document.getElementById('sub-start-date')?.value;
  const startMs   = startRaw ? new Date(startRaw).getTime() : Date.now();
  const expiryMs  = startMs + days * 86400000;
  const planLabel = sel?.selectedOptions[0]?.text || planId;

  const btn = document.getElementById('sub-activate-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Activating…'; }

  await apiPatch('users', userId, {
    rendor_sub_status: 'active',
    rendor_sub_expiry: String(expiryMs),
    rendor_sub_plan:   planId,
  });

  addNotification(userId, 'system', '🎉 Subscription Activated!',
    `Your ${planLabel} subscription is now active. Your profile is visible to clients until ${new Date(expiryMs).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}. Keep creating great posts!`
  );

  showToast('Subscription activated ✅', 'success');
  closeModalForce();
  await loadAdminRendors();
}

// ── Reject vendor application ─────────────────────────────
async function rejectVendorApplication(userId, email) {
  if (!confirm(`Reject this vendor application? The user will be notified.`)) return;
  await apiPatch('users', userId, { status: 'suspended' });
  addNotification(userId, 'system', '❌ Application Not Approved',
    'Your vendor application was not approved at this time. Please contact support for more information.');
  showToast('Application rejected', 'warning');
  const card = document.getElementById('pending-vendor-' + userId);
  if (card) card.remove();
}

// ── Store picker modal (for approve + assign flow) ───────
async function showStorePicker(vendorUserId, vendorEmail) {
  const storeRes = await apiGet('stores', 'limit=200');
  const unassignedStores = (storeRes?.data || []).filter(s => !s.vendor_id || s.vendor_id === '');

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🏪 Assign Store to Vendor</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="order-alert order-alert-success" style="margin-bottom:14px">
    <i class="fas fa-user-check"></i>
    <div>Vendor <strong>${vendorEmail}</strong> approved. Choose a store to assign:</div>
  </div>
  ${unassignedStores.length ? unassignedStores.map(s => `
  <div class="card" style="margin-bottom:8px;cursor:pointer" onclick="closeModalForce();showHandoverModal('${s.id}','${vendorEmail}')">
    <div class="card-body" style="display:flex;align-items:center;gap:10px;padding:10px 12px">
      <i class="fas fa-store" style="color:var(--primary);font-size:1.1rem;flex-shrink:0"></i>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.875rem">${escHtml(s.name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${s.location} · GHS ${s.store_price||500}</div>
      </div>
      <i class="fas fa-chevron-right" style="color:var(--text-muted)"></i>
    </div>
  </div>`).join('') : `
  <div class="empty-state" style="padding:20px 0">
    <i class="fas fa-inbox"></i>
    <h3>No unassigned stores</h3>
    <p>Create a store first in the Create Store tab</p>
  </div>
  <button class="btn btn-primary btn-block" onclick="closeModalForce();switchTab(document.querySelector('[onclick*=admin-create-store]'),\\'admin-create-store\\')">
    <i class="fas fa-plus"></i> Create a Store
  </button>`}
</div>`);
}

// ── Send/Clear Platform Announcement ─────────────────────
async function sendAnnouncement() {
  const text    = document.getElementById('setting-announcement-text')?.value.trim();
  const type    = document.getElementById('setting-announcement-type')?.value || 'info';
  const active  = document.getElementById('setting-announcement-active')?.checked ?? true;

  if (!text) { showToast('Please enter an announcement message', 'warning'); return; }

  const btn = document.querySelector('[onclick="sendAnnouncement()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }

  // Upsert all three announcement settings (for banner display)
  const res  = await apiGet('settings', 'limit=100');
  const rows = res?.data || [];
  const upsert = async (key, value) => {
    const ex = rows.find(r => r.key === key);
    if (ex) await apiPatch('settings', ex.id, { value: String(value), updated_at: new Date().toISOString() });
    else    await apiPost('settings', { key, value: String(value), label: key, type: 'text', updated_at: new Date().toISOString() });
  };
  await Promise.all([
    upsert('announcement_text',   text),
    upsert('announcement_type',   type),
    upsert('announcement_active', String(active))
  ]);

  // Send as in-app notification to ALL non-admin users (saved to DB so they receive it)
  const typeIconMap = { info: '📢', success: '✅', warning: '⚠️', danger: '🚨' };
  const icon = typeIconMap[type] || '📢';
  const usersRes = await apiGet('users', 'limit=500');
  const allUsers = (usersRes?.data || []).filter(u => u.status !== 'deleted' && u.role !== 'admin');

  // Post each notification to the DB so it appears when users open their notifications
  // Process in small batches of 10 to avoid overloading the API
  const BATCH = 10;
  for (let i = 0; i < allUsers.length; i += BATCH) {
    const batch = allUsers.slice(i, i + BATCH);
    await Promise.all(batch.map(u =>
      apiPost('notifications', {
        user_id:    u.id,
        type:       'system',
        title:      `${icon} Platform Announcement`,
        message:    text,
        is_read:    false,
        action_url: '',
        created_at: Date.now()
      })
    ));
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Announcement'; }
  const msg = document.getElementById('announcement-sent-msg');
  if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
  showToast(`📢 Announcement sent to ${allUsers.length} user(s)!`, 'success');
}

async function clearAnnouncement() {
  document.getElementById('setting-announcement-text').value  = '';
  document.getElementById('setting-announcement-active').checked = false;

  const res  = await apiGet('settings', 'limit=100');
  const rows = res?.data || [];
  const upsert = async (key, value) => {
    const ex = rows.find(r => r.key === key);
    if (ex) await apiPatch('settings', ex.id, { value: String(value), updated_at: new Date().toISOString() });
  };
  await Promise.all([
    upsert('announcement_active', 'false'),
    upsert('announcement_text',   '')
  ]);
  showToast('Announcement cleared', 'info');
}

async function refreshAdminUsersList() {
  const list = document.getElementById('admin-users-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  const res = await apiGet('users', 'limit=200');
  const users = res?.data || [];
  list.innerHTML = users.map(u => adminUserRowHTML(u)).join('');
}

// ── Refresh vendors+stores list in-place ────────────────────
async function refreshAdminVendorsList() {
  await refreshAdminVendorsFull();
}

async function refreshAdminVendorsFull() {
  const list = document.getElementById('admin-vendors-list');
  if (!list) { renderAdminDashboard(); return; }
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  const [usersRes, storesRes] = await Promise.all([
    apiGet('users',  'limit=200'),
    apiGet('stores', 'limit=200')
  ]);
  const allUsers  = usersRes?.data  || [];
  const allStores = storesRes?.data || [];
  App.allStores = allStores;
  const vendors = allUsers.filter(u => u.role === 'vendor');
  list.innerHTML = vendors.length
    ? vendors.map(v => adminVendorWithStoreRowHTML(v, allStores, allUsers)).join('')
    : '<div class="empty-state" style="padding:24px 0"><i class="fas fa-store-slash"></i><h3>No vendors yet</h3></div>';
}

// ── Vendor card with embedded store info ─────────────────────
function adminVendorWithStoreRowHTML(u, allStores, allUsers) {
  let store = (allStores || []).find(s => s.vendor_id === u.id);
  if (!store && u.status === 'active') {
    // Only auto-create a fallback store for already active vendors if one is missing,
    // using their preferences if available to keep the information in place.
    const storeName = (u.preferred_store_name || '').trim() || u.name + "'s Shop";
    const loc = u.location || 'Accra';
    const prefix = (typeof LOCATION_PREFIXES !== 'undefined' ? LOCATION_PREFIXES[loc] : null) || 'XX';
    const slug = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const kws = (u.preferred_store_kws || '').split(',').map(k => k.trim()).filter(Boolean);

    store = {
      id: 'store-' + u.id,
      name: storeName,
      slug: slug,
      description: u.preferred_store_desc || '',
      vendor_id: u.id,
      status: 'active',
      location: loc,
      category: u.preferred_store_cat || 'General',
      keywords: kws,
      location_prefix: prefix,
      total_sales: 0,
      total_orders: 0
    };
    allStores.push(store);
    try {
      localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores));
    } catch(e){}
    apiPost('stores', store).catch(() => {});
  }
  const statusColor = {
    active: 'var(--success)', suspended: 'var(--danger)',
    pending_approval: '#d97706', deleted: 'var(--text-muted)'
  }[u.status || 'active'] || 'var(--text-muted)';

  return `
<div class="card" style="margin-bottom:10px;border-left:4px solid var(--success);cursor:pointer" id="user-row-${u.id}" onclick="adminOpenVendorProfile('${u.id}')">
  <div class="card-body" style="padding:12px">

    <!-- Vendor info row -->
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${store ? '10px' : '0'}">
      <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--primary-light),var(--primary));display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:800;color:var(--primary);font-size:1rem">
        ${(u.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.875rem">${escHtml(u.name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${u.email}${u.phone ? ' · ' + u.phone : ''}</div>
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          <span style="font-size:.7rem;padding:2px 7px;border-radius:10px;background:${statusColor}22;color:${statusColor};font-weight:700">${u.status || 'active'}</span>
          ${u.location ? `<span style="font-size:.7rem;color:var(--text-muted)">${u.location}</span>` : ''}
          ${u.is_verified  ? '<span class="status-badge status-paid" style="font-size:.65rem">Phone ✓</span>'  : ''}
          ${u.id_verified  ? '<span class="status-badge status-paid" style="font-size:.65rem">ID ✓</span>'    : ''}
          ${u.wallet_balance ? `<span style="font-size:.7rem;color:var(--success)">GHS ${(u.wallet_balance||0).toFixed(0)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();showSendNotificationModal('${u.id}','${escHtml(u.name).replace(/'/g,"\\'")}')"><i class="fas fa-bell"></i> Notify</button>
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();adminOpenVendorProfile('${u.id}')"><i class="fas fa-user"></i> Profile</button>
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();adjustUserWallet('${u.id}','${escHtml(u.name).replace(/'/g,"\\'")}',${ u.wallet_balance||0})"><i class="fas fa-wallet"></i> Wallet</button>
        ${u.status === 'active'
          ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="event.stopPropagation();suspendUser('${u.id}')"><i class="fas fa-ban"></i> Suspend</button>`
          : (u.status !== 'deleted' ? `<button class="btn btn-ghost btn-sm" style="color:var(--success)" onclick="event.stopPropagation();activateUser('${u.id}')"><i class="fas fa-check"></i> Activate</button>` : '')}
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);margin-top:2px" onclick="event.stopPropagation();if(confirm('Are you ABSOLUTELY sure you want to delete ${escHtml(u.name).replace(/'/g,"\\'") || 'this user'}? This CANNOT be undone!'))_apDeleteUser('${u.id}')"><i class="fas fa-trash-alt"></i> Delete</button>
      </div>
    </div>

    <!-- Embedded store card -->
    ${store ? `
    <div style="background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);padding:10px 12px">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${store.logo_url||'https://via.placeholder.com/40x40?text=S'}" style="width:38px;height:38px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0" onerror="this.src='https://via.placeholder.com/40x40?text=S'">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.85rem">${escHtml(store.name)}</div>
          <div style="font-size:.73rem;color:var(--text-muted)">${store.location} · ${store.category||'General'}</div>
          <div style="display:flex;gap:5px;align-items:center;margin-top:3px;flex-wrap:wrap">
            <span class="status-badge status-${store.status}">${store.status}</span>
            ${store.total_orders ? `<span style="font-size:.7rem;color:var(--text-muted)">${store.total_orders} orders</span>` : ''}
            <span style="font-size:.7rem;color:var(--text-muted)">GHS ${(store.total_sales||0).toLocaleString()} sales</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          ${store.status === 'active'
            ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger);border:1px solid var(--danger)" onclick="event.stopPropagation();suspendStore('${store.id}')"><i class="fas fa-ban"></i> Suspend</button>`
            : `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();activateStore('${store.id}')"><i class="fas fa-check"></i> Activate</button>`}
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();renameStore('${store.id}','${escHtml(store.name)}')"><i class="fas fa-edit"></i> Rename</button>
        </div>
      </div>
    </div>` : `
    <div style="background:#fef9c3;border-radius:var(--radius-sm);padding:8px 10px;font-size:.78rem;color:#78350f;display:flex;align-items:center;gap:8px">
      <i class="fas fa-exclamation-triangle"></i>
      <span>No store assigned yet.</span>
      <button class="btn btn-outline btn-sm" style="margin-left:auto;padding:3px 10px;font-size:.72rem" onclick="switchTab(document.querySelector('[onclick*=admin-create-store]'),\'admin-create-store\')"><i class="fas fa-plus"></i> Create Store</button>
    </div>`}
  </div>
</div>`;
}

function adminUserRowHTML(u) {
  const statusColor = {
    active: 'var(--success)', suspended: 'var(--danger)',
    pending_approval: '#d97706', deleted: 'var(--text-muted)'
  }[u.status || 'active'] || 'var(--text-muted)';

  // Role-specific accent colour for left border
  const borderColor = u.role === 'vendor' ? 'var(--primary)' : u.role === 'rendor' ? '#7c3aed' : 'var(--border)';

  // Route click to the correct profile modal
  const profileFn = u.role === 'vendor'
    ? `adminOpenVendorProfile('${u.id}')`
    : u.role === 'rendor'
      ? `adminOpenRendorProfile('${u.id}')`
      : `adminOpenBuyerProfile('${u.id}')`;

  return `
<div class="card" style="margin-bottom:8px;cursor:pointer;border-left:3px solid ${borderColor}" id="user-row-${u.id}"
     onclick="${profileFn}">
  <div class="card-body" style="padding:10px 12px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--primary-light),var(--primary));display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:800;color:var(--primary);font-size:1rem">
        ${(u.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.875rem">${escHtml(u.name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${u.email} · <strong style="text-transform:capitalize">${u.role}</strong></div>
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          <span style="font-size:.7rem;padding:2px 7px;border-radius:10px;background:${statusColor}22;color:${statusColor};font-weight:700">${u.status || 'active'}</span>
          ${u.location ? `<span style="font-size:.7rem;color:var(--text-muted)">${u.location}</span>` : ''}
          ${u.is_verified ? '<span class="status-badge status-paid" style="font-size:.65rem">Phone ✓</span>' : ''}
          ${u.id_verified ? '<span class="status-badge status-paid" style="font-size:.65rem">ID ✓</span>'   : ''}
          ${u.wallet_balance ? `<span style="font-size:.7rem;color:var(--success)">GHS ${(u.wallet_balance||0).toFixed(0)}</span>` : ''}
        </div>
      </div>
      <i class="fas fa-chevron-right" style="color:var(--text-muted);font-size:.75rem;flex-shrink:0"></i>
    </div>
  </div>
</div>`;
}

// ── Send notification to a user ────────────────────────────
function showSendNotificationModal(userId, userName) {
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🔔 Send Notification to ${escHtml(userName)}</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="form-group">
    <label class="form-label">Notification Type</label>
    <select class="form-control form-select" id="notif-type">
      <option value="system">📢 System Message</option>
      <option value="order">📦 Order Update</option>
      <option value="referral">🎁 Referral</option>
      <option value="wallet">💰 Wallet</option>
      <option value="promo">🎉 Promotion</option>
      <option value="warning">⚠️ Warning</option>
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Title</label>
    <input class="form-control" id="notif-title" placeholder="Notification title…" maxlength="80">
  </div>
  <div class="form-group">
    <label class="form-label">Message</label>
    <textarea class="form-control" id="notif-message" rows="3" placeholder="Write your message to ${escHtml(userName)}…" maxlength="300"></textarea>
    <div class="form-hint"><span id="notif-char-count">0</span>/300 characters</div>
  </div>
  <div style="display:flex;gap:8px">
    <button class="btn btn-primary" style="flex:1" onclick="sendAdminNotification('${userId}','${escHtml(userName).replace(/'/g,"\\'").replace(/"/g,"&quot;")}')">
      <i class="fas fa-paper-plane"></i> Send
    </button>
    <button class="btn btn-outline" onclick="closeModalForce()">Cancel</button>
  </div>
</div>`);

  // Character counter
  setTimeout(() => {
    const ta = document.getElementById('notif-message');
    const counter = document.getElementById('notif-char-count');
    if (ta && counter) {
      ta.addEventListener('input', () => { counter.textContent = ta.value.length; });
    }
  }, 50);
}

async function sendAdminNotification(userId, userName) {
  const type    = document.getElementById('notif-type')?.value || 'system';
  const title   = document.getElementById('notif-title')?.value.trim();
  const message = document.getElementById('notif-message')?.value.trim();

  if (!title)   { showToast('Please enter a title', 'warning'); return; }
  if (!message) { showToast('Please enter a message', 'warning'); return; }

  addNotification(userId, type, title, message);
  closeModalForce();
  showToast(`Notification sent to ${userName} ✅`, 'success');
}

// ── Adjust user wallet ─────────────────────────────────────
function adjustUserWallet(userId, userName, currentBalance) {
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">💰 Wallet — ${escHtml(userName)}</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div style="background:var(--bg);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;text-align:center">
    <div style="font-size:.78rem;color:var(--text-muted)">Current Balance</div>
    <div style="font-size:1.6rem;font-weight:800;color:var(--primary)">GHS ${parseFloat(currentBalance||0).toFixed(2)}</div>
  </div>
  <div class="form-group">
    <label class="form-label">Action</label>
    <select class="form-control form-select" id="wallet-adj-type">
      <option value="credit">➕ Credit (Add funds)</option>
      <option value="debit">➖ Debit (Remove funds)</option>
      <option value="set">🔧 Set balance to specific amount</option>
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Amount (GHS)</label>
    <input class="form-control" id="wallet-adj-amount" type="number" min="0" step="0.01" placeholder="0.00">
  </div>
  <div class="form-group">
    <label class="form-label">Reason / Note</label>
    <input class="form-control" id="wallet-adj-note" placeholder="e.g. Refund for order #…">
  </div>
  <button class="btn btn-primary btn-block" onclick="applyWalletAdjustment('${userId}','${escHtml(userName).replace(/'/g,"\\'")}',${parseFloat(currentBalance||0)})">
    <i class="fas fa-check"></i> Apply
  </button>
</div>`);
}

async function applyWalletAdjustment(userId, userName, currentBalance) {
  const adjType = document.getElementById('wallet-adj-type')?.value;
  const amount  = parseFloat(document.getElementById('wallet-adj-amount')?.value) || 0;
  const note    = document.getElementById('wallet-adj-note')?.value.trim() || 'Admin adjustment';

  if (amount <= 0 && adjType !== 'set') { showToast('Please enter a valid amount', 'warning'); return; }

  let newBalance = currentBalance;
  if (adjType === 'credit') newBalance = currentBalance + amount;
  else if (adjType === 'debit')  newBalance = Math.max(0, currentBalance - amount);
  else if (adjType === 'set')    newBalance = amount;

  newBalance = parseFloat(newBalance.toFixed(2));

  await apiPatch('users', userId, { wallet_balance: newBalance });

  // Record the transaction
  await apiPost('transactions', {
    user_id:     userId,
    type:        'admin_adjustment',
    amount:      adjType === 'debit' ? -amount : amount,
    description: note,
    status:      'completed',
    created_at:  new Date().toISOString()
  });

  addNotification(userId, 'wallet', '💰 Wallet Updated',
    `Your wallet balance has been updated to GHS ${newBalance.toFixed(2)}. Note: ${note}`);

  closeModalForce();
  showToast(`Wallet updated to GHS ${newBalance.toFixed(2)} ✅`, 'success');

  // Refresh users list
  const res = await apiGet('users', 'limit=200');
  const users = res?.data || [];
  const list = document.getElementById('admin-users-list');
  if (list) list.innerHTML = users.map(u => adminUserRowHTML(u)).join('');
}


function adminOrderRowHTML(o, allUsers) {
  const buyer = allUsers.find(u => u.id === o.buyer_id);
  return `
<div style="padding:10px 0;border-bottom:1px solid var(--border)">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="font-weight:700;font-size:.8rem;color:var(--text-muted)">Order #${(o.id||'').slice(-8).toUpperCase()}</div>
      <div style="font-size:.875rem;font-weight:600">${buyer ? escHtml(buyer.name) : 'Unknown Buyer'}</div>
      <div style="font-size:.75rem;color:var(--text-muted)">${formatDate(o.created_at)} · ${(o.items||[]).length} item(s)</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700;color:var(--primary)">GHS ${(o.total||0).toFixed(2)}</div>
      <span class="status-badge status-${o.status||'pending'}">${o.status||'pending'}</span>
    </div>
  </div>
</div>`;
}

// NOTE: adminPackageRowHTML, updateAdminStatus, refreshAdminOrdersList
//       are defined in js/orders.js

// ── User suspend / activate ────────────────────────────────
async function suspendUser(userId) {
  if (!confirm('Suspend this user? They will not be able to log in.')) return;
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; }
  await apiPatch('users', userId, { status: 'suspended' });
  showToast('User suspended', 'warning');
  // Refresh users list in-place without full re-render
  const res = await apiGet('users', 'limit=200');
  const users = res?.data || [];
  const list = document.getElementById('admin-users-list');
  if (list) list.innerHTML = users.map(u => adminUserRowHTML(u)).join('');
}

/** Rendor-card notify / suspend (wrappers used in adminActiveRendorCardHTML) */
async function adminNotifyUser(userId) {
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🔔 Send Notification</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="form-group">
    <label class="form-label">Title *</label>
    <input class="form-control" id="notif-title" placeholder="e.g. Action Required">
  </div>
  <div class="form-group">
    <label class="form-label">Message *</label>
    <textarea class="form-control" id="notif-msg" rows="3" placeholder="Write your message…"></textarea>
  </div>
  <button class="btn btn-primary btn-block" onclick="
    const t=document.getElementById('notif-title')?.value?.trim();
    const m=document.getElementById('notif-msg')?.value?.trim();
    if(!t||!m){showToast('Title and message required','warning');return;}
    addNotification('${userId}','system',t,m);
    showToast('Notification sent ✅','success');
    closeModalForce();
  ">
    <i class="fas fa-paper-plane"></i> Send
  </button>
</div>`);
}

async function adminSuspendUser(userId) {
  if (!confirm('Suspend this user? They will not be able to log in.')) return;
  await apiPatch('users', userId, { status: 'suspended' });
  addNotification(userId, 'system', '🚫 Account Suspended',
    'Your account has been suspended. Please contact support if you believe this is an error.');
  showToast('User suspended', 'warning');
  await loadAdminRendors();
}

async function activateUser(userId) {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; }
  await apiPatch('users', userId, { status: 'active' });
  showToast('User activated ✅', 'success');
  // Refresh users list in-place without full re-render
  const res = await apiGet('users', 'limit=200');
  const users = res?.data || [];
  const list = document.getElementById('admin-users-list');
  if (list) list.innerHTML = users.map(u => adminUserRowHTML(u)).join('');
}

function filterAdminUsers(query, users) {
  const q = query.toLowerCase();
  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(q)  ||
    u.email?.toLowerCase().includes(q) ||
    u.phone?.includes(q)
  );
  const list = document.getElementById('admin-users-list');
  if (list) list.innerHTML = filtered.map(u => adminUserRowHTML(u)).join('');
}

// ── Review management ─────────────────────────────────────
function showAdminReviewsModal() {
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">⭐ Review Management</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.85rem;color:var(--text-light);margin-bottom:12px">Monitor and manage vendor ratings.</p>
  <div class="verify-banner">
    <i class="fas fa-shield-alt"></i>
    <p>Auto-detection active for duplicate and suspicious reviews.</p>
  </div>
  <ul style="font-size:.82rem;color:var(--text-muted);padding-left:16px;line-height:2;margin-top:12px">
    <li>Flag reviews from non-buyers</li>
    <li>Detect repeated identical reviews</li>
    <li>Rate anomaly detection</li>
    <li>Manual approve / reject reviews</li>
  </ul>
</div>`, true);
}

// ── Preview as role ───────────────────────────────────────
function previewAsRole(role) {
  if (!App.currentUser || App.currentUser.role !== 'admin') return;
  // Save admin session so we can restore it
  sessionStorage.setItem('admin_preview_session', JSON.stringify(App.currentUser));
  // Create a temporary preview user object
  const previewUser = {
    id:            App.currentUser.id,
    name:          App.currentUser.name + ' (Preview)',
    email:         App.currentUser.email,
    role:          role,
    location:      App.currentUser.location || 'Accra',
    is_verified:   true,
    id_verified:   true,
    wallet_balance:0,
    referral_code: 'ADMIN',
    referral_count:0,
    referral_earnings:0,
    status:        'active',
    _is_admin_preview: true
  };
  App.currentUser = previewUser;
  saveSessions();
  showToast(`👁 Previewing as ${role}. Tap your profile icon then "Exit Preview" to return.`, 'info');
  showPage('dashboard');
}

// Call this to exit preview mode and restore admin session
function exitPreviewMode() {
  const saved = sessionStorage.getItem('admin_preview_session');
  if (!saved) { showToast('No preview session found', 'error'); return; }
  try {
    App.currentUser = JSON.parse(saved);
    saveSessions();
    sessionStorage.removeItem('admin_preview_session');
    showToast('Back to admin dashboard ✅', 'success');
    showPage('admin-dashboard');
  } catch(e) { showToast('Could not restore admin session', 'error'); }
}

// ── Charts ────────────────────────────────────────────────
function renderAdminRevenueChart(orders = []) {
  const canvas = document.getElementById('admin-revenue-chart');
  if (!canvas) return;

  const now = new Date();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5'];
  const data = [0, 0, 0, 0, 0];

  orders.forEach(o => {
    if (!o.created_at) return;
    const orderDate = new Date(o.created_at);
    const diffMs = now - orderDate;
    if (diffMs < 0 || diffMs > 5 * oneWeekMs) return;

    const bucketIndex = 4 - Math.floor(diffMs / oneWeekMs);
    if (bucketIndex >= 0 && bucketIndex < 5) {
      data[bucketIndex] += parseFloat(o.platform_fee || 0);
    }
  });

  const roundedData = data.map(v => parseFloat(v.toFixed(2)));

  if (window._adminRevChart) window._adminRevChart.destroy();
  window._adminRevChart = new Chart(canvas, {
    type: 'line',
    data: { labels: weeks, datasets: [{ label: 'Platform Fee (GHS)', data: roundedData, fill: true,
      backgroundColor: 'rgba(232,93,4,0.1)', borderColor: 'var(--primary)', tension: 0.4, pointRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } } }
  });
}

function renderAdminLocationChart(orders) {
  const canvas = document.getElementById('admin-loc-chart');
  if (!canvas) return;
  const locCounts = {};
  LOCATIONS.forEach(l => locCounts[l] = 0);
  orders.forEach(o => { if (o.buyer_location && locCounts[o.buyer_location] !== undefined) locCounts[o.buyer_location]++; });
  const labels = Object.keys(locCounts).filter(l => locCounts[l] > 0);
  const data   = labels.map(l => locCounts[l]);
  if (!labels.length) return;
  if (window._adminLocChart) window._adminLocChart.destroy();
  window._adminLocChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data,
      backgroundColor: ['#e85d04','#1a1a2e','#ffd60a','#2d9e5c','#e63946','#457b9d','#f4a261','#7c3aed'] }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
  });
}

// ══════════════════════════════════════════════════════════
// AD CAMPAIGN MANAGER
// ══════════════════════════════════════════════════════════

/** Load and render all campaigns in the Ads tab */
async function loadAdminAds() {
  const listEl = document.getElementById('admin-ads-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading campaigns…</div>';

  const [campaignsRes, storesRes] = await Promise.all([
    apiGet('ad_campaigns', 'limit=100'),
    apiGet('stores', 'limit=200')
  ]);
  const campaigns = campaignsRes?.data || [];
  const allStores = storesRes?.data   || [];

  if (!campaigns.length) {
    listEl.innerHTML = `
<div class="empty-state" style="padding:40px">
  <i class="fas fa-ad" style="font-size:2rem;color:var(--text-muted)"></i>
  <h3 style="margin-top:12px">No campaigns yet</h3>
  <p>Create your first ad campaign to promote store products across the platform.</p>
  <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showAddAdCampaignModal()">
    <i class="fas fa-plus"></i> New Campaign
  </button>
</div>`;
    return;
  }

  listEl.innerHTML = campaigns.map(c => adminAdCampaignRowHTML(c, allStores)).join('');
}

/** HTML card for a single campaign row */
function adminAdCampaignRowHTML(c, allStores) {
  const storeIds   = Array.isArray(c.store_ids) ? c.store_ids : [];
  const pages      = Array.isArray(c.pages)     ? c.pages     : [];
  const storeNames = storeIds.map(sid => {
    const s = allStores.find(st => st.id === sid);
    return s ? escHtml(s.name) : `<span style="color:var(--text-muted)">${sid.slice(0,8)}…</span>`;
  });

  const statusColor = c.status === 'active' ? 'var(--success)' :
                      c.status === 'paused'  ? 'var(--warning)'  : 'var(--text-muted)';
  const statusIcon  = c.status === 'active' ? 'fa-circle' :
                      c.status === 'paused'  ? 'fa-pause-circle' : 'fa-stop-circle';

  const now       = Date.now();
  const endDate   = c.end_date ? Number(c.end_date) : null;
  const isExpired = endDate && now > endDate;
  const daysLeft  = endDate ? Math.max(0, Math.ceil((endDate - now) / 86400000)) : '∞';

  const intervalLabel = c.interval_value
    ? `${c.interval_value}s per slide`
    : 'Not set';

  // Build per-store budget summary
  const budgets = c.store_budgets || {};
  const budgetSummary = storeIds.map(sid => {
    const s    = allStores.find(st => st.id === sid);
    const name = s ? escHtml(s.name) : sid.slice(0,8) + '…';
    const mins = budgets[sid] || 30;
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:2px 8px;margin:2px;font-size:.7rem">
      <strong>${name}</strong><span style="color:var(--text-muted)">${mins} min/day</span>
    </span>`;
  }).join('');
  const durationLabel = c.duration_days ? `${c.duration_days} day${c.duration_days !== 1 ? 's' : ''}` : '—';

  return `
<div class="card" style="margin-bottom:12px" id="ad-campaign-row-${c.id}">
  <div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <i class="fas ${statusIcon}" style="color:${statusColor};font-size:.85rem"></i>
          <span style="font-weight:700;font-size:.92rem">${escHtml(c.name || 'Unnamed Campaign')}</span>
          ${isExpired ? '<span style="background:var(--danger);color:#fff;font-size:.6rem;padding:2px 7px;border-radius:10px;font-weight:700">EXPIRED</span>' : ''}
        </div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">
          <i class="fas fa-clock"></i> ${intervalLabel} &nbsp;·&nbsp;
          <i class="fas fa-calendar-alt"></i> ${durationLabel} &nbsp;·&nbsp;
          <i class="fas fa-hourglass-half"></i> ${daysLeft} days left
        </div>
        <div style="font-size:.75rem;margin-bottom:6px">
          <strong>Pages:</strong>
          ${pages.map(p => `<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:10px;font-size:.7rem;margin-right:4px">${p}</span>`).join('') || '—'}
        </div>
        <div style="font-size:.75rem;color:var(--text-light);margin-top:4px">
          <strong>Stores &amp; daily budgets (${storeIds.length}):</strong><br>
          <div style="margin-top:4px;line-height:1.8">${budgetSummary || '—'}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${c.status === 'active'
          ? `<button class="btn btn-ghost btn-sm" style="color:var(--warning);border:1px solid var(--warning)"
                     onclick="toggleAdCampaignStatus('${c.id}','paused')">
               <i class="fas fa-pause"></i> Pause
             </button>`
          : `<button class="btn btn-success btn-sm"
                     onclick="toggleAdCampaignStatus('${c.id}','active')">
               <i class="fas fa-play"></i> Activate
             </button>`}
        <button class="btn btn-outline btn-sm" onclick="showEditAdCampaignModal('${c.id}')">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
                onclick="deleteAdCampaign('${c.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  </div>
</div>`;
}

/** Toggle the per-store budget row when a store checkbox is checked/unchecked */
function _adToggleBudgetRow(storeId, checked) {
  const row = document.getElementById('ad-budget-row-' + storeId);
  if (row) row.style.display = checked ? 'flex' : 'none';
}

/** Show modal to create a new campaign */
async function showAddAdCampaignModal() {
  const storesRes = await apiGet('stores', 'limit=200');
  const allStores = (storesRes?.data || []).filter(s => s.status === 'active');
  _showAdCampaignModal(null, allStores);
}

/** Show modal to edit an existing campaign */
async function showEditAdCampaignModal(campaignId) {
  const [campaignData, storesRes] = await Promise.all([
    apiFetch('ad_campaigns/' + campaignId),
    apiGet('stores', 'limit=200')
  ]);
  const allStores = (storesRes?.data || []).filter(s => s.status === 'active');
  _showAdCampaignModal(campaignData, allStores);
}

/** Shared modal builder for create / edit */
function _showAdCampaignModal(campaign, allStores) {
  const isEdit    = !!campaign;
  const storeIds  = isEdit && Array.isArray(campaign.store_ids) ? campaign.store_ids : [];
  const pages     = isEdit && Array.isArray(campaign.pages)     ? campaign.pages     : ['home','shop','stores'];
  const startDate = isEdit && campaign.start_date
    ? new Date(Number(campaign.start_date)).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const endMs     = isEdit && campaign.end_date ? Number(campaign.end_date) : Date.now() + 7 * 86400000;
  const endDate   = new Date(endMs).toISOString().slice(0, 10);

  const budgets = isEdit && campaign.store_budgets ? campaign.store_budgets : {};

  const storeOptions = allStores.map(s => `
<label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:var(--radius-sm);cursor:pointer;transition:background var(--transition)"
       onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
  <input type="checkbox" value="${s.id}" name="ad-store-check"
         ${storeIds.includes(s.id) ? 'checked' : ''}
         style="width:16px;height:16px;accent-color:var(--primary)"
         onchange="_adToggleBudgetRow('${s.id}', this.checked)">
  <img src="${s.logo_url || 'https://via.placeholder.com/32x32?text=S'}"
       style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0"
       onerror="this.src='https://via.placeholder.com/32x32?text=S'">
  <span style="font-size:.85rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.name)}</span>
  <span style="font-size:.72rem;color:var(--text-muted)">${s.location}</span>
</label>
<div class="ad-budget-row" id="ad-budget-row-${s.id}"
     style="display:${storeIds.includes(s.id) ? 'flex' : 'none'};align-items:center;gap:8px;padding:2px 8px 10px 52px">
  <i class="fas fa-clock" style="font-size:.75rem;color:var(--text-muted)"></i>
  <input type="number" min="1" max="1440"
         id="ad-budget-${s.id}" name="ad-store-budget"
         data-store="${s.id}"
         value="${budgets[s.id] || 30}"
         style="width:65px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem;text-align:center">
  <span style="font-size:.78rem;color:var(--text-muted)">mins / day on banner</span>
</div>`).join('');

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">${isEdit ? '✏️ Edit Campaign' : '🎯 New Ad Campaign'}</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body" style="max-height:75vh;overflow-y:auto">

  <div class="form-group">
    <label class="form-label">Campaign Name *</label>
    <input id="ac-name" class="form-control" placeholder="e.g. Summer Promo"
           value="${isEdit ? escHtml(campaign.name || '') : ''}">
  </div>

  <div class="form-group">
    <label class="form-label">Show on Pages</label>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">
      ${['home','shop','stores'].map(p => `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" name="ad-page-check" value="${p}"
               ${pages.includes(p) ? 'checked' : ''}
               style="width:16px;height:16px;accent-color:var(--primary)">
        ${p.charAt(0).toUpperCase() + p.slice(1)}
      </label>`).join('')}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div class="form-group">
      <label class="form-label">Slide Duration (seconds) *</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="ac-interval-value" type="number" min="2" max="60" class="form-control"
               style="width:80px" value="${isEdit && campaign.interval_unit === 'seconds' ? (campaign.interval_value || 5) : 5}">
        <input type="hidden" id="ac-interval-unit" value="seconds">
        <span style="font-size:.82rem;color:var(--text-muted)">sec per slide</span>
      </div>
      <div class="form-hint">How long each product slide shows (2–60 s)</div>
    </div>
    <div class="form-group">
      <label class="form-label">Duration (days) *</label>
      <input id="ac-duration" type="number" min="1" class="form-control"
             value="${isEdit ? (campaign.duration_days || 7) : 7}">
      <div class="form-hint">How many days this campaign runs</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div class="form-group">
      <label class="form-label">Start Date</label>
      <input id="ac-start-date" type="date" class="form-control" value="${startDate}">
    </div>
    <div class="form-group">
      <label class="form-label">End Date</label>
      <input id="ac-end-date" type="date" class="form-control" value="${endDate}">
    </div>
  </div>

  <div class="form-group">
    <label class="form-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" id="ac-show-store-name"
             ${(!isEdit || campaign.show_store_name !== false) ? 'checked' : ''}
             style="width:16px;height:16px;accent-color:var(--primary)">
      Show store name on banner slide
    </label>
  </div>

  <div class="form-group">
    <label class="form-label">Status</label>
    <select id="ac-status" class="form-control form-select">
      <option value="active" ${(!isEdit || campaign.status === 'active') ? 'selected' : ''}>Active</option>
      <option value="paused" ${(isEdit && campaign.status === 'paused')  ? 'selected' : ''}>Paused</option>
    </select>
  </div>

  <div class="form-group">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <label class="form-label" style="margin-bottom:0">
        Select Stores <span style="color:var(--text-muted);font-weight:400">(${allStores.length} active)</span>
      </label>
      ${allStores.length ? `
      <div style="display:flex;gap:8px">
        <button type="button" class="btn btn-ghost btn-sm" style="font-size:.72rem;padding:2px 8px"
                onclick="document.querySelectorAll('input[name=ad-store-check]').forEach(cb=>cb.checked=true)">
          All
        </button>
        <button type="button" class="btn btn-ghost btn-sm" style="font-size:.72rem;padding:2px 8px;color:var(--text-muted)"
                onclick="document.querySelectorAll('input[name=ad-store-check]').forEach(cb=>cb.checked=false)">
          None
        </button>
      </div>` : ''}
    </div>
    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px">
      ${allStores.length
        ? storeOptions
        : '<p style="text-align:center;padding:16px;color:var(--text-muted);font-size:.85rem">No active stores found</p>'}
    </div>
    <div class="form-hint">Check a store to include it. Set how many <strong>minutes per day</strong> its products appear — more minutes = more slide slots proportionally.</div>
  </div>

  <button class="btn btn-primary" style="width:100%" onclick="saveAdCampaign(${isEdit ? `'${campaign.id}'` : 'null'})">
    <i class="fas fa-${isEdit ? 'save' : 'rocket'}"></i> ${isEdit ? 'Save Changes' : 'Launch Campaign'}
  </button>
</div>`, true);
}

/** Save (create or update) a campaign */
async function saveAdCampaign(campaignId) {
  const name          = document.getElementById('ac-name')?.value?.trim();
  const intervalValue = parseInt(document.getElementById('ac-interval-value')?.value) || 5;
  const intervalUnit  = document.getElementById('ac-interval-unit')?.value || 'seconds';
  const durationDays  = parseInt(document.getElementById('ac-duration')?.value) || 7;
  const startDateStr  = document.getElementById('ac-start-date')?.value;
  const endDateStr    = document.getElementById('ac-end-date')?.value;
  const showStoreName = document.getElementById('ac-show-store-name')?.checked ?? true;
  const status        = document.getElementById('ac-status')?.value || 'active';

  const pages = [...document.querySelectorAll('input[name="ad-page-check"]:checked')]
    .map(cb => cb.value);
  const storeIds = [...document.querySelectorAll('input[name="ad-store-check"]:checked')]
    .map(cb => cb.value);

  // Collect per-store daily minute budgets
  const storeBudgets = {};
  document.querySelectorAll('input[name="ad-store-budget"]').forEach(inp => {
    const sid = inp.dataset.store;
    if (sid && storeIds.includes(sid)) {
      storeBudgets[sid] = Math.max(1, parseInt(inp.value) || 30);
    }
  });

  if (!name) { showToast('Campaign name is required', 'error'); return; }
  if (!pages.length) { showToast('Select at least one page', 'error'); return; }
  if (!storeIds.length) { showToast('Select at least one store', 'error'); return; }

  const startTs = startDateStr ? new Date(startDateStr).getTime() : Date.now();
  const endTs   = endDateStr
    ? new Date(endDateStr).getTime() + 86399000 // end of that day
    : startTs + durationDays * 86400000;

  const payload = {
    name,
    store_ids:       storeIds,
    store_budgets:   JSON.stringify(storeBudgets),  // stored as text in DB, parsed by AdEngine
    pages,
    interval_value:  intervalValue,
    interval_unit:   intervalUnit,
    duration_days:   durationDays,
    start_date:      startTs,
    end_date:        endTs,
    show_store_name: showStoreName,
    status,
    created_by:      App.currentUser?.id || ''
  };

  const saveBtn = document.querySelector('.modal-body .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  let result;
  if (campaignId) {
    result = await apiPut('ad_campaigns', campaignId, payload);
  } else {
    result = await apiPost('ad_campaigns', payload);
  }

  if (result) {
    showToast(campaignId ? 'Campaign updated ✅' : 'Campaign launched 🚀', 'success');
    closeModalForce();
    await loadAdminAds();
    // Refresh banners on-page so changes take effect immediately
    if (typeof refreshAdBanners === 'function') refreshAdBanners();
  } else {
    showToast('Failed to save campaign', 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; }
  }
}

/** Toggle a campaign between active / paused */
async function toggleAdCampaignStatus(campaignId, newStatus) {
  await apiPatch('ad_campaigns', campaignId, { status: newStatus });
  showToast(newStatus === 'active' ? 'Campaign activated ▶' : 'Campaign paused ⏸', 'info');
  await loadAdminAds();
  if (typeof refreshAdBanners === 'function') refreshAdBanners();
}

/** Delete a campaign after confirmation */
async function deleteAdCampaign(campaignId) {
  if (!confirm('Delete this ad campaign? This cannot be undone.')) return;
  await apiDelete('ad_campaigns', campaignId);
  showToast('Campaign deleted', 'info');
  await loadAdminAds();
  if (typeof refreshAdBanners === 'function') refreshAdBanners();
}

async function renderAdminStorefronts() {
  const listEl = document.getElementById('admin-storefronts-list');
  if (!listEl) return;

  const res = await apiGet('stores', 'limit=200');
  const rawStores = res ? res.data || [] : [];
  
  // Remove duplicates
  const stores = [];
  const seenIds = new Set();
  for (const s of rawStores) {
    if (s && s.id && !seenIds.has(s.id)) {
      seenIds.add(s.id);
      stores.push(s);
    }
  }

  App.allStores = stores;
  
  const pending = stores.filter(s => s.storefront_status === 'pending_approval');
  const approved = stores.filter(s => s.storefront_status === 'approved');
  const draft = stores.filter(s => s.storefront_status === 'draft' || s.storefront_status === 'inactive');
  
  // Helper: get a small subscription badge for admin view
  const getSubBadge = (s) => {
    if (!s.subscription_plan || !s.subscription_status) {
      return `<span style="font-size:.65rem;background:#f3f4f6;color:#6b7280;padding:1px 6px;border-radius:4px;margin-left:4px">No Sub</span>`;
    }
    const end = s.subscription_end ? new Date(s.subscription_end) : null;
    const now = new Date();
    const expired = end && end < now;
    const daysLeft = end ? Math.max(0, Math.ceil((end - now) / 86400000)) : null;
    const expiring = daysLeft !== null && daysLeft <= 7 && !expired;
    const planNames = { starter: '🌱 Starter', growth: '🚀 Growth', pro: '💎 Pro' };
    const planLabel = planNames[s.subscription_plan] || s.subscription_plan;
    if (expired) return `<span style="font-size:.65rem;background:#fef2f2;color:#991b1b;padding:1px 6px;border-radius:4px;margin-left:4px">${planLabel} — EXPIRED</span>`;
    if (expiring) return `<span style="font-size:.65rem;background:#fff7ed;color:#c2410c;padding:1px 6px;border-radius:4px;margin-left:4px">${planLabel} — ${daysLeft}d left ⚠️</span>`;
    return `<span style="font-size:.65rem;background:#d1fae5;color:#065f46;padding:1px 6px;border-radius:4px;margin-left:4px">${planLabel} — until ${end ? end.toLocaleDateString() : '?'}</span>`;
  };

  const renderItemHTML = (s, badgeText, badgeBg, badgeColor, actionsHTML) => `
    <div class="card" style="margin-bottom:12px;border:1px solid var(--border)">
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 16px">
        <div style="flex:1;min-width:200px">
          <h4 style="font-weight:700;font-size:.88rem;margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${escHtml(s.name)}
            <span style="font-size:.72rem;background:${badgeBg};color:${badgeColor};padding:2px 6px;border-radius:4px;font-weight:600">${badgeText}</span>
            ${getSubBadge(s)}
          </h4>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">
            <div><strong>Slogan:</strong> ${escHtml(s.slogan || 'None')}</div>
            <div><strong>Link Slug:</strong> <code style="background:var(--bg);padding:2px 4px;border-radius:3px">happamart.com/store/${s.slug || s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</code></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${actionsHTML}
        </div>
      </div>
    </div>
  `;


  let html = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px">
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:var(--primary)">${pending.length}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">Pending Requests</div>
      </div>
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:#16a34a">${approved.length}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">Approved Sites</div>
      </div>
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:var(--text-muted)">${draft.length}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">Draft/Disabled Sites</div>
      </div>
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:#7c3aed">${stores.filter(s => s.subscription_status === 'active' && s.subscription_end && new Date(s.subscription_end) > new Date()).length}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">Active Subscriptions</div>
      </div>
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:1.1rem;font-weight:800;color:#dc2626">${stores.filter(s => s.subscription_end && new Date(s.subscription_end) < new Date()).length}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">Expired Subs</div>
      </div>
    </div>
  `;


  // 1. Pending Section
  html += `<h3 style="font-size:.9rem;font-weight:800;margin:16px 0 8px"><i class="fas fa-clock" style="color:#d97706"></i> Storefront Requests (${pending.length})</h3>`;
  if (pending.length) {
    html += pending.map(s => renderItemHTML(s, 'Pending Review', '#fef3c7', '#d97706', `
      <button class="btn btn-sm btn-outline" style="color:var(--primary);border-color:var(--primary)" onclick="showPage('store-detail'); renderStoreDetail('${s.id}')">
        <i class="fas fa-eye"></i> Preview
      </button>
      <button class="btn btn-sm btn-success" style="background:#16a34a;border:none;color:#fff" onclick="approveStorefront('${s.id}')">
        <i class="fas fa-check"></i> Approve
      </button>
      <button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="rejectStorefront('${s.id}')">
        <i class="fas fa-times"></i> Reject
      </button>
    `)).join('');
  } else {
    html += '<p style="font-size:.8rem;color:var(--text-muted);padding:10px 0">No pending storefront launch requests.</p>';
  }

  // 2. Approved Section
  html += `<h3 style="font-size:.9rem;font-weight:800;margin:24px 0 8px"><i class="fas fa-check-circle" style="color:#16a34a"></i> Approved & Live Storefronts (${approved.length})</h3>`;
  if (approved.length) {
    html += approved.map(s => renderItemHTML(s, 'Live', '#d1fae5', '#065f46', `
      <button class="btn btn-sm btn-outline" style="color:var(--primary);border-color:var(--primary)" onclick="showPage('store-detail'); renderStoreDetail('${s.id}')">
        <i class="fas fa-eye"></i> Preview
      </button>
      <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none" onclick="adminGrantSubscription('${s.id}')">
        <i class="fas fa-gift"></i> Grant Sub
      </button>
      <button class="btn btn-sm" style="background:#9a3412;color:#fff;border:none" onclick="adminRevokeSubscription('${s.id}')">
        <i class="fas fa-times-circle"></i> Revoke Sub
      </button>
      <button class="btn btn-sm btn-danger" style="background:var(--danger);border:none;color:#fff" onclick="disableStorefront('${s.id}')">
        <i class="fas fa-ban"></i> Disable
      </button>
    `)).join('');
  } else {
    html += '<p style="font-size:.8rem;color:var(--text-muted);padding:10px 0">No active storefronts live yet.</p>';
  }

  // 3. Draft/Inactive Section
  html += `<h3 style="font-size:.9rem;font-weight:800;margin:24px 0 8px"><i class="fas fa-folder-open" style="color:var(--text-muted)"></i> Draft/Inactive Storefronts (${draft.length})</h3>`;
  if (draft.length) {
    html += draft.map(s => renderItemHTML(s, 'Draft / Inactive', '#f3f4f6', 'var(--text-muted)', `
      <button class="btn btn-sm btn-outline" style="color:var(--primary);border-color:var(--primary)" onclick="showPage('store-detail'); renderStoreDetail('${s.id}')">
        <i class="fas fa-eye"></i> Preview
      </button>
      <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none" onclick="adminGrantSubscription('${s.id}')">
        <i class="fas fa-gift"></i> Grant Sub
      </button>
      <button class="btn btn-sm btn-success" style="background:#16a34a;border:none;color:#fff" onclick="approveStorefront('${s.id}')">
        <i class="fas fa-globe"></i> Make Live
      </button>
      <button class="btn btn-sm btn-danger" style="background:var(--danger);border:none;color:#fff" onclick="deleteStorefront('${s.id}')">
        <i class="fas fa-trash"></i> Delete
      </button>
    `)).join('');
  } else {
    html += '<p style="font-size:.8rem;color:var(--text-muted);padding:10px 0">No draft storefronts.</p>';
  }

  listEl.innerHTML = html;
}

async function approveStorefront(storeId) {
  if (!confirm('Approve this storefront layout? It will go live immediately.')) return;
  
  const idx = App.allStores.findIndex(s => String(s.id) === String(storeId));
  if (idx !== -1) {
    App.allStores[idx].storefront_status = 'approved';
    try {
      localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores));
    } catch(e){}
  }
  
  showToast('Approving storefront...', 'info');
  await apiPatch('stores', storeId, { storefront_status: 'approved' }).catch(() => {});
  showToast('Storefront approved successfully! 🎉', 'success');
  renderAdminStorefronts();
}

async function rejectStorefront(storeId) {
  const reason = prompt('Enter a reason for rejecting this storefront request (will be saved in draft):');
  if (reason === null) return;

  const idx = App.allStores.findIndex(s => String(s.id) === String(storeId));
  if (idx !== -1) {
    App.allStores[idx].storefront_status = 'draft';
    App.allStores[idx].slogan = (App.allStores[idx].slogan || '') + ` (Admin feedback: ${reason})`;
    try {
      localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores));
    } catch(e){}
  }

  showToast('Rejecting storefront request...', 'info');
  await apiPatch('stores', storeId, { 
    storefront_status: 'draft',
    slogan: App.allStores[idx].slogan
  }).catch(() => {});
  showToast('Storefront request rejected.', 'warning');
  renderAdminStorefronts();
}

async function disableStorefront(storeId) {
  if (!confirm('Are you sure you want to disable/revoke this storefront? It will no longer be publicly accessible.')) return;

  const idx = App.allStores.findIndex(s => String(s.id) === String(storeId));
  if (idx !== -1) {
    App.allStores[idx].storefront_status = 'draft';
    try {
      localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores));
    } catch(e){}
  }

  showToast('Disabling storefront...', 'info');
  await apiPatch('stores', storeId, { storefront_status: 'draft' }).catch(() => {});
  showToast('Storefront disabled successfully.', 'warning');
  renderAdminStorefronts();
}

async function deleteStorefront(storeId) {
  if (!confirm('Are you sure you want to permanently delete this store and all its associated products/reviews from the database? This action cannot be undone.')) return;

  showToast('Cleaning store dependencies...', 'info');
  try {
    // 1. Fetch and delete reviews & products
    const prodRes = await apiGet('products', 'limit=500').catch(() => null);
    const storeProducts = (prodRes?.data || []).filter(p => String(p.store_id) === String(storeId));
    
    const revRes = await apiGet('reviews', 'limit=500').catch(() => null);
    const storeReviews = (revRes?.data || []).filter(r => 
      String(r.store_id) === String(storeId) || storeProducts.some(p => String(p.id) === String(r.product_id))
    );

    for (const r of storeReviews) {
      await apiDelete('reviews', r.id).catch(() => {});
    }
    for (const p of storeProducts) {
      await apiDelete('products', p.id).catch(() => {});
    }

    // 2. Fetch and delete orders & packages
    const pkgRes = await apiGet('packages', 'limit=500').catch(() => null);
    const storePkgs = (pkgRes?.data || []).filter(pkg => String(pkg.store_id) === String(storeId));
    for (const pkg of storePkgs) {
      await apiDelete('packages', pkg.id).catch(() => {});
    }

    const ordRes = await apiGet('orders', 'limit=500').catch(() => null);
    const storeOrders = (ordRes?.data || []).filter(o => String(o.store_id) === String(storeId));
    for (const o of storeOrders) {
      await apiDelete('orders', o.id).catch(() => {});
    }

    // 3. Fetch and delete ad campaigns
    const adsRes = await apiGet('ad_campaigns', 'limit=500').catch(() => null);
    const storeAds = (adsRes?.data || []).filter(ad => String(ad.store_id) === String(storeId));
    for (const ad of storeAds) {
      await apiDelete('ad_campaigns', ad.id).catch(() => {});
    }
  } catch(e) {
    console.error('Cascading delete prep failed:', e);
  }

  showToast('Deleting store record...', 'info');
  const res = await apiDelete('stores', storeId).catch(err => {
    console.error('Delete store error:', err);
    return null;
  });
  
  // Clean local state and re-render
  App.allStores = App.allStores.filter(s => String(s.id) !== String(storeId));
  try {
    localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores));
  } catch(e){}
  
  showToast('Store deleted successfully! 🗑️', 'success');
  renderAdminStorefronts();
}

// ── Admin Subscription Management ─────────────────────────────────────────────

async function adminGrantSubscription(storeId) {
  const store = App.allStores.find(s => String(s.id) === String(storeId));
  if (!store) return;

  const planKey = prompt(`Grant free subscription plan for "${store.name}".\nEnter plan: starter, growth, or pro`, store.subscription_plan || 'growth');
  if (!planKey || !['starter','growth','pro'].includes(planKey.toLowerCase())) {
    showToast('Invalid plan. Use: starter, growth, or pro', 'error');
    return;
  }
  const months = parseInt(prompt('How many free months?', '1') || '1', 10);
  if (!months || months < 1) return;

  const idx = App.allStores.findIndex(s => String(s.id) === String(storeId));
  const now = new Date();
  const currentEnd = App.allStores[idx]?.subscription_end ? new Date(App.allStores[idx].subscription_end) : null;
  const startFrom = (currentEnd && currentEnd > now) ? currentEnd : now;
  const newEnd = new Date(startFrom);
  newEnd.setMonth(newEnd.getMonth() + months);

  App.allStores[idx].subscription_plan = planKey.toLowerCase();
  App.allStores[idx].subscription_status = 'active';
  App.allStores[idx].subscription_start = now.toISOString();
  App.allStores[idx].subscription_end = newEnd.toISOString();
  App.allStores[idx].subscription_method = 'admin_grant';

  try { localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores)); } catch(e){}
  await apiPatch('stores', storeId, {
    subscription_plan: planKey.toLowerCase(),
    subscription_status: 'active',
    subscription_start: now.toISOString(),
    subscription_end: newEnd.toISOString()
  }).catch(() => {});

  showToast(`✅ ${months} month(s) of ${planKey} plan granted to ${store.name} until ${newEnd.toLocaleDateString()}.`, 'success');
  renderAdminStorefronts();
}

async function adminRevokeSubscription(storeId) {
  const store = App.allStores.find(s => String(s.id) === String(storeId));
  if (!store) return;
  if (!confirm(`Revoke subscription for "${store.name}"? This will expire their plan immediately.`)) return;

  const idx = App.allStores.findIndex(s => String(s.id) === String(storeId));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  App.allStores[idx].subscription_status = 'revoked';
  App.allStores[idx].subscription_end = yesterday.toISOString();

  try { localStorage.setItem('happa_all_stores', JSON.stringify(App.allStores)); } catch(e){}
  await apiPatch('stores', storeId, {
    subscription_status: 'revoked',
    subscription_end: yesterday.toISOString()
  }).catch(() => {});

  showToast(`Subscription revoked for ${store.name}.`, 'warning');
  renderAdminStorefronts();
}

