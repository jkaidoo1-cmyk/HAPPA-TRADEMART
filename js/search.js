/* ============================================================
   HAPPA TRADEMART — Search Module
   ============================================================ */

let searchDebounce = null;

function initSearch() {
  const input = document.getElementById('nav-search-input');
  const dropdown = document.getElementById('search-dropdown');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const q = input.value.trim();
      if (q.length >= 2) {
        // On the cart page the search bar is repurposed for order tracking.
        if (App.currentPage === 'cart') showPackageTrackSuggestions(q);
        else showSearchSuggestions(q);
      } else hideSearchDropdown();
    }, 280);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (App.currentPage === 'cart') {
        trackFromSearchBar(q);
      } else {
        performSearch(q);
        window.hideHeaderSearchBar();
      }
    }
    if (e.key === 'Escape') window.hideHeaderSearchBar();
  });

  document.addEventListener('click', (e) => {
    // If click is outside search container and search trigger button, hide it
    if (!e.target.closest('#nav-search-container') && !e.target.closest('#top-nav-search-trigger')) {
      window.hideHeaderSearchBar();
    }
  });
}

window.toggleHeaderSearchBar = function(event) {
  if (event) event.stopPropagation();
  const container = document.getElementById('nav-search-container');
  if (!container) return;
  const isActive = container.classList.contains('mobile-active');
  if (!isActive) {
    window.showHeaderSearchBar();
  } else {
    window.hideHeaderSearchBar();
  }
};

window.showHeaderSearchBar = function() {
  const container = document.getElementById('nav-search-container');
  const input = document.getElementById('nav-search-input');
  if (!container) return;
  container.classList.add('mobile-active');
  if (input) {
    input.focus();
  }
};

window.hideHeaderSearchBar = function() {
  const container = document.getElementById('nav-search-container');
  const input = document.getElementById('nav-search-input');
  if (!container) return;
  container.classList.remove('mobile-active');
  if (input) {
    input.value = '';
  }
  hideSearchDropdown();
};

function hideSearchDropdown() {
  const dd = document.getElementById('search-dropdown');
  if (dd) dd.classList.add('hidden');
}

async function showSearchSuggestions(q) {
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;

  const ql = q.toLowerCase();

  // Search products by name + tags
  const matchedProducts = App.allProducts.filter(p =>
    p.status !== 'archived' && shouldShowProductOnMainWebsite(p) && (
      p.name?.toLowerCase().includes(ql) ||
      p.tags?.some(t => t.toLowerCase().includes(ql)) ||
      p.category?.toLowerCase().includes(ql)
    )
  ).slice(0, 5);

  // Search stores by name + category
  const matchedStores = App.allStores.filter(s =>
    isStoreVisibleOnMain(s) && shouldShowStoreOnMainWebsite(s) && (
      s.name?.toLowerCase().includes(ql) ||
      s.category?.toLowerCase().includes(ql)
    )
  ).slice(0, 3);

  // Build suggestions
  let html = '';

  if (matchedProducts.length) {
    html += `<div style="padding:8px 14px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Products</div>`;
    html += matchedProducts.map(p => `
    <div class="search-suggestion" onclick="openProduct('${p.id}');hideSearchDropdown()">
      <img src="${p.images?.[0]||'https://via.placeholder.com/30x30?text=P'}" style="width:30px;height:30px;border-radius:4px;object-fit:cover" onerror="this.src='https://via.placeholder.com/30x30?text=P'">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${highlight(p.name||'', q)}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">GHS ${p.price} · ${p.location}</div>
      </div>
    </div>`).join('');
  }

  if (matchedStores.length) {
    html += `<div style="padding:8px 14px 4px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Stores</div>`;
    html += matchedStores.map(s => `
    <div class="search-suggestion" onclick="openStore('${s.id}');hideSearchDropdown()">
      <img src="${s.logo_url||'https://via.placeholder.com/30x30?text=S'}" style="width:30px;height:30px;border-radius:4px;object-fit:cover" onerror="this.src='https://via.placeholder.com/30x30?text=S'">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.85rem">${highlight(s.name||'', q)}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">${s.category} · ${s.location}</div>
      </div>
    </div>`).join('');
  }

  if (!html) {
    html = `
    <div class="search-suggestion">
      <i class="fas fa-search"></i>
      <span style="color:var(--text-muted)">No results for "<strong>${escHtml(q)}</strong>"</span>
    </div>
    <div class="search-suggestion" onclick="performSearch('${escHtml(q)}')">
      <i class="fas fa-arrow-right" style="color:var(--primary)"></i>
      <span style="color:var(--primary);font-weight:600">Search all products for "${escHtml(q)}"</span>
    </div>`;
  } else {
    html += `
    <div class="search-suggestion" onclick="performSearch('${escHtml(q)}');hideSearchDropdown()" style="border-top:1px solid var(--border)">
      <i class="fas fa-search" style="color:var(--primary)"></i>
      <span style="color:var(--primary);font-weight:600">See all results for "${escHtml(q)}"</span>
    </div>`;
  }

  dd.innerHTML = html;
  dd.classList.remove('hidden');
}

