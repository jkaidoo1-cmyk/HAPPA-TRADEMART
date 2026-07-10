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
      if (q.length >= 2) showSearchSuggestions(q);
      else hideSearchDropdown();
    }, 280);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (q) {
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
    p.status !== 'archived' && (
      p.name?.toLowerCase().includes(ql) ||
      p.tags?.some(t => t.toLowerCase().includes(ql)) ||
      p.category?.toLowerCase().includes(ql)
    )
  ).slice(0, 5);

  // Search stores by name + keywords
  const matchedStores = App.allStores.filter(s =>
    s.status === 'active' && (
      s.name?.toLowerCase().includes(ql) ||
      s.keywords?.some(k => k.toLowerCase().includes(ql)) ||
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
    p.status !== 'archived' && (
      p.name?.toLowerCase().includes(q) ||
      p.tags?.some(t => t.toLowerCase().includes(q)) ||
      p.category?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    )
  );

  const stores = App.allStores.filter(s =>
    s.status === 'active' && (
      s.name?.toLowerCase().includes(q) ||
      s.keywords?.some(k => k.toLowerCase().includes(q)) ||
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
${stores.map(s => storeCardHTML(s)).join('')}
<div style="margin-bottom:16px"></div>` : ''}

${products.length ? `
<h4 style="font-weight:700;font-size:.9rem;margin-bottom:8px">🛍 Products</h4>
<div class="product-grid" style="padding:0">
  ${products.map(p => productCardHTML(p)).join('')}
</div>` : ''}

${!products.length && !stores.length ? `
<div class="empty-state" style="padding:50px 20px">
  <i class="fas fa-search-minus"></i>
  <h3>No results found</h3>
  <p>Try different keywords or browse our marketplace</p>
  <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showPage('marketplace')">Browse All</button>
</div>` : ''}`;
}

// Highlight search term in text
function highlight(text, query) {
  if (!query || !text) return escHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escHtml(text).replace(new RegExp(`(${escaped})`, 'gi'),
    '<mark style="background:var(--accent);padding:0 2px;border-radius:2px">$1</mark>');
}
