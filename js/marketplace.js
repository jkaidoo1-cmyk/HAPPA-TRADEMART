/* ============================================================

   HAPPA TRADEMART — Marketplace & Product Detail

   ============================================================ */



let currentMarketFilter = 'all';



function setMarketFilter(filter, el) {

  currentMarketFilter = filter;

  document.querySelectorAll('#marketplace-filters .filter-chip').forEach(c => c.classList.remove('active'));

  if (el) el.classList.add('active');

  renderMarketplace();

}



async function renderMarketplace() {

  const grid    = document.getElementById('marketplace-grid');

  const empty   = document.getElementById('marketplace-empty');

  const counter = document.getElementById('market-count');

  if (!grid) return;



  // ── Services tab: fetch & render rendor posts, hide product grid ──

  if (currentMarketFilter === 'services') {

    await renderRendorServices(grid, empty, counter);

    return;

  }



  if (!App.isBackgroundRefresh) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  }


  // Always re-fetch products & stores so newly uploaded items appear
  try {
    const res = await apiGet('products', 'limit=500');
    App.allProducts = res ? res.data || [] : App.allProducts;
  } catch(e) { /* offline — use cached data */ }

  try {
    if (!App.allStores.length) {
      const sRes = await apiGet('stores', 'limit=200');
      App.allStores = sRes ? sRes.data || [] : App.allStores;
    }
  } catch(e) { /* offline — use cached data */ }



  let items = App.allProducts.filter(p => p.status !== 'archived');

  const ul  = App.currentUser?.location || '';

  const af  = App.advancedFilter || {};



  // Apply filters

  const f = currentMarketFilter;

  if (f === 'local')    items = items.filter(p => ul && p.location === ul);

  if (f === 'flash')    items = items.filter(p => p.is_flash_sale);

  if (f === 'Fashion')  items = items.filter(p => p.category?.includes('Fashion') || p.category?.includes('Footwear'));

  if (f === 'Electronics') items = items.filter(p => p.category?.includes('Electronic') || p.category?.includes('Audio') || p.category?.includes('Cable'));

  if (f === 'Beauty')   items = items.filter(p => p.category?.includes('Beauty') || p.category?.includes('Skin') || p.category?.includes('Makeup'));

  if (f === 'Food')     items = items.filter(p => p.category?.includes('Food') || p.category?.includes('Grocer'));



  // Advanced filter

  if (af.loc)    items = items.filter(p => p.location === af.loc);

  if (af.cat)    items = items.filter(p => p.category?.includes(af.cat.split(' ')[0]));

  if (af.min)    items = items.filter(p => p.price >= af.min);

  if (af.max && af.max !== Infinity) items = items.filter(p => p.price <= af.max);



  // Sort

  const sort = document.getElementById('market-sort')?.value || 'trending';

  if (sort === 'price_low')  items.sort((a,b) => a.price - b.price);

  if (sort === 'price_high') items.sort((a,b) => b.price - a.price);

  if (sort === 'rating')     items.sort((a,b) => (b.avg_rating||0) - (a.avg_rating||0));

  if (sort === 'trending')   items.sort((a,b) => (b.views||0) - (a.views||0));

  if (sort === 'newest')     items.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));



  if (counter) counter.textContent = `${items.length} product${items.length!==1?'s':''}`;



  if (!items.length) {

    grid.innerHTML = '';

    if (empty) empty.classList.remove('hidden');

    return;

  }

  if (empty) empty.classList.add('hidden');

  grid.innerHTML = items.map(p => productCardHTML(p)).join('');

}



// ── Rendor Services view (marketplace filter = 'services') ──

async function renderRendorServices(grid, empty, counter) {

  // Reset grid to single-column list layout for service posts

  grid.style.gridTemplateColumns = '1fr';

  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading services…</div>';

  if (empty) empty.classList.add('hidden');



  // Fetch active rendor posts and their owners in parallel

  const [postsRes, usersRes] = await Promise.all([

    apiGet('services', 'limit=200'),

    apiGet('users',    'limit=200')

  ]);

  const allPosts   = (postsRes?.data || []).filter(s => s.status === 'active' && !s.deleted);

  const allRendors = (usersRes?.data  || []).filter(u => u.role === 'rendor' && u.status === 'active');



  // Build a quick rendor lookup map

  const rendorMap = {};

  allRendors.forEach(r => { rendorMap[r.id] = r; });



  // Only show posts from approved rendors

  const posts = allPosts.filter(s => rendorMap[s.rendor_id]);



  if (counter) counter.textContent = `${posts.length} service${posts.length !== 1 ? 's' : ''}`;



  if (!posts.length) {

    grid.innerHTML = '';

    grid.style.gridTemplateColumns = '';

    if (empty) {

      empty.querySelector('h3').textContent  = 'No services yet';

      empty.querySelector('p').textContent   = 'Check back soon for freelance services';

      empty.classList.remove('hidden');

    }

    return;

  }



  grid.innerHTML = posts.map(s => rendorPostCardPublicHTML(s, rendorMap[s.rendor_id])).join('');

}



// ── Rendor post card (public / buyer-facing) ──────────────

function rendorPostCardPublicHTML(post, rendor) {

  const name     = escHtml(rendor?.rendor_display_name || rendor?.name || 'Rendor');

  const cat      = escHtml(post.category || '—');

  const avatar   = (rendor?.rendor_display_name || rendor?.name || 'R').charAt(0).toUpperCase();

  const verified = rendor?.id_verified

    ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:.68rem;background:#ede9fe;color:#7c3aed;border-radius:20px;padding:1px 7px;font-weight:700"><i class="fas fa-check-circle"></i> Verified</span>'

    : '';

  const price    = post.price

    ? `<span style="font-weight:800;color:#7c3aed;font-size:.9rem">From GHS ${parseFloat(post.price).toFixed(2)}</span>`

    : '';

  const desc     = post.description

    ? `<p style="font-size:.8rem;color:var(--text-light);margin-top:6px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${escHtml(post.description)}</p>`

    : '';

  const img      = post.image_url

    ? `<img src="${escHtml(post.image_url)}" alt="${escHtml(post.title)}"

            style="width:100%;height:160px;object-fit:cover;border-radius:var(--radius-sm) var(--radius-sm) 0 0"

            onerror="this.style.display='none'">`

    : '';



  return `

<div class="rendor-post-card" onclick="openRendorProfile('${rendor?.id || ''}')">

  ${img}

  <div style="padding:12px">

    <!-- Rendor identity -->

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">

      <div class="rendor-post-avatar">${avatar}</div>

      <div style="flex:1;min-width:0">

        <div style="font-weight:700;font-size:.85rem;display:flex;align-items:center;gap:5px;flex-wrap:wrap">

          ${name} ${verified}

        </div>

        <div style="font-size:.72rem;color:var(--text-muted)">

          <i class="fas fa-briefcase"></i> ${escHtml(rendor?.rendor_service_cat || cat)}

        </div>

      </div>

      ${price}

    </div>

    <!-- Post title & desc -->

    <div style="font-weight:700;font-size:.9rem;line-height:1.35">${escHtml(post.title)}</div>

    <div style="font-size:.72rem;color:var(--text-muted);margin-top:3px">

      <i class="fas fa-tag"></i> ${cat}

    </div>

    ${desc}

    <!-- CTA -->

    <div style="margin-top:10px;display:flex;justify-content:flex-end">

      <button class="btn btn-sm" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;font-size:.75rem"

              onclick="event.stopPropagation();openRendorProfile('${rendor?.id || ''}')">

        <i class="fas fa-address-card"></i> View Profile &amp; Contact

      </button>

    </div>

  </div>

</div>`;

}



// When leaving the 'services' view, reset the grid column layout

const _origSetMarketFilter = setMarketFilter;

// patch: reset grid template when switching away from 'services'

function setMarketFilter(filter, el) {

  currentMarketFilter = filter;

  document.querySelectorAll('#marketplace-filters .filter-chip').forEach(c => c.classList.remove('active'));

  if (el) el.classList.add('active');

  // Reset grid layout if switching away from services

  const grid = document.getElementById('marketplace-grid');

  if (grid && filter !== 'services') grid.style.gridTemplateColumns = '';

  renderMarketplace();

}



// ── Stores Page ──────────────────────────────────────────

let currentStoreFilter = 'all';