async function performSearch(query) {
  const input = document.getElementById('nav-search-input');
  if (input) input.value = query;
  hideSearchDropdown();

  const q = query.toLowerCase();

  // Ensure data loaded
  if (!App.allProducts.length) {
    const res = await apiGet('products', 'limit=100');
    App.allProducts = res ? res.data || [] : [];
  }
  if (!App.allStores.length) {
    const sr = await apiGet('stores', 'limit=50');
    App.allStores = sr ? sr.data || [] : [];
  }

  const products = App.allProducts.filter(p =>
    p.status !== 'archived' && shouldShowProductOnMainWebsite(p) && (
      p.name?.toLowerCase().includes(q) ||
      p.tags?.some(t => t.toLowerCase().includes(q)) ||
      p.category?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    )
  );

  const stores = App.allStores.filter(s =>
    isStoreVisibleOnMain(s) && shouldShowStoreOnMainWebsite(s) && (
      s.name?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q)
    )
  );

  showPage('search');

  const c = document.getElementById('search-results-content');
  if (!c) return;

  c.innerHTML = `
<div style="margin-bottom:12px">
  <h3 style="font-weight:700">Results for "<em>${escHtml(query)}</em>"</h3>
  <div style="font-size:.8rem;color:var(--text-muted)">${products.length} product${products.length!==1?'s':''} · ${stores.length} store${stores.length!==1?'s':''}</div>
</div>

${stores.length ? `
<h4 style="font-weight:700;font-size:.9rem;margin-bottom:8px">🏪 Stores</h4>
<div id="search-stores-container"></div>
<div style="margin-bottom:16px"></div>` : ''}

${products.length ? `
<h4 style="font-weight:700;font-size:.9rem;margin-bottom:8px">🛍 Products</h4>
<div class="product-grid" id="search-products-container" style="padding:0"></div>` : ''}

${!products.length && !stores.length ? `
<div class="empty-state" style="padding:50px 20px">
  <i class="fas fa-search-minus"></i>
  <h3>No results found</h3>
  <p>Try different keywords or browse our marketplace</p>
  <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showPage('marketplace')">Browse All</button>
</div>` : ''}`;

  if (stores.length) {
    const sEl = document.getElementById('search-stores-container');
    if (sEl) renderItemsProgressively(sEl, stores, s => storeCardHTML(s), { initialBatch: 4, batchSize: 4 });
  }

  if (products.length) {
    const pEl = document.getElementById('search-products-container');
    if (pEl) renderItemsProgressively(pEl, products, p => productCardHTML(p), { initialBatch: 6, batchSize: 6 });
  }
}

// Highlight search term in text
function highlight(text, query) {
  if (!query || !text) return escHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escHtml(text).replace(new RegExp(`(${escaped})`, 'gi'),
    '<mark style="background:var(--accent);padding:0 2px;border-radius:2px">$1</mark>');
}

// ── Order tracking via the header search bar (used on the cart page) ─────
// On the cart page the global search bar does product/store search, which is
// useless there. It becomes an order tracker: type a package code (PK-…)
// and get the live tracking card right in the dropdown.
let pkgSearchCache = null;
let pkgSearchCacheAt = 0;

