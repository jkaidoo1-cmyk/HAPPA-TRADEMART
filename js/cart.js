/* ============================================================
   HAPPA TRADEMART — Cart Module
   ============================================================ */

function addToCart(product, qty = 1, buyerNote = '') {
  if (App.currentUser && ['admin', 'vendor', 'pending_vendor'].includes(App.currentUser.role)) {
    // Vendors/admins can't shop — explain it instead of silently doing nothing.
    showToast('Shopping is for buyer accounts — sign in with a buyer account to add items to your cart.', 'info', 4500);
    return false;
  }
  if (!product) return false;
  if (product.stock_qty === 0 || product.status === 'sold_out') {
    showToast('This item is out of stock', 'error');
    return false;
  }

  // ── Optimistic UI: capture pre-state, render immediately, ──
  const previousCart = JSON.parse(JSON.stringify(App.cart));
  const existing = App.cart.find(i => i.id === product.id);
  const store = App.allStores.find(s => s.id === product.store_id) || { name: 'Store', id: product.store_id, location: product.location };
  if (existing) {
    const newQty = Math.min(existing.qty + qty, product.stock_qty);
    existing.qty = newQty;
    // Update note if a new one was provided
    if (buyerNote) existing.buyer_note = buyerNote;
    showToast(`Cart updated: ${product.name} ×${newQty}`, 'success');
  } else {
    // Product-share referral attribution:
    // 1. Read referrer from cookie (set when user opened a ?ref= link)
    // 2. Lock on first add-to-cart so later share links don't overwrite
    // 3. Never attribute to self
    const refCookie = (document.cookie || '').split('; ')
      .find(c => c.startsWith('happa_ref='));
    const freshRef = refCookie ? decodeURIComponent(refCookie.split('=')[1]) : '';
    const isSelfRef = App.currentUser && freshRef === App.currentUser.referral_code;
    // Lock: use existing cart referrer if cart is not empty, otherwise use cookie
    const lockedRef = isSelfRef ? ''
      : (App.cart.length > 0 ? (App.cart[0].product_referrer || '') : freshRef);

    App.cart.push({
      id: product.id, name: product.name, price: product.price,
      image: product.images?.[0] || '', qty,
      stock_qty: product.stock_qty,
      store_id: product.store_id, store_name: store.name,
      vendor_id: product.vendor_id, location: product.location || store.location || 'Accra',
      weight_kg: product.weight_kg || 0.5,
      commission_pct: getCommission(product.price),
      buyer_note: buyerNote || '',
      allow_buyer_note: product.allow_buyer_note || false,
      product_referrer: lockedRef
    });
    showToast(`Added to cart: ${product.name} 🛒`, 'success');
  }
  saveCart();
  updateCartBadge();
  // Pulse the cart icon so the user sees the count change
  const cartIcon = document.querySelector('.nav-icon[onclick*="cart"], .nav-icon i.fa-shopping-cart, .nav-icon i.fa-shopping-bag');
  if (cartIcon) {
    const target = cartIcon.closest('.nav-icon') || cartIcon;
    if (window.OptimisticUI) OptimisticUI.pulse(target);
  }

  // Rollback helper exposed in case a future caller wants to
  // revert the optimistic add (e.g. if a server-side stock check
  // fails on a future migration). Safe no-op today.
  if (!addToCart._registerRollback) {
    addToCart._registerRollback = (productId) => {
      App.cart = previousCart;
      saveCart();
      updateCartBadge();
    };
  }

  return true;
}

function removeFromCart(productId, targetEl) {
  if (targetEl && window.OptimisticUI) {
    const itemCard = targetEl.closest('.cart-item');
    if (itemCard) itemCard.style.opacity = '0.3';
  }
  App.cart = App.cart.filter(i => i.id !== productId);
  saveCart();
  renderCart();
  const cartIcon = document.querySelector('.nav-icon[onclick*="cart"], .nav-icon i.fa-shopping-cart, .nav-icon i.fa-shopping-bag');
  if (cartIcon && window.OptimisticUI) {
    OptimisticUI.pulse(cartIcon.closest('.nav-icon') || cartIcon);
  }
}