function setStoreFilter(filter, el) {

  currentStoreFilter = filter;

  document.querySelectorAll('#stores-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));

  if (el) el.classList.add('active');

  renderStores();

}



async function renderStores() {

  const grid  = document.getElementById('stores-grid');

  const empty = document.getElementById('stores-empty');

  if (!grid) return;



  // Always re-fetch stores so newly created stores appear
  try {
    const res = await apiGet('stores', 'limit=200');
    App.allStores = res ? res.data || [] : App.allStores;
  } catch(e) { /* offline — use cached data */ }



  let stores = App.allStores.filter(s => s.status === 'active' && s.vendor_id !== 'admin' && !(s.name || '').toLowerCase().includes('admin'));

  const ul = App.currentUser?.location || '';

  const f  = currentStoreFilter;

  if (f === 'local')  stores = stores.filter(s => ul && s.location === ul);

  if (['Fashion','Electronics','Beauty'].includes(f)) {

    stores = stores.filter(s => s.category?.includes(f));

  }



  if (!stores.length) {

    grid.innerHTML = '';

    if (empty) empty.classList.remove('hidden');

    return;

  }

  if (empty) empty.classList.add('hidden');

  grid.innerHTML = stores.map(s => storeCardHTML(s)).join('');

}



// ── Product Detail ────────────────────────────────────────

async function renderProductDetail(id) {
  try {
  const c = document.getElementById('product-detail-content');

  if (!c) return;

  if (!App.isBackgroundRefresh) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
  }



  const p = App.allProducts.find(p => String(p.id) === String(id)) || await apiGet(`products/${id}`);

  if (!p || (p.error && !p.id)) { c.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><h3>Product not found</h3></div>'; return; }



  // Increment view

  apiPatch('products', p.id, { views: (p.views || 0) + 1 });



  const store = App.allStores.find(s => s.id === p.store_id) || {};

  const commission = getCommission(p.price);

  const discount = p.original_price > p.price

    ? Math.round((1 - p.price / p.original_price) * 100) : 0;

  const stockClass = p.stock_qty === 0 ? 'stock-zero' : p.stock_qty <= 3 ? 'stock-low' : 'stock-ok';

  const stockMsg   = p.stock_qty === 0 ? 'Out of Stock' : p.stock_qty <= 3 ? `Only ${p.stock_qty} left!` : `${p.stock_qty} in stock`;

  const images = p.images?.length ? p.images : ['https://via.placeholder.com/600x600?text=No+Image'];



  // Reviews

  const rvRes = await apiGet('reviews', `search=${p.id}&limit=20`);

  const reviews = (rvRes?.data || []).filter(r => r.target_id === p.id && r.target_type === 'product' && r.approved !== false);



  c.innerHTML = `

<div class="page-header">

  <button class="back-btn" onclick="goBack()"><i class="fas fa-arrow-left"></i></button>

  <h2 class="truncate">${escHtml(p.name)}</h2>

  <button class="nav-icon-btn" onclick="shareProduct('${p.id}')" style="margin-left:auto">

    <i class="fas fa-share-alt"></i>

  </button>

</div>



<!-- Product Image -->

<div style="position:relative;background:#f3f4f6">

  ${p.is_flash_sale ? '<span class="flash-badge" style="top:12px;left:12px">FLASH</span>' : ''}

  ${discount > 0 ? `<span style="position:absolute;top:12px;right:12px;background:var(--danger);color:#fff;font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:var(--radius-full)">${discount}% OFF</span>` : ''}

  <img src="${images[0]}" alt="${escHtml(p.name)}"

       style="width:100%;aspect-ratio:1;object-fit:cover;max-height:340px"

       onerror="this.src='https://via.placeholder.com/600x600?text=No+Image'">

  ${images.length > 1 ? `<div style="display:flex;gap:6px;padding:8px 12px;overflow-x:auto">

    ${images.map((img,i) => `<img src="${img}" onclick="switchImg(this,'${img}')" style="width:56px;height:56px;border-radius:6px;object-fit:cover;cursor:pointer;opacity:${i===0?'1':'0.6'}" onerror="this.src='https://via.placeholder.com/60x60?text=img'">`).join('')}

  </div>` : ''}

</div>



<!-- Product Info -->

<div style="padding:16px;background:#fff;margin-bottom:8px">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">

    <h1 style="font-size:1.1rem;font-weight:700;line-height:1.3">${escHtml(p.name)}</h1>

    <button onclick="toggleWishlist('${p.id}')" id="wish-btn-${p.id}"

            style="color:var(--text-muted);font-size:1.3rem;flex-shrink:0">

      <i class="far fa-heart"></i>

    </button>

  </div>

  <div style="display:flex;align-items:center;gap:8px;margin:8px 0">

    <span style="font-size:1.4rem;font-weight:800;color:var(--primary)">GHS ${p.price}</span>

    ${p.original_price > p.price ? `<span style="font-size:.9rem;color:var(--text-muted);text-decoration:line-through">GHS ${p.original_price}</span>` : ''}



  </div>

  <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">

    ${renderStars(p.avg_rating || 0)}

    <span style="font-size:.8rem;color:var(--text-light)">${(p.avg_rating||0).toFixed(1)} (${p.review_count||0} reviews)</span>

    <span style="font-size:.8rem;color:var(--text-muted)">· ${p.sold_count||0} sold</span>

  </div>

  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">

    <span style="font-size:.8rem" class="${stockClass}">

      <i class="fas fa-${p.stock_qty===0?'times-circle':'check-circle'}"></i> ${stockMsg}

    </span>

    <span class="tag"><i class="fas fa-map-marker-alt"></i> ${p.location}</span>

    ${Array.isArray(p.tags) ? p.tags.slice(0,3).map(t=>`<span class="tag">${escHtml(t)}</span>`).join('') : ''}

  </div>



  <!-- Qty Selector + Add to Cart -->

  ${p.stock_qty > 0 ? `

  ${p.allow_buyer_note ? `

  <div class="form-group" style="margin-bottom:10px">

    <label class="form-label" style="display:flex;align-items:center;gap:5px;color:#166534;font-weight:700">

      <i class="fas fa-comment-dots" style="color:#16a34a"></i> Add a Note to Your Order

    </label>

    <textarea class="form-control" id="buyer-note-${p.id}" rows="2"

      placeholder="${escHtml(p.buyer_note_prompt || 'e.g. Color: Red, Size: L')}"

      style="font-size:.85rem;resize:none"></textarea>

    <div style="font-size:.7rem;color:#15803d;margin-top:3px">

      <i class="fas fa-info-circle"></i> Your note will be sent directly to the vendor with your order.

    </div>

  </div>` : ''}

  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">

    <div class="qty-control">

      <button class="qty-btn" onclick="changeDetailQty(-1)"><i class="fas fa-minus"></i></button>

      <span class="qty-value" id="detail-qty">1</span>

      <button class="qty-btn" onclick="changeDetailQty(1,${p.stock_qty})"><i class="fas fa-plus"></i></button>

    </div>

    <span style="font-size:.8rem;color:var(--text-muted)">Max ${p.stock_qty}</span>

  </div>

  <div style="display:flex;gap:10px">

    <button class="btn btn-primary" style="flex:1" onclick="addToCartFromDetail('${p.id}')">

      <i class="fas fa-shopping-bag"></i> Add to Cart

    </button>

    <button class="btn btn-secondary" style="flex:1" onclick="buyNow('${p.id}')">

      <i class="fas fa-bolt"></i> Buy Now

    </button>

  </div>` : `

  <button class="btn btn-outline btn-block" disabled>

    <i class="fas fa-times-circle"></i> Out of Stock

  </button>

  <button class="btn btn-ghost btn-sm btn-block" onclick="notifyRestock('${p.id}')" style="margin-top:8px">

    <i class="fas fa-bell"></i> Notify when restocked

  </button>`}

</div>



<!-- Vendor / Store Info -->

${store.id ? `

<div class="card" style="margin:0 12px 12px;cursor:pointer" onclick="openStore('${store.id}')">

  <div class="card-body" style="display:flex;align-items:center;gap:12px">

    <img src="${store.logo_url||'https://via.placeholder.com/60x60?text=Store'}" alt="${escHtml(store.name)}"

         style="width:48px;height:48px;border-radius:var(--radius-sm);object-fit:cover"

         onerror="this.src='https://via.placeholder.com/60x60?text=S'">

    <div style="flex:1">

      <div style="font-weight:700;font-size:.9rem">${escHtml(store.name)}</div>

      <div style="font-size:.75rem;color:var(--text-light)">${store.category||''} · ${store.location||''}</div>

      <div style="font-size:.75rem">${renderStars(store.avg_rating||0)}</div>

    </div>

    <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();toggleSaveStore('${store.id}')">

      <i class="far fa-bookmark"></i> Save

    </button>

  </div>

</div>` : ''}



<!-- Description -->

<div class="card" style="margin:0 12px 12px">

  <div class="card-header"><h3>Product Description</h3></div>

  <div class="card-body">

    <p style="font-size:.875rem;color:var(--text-light);line-height:1.7">${escHtml(p.description || 'No description available.')}</p>

  </div>

</div>



<!-- Delivery Info -->

<div class="card" style="margin:0 12px 12px">

  <div class="card-header"><h3><i class="fas fa-truck"></i> Delivery Info</h3></div>

  <div class="card-body" id="product-delivery-info">

    ${renderProductDelivery(p)}

  </div>

</div>



<!-- Reviews -->

<div class="card" style="margin:0 12px 12px">

  <div class="card-header">

    <h3>Reviews (${reviews.length})</h3>

    ${App.currentUser ? `<button class="btn btn-outline btn-sm" onclick="showReviewModal('${p.id}','product')">Write Review</button>` : ''}

  </div>

  <div>

    ${reviews.length ? reviews.slice(0,5).map(r => reviewCardHTML(r)).join('') :

      '<div class="empty-state" style="padding:24px"><i class="fas fa-comment-alt"></i><h3>No reviews yet</h3><p>Be the first to review!</p></div>'}

  </div>

  ${reviews.length > 5 ? `<div class="card-footer"><button class="btn btn-ghost btn-block btn-sm">See all ${reviews.length} reviews</button></div>` : ''}

</div>



<!-- Related Products -->

<div class="section">

  <div class="section-header"><h2 class="section-title">You may also like</h2></div>

  <div class="product-grid" id="related-products" style="padding-bottom:16px"></div>

</div>`;



  // Load related

  const related = App.allProducts.filter(rp => rp.id !== p.id && (rp.category === p.category || rp.location === p.location) && rp.status !== 'archived').slice(0,4);

  const relDiv = document.getElementById('related-products');

  if (relDiv) relDiv.innerHTML = related.map(rp => productCardHTML(rp)).join('');

  App.loadedPages['product-' + id] = true;
  App.isBackgroundRefresh = false;
  } catch(e) {
    const c = document.getElementById('product-detail-content');
    if (c) c.innerHTML = `<div style="padding:40px;color:red;white-space:pre-wrap">Error rendering product detail:\n\n${e.stack}</div>`;
    console.error(e);
  }
}



function renderProductDelivery(p) {

  const ul = App.currentUser?.location || '';

  if (!ul) return `<p style="font-size:.85rem;color:var(--text-muted)"><a href="#" onclick="showPage('auth')" style="color:var(--primary)">Sign in</a> to see delivery rates to your location</p>`;

  const d = calcDelivery(p.location, ul, p.weight_kg || 0.5);

  const sat = getNextSaturday();

  return `

<div style="font-size:.85rem;display:flex;flex-direction:column;gap:8px">

  <div style="display:flex;justify-content:space-between">

    <span><i class="fas fa-truck" style="color:var(--primary)"></i> ${d.intercity ? 'Intercity' : 'Local'} Delivery</span>

    <strong>GHS ${d.rate.toFixed(0)}</strong>

  </div>

  <div style="display:flex;justify-content:space-between">

    <span><i class="fas fa-calendar" style="color:var(--primary)"></i> Ships on</span>

    <strong>${sat.toLocaleDateString('en-GH',{weekday:'short',day:'numeric',month:'short'})}</strong>

  </div>

  ${d.intercity ? '<p style="color:var(--text-muted);font-size:.78rem">Intercity delivery via Bolt Send or Ghana Post</p>' : ''}

</div>`;

}



function changeDetailQty(delta, max = 999) {

  const el = document.getElementById('detail-qty');

  if (!el) return;

  let v = parseInt(el.textContent) + delta;

  v = Math.max(1, Math.min(max, v));

  el.textContent = v;

}



async function addToCartFromDetail(productId) {

  const p = App.allProducts.find(p => p.id === productId) || await apiGet(`products/${productId}`);

  if (!p) return;

  const qty  = parseInt(document.getElementById('detail-qty')?.textContent) || 1;

  const note = (document.getElementById('buyer-note-' + productId)?.value || '').trim();

  addToCart(p, qty, note);

}



async function buyNow(productId) {
  if (App.currentUser && ['admin', 'vendor', 'pending_vendor'].includes(App.currentUser.role)) {
    return;
  }
  if (!App.currentUser) { showPage('auth'); return; }

  const p = App.allProducts.find(p => p.id === productId) || await apiGet(`products/${productId}`);

  if (!p) return;

  const qty = parseInt(document.getElementById('detail-qty')?.textContent) || 1;

  if (addToCart(p, qty)) {
    showPage('checkout');
  }

}



function toggleWishlist(productId) {

  showToast('Saved to wishlist ❤️', 'success');

}



function notifyRestock(productId) {
  if (!App.currentUser) { showPage('auth'); return; }
  showToast('We\'ll notify you when this item is back in stock 🔔', 'info');
}

async function shareProduct(productId) {
  const p = App.allProducts.find(prod => String(prod.id) === String(productId));
  if (!p) {
    showToast('Product not found', 'error');
    return;
  }

  const baseUrl = window.location.origin + window.location.pathname;
  const url = baseUrl + '?product=' + productId;
  const title = p.name;
  const desc = p.description ? `${p.description}` : '';
  const text = `${title}\n\n${desc ? desc + '\n\n' : ''}Check this out on HAPPA TRADEMART!\n${url}`;

  const shareData = {
    title: title,
    text: text,
    url: url
  };

  try {
    if (navigator.share) {
      // Intentionally NOT attaching files (images) because OS share sheets often split files and text into separate messages.
      // By sending only the URL, we rely on the Open Graph meta tags to render a proper rich link preview.
      await navigator.share(shareData);
    } else {
      navigator.clipboard?.writeText(text);
      showToast('Product details copied! 📋', 'success');
    }
  } catch (err) {
    console.log('Share failed or was cancelled:', err);
  }
}



// ── Store Detail ──────────────────────────────────────────

async function renderStoreDetail(id) {
  try {
  const c = document.getElementById('store-detail-content');
  if (!c) return;
  if (!App.isBackgroundRefresh) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
  }

  const s = App.allStores.find(st => String(st.id) === String(id)) || await apiGet(`stores/${id}`);
  if (!s) { c.innerHTML = '<div class="empty-state"><i class="fas fa-store-slash"></i><h3>Store not found</h3></div>'; return; }

  const isOwner = App.currentUser && String(App.currentUser.id) === String(s.vendor_id);
  const isAdmin = App.currentUser && App.currentUser.role === 'admin';
  if (s.status !== 'active' && !isOwner && !isAdmin) {
    c.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px; text-align: center;">
        <div style="font-size: 3rem; margin-bottom: 16px;">🏪</div>
        <h3>Store under construction</h3>
        <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 4px;">
          This store is not active yet.
        </p>
      </div>`;
    return;
  }

  const storeProds = App.allProducts.filter(p => String(p.store_id) === String(id) && p.status !== 'archived');
  const slogan = s.slogan || 'Welcome to our store!';
  const verifiedBadge = s.verified ? '<span class="verified-seller-badge" style="background:#10b981;color:#fff;font-size:.65rem;padding:2px 6px;border-radius:10px;font-weight:700"><i class="fas fa-check-circle"></i> Verified Seller</span>' : '';
  let followed = App.savedStores.includes(id);
  const bannerSrc = s.banner_url || 'images/photo_2026-05-30_17-40-49-Photoroom.png';
  const logoSrc = s.logo_url || 'images/photo_2026-05-30_17-40-49-Photoroom.png';
  const storeName = s.name;

  const headerHTML = `
    <div style="position:relative;background:#f8f9fa">
      <img src="${bannerSrc}" alt="${escHtml(storeName)}" 
           style="width:100%;height:140px;object-fit:cover;" onerror="this.src='https://via.placeholder.com/800x300?text=Store+Banner'">
      <div style="padding:12px 16px;background:#fff;border-bottom:1px solid var(--border);position:relative">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-top:-35px">
          <img src="${logoSrc}" alt="${escHtml(storeName)}"
               style="width:64px;height:64px;border-radius:12px;border:3px solid #fff;object-fit:cover;box-shadow:var(--shadow-sm)"
               onerror="this.src='https://via.placeholder.com/100x100?text=Logo'">
          <div style="flex:1;padding-top:25px">
            <h1 style="font-size:1.1rem;font-weight:800;margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--text)">
              ${escHtml(storeName)} ${verifiedBadge}
            </h1>
            <p style="font-size:.78rem;margin:2px 0 0 0;font-style:italic;color:var(--text-light)">${escHtml(slogan)}</p>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
              ${renderStars(s.avg_rating || 0)}
              <span style="font-size:.75rem;color:var(--text-muted)">${(s.avg_rating || 0).toFixed(1)} (${s.review_count || 0})</span>
              <span style="font-size:.75rem;color:var(--text-muted)"><i class="fas fa-map-marker-alt"></i> ${s.location}</span>
            </div>
          </div>
          <div style="padding-top:25px;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            <button class="btn btn-sm ${followed ? 'btn-outline' : 'store-theme-btn'}" onclick="toggleFollowStore('${s.id}')" id="follow-store-btn">
              <i class="fas ${followed ? 'fa-check' : 'fa-plus'}"></i> ${followed ? 'Following' : 'Follow'}
            </button>
            <span style="font-size:.65rem;color:var(--text-muted);font-weight:600" id="followers-count">${s.followers || 0} followers</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const adminToolbarHTML = isAdmin ? `
    <div id="admin-store-toolbar" style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:10px 16px;box-shadow:0 2px 8px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;gap:8px">
        <i class="fas fa-shield-alt" style="color:#f59e0b;font-size:.8rem"></i>
        <span style="color:#f59e0b;font-weight:800;font-size:.75rem;text-transform:uppercase">Admin View — ${escHtml(s.name)}</span>
      </div>
    </div>` : '';

  c.innerHTML = `
    <div id="marketplace-store-container">
      <style>
        #marketplace-store-container .store-tab-btn {
          flex: 1;
          padding: 12px 0;
          cursor: pointer;
          background: none;
          border: none;
          color: var(--text-light);
          border-bottom: 2px solid transparent;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          text-align: center;
          transition: all 0.2s;
        }
        #marketplace-store-container .store-tab-btn.active {
          border-bottom-color: var(--primary);
          color: var(--primary);
        }
        #marketplace-store-container .store-theme-btn {
          background: var(--primary);
          color: #fff;
          border: none;
          border-radius: 20px;
          padding: 6px 14px;
          font-weight: 700;
          font-size: 0.75rem;
          box-shadow: 0 4px 10px rgba(232, 93, 4, 0.2);
          cursor: pointer;
          transition: transform 0.1s;
        }
        #marketplace-store-container .store-theme-btn:hover {
          transform: translateY(-1px);
        }
      </style>
      <div class="page-header" style="background:#fff;border-bottom:1px solid var(--border);padding:12px 16px;display:flex;align-items:center;gap:12px">
        <button class="back-btn" onclick="goBack()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text)"><i class="fas fa-arrow-left"></i></button>
        <h2 style="font-size:1.15rem;font-weight:800;margin:0;color:var(--text)">${escHtml(storeName)}</h2>
      </div>
      ${adminToolbarHTML}
      ${headerHTML}

      <!-- Search product within store -->
      <div style="padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--border)">
        <div style="position:relative">
          <i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted)"></i>
          <input type="text" placeholder="Search products in this store..." id="store-search-input" 
                 oninput="handleStoreProductSearch('${s.id}', this.value)"
                 style="width:100%;padding:10px 12px 10px 36px;border:1px solid var(--border);border-radius:25px;font-size:.82rem">
        </div>
      </div>
      <!-- Tab Content Area (Used for handleStoreProductSearch) -->
      <div class="store-tab-content" id="store-tab-content" style="padding:16px;background:#f8f9fa;">
        <div class="product-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
           ${storeProds.map(p => productCardHTML(p)).join('')}
        </div>
        ${storeProds.length === 0 ? '<div class="empty-state" style="grid-column: 1 / -1; padding: 40px;"><i class="fas fa-box-open"></i><h3>No products found</h3></div>' : ''}
      </div>
    </div>
  `;

  App.loadedPages['store-detail-' + id] = true;
  App.isBackgroundRefresh = false;
  } catch (e) {
    const c = document.getElementById('store-detail-content');
    if (c) c.innerHTML = `<div style="padding:40px;color:red;white-space:pre-wrap">Error rendering store detail:\n\n${e.stack}</div>`;
    console.error(e);
  }
}

async function renderStorefront(id) {
  const c = document.getElementById('storefront-content');
  if (!c) return;
  if (!App.isBackgroundRefresh) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
  }

  const s = App.allStores.find(st => String(st.id) === String(id)) || await apiGet(`stores/${id}`);
  if (!s) { c.innerHTML = '<div class="empty-state"><i class="fas fa-store-slash"></i><h3>Storefront not found</h3></div>'; return; }

  // Look up storefront record for this store ID
  let sf = null;
  const sfRes = await apiGet('storefronts', 'limit=200');
  const allSF = sfRes?.data || [];
  sf = allSF.find(sfRecord => String(sfRecord.store_id) === String(id)) || null;

  // Enforce storefront visibility: only allow approved storefronts to load.
  // Exception: Let admins or the store owner vendor view/review the storefront.
  const isOwner = App.currentUser && String(App.currentUser.id) === String(s.vendor_id);
  const isAdmin = App.currentUser && App.currentUser.role === 'admin';
  const storefrontStatus = sf?.status || 'inactive';

  if (storefrontStatus !== 'approved' && !isOwner && !isAdmin) {
    c.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px; text-align: center;">
        <div style="font-size: 3rem; margin-bottom: 16px;">🏪</div>
        <h3>Storefront under construction</h3>
        <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 4px;">
          This storefront has not been approved or requested yet.
        </p>
      </div>`;
    return;
  }

  const theme = sf?.theme || s.theme || 'classic';
  const font_family = sf?.font_family || s.font_family || 'Outfit';

  // Dynamically load Google Font on demand if not already loaded (saves massive bandwidth and load time)
  if (font_family && font_family !== 'Outfit' && font_family !== 'Inter') {
    const fontId = `storefront-font-${font_family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (!document.getElementById(fontId)) {
      const link = document.createElement('link');
      link.id = fontId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font_family)}:wght@400;700;800&display=swap`;
      document.head.appendChild(link);
    }
  }

  // Update dynamic PWA manifest for storefront branding
  if (typeof updatePWAManifest === 'function') {
    updatePWAManifest(sf?.name || s.name, sf?.logo_url || s.logo_url || 'images/icon-192.png', sf?.primary_color || s.primary_color || '#e85d04');
  }

  const storeProds = App.allProducts.filter(p => String(p.store_id) === String(id) && p.status !== 'archived');

  const primaryColor = sf?.primary_color || s.primary_color || '#e85d04';
  const secondaryColor = sf?.secondary_color || s.secondary_color || '#0d0d0d';
  const slogan = sf?.slogan || s.slogan || 'Welcome to our store!';
  const verifiedBadge = s.verified ? '<span class="verified-seller-badge" style="background:#10b981;color:#fff;font-size:.65rem;padding:2px 6px;border-radius:10px;font-weight:700"><i class="fas fa-check-circle"></i> Verified Seller</span>' : '';

  let followed = App.savedStores.includes(id);

  const bannerSrc = sf?.banner_url || s.banner_url || 'images/photo_2026-05-30_17-40-49-Photoroom.png';
  const logoSrc = sf?.logo_url || s.logo_url || 'images/photo_2026-05-30_17-40-49-Photoroom.png';
  const storeName = sf?.name || s.name;

  let themeStyles = '';
  let headerHTML = '';

  if (theme === 'bold') {
    themeStyles = `
      #storefront-page-container { font-family: '${font_family}', sans-serif !important; }
      #storefront-page-container .store-theme-btn { background: ${primaryColor} !important; color: #fff !important; border: none !important; border-radius: 8px; font-weight:800; text-transform: uppercase; box-shadow: 0 4px 10px color-mix(in srgb, ${primaryColor} 30%, transparent); }
      #storefront-page-container .store-tab-btn { flex:1; padding:10px 0; cursor:pointer; color:var(--text-light); transition: all 0.2s; border-bottom: 2px solid transparent; font-weight:800; text-transform:uppercase; font-size:0.7rem; text-align:center; }
      #storefront-page-container .store-tab-btn.active { border-bottom-color: ${primaryColor}; color: ${primaryColor}; }
      #storefront-page-container .store-tab-content { background: #f8f9fa !important; color: var(--text) !important; padding-bottom:12px; }
      #storefront-page-container .product-card { background: #ffffff !important; border: 1px solid var(--border) !important; border-radius: 12px !important; color: var(--text) !important; box-shadow: 0 4px 15px rgba(0,0,0,0.07) !important; transition: all 0.25s ease-in-out !important; }
      #storefront-page-container .product-card:hover { transform: translateY(-3px) !important; box-shadow: 0 12px 24px rgba(0,0,0,0.12) !important; }
      #storefront-page-container .product-card .product-name { color: var(--text) !important; font-weight: 700 !important; font-size: 0.85rem !important; }
      #storefront-page-container .product-card .product-price { color: ${primaryColor} !important; font-weight: 800 !important; }
      #storefront-page-container .product-rating .fa-star { color: ${primaryColor} !important; }
      #storefront-page-container .flash-badge { background: ${primaryColor} !important; }
    `;
    headerHTML = `
      <div style="position:relative; text-align:center; padding-bottom:12px; background:#fff; border-bottom:1px solid var(--border)">

        <div style="width:100%; height:130px; background:${secondaryColor}; display:flex; align-items:center; justify-content:center; overflow:hidden">
          <img src="${bannerSrc}" style="width:100%; height:100%; object-fit:cover" loading="lazy" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        </div>
        <div style="margin:-40px auto 6px auto; width:80px; height:80px; border-radius:50%; border:3px solid #fff; background:#fff; overflow:hidden; box-shadow:var(--shadow-md); position:relative; z-index:2">
          <img src="${logoSrc}" style="width:100%; height:100%; object-fit:cover" loading="lazy" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
        </div>
        <h4 class="store-name-title" style="font-size:1.2rem; font-weight:900; margin:0; text-transform:uppercase">${storeName} ${verifiedBadge}</h4>
        <div style="font-size:0.7rem; color:var(--text-light); font-weight:700; margin-top:2px"><i class="fas fa-star" style="color:#fbbf24"></i> 4.9 (15 reviews)</div>
      </div>
      <div style="background:${secondaryColor}; padding:10px 12px; text-align:center">
        <h5 class="store-slogan-text" style="font-size:0.8rem; font-weight:800; margin:0; text-transform:uppercase">${slogan}</h5>
      </div>
    `;
  } else if (theme === 'modern') {
    themeStyles = `
      #storefront-page-container { font-family: '${font_family}', sans-serif !important; }
      #storefront-page-container .store-theme-btn { background: ${primaryColor}; color: #fff; border: none; padding: 6px 14px; border-radius: 20px; font-weight:700; font-size:.7rem; box-shadow: 0 4px 10px rgba(0,0,0,0.1); transition: transform 0.1s; }
      #storefront-page-container .store-tab-btn { flex:1; padding:10px 0; cursor:pointer; color:var(--text-light) !important; transition: all 0.2s; border-bottom: 2px solid transparent; font-size: 0.72rem; text-align:center; }
      #storefront-page-container .store-tab-btn.active { color: ${primaryColor} !important; font-weight: 800; border-bottom-color: ${primaryColor}; }
      #storefront-page-container .store-tab-list { background: color-mix(in srgb, ${secondaryColor} 20%, rgba(255, 255, 255, 0.6)); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
      #storefront-page-container .store-tab-content { background: color-mix(in srgb, ${secondaryColor} 20%, #faf9f6) !important; color: var(--text) !important; padding-bottom:12px; }
      #storefront-page-container .product-card { background: rgba(255,255,255,0.75) !important; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.4) !important; color: var(--text) !important; box-shadow: 0 4px 15px rgba(0,0,0,0.03) !important; border-radius: 12px !important; }
      #storefront-page-container .product-card .product-name { color: var(--text) !important; font-weight: 700 !important; font-size: 0.85rem !important; }
      #storefront-page-container .product-card .product-price { color: ${primaryColor} !important; font-weight: 800 !important; }
      #storefront-page-container .product-card .product-img { background: rgba(255,255,255,0.4) !important; border-radius: 8px !important; }
      #storefront-page-container .product-rating .fa-star { color: ${primaryColor} !important; }
      #storefront-page-container .flash-badge { background: ${primaryColor} !important; }
    `;
    headerHTML = `
      <div style="position:relative; overflow:hidden; min-height:190px; display:flex; align-items:center; justify-content:center; padding:25px 10px;">

        <!-- Full-screen hero banner in background -->
        <img src="${bannerSrc}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:1;" loading="lazy" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        <div style="position:absolute; inset:0; background:rgba(15, 23, 42, 0.45); z-index:1;"></div>
        
        <!-- Frosted Glass Card overlay containing logo, title, slogan -->
        <div style="position:relative; z-index:2; width:88%; background:color-mix(in srgb, ${secondaryColor} 20%, rgba(255, 255, 255, 0.7)); backdrop-filter:blur(16px) saturate(180%); -webkit-backdrop-filter:blur(16px) saturate(180%); border:1px solid rgba(255, 255, 255, 0.4); border-radius:14px; padding:16px 12px 12px 12px; text-align:center; box-shadow:0 8px 32px 0 rgba(0, 0, 0, 0.08);">
          <div style="display:flex; justify-content:center; margin-top:-38px; margin-bottom:8px;">
            <img src="${logoSrc}" style="width:58px; height:58px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px rgba(0,0,0,0.15); object-fit:cover; background:#fff" loading="lazy" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
          </div>
          <h4 class="store-name-title" style="font-family:'Outfit', 'Inter', sans-serif; font-size:1.15rem; font-weight:800; margin:0; letter-spacing:0.5px">${storeName} ${verifiedBadge}</h4>
          <p class="store-slogan-text" style="font-size:0.75rem; margin:4px 0 0 0; font-weight:500; font-style:italic;">${slogan}</p>
        </div>
      </div>
    `;
  } else if (theme === 'neumorphic') {
    themeStyles = `
      #storefront-page-container { font-family: '${font_family}', sans-serif !important; --neu-bg: color-mix(in srgb, ${secondaryColor} 10%, #faf9f6); }
      #storefront-page-container .store-theme-btn { background: var(--neu-bg); color: ${primaryColor} !important; border: 1px solid rgba(255,255,255,0.9); padding: 7px 16px; border-radius: 14px; font-weight:700; font-size:.68rem; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 2px 2px 5px rgba(165,175,190,0.25), -2px -2px 5px #ffffff; transition: all 0.2s ease; }
      #storefront-page-container .store-tab-btn { flex:1; padding:8px 0; cursor:pointer; color:var(--text-light) !important; transition: all 0.2s; border-radius: 10px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; text-align: center; box-shadow: 2px 2px 5px rgba(165,175,190,0.25), -2px -2px 5px #ffffff; }
      #storefront-page-container .store-tab-btn.active { color: ${primaryColor} !important; box-shadow: inset 1px 1px 3px rgba(165,175,190,0.25), inset -1px -1px 3px #ffffff; }
      #storefront-page-container .store-tab-list { background: var(--neu-bg); padding: 4px; display: flex; gap: 8px; border-bottom: none; }
      #storefront-page-container .store-tab-content { background: var(--neu-bg) !important; color: var(--text) !important; padding-bottom: 12px; }
      #storefront-page-container .product-card { background: var(--neu-bg) !important; border: none !important; border-radius: 16px !important; color: var(--text) !important; box-shadow: 3px 3px 8px rgba(165,175,190,0.25), -3px -3px 8px #ffffff !important; transition: all 0.25s ease-in-out !important; }
      #storefront-page-container .product-card:hover { transform: translateY(-2px) !important; box-shadow: 5px 5px 12px rgba(165,175,190,0.35), -5px -5px 12px #ffffff !important; }
      #storefront-page-container .product-card .product-name { color: var(--text) !important; font-size: 0.65rem !important; font-weight: 700 !important; }
      #storefront-page-container .product-card .product-price { color: ${primaryColor} !important; font-weight: 800 !important; }
      #storefront-page-container .product-card .product-img { background: #ffffff !important; border-radius: 12px 12px 0 0 !important; margin: 4px; box-shadow: none !important; border-bottom: 1px solid rgba(0,0,0,0.03) !important; }
      #storefront-page-container .product-rating .fa-star { color: ${primaryColor} !important; }
      #storefront-page-container .flash-badge { background: ${primaryColor} !important; }
    `;
    headerHTML = `
      <div style="background:color-mix(in srgb, ${secondaryColor} 10%, #faf9f6); padding:12px; display:flex; flex-direction:column; align-items:center; position:relative; border-bottom: none">

        <!-- Neumorphic Banner Inset Frame -->
        <div style="width:100%; height:110px; background:color-mix(in srgb, ${secondaryColor} 10%, #faf9f6); padding:4px; box-shadow: inset 1px 1px 3px rgba(165,175,190,0.25), inset -1px -1px 3px #ffffff; border-radius:12px; overflow:hidden">
          <img src="${bannerSrc}" style="width:100%; height:100%; object-fit:cover; border-radius:10px" loading="lazy" onerror="this.src='https://via.placeholder.com/800x300?text=Banner'">
        </div>
        
        <!-- Raised Profile Logo -->
        <div style="width:68px; height:68px; border-radius:50%; background:color-mix(in srgb, ${secondaryColor} 10%, #faf9f6); display:flex; align-items:center; justify-content:center; box-shadow: 2px 2px 5px rgba(165,175,190,0.25), -2px -2px 5px #ffffff; padding: 4px; margin-top:-28px; position:relative; z-index:2">
          <img src="${logoSrc}" style="width:100%; height:100%; border-radius:50%; object-fit:cover" loading="lazy" onerror="this.src='https://via.placeholder.com/100?text=Logo'">
        </div>
        
        <div style="text-align:center; margin-top:6px">
          <h4 class="store-name-title" style="font-size:1.15rem; font-weight:800; margin:0">${storeName} ${verifiedBadge}</h4>
          <p class="store-slogan-text" style="font-size:0.75rem; margin:4px 0 0 0; font-style: italic">${slogan}</p>
        </div>
      </div>
    `;
  } else {
    // Classic Theme
    themeStyles = `
      #storefront-page-container { font-family: '${font_family}', sans-serif !important; }
      #storefront-page-container .store-theme-btn { background: ${primaryColor} !important; color: #fff !important; border: none !important; }
      #storefront-page-container .store-tab-btn { flex:1; padding:10px 0; cursor:pointer; color:var(--text-light); transition: all 0.2s; border-bottom: 2px solid transparent; font-size: 0.72rem; text-align:center; }
      #storefront-page-container .store-tab-btn.active { border-bottom-color: ${primaryColor}; color: ${primaryColor}; }
      #storefront-page-container .product-card .product-price { color: ${primaryColor} !important; font-weight: 800 !important; }
      #storefront-page-container .product-rating .fa-star { color: ${primaryColor} !important; }
      #storefront-page-container .flash-badge { background: ${primaryColor} !important; }
    `;
    headerHTML = `
      <div style="position:relative;background:#f8f9fa">

        <img src="${bannerSrc}" alt="${escHtml(storeName)}" 
             style="width:100%;height:180px;object-fit:cover;" onerror="this.src='https://via.placeholder.com/800x300?text=Store+Banner'">
        <div style="padding:16px;background:#fff;border-bottom:1px solid var(--border);position:relative">
          <div style="display:flex;align-items:flex-start;gap:12px;margin-top:-45px">
            <img src="${logoSrc}" alt="${escHtml(storeName)}"
                 style="width:80px;height:80px;border-radius:12px;border:3px solid #fff;object-fit:cover;box-shadow:var(--shadow-sm)"
                 onerror="this.src='https://via.placeholder.com/100x100?text=Logo'">
            <div style="flex:1;padding-top:35px">
              <h1 class="store-name-title" style="font-size:1.25rem;font-weight:800;margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                ${escHtml(storeName)} ${verifiedBadge}
              </h1>
              <p class="store-slogan-text" style="font-size:.85rem;margin:4px 0 0 0;font-style:italic">${escHtml(slogan)}</p>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
                ${renderStars(s.avg_rating || 0)}
                <span style="font-size:.8rem;color:var(--text-muted)">${(s.avg_rating || 0).toFixed(1)} (${s.review_count || 0})</span>
                <span class="store-location-tag" style="font-size:.78rem"><i class="fas fa-map-marker-alt"></i> ${s.location}</span>
              </div>
            </div>
            <div style="padding-top:35px;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <button class="btn btn-sm ${followed ? 'btn-outline' : 'store-theme-btn'}" onclick="toggleFollowStore('${s.id}')" id="follow-store-btn">
                <i class="fas ${followed ? 'fa-check' : 'fa-plus'}"></i> ${followed ? 'Following' : 'Follow Store'}
              </button>
              <span style="font-size:.7rem;color:var(--text-muted);font-weight:600" id="followers-count">${s.followers || 0} followers</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const customStyles = `
    <style id="store-custom-styles-${id}">
      ${themeStyles}
      #storefront-page-container .store-name-title { color: ${primaryColor} !important; }
      #storefront-page-container .store-slogan-text { color: ${primaryColor} !important; }
      #storefront-page-container .store-description-text { color: ${primaryColor} !important; }
    </style>
  `;

  const adminToolbarHTML = isAdmin ? `
<div id="admin-store-toolbar" style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:12px 16px;box-shadow:0 2px 8px rgba(0,0,0,.4)">
  <div style="display:flex;align-items:center;gap:8px">
    <i class="fas fa-shield-alt" style="color:#f59e0b;font-size:.9rem"></i>
    <span style="color:#f59e0b;font-weight:800;font-size:.82rem;text-transform:uppercase">Admin View — ${escHtml(s.name)}</span>
  </div>
</div>` : '';

  c.innerHTML = `
    <div id="storefront-page-container">
      ${customStyles}
      ${adminToolbarHTML}
      
      ${headerHTML}

      <!-- Search product within store -->
      <div style="padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--border)">
        <div style="position:relative">
          <i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted)"></i>
          <input type="text" placeholder="Search products in this store..." id="store-search-input" 
                 oninput="handleStoreProductSearch('${s.id}', this.value)"
                 style="width:100%;padding:10px 12px 10px 36px;border:1px solid var(--border);border-radius:25px;font-size:.82rem">
        </div>
      </div>
      
      <!-- Store Tabs Navigation -->
      <div class="store-tab-list" style="display:flex;overflow-x:auto;sticky:top">
        <button class="store-tab-btn active" data-tab="home" onclick="switchStorefrontTab('home','${s.id}')">Home</button>
        <button class="store-tab-btn" data-tab="products" onclick="switchStorefrontTab('products','${s.id}')">Products</button>
        <button class="store-tab-btn" data-tab="cart" onclick="switchStorefrontTab('cart','${s.id}')">Cart <span id="store-cart-count-${s.id}" style="background:var(--primary);color:#fff;border-radius:10px;padding:1px 6px;font-size:0.6rem;font-weight:700;display:none">0</span></button>
        <button class="store-tab-btn" data-tab="about" onclick="switchStorefrontTab('about','${s.id}')">About</button>
        <button class="store-tab-btn" data-tab="admin" onclick="switchStorefrontTab('admin','${s.id}')">Admin Portal</button>
      </div>

      <!-- Tab Content Area -->
      <div class="store-tab-content" id="store-tab-content"></div>
    </div>
  `;

  switchStorefrontTab('home', s.id);

  setTimeout(() => {
    const storeCart = JSON.parse(localStorage.getItem('happa_store_cart_' + s.id) || '[]');
    const totalQty = storeCart.reduce((acc, curr) => acc + curr.qty, 0);
    const countBadge = document.getElementById('store-cart-count-' + s.id);
    if (countBadge) {
      if (totalQty > 0) {
        countBadge.textContent = totalQty;
        countBadge.style.display = 'inline-block';
      } else {
        countBadge.style.display = 'none';
      }
    }
  }, 100);
}



/* ============================================================

   ADMIN STORE-PAGE HELPERS

   Rendered only when App.currentUser.role === 'admin'

   ============================================================ */



// ── Admin product card — standard card + admin action bar ─

function adminProductCardHTML(p) {

  const avail    = p.is_available !== false;

  const isSoldOut= p.stock_qty === 0;

  const flash    = p.is_flash_sale ? '<span class="flash-badge">FLASH</span>' : '';

  const soldOut  = isSoldOut ? '<div class="sold-out-overlay">SOLD OUT</div>' : '';

  const hidden   = !avail ? '<div class="sold-out-overlay" style="background:rgba(0,0,0,.55)">HIDDEN</div>' : '';

  const editId   = 'sd-prod-edit-' + p.id;



  const PROD_CATS = ['Electronics','Fashion & Clothing','Food & Drinks','Health & Beauty',

    'Home & Living','Books & Stationery','Sports & Fitness','Toys & Games','Art & Crafts','Services','Other'];



  return `

<div style="position:relative;border-radius:var(--radius-md);overflow:hidden;box-shadow:var(--shadow-sm);background:#fff;border:2px solid ${avail?'var(--border)':'#fca5a5'}">

  <!-- product image / overlays -->

  <div style="position:relative;cursor:pointer" onclick="openProduct('${p.id}')">

    ${flash}${soldOut}${hidden}

    <img style="width:100%;height:140px;object-fit:cover;display:block"

         src="${p.images?.[0]||'https://via.placeholder.com/300x300?text=No+Image'}"

         alt="${escHtml(p.name)}" loading="lazy"

         onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">

  </div>

  <!-- product info -->

  <div style="padding:8px 8px 4px">

    <div style="font-weight:700;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</div>

    <div style="font-size:.75rem;color:var(--text-muted)">${p.category||'—'} · Stock: <strong>${p.stock_qty??0}</strong>${isSoldOut?' ⚠️':''}</div>

    <div style="font-weight:800;color:var(--primary);font-size:.9rem">GHS ${(p.price||0).toFixed(2)}</div>

    <div style="font-size:.68rem;color:var(--text-muted)">${p.sold_count||0} sold · ${p.avg_rating?p.avg_rating.toFixed(1)+' ★':'—'}</div>

  </div>

  <!-- admin action row -->

  <div style="display:flex;gap:4px;padding:6px 8px;background:#f8fafc;border-top:1px solid var(--border)">

    <button title="Edit product"

            onclick="document.getElementById('${editId}').style.display=document.getElementById('${editId}').style.display==='none'?'block':'none'"

            style="flex:1;background:#8b5cf6;color:#fff;border:none;border-radius:5px;padding:5px 0;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px">

      <i class="fas fa-pen"></i> Edit

    </button>

    <button title="${avail?'Hide product':'Make available'}"

            onclick="_sdToggleProduct('${p.id}')"

            style="flex:1;background:${avail?'#f59e0b':'#10b981'};color:#fff;border:none;border-radius:5px;padding:5px 0;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px">

      <i class="fas fa-${avail?'eye-slash':'eye'}"></i> ${avail?'Hide':'Show'}

    </button>

    <button title="Delete product permanently"

            onclick="_sdDeleteProduct('${p.id}','${escHtml(p.name).replace(/'/g,"\\'")}',this)"

            style="flex:1;background:#ef4444;color:#fff;border:none;border-radius:5px;padding:5px 0;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px">

      <i class="fas fa-trash-alt"></i> Del

    </button>

  </div>

  <!-- inline edit form -->

  <div id="${editId}" style="display:none;background:#f0f4ff;border-top:1px solid #c7d2fe;padding:10px">

    <form onsubmit="event.preventDefault();_sdSaveProduct('${p.id}',this)" style="display:grid;gap:5px">

      <input  class="form-control" name="name"           value="${escHtml(p.name||'')}"      placeholder="Name"            style="font-size:.8rem">

      <div style="display:flex;gap:5px">

        <input class="form-control" name="price"         value="${(p.price||0).toFixed(2)}"  placeholder="Price"      type="number" min="0" step="0.01" style="font-size:.8rem;flex:1">

        <input class="form-control" name="original_price" value="${p.original_price||''}"    placeholder="Orig. price" type="number" min="0" step="0.01" style="font-size:.8rem;flex:1">

      </div>

      <div style="display:flex;gap:5px">

        <input class="form-control" name="stock_qty"     value="${p.stock_qty??0}"            placeholder="Stock"      type="number" min="0" style="font-size:.8rem;flex:1">

        <input class="form-control" name="weight_kg"     value="${p.weight_kg||''}"           placeholder="kg"         type="number" min="0" step="0.01" style="font-size:.8rem;flex:1">

      </div>

      <select class="form-control form-select" name="category" style="font-size:.8rem">

        ${PROD_CATS.map(c=>`<option value="${c}"${c===p.category?' selected':''}>${c}</option>`).join('')}

      </select>

      <input class="form-control" name="short_desc" value="${escHtml(p.short_desc||'')}" placeholder="Short description" style="font-size:.8rem">

      <input class="form-control" name="image_url"  value="${escHtml((p.images||[])[0]||'')}" placeholder="Cover image URL" style="font-size:.8rem">

      <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer">

        <input type="checkbox" name="is_available"  ${p.is_available!==false?'checked':''} style="width:14px;height:14px"> Available (visible to buyers)

      </label>

      <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer">

        <input type="checkbox" name="is_flash_sale" ${p.is_flash_sale?'checked':''} style="width:14px;height:14px"> ⚡ Flash Sale

      </label>

      <div style="display:flex;gap:5px">

        <button type="submit" style="flex:1;background:#10b981;color:#fff;border:none;border-radius:5px;padding:6px;font-size:.78rem;font-weight:700;cursor:pointer"><i class="fas fa-save"></i> Save</button>

        <button type="button" onclick="document.getElementById('${editId}').style.display='none'" style="flex:1;background:#6b7280;color:#fff;border:none;border-radius:5px;padding:6px;font-size:.78rem;cursor:pointer">Cancel</button>

      </div>

    </form>

  </div>

</div>`;

  App.loadedPages['storefront-' + id] = true;
  App.isBackgroundRefresh = false;
}



/* ── Store-page admin action handlers (_sd* prefix) ──────── */



async function _sdSuspendStore(storeId) {

  if (!confirm('Suspend this store? Products will be hidden from the marketplace.')) return;

  await apiPatch('stores', storeId, { status: 'suspended' });

  const s = (App.allStores||[]).find(s => s.id === storeId);

  if (s) s.status = 'suspended';

  showToast('Store suspended', 'warning');

  renderStoreDetail(storeId);

}



async function _sdActivateStore(storeId) {

  await apiPatch('stores', storeId, { status: 'active' });

  const s = (App.allStores||[]).find(s => s.id === storeId);

  if (s) s.status = 'active';

  showToast('Store activated ✅', 'success');

  renderStoreDetail(storeId);

}



async function _sdMarkStorePaid(storeId) {

  await apiPatch('stores', storeId, { is_paid: true });

  const s = (App.allStores||[]).find(s => s.id === storeId);

  if (s) s.is_paid = true;

  showToast('Store marked as paid ✅', 'success');

  renderStoreDetail(storeId);

}



async function _sdMarkStoreUnpaid(storeId) {

  if (!confirm('Mark this store as unpaid?')) return;

  await apiPatch('stores', storeId, { is_paid: false });

  const s = (App.allStores||[]).find(s => s.id === storeId);

  if (s) s.is_paid = false;

  showToast('Store marked as unpaid', 'warning');

  renderStoreDetail(storeId);

}



function _sdEditStore(storeId) {

  const form = document.getElementById('sd-store-edit-form');

  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';

}



async function _sdSaveStore(storeId, form) {

  const data = {};

  new FormData(form).forEach((v, k) => { data[k] = v; });

  data.is_paid     = form.querySelector('[name=is_paid]')?.checked ?? false;

  data.store_price = parseFloat(data.store_price) || 0;

  if (data.name) data.slug = data.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');



  const btn = form.querySelector('[type=submit]');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }



  await apiPatch('stores', storeId, data);



  const s = (App.allStores||[]).find(s => s.id === storeId);

  if (s) Object.assign(s, data);



  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save'; }

  showToast('Store updated ✅', 'success');

  renderStoreDetail(storeId);

}