async function fetchPkgSearchCache() {
  const now = Date.now();
  if (!pkgSearchCache || now - pkgSearchCacheAt > 30000) {
    const res = await apiGet('packages', 'limit=200');
    pkgSearchCache = res?.data || (Array.isArray(res) ? res : []);
    pkgSearchCacheAt = now;
  }
  return pkgSearchCache;
}

// Invalidate the cached package list right after a new order is placed, so a
// just-created package is findable immediately.
window.invalidatePackageSearchCache = function() {
  pkgSearchCache = null;
  pkgSearchCacheAt = 0;
};

function pkgStatusInfo(pkg) {
  const vs = pkg.vendor_status || 'pending';
  const as = pkg.admin_status || 'pending';
  const map = {
    pending: { text: 'Processing', css: 'pending', icon: 'fa-clock' },
    accepted: { text: 'Accepted', css: 'received', icon: 'fa-check' },
    received: { text: 'Received', css: 'received', icon: 'fa-store' },
    processed: { text: 'Ready', css: 'processed', icon: 'fa-box' },
    on_delivery: { text: 'On Delivery', css: 'on_delivery', icon: 'fa-truck' },
    delivered: { text: 'Delivered', css: 'delivered', icon: 'fa-check-double' },
    rejected: { text: 'Rejected', css: 'rejected', icon: 'fa-times-circle' }
  };
  if (vs === 'rejected') return map.rejected;
  if (as === 'delivered') return map.delivered;
  if (as === 'on_delivery') return map.on_delivery;
  if (vs === 'processed') return map.processed;
  if (vs === 'received' || vs === 'accepted') return map.received;
  return map.pending;
}

async function showPackageTrackSuggestions(q) {
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;
  let pkgs = [];
  try { pkgs = await fetchPkgSearchCache(); } catch (e) {}
  const ql = q.toLowerCase();
  const matches = pkgs.filter(p => String(p.package_code || p.code || '').toLowerCase().includes(ql)).slice(0, 5);

  dd.classList.remove('hidden');
  if (!matches.length) {
    dd.innerHTML = `<div style="padding:12px 14px;font-size:.82rem;color:var(--text-muted)"><i class="fas fa-search" style="margin-right:6px"></i>No package matches "${escHtml(q)}". Enter the full code, e.g. <strong>PK-12345</strong>.</div>`;
    return;
  }
  dd.innerHTML = `
    <div style="padding:8px 14px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Track Your Orders</div>
    ${matches.map(p => {
      const st = pkgStatusInfo(p);
      const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
      const code = String(p.package_code || p.id || '').replace(/'/g, "\\'");
      return `
      <div class="search-suggestion" onclick="trackPackageFromSearch('${code}')">
        <div style="font-size:1rem;color:var(--primary);width:30px;text-align:center"><i class="fas fa-cube"></i></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.85rem">${p.package_code || p.id}</div>
          <div style="font-size:.72rem;color:var(--text-muted)"><span class="status-badge status-${st.css}" style="font-size:.62rem;padding:2px 6px"><i class="fas ${st.icon}" style="margin-right:3px"></i>${st.text}</span> · ${dateStr}</div>
        </div>
      </div>`;
    }).join('')}
    <div style="padding:8px 14px;font-size:.72rem;color:var(--text-muted);border-top:1px solid var(--border)">Press Enter or click a code to see the full tracking.</div>`;
}