function updateCartQty(productId, delta, btnEl) {
  const item = App.cart.find(i => i.id === productId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) { removeFromCart(productId, btnEl); return; }
  if (newQty > item.stock_qty) {
    if (btnEl && window.OptimisticUI) OptimisticUI.shake(btnEl);
    showToast('Not enough stock', 'warning');
    return;
  }
  item.qty = newQty;
  saveCart();
  renderCart();
  const cartIcon = document.querySelector('.nav-icon[onclick*="cart"], .nav-icon i.fa-shopping-cart, .nav-icon i.fa-shopping-bag');
  if (cartIcon && window.OptimisticUI) {
    OptimisticUI.pulse(cartIcon.closest('.nav-icon') || cartIcon);
  }
}

function clearCart() {
  if (!App.cart.length) return;
  if (!confirm('Clear your entire cart?')) return;
  App.cart = [];
  saveCart();
  renderCart();
  showToast('Cart cleared', 'info');
}

function getCartTotals(overrideDest) {
  const subtotal = App.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const commissionTotal = App.cart.reduce((s, i) => s + (i.price * i.qty * (i.commission_pct || 8) / 100), 0);
  const platformFee = subtotal * PLATFORM_FEE_PCT / 100;
  const destSelect = typeof document !== 'undefined' ? document.getElementById('checkout-dest')?.value : '';
  const targetLoc = overrideDest || destSelect || App.currentUser?.location || 'Accra';

  // Group by store to calculate delivery
  const stores = {};
  App.cart.forEach(item => {
    if (!stores[item.store_id]) stores[item.store_id] = { location: item.location, items: [] };
    stores[item.store_id].items.push(item);
  });

  let deliveryFee = 0;
  Object.values(stores).forEach(sg => {
    const d = calcDelivery(sg.location, targetLoc || sg.location,
      sg.items.reduce((s, i) => s + i.weight_kg * i.qty, 0));
    deliveryFee += d.rate;
  });

  let discount = 0;
  if (App.appliedCoupon) {
    // Coupons are created in the admin editor with type '%' or 'GHS'.
    // Accept both '%' and legacy 'pct' as a percentage discount.
    const cType = App.appliedCoupon.type;
    if (cType === 'pct' || cType === '%') {
      discount = Math.min(subtotal, subtotal * (App.appliedCoupon.value / 100));
    } else {
      discount = Math.min(subtotal, App.appliedCoupon.value);
    }
  }

  const total = Math.max(0, subtotal + platformFee + deliveryFee - discount);
  return { subtotal, commissionTotal, platformFee, deliveryFee, discount, total };
}