async function _sdDeleteStore(storeId, storeName, btn) {

  if (!confirm(`Delete "${storeName}"? This cannot be undone.`)) return;

  if (!confirm(`Final confirmation: delete "${storeName}" permanently?`)) return;

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  await apiDelete('stores', storeId);

  const idx = (App.allStores||[]).findIndex(s => s.id === storeId);

  if (idx > -1) App.allStores.splice(idx, 1);

  showToast('Store deleted', 'warning');

  goBack();

}



async function _sdToggleProduct(productId) {

  const product = (App.allProducts||[]).find(p => p.id === productId);

  const newAvail = product ? !(product.is_available !== false) : false;

  await apiPatch('products', productId, { is_available: newAvail });

  if (product) product.is_available = newAvail;

  showToast(newAvail ? 'Product now visible ✅' : 'Product hidden', newAvail ? 'success' : 'info');

  const storeId = product?.store_id || App.currentStoreId;

  if (storeId) renderStoreDetail(storeId);

}



async function _sdDeleteProduct(productId, productName, btn) {

  if (!confirm(`Delete "${productName}"? This cannot be undone.`)) return;

  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  await apiDelete('products', productId);

  const idx = (App.allProducts||[]).findIndex(p => p.id === productId);

  if (idx > -1) App.allProducts.splice(idx, 1);

  showToast('Product deleted', 'warning');

  const storeId = App.currentStoreId;

  if (storeId) renderStoreDetail(storeId);

}