function buildPackageTrackCard(pkg) {
  const st = pkgStatusInfo(pkg);
  const vs = pkg.vendor_status || 'pending';
  const as = pkg.admin_status || 'pending';
  const items = (pkg.items || []).slice(0, 3);
  const dateStr = pkg.created_at ? new Date(pkg.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const total = parseFloat(pkg.total_amount || pkg.total || pkg.gross_amount) || 0;
  return `
  <div style="padding:12px 14px">
    <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer" onclick="showPackageDetailModal('${pkg.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:.78rem;font-weight:700"><i class="fas fa-cube" style="margin-right:3px;color:var(--primary)"></i>${pkg.package_code || pkg.id || ''}</span>
        <span class="status-badge status-${st.css}" style="font-size:.7rem;padding:3px 8px"><i class="fas ${st.icon}" style="margin-right:3px"></i>${st.text}</span>
      </div>
      <div class="order-tracking-bar" style="margin-bottom:6px">
        <div class="tracking-step ${vs !== 'pending' && vs !== 'rejected' ? 'done' : vs === 'rejected' ? 'fail' : 'active'}">
          <div class="tracking-dot"></div><div class="tracking-label">Vendor</div>
        </div>
        <div class="tracking-line ${vs === 'processed' || as !== 'pending' ? 'done' : ''}"></div>
        <div class="tracking-step ${as === 'on_delivery' || as === 'delivered' ? 'done' : vs === 'processed' ? 'active' : ''}">
          <div class="tracking-dot"></div><div class="tracking-label">In Transit</div>
        </div>
        <div class="tracking-line ${as === 'delivered' ? 'done' : ''}"></div>
        <div class="tracking-step ${as === 'delivered' ? 'done' : ''}">
          <div class="tracking-dot"></div><div class="tracking-label">Delivered</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        ${buildItemThumbsHTML(pkg.items, 3)}
        <div style="font-size:.75rem;color:var(--text-muted);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${items.map(i => escHtml(itemDisplayName(i.name))).filter(Boolean).join(', ')}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:.82rem;font-weight:700;color:var(--primary)">GHS ${total.toFixed(2)}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">${dateStr}</div>
      </div>
      <div style="font-size:.68rem;color:var(--text-muted);margin-top:6px"><i class="fas fa-hand-pointer"></i> Tap for full details</div>
    </div>
  </div>`;
}

async function trackPackageFromSearch(code) {
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;
  dd.classList.remove('hidden');
  dd.innerHTML = '<div style="padding:14px;font-size:.82rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Looking up package...</div>';
  try {
    const pkgs = await fetchPkgSearchCache();
    const pkg = pkgs.find(p => String(p.package_code || p.code || '').toUpperCase() === String(code).toUpperCase());
    if (!pkg) {
      dd.innerHTML = `<div style="padding:12px 14px;font-size:.82rem;color:var(--danger)">Package "${escHtml(code)}" not found.</div>`;
      return;
    }
    dd.innerHTML = buildPackageTrackCard(pkg);
  } catch (e) {
    dd.innerHTML = '<div style="padding:12px 14px;font-size:.82rem;color:var(--danger)">Failed to look up package. Try again.</div>';
  }
}
window.trackPackageFromSearch = trackPackageFromSearch;

async function trackFromSearchBar(q) {
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;
  dd.classList.remove('hidden');
  dd.innerHTML = '<div style="padding:14px;font-size:.82rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Looking up package...</div>';
  try {
    const pkgs = await fetchPkgSearchCache();
    const ql = q.toLowerCase();
    const pkg = pkgs.find(p => String(p.package_code || p.code || '').toLowerCase() === ql)
             || pkgs.find(p => String(p.package_code || p.code || '').toLowerCase().includes(ql));
    if (!pkg) {
      dd.innerHTML = `<div style="padding:12px 14px;font-size:.82rem;color:var(--danger)"><i class="fas fa-search" style="margin-right:6px"></i>No package found for "${escHtml(q)}". Try the full code, e.g. <strong>PK-12345</strong>.</div>`;
      return;
    }
    dd.innerHTML = buildPackageTrackCard(pkg);
  } catch (e) {
    dd.innerHTML = '<div style="padding:12px 14px;font-size:.82rem;color:var(--danger)">Failed to look up package. Try again.</div>';
  }
}

// Swap the header search bar between product/store search and order tracking
// depending on the current page. Also hides any open dropdown on page change.
window.updateHeaderSearchForPage = function() {
  const input = document.getElementById('nav-search-input');
  if (input) {
    input.placeholder = App.currentPage === 'cart'
      ? 'Track order — enter package code (PK-…)'
      : 'Search stores, products…';
  }
  hideSearchDropdown();
};