async function renderCartOrders() {
  const container = document.getElementById('cart-recent-orders');
  if (!container) return;
  if (!App.currentUser || !App.currentUser.id) {
    container.innerHTML = '';
    return;
  }
  try {
    const pkgsRes = await apiGet('packages', 'limit=20');
    const allPkgs = pkgsRes?.data || (Array.isArray(pkgsRes) ? pkgsRes : []);
    const myPkgs = allPkgs.filter(p => {
      if (typeof buyerOwnsPackage === 'function') return buyerOwnsPackage(p, App.currentUser);
      return String(p.buyer_id) === String(App.currentUser.id);
    }).sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0)).slice(0, 10);
    if (!myPkgs.length) {
      container.innerHTML = '';
      return;
    }
    const statusLabels = {
      pending: { text: 'Processing', css: 'pending', icon: 'fa-clock' },
      received: { text: 'Vendor Received', css: 'received', icon: 'fa-store' },
      processed: { text: 'Ready', css: 'processed', icon: 'fa-box' },
      on_delivery: { text: 'On Delivery', css: 'on_delivery', icon: 'fa-truck' },
      delivered: { text: 'Delivered', css: 'delivered', icon: 'fa-check-double' },
      rejected: { text: 'Rejected', css: 'rejected', icon: 'fa-times-circle' }
    };
    container.innerHTML = `
<div style="margin:0 16px 12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <h3 style="font-size:.9rem;font-weight:800;margin:0"><i class="fas fa-truck" style="color:var(--primary);margin-right:6px"></i>Recent Orders</h3>
    <button class="btn btn-ghost btn-sm" onclick="showPage('buyer')" style="font-size:.75rem;padding:4px 10px">View All</button>
  </div>
  ${myPkgs.map(pkg => {
    const vs = pkg.vendor_status || 'pending';
    const as = pkg.admin_status || 'pending';
    let st;
    if (vs === 'rejected') st = statusLabels.rejected;
    else if (as === 'delivered') st = statusLabels.delivered;
    else if (as === 'on_delivery') st = statusLabels.on_delivery;
    else if (vs === 'processed') st = statusLabels.processed;
    else if (vs === 'received') st = statusLabels.received;
    else st = statusLabels.pending;
    const items = (pkg.items || []).slice(0, 2);
    const dateStr = pkg.created_at ? new Date(pkg.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '';
    return `
<div class="package-card" style="margin-bottom:8px;cursor:pointer" onclick="showPackageDetailModal('${pkg.id}')">
  <div class="package-header" style="padding:10px 12px">
    <span class="package-code" style="font-size:.78rem"><i class="fas fa-cube" style="margin-right:3px"></i>${pkg.package_code || pkg.id || ''}</span>
    <span class="status-badge status-${st.css}" style="font-size:.7rem;padding:3px 8px"><i class="fas ${st.icon}" style="margin-right:3px"></i>${st.text}</span>
  </div>
  <div style="padding:8px 12px 10px">
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
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:.75rem;color:var(--text-muted)">${items.map(i => i.name || 'Item').join(', ')}${(pkg.items||[]).length > 2 ? ' +' + ((pkg.items||[]).length-2) : ''}</div>
      <div style="font-size:.75rem;color:var(--text-muted)">${dateStr}</div>
    </div>
    <div style="font-size:.82rem;font-weight:700;color:var(--primary);margin-top:4px">GHS ${(parseFloat(pkg.total || pkg.gross_amount) || 0).toFixed(2)}</div>
  </div>
</div>`; }).join('')}
</div>`;
  } catch(e) {
    container.innerHTML = '';
  }
}
window.renderCartOrders = renderCartOrders;