async function _sdSaveProduct(productId, form) {

  const data = {};

  new FormData(form).forEach((v, k) => { data[k] = v; });



  data.price          = parseFloat(data.price)          || 0;

  data.original_price = parseFloat(data.original_price) || 0;

  data.stock_qty      = parseInt(data.stock_qty)        || 0;

  data.weight_kg      = parseFloat(data.weight_kg)      || 0;

  data.is_available   = form.querySelector('[name=is_available]')?.checked  ?? true;

  data.is_flash_sale  = form.querySelector('[name=is_flash_sale]')?.checked ?? false;

  if (data.name) data.slug = data.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');



  const product = (App.allProducts||[]).find(p => p.id === productId);

  if (data.image_url !== undefined) {

    const imgs = product ? [...(product.images||[])] : [];

    if (imgs[0] !== data.image_url) imgs[0] = data.image_url;

    data.images = imgs;

  }

  delete data.image_url;



  const btn = form.querySelector('[type=submit]');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }



  await apiPatch('products', productId, data);



  if (product) Object.assign(product, data);

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save'; }

  showToast('Product updated ✅', 'success');

  const storeId = product?.store_id || App.currentStoreId;

  if (storeId) renderStoreDetail(storeId);

}



// ── Review Modal & Card ───────────────────────────────────

function showReviewModal(targetId, targetType) {

  showModal(`

<div class="modal-handle"></div>

<div class="modal-header">

  <span class="modal-title">Write a Review</span>

  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>

</div>

<div class="modal-body">

  <div style="margin-bottom:16px">

    <div class="form-label">Your Rating</div>

    <div style="display:flex;gap:8px;font-size:1.8rem" id="star-picker">

      ${[1,2,3,4,5].map(n=>`<span style="cursor:pointer;color:var(--border)" onclick="pickStar(${n})" data-star="${n}">&#9733;</span>`).join('')}

    </div>

    <input type="hidden" id="review-rating" value="0">

  </div>

  <div class="form-group">

    <label class="form-label">Comment</label>

    <textarea class="form-control" id="review-comment" rows="4" placeholder="Share your experience…" style="resize:none"></textarea>

  </div>

  <button class="btn btn-primary btn-block" onclick="submitReview('${targetId}','${targetType}')">

    <i class="fas fa-paper-plane"></i> Submit Review

  </button>

</div>`);

}



function pickStar(n) {

  document.getElementById('review-rating').value = n;

  document.querySelectorAll('#star-picker span').forEach((s,i) => {

    s.style.color = i < n ? 'var(--accent)' : 'var(--border)';

  });

}



async function submitReview(targetId, targetType) {

  const rating  = parseInt(document.getElementById('review-rating')?.value);

  const comment = document.getElementById('review-comment')?.value.trim();

  if (!rating) { showToast('Please select a star rating', 'warning'); return; }

  if (!comment) { showToast('Please write a comment', 'warning'); return; }



  const rv = {

    target_id: targetId, target_type: targetType,

    reviewer_id: App.currentUser.id, reviewer_name: App.currentUser.name,

    rating, comment, order_id: '', approved: true, flagged: false

  };

  const created = await apiPost('reviews', rv);

  if (!created) { showToast('Could not submit review. Try again.', 'error'); return; }

  closeModalForce();

  showToast('Review submitted! Thank you ⭐', 'success');

  // Reload product/store detail

  if (targetType === 'product') renderProductDetail(targetId);

  else renderStoreDetail(targetId);

}



function reviewCardHTML(r) {

  return `

<div class="review-card">

  <div class="review-header">

    <div>

      <div class="reviewer-name">${escHtml(r.reviewer_name || 'Anonymous')}</div>

      <div>${renderStars(r.rating||0)}</div>

    </div>

    <div class="review-date">${formatDate(r.created_at)}</div>

  </div>

  <div class="review-comment">${escHtml(r.comment || '')}</div>

</div>`;

}



// ── Open Rendor Public Profile ────────────────────────────

function openRendorProfile(rendorId) {

  if (!rendorId) return;

  App.currentRendorId = rendorId;

  showPage('rendor-profile');

}



// ── Render Rendor Public Profile Page ────────────────────

async function renderRendorProfilePublic() {

  const c     = document.getElementById('rendor-profile-content');

  const title = document.getElementById('rendor-profile-page-title');

  if (!c) return;



  if (!App.isBackgroundRefresh) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
  }



  const rendorId = App.currentRendorId;

  if (!rendorId) {

    c.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Rendor not found</h3></div>';

    return;

  }



  // Fetch rendor user + their active posts in parallel

  const [rendorData, postsRes] = await Promise.all([

    apiFetch('users/' + rendorId),

    apiGet('services', 'limit=100')

  ]);



  const rendor = rendorData;

  if (!rendor || rendor.role !== 'rendor' || rendor.status !== 'active') {

    c.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i><h3>Profile not available</h3><p>This rendor profile is no longer active.</p></div>';

    return;

  }



  const posts = (postsRes?.data || []).filter(s =>

    s.rendor_id === rendorId && s.status === 'active' && !s.deleted

  );



  const displayName = rendor.rendor_display_name || rendor.name || 'Rendor';

  const serviceCat  = rendor.rendor_service_cat  || 'Service Provider';

  const bio         = rendor.rendor_bio          || '';

  const startPrice  = rendor.rendor_starting_price

    ? `From GHS ${parseFloat(rendor.rendor_starting_price).toFixed(2)}`

    : '';

  const tags        = rendor.rendor_tags

    ? rendor.rendor_tags.split(',').map(t => t.trim()).filter(Boolean)

    : [];

  const verified    = rendor.id_verified

    ? '<span style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;background:#ede9fe;color:#7c3aed;border-radius:20px;padding:2px 8px;font-weight:700"><i class="fas fa-check-circle"></i> Verified</span>'

    : '';

  const avatar      = displayName.charAt(0).toUpperCase();



  // Build contact rows (only show if value exists)

  const contacts = [];

  if (rendor.rendor_whatsapp)   contacts.push({ icon:'fab fa-whatsapp',  color:'#22c55e', label:'WhatsApp',  val:rendor.rendor_whatsapp,  href:`https://wa.me/${rendor.rendor_whatsapp.replace(/\D/g,'')}` });

  if (rendor.rendor_email)      contacts.push({ icon:'fas fa-envelope',  color:'#f97316', label:'Email',     val:rendor.rendor_email,     href:`mailto:${rendor.rendor_email}` });

  if (rendor.rendor_instagram)  contacts.push({ icon:'fab fa-instagram', color:'#ec4899', label:'Instagram', val:rendor.rendor_instagram, href:`https://instagram.com/${rendor.rendor_instagram.replace('@','')}` });

  if (rendor.rendor_twitter)    contacts.push({ icon:'fab fa-twitter',   color:'#3b82f6', label:'Twitter',   val:rendor.rendor_twitter,   href:`https://twitter.com/${rendor.rendor_twitter.replace('@','')}` });

  if (rendor.rendor_facebook)   contacts.push({ icon:'fab fa-facebook',  color:'#1d4ed8', label:'Facebook',  val:rendor.rendor_facebook,  href:rendor.rendor_facebook.startsWith('http') ? rendor.rendor_facebook : `https://facebook.com/${rendor.rendor_facebook}` });

  if (rendor.rendor_website)    contacts.push({ icon:'fas fa-globe',     color:'#0ea5e9', label:'Website',   val:rendor.rendor_website,   href:rendor.rendor_website.startsWith('http') ? rendor.rendor_website : `https://${rendor.rendor_website}` });



  if (title) title.textContent = displayName;



  c.innerHTML = `

<!-- ── Profile Header ── -->

<div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:24px 16px 20px;color:#fff">

  <div style="display:flex;align-items:center;gap:14px">

    <div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:#fff;flex-shrink:0;border:2px solid rgba(255,255,255,.4)">

      ${avatar}

    </div>

    <div style="flex:1;min-width:0">

      <div style="font-size:1.1rem;font-weight:800;display:flex;align-items:center;gap:6px;flex-wrap:wrap">

        ${escHtml(displayName)} ${verified}

      </div>

      <div style="font-size:.8rem;opacity:.85;margin-top:2px">

        <i class="fas fa-briefcase"></i> ${escHtml(serviceCat)}

      </div>

      ${startPrice ? `<div style="font-size:.82rem;font-weight:700;margin-top:4px;opacity:.95">${escHtml(startPrice)}</div>` : ''}

    </div>

  </div>

  ${tags.length ? `

  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">

    ${tags.map(t => `<span style="background:rgba(255,255,255,.15);color:#fff;border-radius:20px;padding:2px 10px;font-size:.72rem">${escHtml(t)}</span>`).join('')}

  </div>` : ''}

</div>



<!-- ── Bio ── -->

${bio ? `

<div class="card" style="margin:12px 12px 0">

  <div class="card-body">

    <div style="font-weight:700;font-size:.85rem;margin-bottom:6px;color:var(--text-muted)"><i class="fas fa-user"></i> ABOUT</div>

    <p style="font-size:.875rem;color:var(--text-light);line-height:1.7">${escHtml(bio)}</p>

  </div>

</div>` : ''}



<!-- ── Contact Info ── -->

${contacts.length ? `

<div class="card" style="margin:12px 12px 0">

  <div class="card-body">

    <div style="font-weight:700;font-size:.85rem;margin-bottom:10px;color:var(--text-muted)"><i class="fas fa-address-card"></i> CONTACT</div>

    <div style="display:flex;flex-direction:column;gap:10px">

      ${contacts.map(ct => `

      <a href="${escHtml(ct.href)}" target="_blank" rel="noopener noreferrer"

         style="display:flex;align-items:center;gap:12px;text-decoration:none;padding:10px 12px;background:#f9fafb;border-radius:var(--radius-sm);border:1px solid var(--border)">

        <i class="${ct.icon}" style="color:${ct.color};font-size:1.2rem;width:22px;text-align:center"></i>

        <div style="flex:1;min-width:0">

          <div style="font-size:.72rem;color:var(--text-muted);font-weight:600">${ct.label}</div>

          <div style="font-size:.85rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(ct.val)}</div>

        </div>

        <i class="fas fa-external-link-alt" style="color:var(--text-muted);font-size:.7rem"></i>

      </a>`).join('')}

    </div>

  </div>

</div>` : `

<div class="card" style="margin:12px 12px 0">

  <div class="card-body" style="text-align:center;padding:16px">

    <p style="font-size:.85rem;color:var(--text-muted)">Contact details not yet added by this rendor.</p>

  </div>

</div>`}



<!-- ── Posts / Services ── -->

<div style="margin:16px 12px 0">

  <div style="font-weight:700;font-size:.9rem;margin-bottom:10px;display:flex;align-items:center;gap:6px">

    <i class="fas fa-th-large" style="color:#7c3aed"></i> Services (${posts.length})

  </div>

  ${posts.length ? posts.map(p => _rendorPublicPostCardHTML(p)).join('') :

    `<div class="empty-state" style="padding:30px">

      <i class="fas fa-folder-open"></i>

      <h3>No posts yet</h3>

      <p>This rendor hasn't added any service posts yet.</p>

    </div>`}

</div>



<!-- ── Bottom padding ── -->

<div style="height:24px"></div>

`;

  App.loadedPages['rendor-profile-' + rendorId] = true;
  App.isBackgroundRefresh = false;
}



// ── Small post card used on the public profile page ──────

function _rendorPublicPostCardHTML(post) {

  const img = post.image_url

    ? `<img src="${escHtml(post.image_url)}" alt="${escHtml(post.title)}"

           style="width:100%;height:140px;object-fit:cover;border-radius:var(--radius-sm) var(--radius-sm) 0 0"

           onerror="this.style.display='none'">`

    : '';

  const price = post.price

    ? `<span style="font-weight:800;color:#7c3aed;font-size:.88rem">GHS ${parseFloat(post.price).toFixed(2)}</span>`

    : '';

  const cat = post.category

    ? `<span style="font-size:.72rem;color:var(--text-muted)"><i class="fas fa-tag"></i> ${escHtml(post.category)}</span>`

    : '';

  const desc = post.description

    ? `<p style="font-size:.8rem;color:var(--text-light);margin-top:6px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${escHtml(post.description)}</p>`

    : '';

  return `

<div style="background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;overflow:hidden">

  ${img}

  <div style="padding:12px">

    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">

      <div style="font-weight:700;font-size:.9rem;line-height:1.35">${escHtml(post.title)}</div>

      ${price}

    </div>

    ${cat}

    ${desc}

  </div>

</div>`;

}



// ── Render Services on Home Page ──────────────────────────

async function renderHomeServices() {

  const sec  = document.getElementById('home-services-section');

  const list = document.getElementById('home-services-list');

  if (!sec || !list) return;



  const [postsRes, usersRes] = await Promise.all([

    apiGet('services', 'limit=50'),

    apiGet('users',    'limit=200')

  ]);

  const allPosts   = (postsRes?.data || []).filter(s => s.status === 'active' && !s.deleted);

  const allRendors = (usersRes?.data  || []).filter(u => u.role === 'rendor' && u.status === 'active');



  const rendorMap = {};

  allRendors.forEach(r => { rendorMap[r.id] = r; });



  // Only posts belonging to approved rendors

  const posts = allPosts.filter(s => rendorMap[s.rendor_id]).slice(0, 4);



  if (!posts.length) {

    sec.style.display = 'none';

    return;

  }



  sec.style.display = '';

  list.innerHTML = posts.map(s => rendorPostCardPublicHTML(s, rendorMap[s.rendor_id])).join('');

}



function toggleSaveStore(storeId) {

  const idx = App.savedStores.indexOf(storeId);

  if (idx > -1) {

    App.savedStores.splice(idx, 1);

    showToast('Store removed from saved', 'info');

  } else {

    App.savedStores.push(storeId);

    showToast('Store saved! Γ¥ñ∩╕Å', 'success');

  }

  localStorage.setItem('happa_saved', JSON.stringify(App.savedStores));

}


function getStoreTabContentEl() {
  const activePageId = App.currentPage === 'storefront' ? 'page-storefront' : 'page-store-detail';
  const activePage = document.getElementById(activePageId);
  return activePage ? activePage.querySelector('.store-tab-content') : document.getElementById('store-tab-content');
}

// ── Storefront Helper Functions ──────────────────────────────────────────
window.switchStorefrontTab = async function(tabName, storeId) {
  const s = App.allStores.find(st => String(st.id) === String(storeId));
  if (!s) return;

  // Look up storefront record
  let sf = null;
  const sfRes = await apiGet('storefronts', 'limit=200');
  const allSF = sfRes?.data || [];
  sf = allSF.find(sfRecord => String(sfRecord.store_id) === String(storeId)) || null;

  const activePageId = App.currentPage === 'storefront' ? 'page-storefront' : 'page-store-detail';
  const activePage = document.getElementById(activePageId);
  if (activePage) {
    activePage.querySelectorAll('.store-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
  }

  const contentEl = getStoreTabContentEl();
  if (!contentEl) return;

  const storeProds = App.allProducts.filter(p => String(p.store_id) === String(storeId) && p.status === 'active');

  const isStorefrontPage = App.currentPage === 'storefront';
  const slogan = isStorefrontPage ? (sf?.slogan || s.slogan || 'Welcome to our store!') : (s.slogan || 'Welcome to our store!');
  const description = isStorefrontPage ? (sf?.about_us || s.description || 'No store bio available yet.') : (s.description || 'No store bio available yet.');
  const business_hours = isStorefrontPage ? (sf?.business_hours || s.business_hours || 'Open Mon - Sat 8:00 AM - 6:00 PM') : (s.business_hours || 'Open Mon - Sat 8:00 AM - 6:00 PM');
  const shipping_policy = isStorefrontPage ? (sf?.shipping_policy || s.shipping_policy || 'Standard Ghana shipping rates apply.') : (s.shipping_policy || 'Standard Ghana shipping rates apply.');
  const return_policy = isStorefrontPage ? (sf?.return_policy || s.return_policy || 'Items can be returned within 3 days if seal is not broken.') : (s.return_policy || 'Items can be returned within 3 days if seal is not broken.');
  const facebook_url = isStorefrontPage ? (sf?.facebook_url || s.facebook_url) : s.facebook_url;
  const instagram_url = isStorefrontPage ? (sf?.instagram_url || s.instagram_url) : s.instagram_url;
  const youtube_url = isStorefrontPage ? (sf?.youtube_url || s.youtube_url) : s.youtube_url;

  if (tabName === 'home') {
    const featured = storeProds.filter(p => p.is_flash_sale).slice(0, 4);
    const recent = [...storeProds].sort((a,b) => b.id.localeCompare(a.id)).slice(0, 4);
    const popular = [...storeProds].sort((a,b) => (b.views || 0) - (a.views || 0)).slice(0, 4);

    const renderSection = (title, items) => {
      if (!items.length) return '';
      return `
        <div class="section" style="margin-top:16px">
          <div class="section-header"><h3 style="font-size:1rem;font-weight:800;margin-left:12px">${title}</h3></div>
          <div class="product-grid" style="padding:0 12px 16px">
            ${items.map(p => productCardHTML(p)).join('')}
          </div>
        </div>
      `;
    };

    contentEl.innerHTML = `
      <div class="store-hero-banner">
        <h2 style="font-size:1.5rem;font-weight:900;margin-bottom:6px">${escHtml(slogan)}</h2>
        <p style="font-size:.85rem;opacity:.9">Best Gadgets & Offers in Ghana</p>
        <button class="btn btn-sm btn-light" onclick="switchStorefrontTab('products','${s.id}')" style="margin-top:10px;font-weight:700">Shop Now</button>
      </div>

      ${renderSection('⚡ Flash Deals', featured)}
      ${renderSection('🔥 Popular Products', popular)}
      ${renderSection('📦 Recently Added', recent)}
    `;

  } else if (tabName === 'products') {
    if (!storeProds.length) {
      contentEl.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><h3>No products found</h3></div>';
      return;
    }
    contentEl.innerHTML = `
      <div class="product-grid" style="padding:16px">
        ${storeProds.map(p => productCardHTML(p)).join('')}
      </div>
    `;

  } else if (tabName === 'cart') {
    window.renderStorefrontCart(storeId);

  } else if (tabName === 'checkout') {
    window.renderStorefrontCheckout(storeId);

  } else if (tabName === 'about') {
    let socialLinksHTML = '';
    if (facebook_url || instagram_url || youtube_url) {
      socialLinksHTML = `
        <div class="card" style="margin-top:12px">
          <div class="card-header"><h3>🔗 Connect With Us</h3></div>
          <div class="card-body" style="display:flex;gap:16px;font-size:1.3rem;padding:12px 16px">
            ${facebook_url ? `<a href="${facebook_url}" target="_blank" style="color:#1877f2" title="Facebook"><i class="fab fa-facebook"></i></a>` : ''}
            ${instagram_url ? `<a href="${instagram_url}" target="_blank" style="color:#e1306c" title="Instagram"><i class="fab fa-instagram"></i></a>` : ''}
            ${youtube_url ? `<a href="${youtube_url}" target="_blank" style="color:#ff0000" title="YouTube"><i class="fab fa-youtube"></i></a>` : ''}
          </div>
        </div>
      `;
    }
    contentEl.innerHTML = `
      <div style="padding:16px;line-height:1.6;display:grid;gap:12px">
        <div class="card">
          <div class="card-header"><h3>🏪 About Us</h3></div>
          <div class="card-body">
            <p class="store-description-text" style="font-size:.85rem;color:var(--text-light)">${escHtml(description)}</p>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>⏰ Business Hours</h3></div>
          <div class="card-body" style="font-size:.85rem;color:var(--text-light)">
            <p>${escHtml(business_hours)}</p>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📞 Contact info</h3></div>
          <div class="card-body" style="font-size:.85rem;color:var(--text-light);display:grid;gap:6px">
            <div><i class="fas fa-envelope" style="width:20px"></i> Email: ${escHtml(s.email || 'support@happamart.com')}</div>
            <div><i class="fas fa-phone" style="width:20px"></i> Hotline: ${escHtml(s.phone || '+233 (0) 244 123 456')}</div>
            <div><i class="fas fa-map-marker-alt" style="width:20px"></i> Location: ${s.location}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📦 Policies</h3></div>
          <div class="card-body" style="font-size:.82rem;color:var(--text-light);display:grid;gap:8px">
            <div><strong>Shipping:</strong> ${escHtml(shipping_policy)}</div>
            <div><strong>Returns:</strong> ${escHtml(return_policy)}</div>
          </div>
        </div>
        ${socialLinksHTML}
      </div>
    `;

  } else if (tabName === 'admin') {
    window.renderStorefrontAdminPortal(storeId);
  }
}

window.toggleFollowStore = function(storeId) {
  let followed = App.savedStores.includes(storeId);
  const s = App.allStores.find(st => st.id === storeId);
  if (!s) return;

  if (followed) {
    App.savedStores = App.savedStores.filter(id => id !== storeId);
    s.followers = Math.max(0, (s.followers || 0) - 1);
    showToast('Unfollowed store', 'info');
  } else {
    App.savedStores.push(storeId);
    s.followers = (s.followers || 0) + 1;
    showToast('Following store! 💖', 'success');
  }

  localStorage.setItem('happa_saved', JSON.stringify(App.savedStores));
  apiPut('stores', storeId, { followers: s.followers });

  const btn = document.getElementById('follow-store-btn');
  const countEl = document.getElementById('followers-count');
  if (btn) {
    btn.className = `btn btn-sm ${!followed ? 'btn-outline' : 'store-theme-btn'}`;
    btn.innerHTML = `<i class="fas ${!followed ? 'fa-check' : 'fa-plus'}"></i> ${!followed ? 'Following' : 'Follow Store'}`;
  }
  if (countEl) {
    countEl.textContent = `${s.followers} followers`;
  }
};

window.handleStoreProductSearch = function(storeId, query) {
  const contentEl = getStoreTabContentEl();
  if (!contentEl) return;

  const needle = query.trim().toLowerCase();
  const storeProds = App.allProducts.filter(p => p.store_id === storeId && p.status === 'active');
  const filtered = storeProds.filter(p => p.name.toLowerCase().includes(needle) || (p.description && p.description.toLowerCase().includes(needle)));

  if (!filtered.length) {
    contentEl.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><h3>No matching products in store</h3></div>';
    return;
  }

  document.querySelectorAll('.store-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === 'products');
  });

  contentEl.innerHTML = `
    <div style="padding:10px 16px;font-size:.78rem;color:var(--text-muted)">Found ${filtered.length} products matching "${escHtml(query)}"</div>
    <div class="product-grid" style="padding:8px 16px 16px">
      ${filtered.map(p => productCardHTML(p)).join('')}
    </div>
  `;
};

window.submitStorefrontReview = async function(form, storeId) {
  if (!App.currentUser) { showToast('Please sign in first', 'warning'); return; }
  const rating = parseInt(form.rating.value);
  const review = form.review.value.trim();

  const newReview = await apiPost('reviews', {
    customer_id: App.currentUser.id,
    customer_name: App.currentUser.name,
    target_id: storeId,
    target_type: 'store',
    rating,
    review,
    created_at: new Date().toISOString()
  });

  if (newReview) {
    showToast('Thank you for rating this store! ⭐', 'success');
    form.reset();
    switchStorefrontTab('reviews', storeId);
  }
};

/* ============================================================
   INDEPENDENT STOREFRONT MINI-WEBSITE HELPER BUNDLE
   ============================================================ */

window.openStorefrontProductModal = async function(productId) {
  const p = App.allProducts.find(prod => String(prod.id) === String(productId));
  if (!p) return;

  // Create overlay modal if not exists
  let modal = document.getElementById('storefront-product-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storefront-product-modal';
    modal.style = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center; padding: 16px;
    `;
    document.body.appendChild(modal);
  }

  const s = App.allStores.find(st => String(st.id) === String(p.store_id)) || {};
  const primaryColor = s.primary_color || '#e85d04';
  const img = p.images && p.images[0] ? p.images[0] : 'images/photo_2026-05-30_17-40-49-Photoroom.png';

  modal.innerHTML = `
    <div style="background:#ffffff; border-radius:18px; width:100%; max-width:440px; box-shadow:0 20px 40px rgba(0,0,0,0.15); overflow:hidden; position:relative; animation: slideUp 0.3s ease;">
      <button onclick="document.getElementById('storefront-product-modal').remove()" style="position:absolute; top:12px; right:12px; border:none; background:rgba(0,0,0,0.5); color:#fff; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:0.8rem; z-index:10">
        <i class="fas fa-times"></i>
      </button>
      <div style="width:100%; height:200px; background:#f8f9fa; display:flex; align-items:center; justify-content:center; overflow:hidden">
        <img src="${img}" style="width:100%; height:100%; object-fit:cover" onerror="this.src='https://via.placeholder.com/400x300?text=Product'">
      </div>
      <div style="padding:20px; display:grid; gap:12px">
        <h3 style="font-size:1.15rem; font-weight:800; color:var(--text); margin:0">${escHtml(p.name)}</h3>
        <div style="display:flex; justify-content:space-between; align-items:center">
          <span style="font-size:1.25rem; font-weight:900; color:${primaryColor}">GHS ${p.price}</span>
          <span style="font-size:0.75rem; background:#f3f4f6; padding:3px 8px; border-radius:12px; color:var(--text-muted)">In Stock: ${p.stock_qty || 0}</span>
        </div>
        <p style="font-size:0.82rem; color:var(--text-light); line-height:1.5; margin:0; max-height:80px; overflow-y:auto">${escHtml(p.description || 'No description available.')}</p>
        
        <div style="display:flex; align-items:center; gap:8px; margin-top:8px">
          <div style="display:flex; align-items:center; border:1.5px solid var(--border); border-radius:8px; overflow:hidden">
            <button onclick="window.updateStorefrontModalQty(-1)" style="padding:6px 12px; border:none; background:#fff; cursor:pointer; font-weight:700">-</button>
            <span id="store-modal-qty" style="padding:0 12px; font-weight:800; font-size:0.85rem">1</span>
            <button onclick="window.updateStorefrontModalQty(1)" style="padding:6px 12px; border:none; background:#fff; cursor:pointer; font-weight:700">+</button>
          </div>
          <button onclick="window.addStorefrontCartItem('${p.store_id}', '${p.id}')" style="flex:1; background:${primaryColor}; color:#fff; border:none; padding:10px; border-radius:8px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px">
            <i class="fas fa-shopping-cart"></i> Add to Cart
          </button>
        </div>
      </div>
    </div>
  `;
};

window.updateStorefrontModalQty = function(delta) {
  const qtyEl = document.getElementById('store-modal-qty');
  if (!qtyEl) return;
  let val = parseInt(qtyEl.textContent) + delta;
  if (val < 1) val = 1;
  qtyEl.textContent = val;
};

window.addStorefrontCartItem = function(storeId, productId) {
  const qtyEl = document.getElementById('store-modal-qty');
  const qty = qtyEl ? parseInt(qtyEl.textContent) : 1;
  const p = App.allProducts.find(prod => String(prod.id) === String(productId));
  if (!p) return;

  const key = 'happa_store_cart_' + storeId;
  let storeCart = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = storeCart.findIndex(item => String(item.id) === String(productId));

  if (idx !== -1) {
    storeCart[idx].qty += qty;
  } else {
    storeCart.push({
      id: p.id,
      name: p.name,
      price: p.price,
      images: p.images,
      qty: qty
    });
  }

  localStorage.setItem(key, JSON.stringify(storeCart));
  showToast('Product added to your store cart! 🛒', 'success');

  // Update badge
  const totalQty = storeCart.reduce((acc, curr) => acc + curr.qty, 0);
  const countBadge = document.getElementById('store-cart-count-' + storeId);
  if (countBadge) {
    countBadge.textContent = totalQty;
    countBadge.style.display = 'inline-block';
  }

  // Remove modal
  const modal = document.getElementById('storefront-product-modal');
  if (modal) modal.remove();
};

window.renderStorefrontCart = function(storeId) {
  const contentEl = getStoreTabContentEl();
  if (!contentEl) return;

  const s = App.allStores.find(st => String(st.id) === String(storeId)) || {};
  const primaryColor = s.primary_color || '#e85d04';
  const key = 'happa_store_cart_' + storeId;
  const storeCart = JSON.parse(localStorage.getItem(key) || '[]');

  if (!storeCart.length) {
    contentEl.innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <i class="fas fa-shopping-basket" style="font-size:2.5rem;color:var(--text-muted)"></i>
        <h3>Your shopping cart is empty</h3>
        <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:14px">Browse products and add them to your cart to check out.</p>
        <button class="btn store-theme-btn btn-sm" onclick="switchStorefrontTab('products', '${storeId}')">Shop Products</button>
      </div>
    `;
    return;
  }

  let subtotal = 0;
  const listHTML = storeCart.map(item => {
    const total = item.price * item.qty;
    subtotal += total;
    const img = item.images && item.images[0] ? item.images[0] : 'images/photo_2026-05-30_17-40-49-Photoroom.png';
    return `
      <div style="display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border)">
        <img src="${img}" style="width:50px; height:50px; border-radius:8px; object-fit:cover; background:#f8f9fa">
        <div style="flex:1">
          <div style="font-weight:800; font-size:0.85rem">${escHtml(item.name)}</div>
          <div style="font-size:0.8rem; color:var(--text-muted)">GHS ${item.price}</div>
        </div>
        <div style="display:flex; align-items:center; border:1px solid var(--border); border-radius:6px; overflow:hidden">
          <button onclick="window.updateStorefrontCartItemQty('${storeId}', '${item.id}', -1)" style="padding:2px 8px; border:none; background:#fff; cursor:pointer">-</button>
          <span style="padding:0 8px; font-size:0.8rem; font-weight:700">${item.qty}</span>
          <button onclick="window.updateStorefrontCartItemQty('${storeId}', '${item.id}', 1)" style="padding:2px 8px; border:none; background:#fff; cursor:pointer">+</button>
        </div>
        <div style="font-weight:800; font-size:0.85rem; width:70px; text-align:right">GHS ${total}</div>
        <button onclick="window.removeStorefrontCartItem('${storeId}', '${item.id}')" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:0.9rem; padding:6px">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
  }).join('');

  contentEl.innerHTML = `
    <div style="padding:16px; display:grid; gap:16px">
      <div class="card">
        <div class="card-header"><h3>🛍️ Shopping Cart</h3></div>
        <div class="card-body" style="padding:12px 16px">
          ${listHTML}
          <div style="display:flex; justify-content:space-between; align-items:center; padding-top:16px; font-weight:800; font-size:1rem">
            <span>Subtotal:</span>
            <span style="color:${primaryColor}">GHS ${subtotal}</span>
          </div>
        </div>
      </div>
      <button onclick="switchStorefrontTab('checkout', '${storeId}')" style="background:${primaryColor}; color:#fff; border:none; padding:12px; border-radius:10px; font-weight:800; font-size:0.9rem; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px">
        Proceed to Checkout <i class="fas fa-arrow-right"></i>
      </button>
    </div>
  `;
};

window.updateStorefrontCartItemQty = function(storeId, productId, delta) {
  const key = 'happa_store_cart_' + storeId;
  let storeCart = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = storeCart.findIndex(item => String(item.id) === String(productId));
  if (idx !== -1) {
    storeCart[idx].qty += delta;
    if (storeCart[idx].qty < 1) storeCart[idx].qty = 1;
    localStorage.setItem(key, JSON.stringify(storeCart));
    
    // Update badge count
    const totalQty = storeCart.reduce((acc, curr) => acc + curr.qty, 0);
    const countBadge = document.getElementById('store-cart-count-' + storeId);
    if (countBadge) countBadge.textContent = totalQty;

    window.renderStorefrontCart(storeId);
  }
};

window.removeStorefrontCartItem = function(storeId, productId) {
  const key = 'happa_store_cart_' + storeId;
  let storeCart = JSON.parse(localStorage.getItem(key) || '[]');
  storeCart = storeCart.filter(item => String(item.id) !== String(productId));
  localStorage.setItem(key, JSON.stringify(storeCart));
  
  // Update badge count
  const totalQty = storeCart.reduce((acc, curr) => acc + curr.qty, 0);
  const countBadge = document.getElementById('store-cart-count-' + storeId);
  if (countBadge) {
    if (totalQty > 0) {
      countBadge.textContent = totalQty;
    } else {
      countBadge.style.display = 'none';
    }
  }

  window.renderStorefrontCart(storeId);
  showToast('Item removed from cart', 'info');
};

window.renderStorefrontCheckout = function(storeId) {
  const contentEl = getStoreTabContentEl();
  if (!contentEl) return;

  const s = App.allStores.find(st => String(st.id) === String(storeId)) || {};
  const primaryColor = s.primary_color || '#e85d04';
  const key = 'happa_store_cart_' + storeId;
  const storeCart = JSON.parse(localStorage.getItem(key) || '[]');

  if (!storeCart.length) {
    window.renderStorefrontCart(storeId);
    return;
  }

  let subtotal = 0;
  storeCart.forEach(i => subtotal += i.price * i.qty);
  const delivery = 15;
  const total = subtotal + delivery;

  const user = App.currentUser || {};

  contentEl.innerHTML = `
    <div style="padding:16px; display:grid; gap:16px">
      <div class="card">
        <div class="card-header"><h3>📦 Delivery Details</h3></div>
        <div class="card-body" style="padding:16px; display:grid; gap:12px">
          <div>
            <label style="display:block; font-size:0.75rem; font-weight:700; margin-bottom:4px">Full Name</label>
            <input type="text" id="sf-ch-name" value="${escHtml(user.name || '')}" class="form-control" required placeholder="e.g. John Doe">
          </div>
          <div>
            <label style="display:block; font-size:0.75rem; font-weight:700; margin-bottom:4px">Phone Number</label>
            <input type="text" id="sf-ch-phone" value="${escHtml(user.phone || '')}" class="form-control" required placeholder="e.g. +233244123456">
          </div>
          <div>
            <label style="display:block; font-size:0.75rem; font-weight:700; margin-bottom:4px">Delivery Location / Address</label>
            <input type="text" id="sf-ch-address" value="${escHtml(user.location || '')}" class="form-control" required placeholder="e.g. KNUST, Queen's Hall">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>💳 Payment Option</h3></div>
        <div class="card-body" style="padding:16px; display:grid; gap:10px">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem">
            <input type="radio" name="sf-ch-payment" value="momo" checked>
            <span>📱 Mobile Money (MTN / Telecel / AT)</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem">
            <input type="radio" name="sf-ch-payment" value="cod">
            <span>💵 Cash on Delivery</span>
          </label>
          ${user.id ? `
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem">
            <input type="radio" name="sf-ch-payment" value="wallet">
            <span>💰 Pay with Wallet (Bal: GHS ${user.wallet_balance || 0})</span>
          </label>
          ` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>📋 Summary</h3></div>
        <div class="card-body" style="padding:12px 16px; font-size:0.85rem; display:grid; gap:6px">
          <div style="display:flex; justify-content:space-between"><span>Items Subtotal:</span><span>GHS ${subtotal}</span></div>
          <div style="display:flex; justify-content:space-between"><span>Delivery Fee:</span><span>GHS ${delivery}</span></div>
          <div style="display:flex; justify-content:space-between; font-weight:800; font-size:1rem; border-top:1px solid var(--border); padding-top:8px">
            <span>Total:</span>
            <span style="color:${primaryColor}">GHS ${total}</span>
          </div>
        </div>
      </div>

      <button onclick="window.placeStorefrontOrder('${storeId}', ${total})" style="background:${primaryColor}; color:#fff; border:none; padding:12px; border-radius:10px; font-weight:800; font-size:0.95rem; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px">
        <i class="fas fa-check-circle"></i> Place Order (GHS ${total})
      </button>
    </div>
  `;
};

window.placeStorefrontOrder = async function(storeId, totalAmount) {
  const name = document.getElementById('sf-ch-name')?.value.trim();
  const phone = document.getElementById('sf-ch-phone')?.value.trim();
  const address = document.getElementById('sf-ch-address')?.value.trim();
  const payment = document.querySelector('input[name="sf-ch-payment"]:checked')?.value;

  if (!name || !phone || !address) {
    showToast('Please fill in all delivery details', 'warning');
    return;
  }

  const user = App.currentUser || {};
  if (payment === 'wallet') {
    if (!user.id) {
      showToast('Please sign in to pay with wallet', 'warning');
      return;
    }
    if ((user.wallet_balance || 0) < totalAmount) {
      showToast('Insufficient wallet balance!', 'danger');
      return;
    }
    user.wallet_balance = (user.wallet_balance || 0) - totalAmount;
    localStorage.setItem('happa_session', JSON.stringify(user));
    await apiPatch('users', user.id, { wallet_balance: user.wallet_balance });
  } else if (payment === 'momo') {
    // Simulate Momo Authorization Prompt
    const num = prompt('Enter your Mobile Money phone number:', phone);
    if (!num) return;
    const pin = prompt('Enter MoMo PIN to authorize GHS ' + totalAmount + ' payment:');
    if (!pin) {
      showToast('Payment cancelled', 'info');
      return;
    }
    showToast('Processing MoMo Payment...', 'info');
    await new Promise(r => setTimeout(r, 1200));
  }

  const key = 'happa_store_cart_' + storeId;
  const storeCart = JSON.parse(localStorage.getItem(key) || '[]');
  const pCode = 'PK-' + Math.floor(10000 + Math.random() * 89999);

  // Post order package record to DB so vendor receives it
  const newPkg = await apiPost('packages', {
    id: 'pkg-' + Date.now(),
    package_code: pCode,
    store_id: storeId,
    vendor_id: App.allStores.find(st => String(st.id) === String(storeId))?.vendor_id || 'u-vendor-001',
    buyer_id: user.id || 'guest',
    buyer_name: name,
    buyer_phone: phone,
    delivery_address: address,
    payment_method: payment === 'wallet' ? 'wallet' : (payment === 'momo' ? 'momo' : 'cod'),
    payment_status: payment === 'cod' ? 'pending' : 'paid',
    vendor_status: 'pending',
    delivery_status: 'pending',
    total_amount: totalAmount,
    items_count: storeCart.reduce((sum, item) => sum + item.qty, 0),
    items: storeCart.map(item => ({
      product_id: item.id,
      name: item.name,
      price: item.price,
      qty: item.qty
    })),
    created_at: new Date().toISOString()
  });

  if (newPkg) {
    showToast('Order placed successfully! 🎉', 'success');
    localStorage.removeItem(key);

    // Reset badge
    const countBadge = document.getElementById('store-cart-count-' + storeId);
    if (countBadge) countBadge.style.display = 'none';

    // Show confirmation tab content
    const contentEl = getStoreTabContentEl();
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="empty-state" style="padding:60px 20px">
          <i class="fas fa-check-circle" style="font-size:3rem;color:var(--success)"></i>
          <h3>Thank you for your purchase!</h3>
          <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:14px">Your order has been sent to the store. Package Code: <strong>${pCode}</strong></p>
          <button class="btn store-theme-btn btn-sm" onclick="switchStorefrontTab('home', '${storeId}')">Back to Store</button>
        </div>
      `;
    }
  }
};

window.renderStorefrontAdminPortal = function(storeId) {
  const contentEl = getStoreTabContentEl();
  if (!contentEl) return;

  const s = App.allStores.find(st => String(st.id) === String(storeId)) || {};
  const primaryColor = s.primary_color || '#e85d04';

  contentEl.innerHTML = `
    <div style="padding:16px; display:grid; gap:16px; justify-items:center; text-align:center">
      <div class="card" style="width:100%; max-width:400px">
        <div class="card-header"><h3>🔑 Storefront Admin Access</h3></div>
        <div class="card-body" style="padding:20px; display:grid; gap:14px">
          <i class="fas fa-shield-alt" style="font-size:2.5rem; color:${primaryColor}"></i>
          <p style="font-size:0.82rem; color:var(--text-muted); line-height:1.5">This portal allows the owner of <strong>${escHtml(s.name)}</strong> to manage listings, view store orders, and configure settings.</p>
          <button onclick="window.accessStorefrontDashboard('${storeId}')" style="background:${primaryColor}; color:#fff; border:none; padding:10px; border-radius:8px; font-weight:800; cursor:pointer; width:100%">
            Open Storefront Dashboard
          </button>
        </div>
      </div>
    </div>
  `;
};

window.accessStorefrontDashboard = function(storeId) {
  const user = App.currentUser;
  if (!user) {
    showToast('Please log in with your HAPPA vendor account first.', 'warning');
    showPage('auth');
    return;
  }
  const s = App.allStores.find(st => String(st.id) === String(storeId));
  if (s && String(s.vendor_id) === String(user.id)) {
    showPage('vendor-dashboard');
    showToast('Welcome to your storefront dashboard! 🏪', 'success');
  } else {
    showToast('Access denied: You are not registered as the owner of this storefront.', 'danger');
  }
};

window.renderStorefrontAdminPortalPage = async function(storeId) {
  const s = App.allStores.find(st => String(st.id) === String(storeId));
  if (!s) return;

  const container = document.getElementById('page-store-admin');
  if (!container) return;

  const primaryColor = s.primary_color || '#e85d04';
  const user = App.currentUser;
  const isOwner = user && String(s.vendor_id) === String(user.id);

  if (!isOwner) {
    // Show branded Login Form
    container.innerHTML = `
      <div style="min-height:100vh; background:#f4f6f9; display:flex; align-items:center; justify-content:center; padding:20px; font-family:sans-serif">
        <div class="card" style="width:100%; max-width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.08); border-radius:12px; overflow:hidden">
          <div style="background:${primaryColor}; padding:24px; text-align:center; color:#fff">
            <h2 style="font-size:1.3rem; font-weight:800; margin:0">${escHtml(s.name)}</h2>
            <p style="font-size:0.8rem; margin:6px 0 0 0; opacity:0.9">Storefront Admin Portal</p>
          </div>
          <div class="card-body" style="padding:24px; display:grid; gap:16px">
            <form onsubmit="event.preventDefault(); window.submitStorefrontAdminLogin(this, '${s.id}')" style="display:grid; gap:14px">
              <div>
                <label style="display:block; font-size:0.75rem; font-weight:700; margin-bottom:4px; color:var(--text)">Vendor Email</label>
                <input type="email" name="email" class="form-control" placeholder="e.g. vendor@mail.com" required style="width:100%">
              </div>
              <div>
                <label style="display:block; font-size:0.75rem; font-weight:700; margin-bottom:4px; color:var(--text)">Password</label>
                <input type="password" name="password" class="form-control" placeholder="••••••••" required style="width:100%">
              </div>
              <button type="submit" style="background:${primaryColor}; color:#fff; border:none; padding:10px; border-radius:8px; font-weight:800; width:100%; cursor:pointer">
                Log In as Admin
              </button>
            </form>
            <div style="text-align:center; margin-top:8px; display:grid; gap:8px">
              <a href="#store/${s.slug || s.id}" style="font-size:0.8rem; color:${primaryColor}; text-decoration:none; font-weight:600">
                <i class="fas fa-arrow-left"></i> Back to Storefront Website
              </a>
              <a href="#register-vendor" style="font-size:0.75rem; color:var(--text-muted); text-decoration:underline; font-weight:600">
                Create Storefront Admin Account
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Render control center dashboard
  container.innerHTML = `
    <div style="background:#f4f6f9; min-height:100vh; display:flex; flex-direction:column">
      <!-- Branded Standalone Admin Header -->
      <div style="background:#fff; border-bottom:1.5px solid var(--border); padding:12px 16px; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; z-index:100">
        <div style="display:flex; align-items:center; gap:8px">
          <i class="fas fa-shield-alt" style="color:${primaryColor}; font-size:1.1rem"></i>
          <span style="font-weight:900; font-size:0.95rem; color:${primaryColor}">${escHtml(s.name)} Control Center</span>
        </div>
        <div style="display:flex; gap:8px">
          <a href="#store/${s.slug || s.id}" class="btn btn-sm btn-outline" style="font-size:0.75rem; font-weight:700; border-radius:18px">
            <i class="fas fa-external-link-alt"></i> Storefront Website
          </a>
          <button onclick="window.logoutStorefrontAdmin('${s.id}')" class="btn btn-sm btn-danger" style="font-size:0.75rem; font-weight:700; border-radius:18px; border:none; background:var(--danger)">
            <i class="fas fa-sign-out-alt"></i> Logout Control Center
          </button>
        </div>
      </div>

      <!-- Content wrapper targeting HAPPA's vendor-dashboard-content div -->
      <div id="vendor-dashboard-content" style="flex:1; padding:16px"></div>
    </div>
  `;

  if (typeof renderVendorDashboard === 'function') {
    renderVendorDashboard();
  }

  App.loadedPages['store-admin-' + storeId] = true;
  App.isBackgroundRefresh = false;
};

window.submitStorefrontAdminLogin = async function(form, storeId) {
  const email = form.email.value.trim().toLowerCase();
  const password = form.password.value.trim();

  // Dynamically populate App.allUsers if missing or empty
  if (!App.allUsers || !App.allUsers.length) {
    const res = await apiGet('users', 'limit=200').catch(() => null);
    App.allUsers = res?.data || [];
  }

  // Find user and check credentials
  const foundUser = (App.allUsers || []).find(u => u.email.toLowerCase() === email && u.password === password);
  if (!foundUser) {
    showToast('Invalid email or password', 'danger');
    return;
  }

  // Check store ownership
  const s = App.allStores.find(st => String(st.id) === String(storeId));
  if (!s || String(s.vendor_id) !== String(foundUser.id)) {
    showToast('Access denied: This account is not the registered owner of this storefront.', 'danger');
    return;
  }

  App.currentUser = foundUser;
  localStorage.setItem('happa_session', JSON.stringify(foundUser));
  updateNavForUser();
  showToast('Logged in to control center successfully! 🏪', 'success');

  window.renderStorefrontAdminPortalPage(storeId);
};

window.logoutStorefrontAdmin = function(storeId) {
  logout();
  window.renderStorefrontAdminPortalPage(storeId);
};


window.switchImg = function(thumbnailEl, imgUrl) {
  const container = thumbnailEl.closest('.page, .modal-content, .card');
  if (!container) return;
  const mainImg = container.querySelector('img[style*="max-height:340px"], .product-img');
  if (mainImg) mainImg.src = imgUrl;
  const thumbs = container.querySelectorAll('img[onclick*="switchImg"]');
  thumbs.forEach(t => t.style.opacity = '0.6');
  thumbnailEl.style.opacity = '1';
};