function renderCart() {
  const c = document.getElementById('cart-content');
  if (!c) return;
  if (!App.cart.length) {
    c.innerHTML = `
<div class="empty-state" style="padding:40px 20px 16px">
  <i class="fas fa-shopping-bag"></i>
  <h3>Your cart is empty</h3>
  <p>Add items from our marketplace</p>
  <button class="btn btn-primary" style="margin-top:16px" onclick="showPage('marketplace')">
    <i class="fas fa-store"></i> Start Shopping
  </button>
</div>
<div id="cart-recent-orders"></div>`;
    if (App.currentUser) renderCartOrders();
    return;
  }

  // Group cart items by store/vendor
  const storeGroups = {};
  App.cart.forEach(item => {
    if (!storeGroups[item.store_id]) {
      storeGroups[item.store_id] = { store_name: item.store_name, store_id: item.store_id, items: [] };
    }
    storeGroups[item.store_id].items.push(item);
  });

  const totals = getCartTotals();

  c.innerHTML = `
<div id="cart-vendor-groups">
${Object.values(storeGroups).map(sg => `
<div style="margin-bottom:12px">
  <div style="background:var(--bg);padding:8px 16px;font-size:.78rem;font-weight:700;color:var(--text-light);border-bottom:1px solid var(--border)">
    <i class="fas fa-store" style="color:var(--primary)"></i> ${escHtml(sg.store_name)}
  </div>
  ${sg.items.map(item => `
  <div class="cart-item">
    <img class="cart-item-img" src="${item.image||'https://via.placeholder.com/80x80?text=P'}"
         alt="${escHtml(item.name)}" onerror="this.src='https://via.placeholder.com/80x80?text=P'">
    <div class="cart-item-info">
      <div class="cart-item-name">${escHtml(item.name)}</div>
      <div class="cart-item-store"><i class="fas fa-store"></i> ${escHtml(item.store_name)}</div>
      ${item.buyer_note ? `<div style="font-size:.72rem;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:3px 7px;margin:3px 0;display:flex;align-items:flex-start;gap:4px"><i class="fas fa-comment-dots" style="margin-top:1px;flex-shrink:0"></i><span>${escHtml(item.buyer_note)}</span></div>` : ''}
      <div class="cart-item-price">GHS ${item.price}</div>
      <div class="qty-control">
        <button class="qty-btn" onclick="updateCartQty('${item.id}',-1,this)"><i class="fas fa-minus"></i></button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" onclick="updateCartQty('${item.id}',1,this)"><i class="fas fa-plus"></i></button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
      <span style="font-weight:700;color:var(--primary)">GHS ${(item.price*item.qty).toFixed(2)}</span>
      <button onclick="removeFromCart('${item.id}',this)" style="color:var(--danger);font-size:.8rem"><i class="fas fa-trash"></i></button>
    </div>
  </div>`).join('')}
</div>`).join('')}
</div>

<!-- Package Info -->
<div style="margin:8px 16px;padding:12px;background:var(--primary-light);border-radius:var(--radius-md);border:1px solid rgba(232,93,4,.2)">
  <div style="font-size:.8rem;font-weight:700;color:var(--primary);margin-bottom:4px">
    <i class="fas fa-boxes"></i> ${Object.keys(storeGroups).length} Vendor Package${Object.keys(storeGroups).length>1?'s':''}
  </div>
  <div style="font-size:.75rem;color:var(--text-light)">
    Separate tracking IDs generated per vendor. Same-location items auto-bundled.
  </div>
</div>

<!-- Summary -->
<div class="checkout-summary" style="margin:12px 16px">
  <div class="summary-row"><span>Subtotal</span><span>GHS ${totals.subtotal.toFixed(2)}</span></div>
  <div class="summary-row"><span>Platform Fee (${PLATFORM_FEE_PCT}%)</span><span>GHS ${totals.platformFee.toFixed(2)}</span></div>
  ${totals.discount > 0 ? `<div class="summary-row" style="color:var(--success)"><span>Discount</span><span>- GHS ${totals.discount.toFixed(2)}</span></div>` : ''}
  <div class="summary-row total"><span>Total</span><span class="amount">GHS ${totals.total.toFixed(2)}</span></div>
</div>

<!-- Checkout CTA -->
<div style="padding:0 16px 16px">
  <button class="btn btn-primary btn-block btn-lg" onclick="proceedToCheckout()">
    <i class="fas fa-lock"></i> Proceed to Checkout
  </button>
  <div style="text-align:center;margin-top:8px">
    <button onclick="showPage('marketplace')" class="btn btn-ghost btn-sm" style="color:var(--primary)">
      <i class="fas fa-plus"></i> Add more items
    </button>
  </div>
</div>

<!-- Shipping Notice removed — banner now lives statically above #cart-content in index.html -->

<!-- Recent Orders -->
<div id="cart-recent-orders"></div>`;
  if (App.currentUser) renderCartOrders();
}

function proceedToCheckout() {
  if (App.currentUser && ['admin', 'vendor', 'pending_vendor'].includes(App.currentUser.role)) {
    showToast('Shopping is for buyer accounts — sign in with a buyer account to continue.', 'info', 4500);
    return;
  }
  if (!App.cart.length) { showToast('Your cart is empty', 'warning'); return; }
  showPage('checkout');
}
