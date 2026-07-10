/* ============================================================
   HAPPA TRADEMART — Cart Module
   ============================================================ */

function addToCart(product, qty = 1, buyerNote = '') {
  if (!product) return;
  if (product.stock_qty === 0 || product.status === 'sold_out') {
    showToast('This item is out of stock', 'error');
    return;
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
    App.cart.push({
      id: product.id, name: product.name, price: product.price,
      image: product.images?.[0] || '', qty,
      stock_qty: product.stock_qty,
      store_id: product.store_id, store_name: store.name,
      vendor_id: product.vendor_id, location: product.location,
      weight_kg: product.weight_kg || 0.5,
      commission_pct: getCommission(product.price),
      buyer_note: buyerNote || '',
      allow_buyer_note: product.allow_buyer_note || false
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
}

function removeFromCart(productId) {
  App.cart = App.cart.filter(i => i.id !== productId);
  saveCart();
  renderCart();
}

function updateCartQty(productId, delta) {
  const item = App.cart.find(i => i.id === productId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) { removeFromCart(productId); return; }
  if (newQty > item.stock_qty) { showToast('Not enough stock', 'warning'); return; }
  item.qty = newQty;
  saveCart();
  renderCart();
}

function clearCart() {
  if (!App.cart.length) return;
  if (!confirm('Clear your entire cart?')) return;
  App.cart = [];
  saveCart();
  renderCart();
  showToast('Cart cleared', 'info');
}

function getCartTotals() {
  const subtotal = App.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const commissionTotal = App.cart.reduce((s, i) => s + (i.price * i.qty * (i.commission_pct || 8) / 100), 0);
  const platformFee = subtotal * PLATFORM_FEE_PCT / 100;
  const userLoc = App.currentUser?.location || '';

  // Group by store to calculate delivery
  const stores = {};
  App.cart.forEach(item => {
    if (!stores[item.store_id]) stores[item.store_id] = { location: item.location, items: [] };
    stores[item.store_id].items.push(item);
  });

  let deliveryFee = 0;
  Object.values(stores).forEach(sg => {
    const d = calcDelivery(sg.location, userLoc || sg.location,
      sg.items.reduce((s, i) => s + i.weight_kg * i.qty, 0));
    deliveryFee += d.rate;
  });

  const total = subtotal + platformFee + deliveryFee;
  return { subtotal, commissionTotal, platformFee, deliveryFee, total };
}

function renderCart() {
  const c = document.getElementById('cart-content');
  if (!c) return;
  if (!App.cart.length) {
    c.innerHTML = `
<div class="empty-state" style="padding:60px 20px">
  <i class="fas fa-shopping-bag"></i>
  <h3>Your cart is empty</h3>
  <p>Add items from our marketplace</p>
  <button class="btn btn-primary" style="margin-top:16px" onclick="showPage('marketplace')">
    <i class="fas fa-store"></i> Start Shopping
  </button>
</div>`;
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
        <button class="qty-btn" onclick="updateCartQty('${item.id}',-1)"><i class="fas fa-minus"></i></button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" onclick="updateCartQty('${item.id}',1)"><i class="fas fa-plus"></i></button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
      <span style="font-weight:700;color:var(--primary)">GHS ${(item.price*item.qty).toFixed(2)}</span>
      <button onclick="removeFromCart('${item.id}')" style="color:var(--danger);font-size:.8rem"><i class="fas fa-trash"></i></button>
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
  <div class="summary-row"><span>Estimated Delivery</span><span>GHS ${totals.deliveryFee.toFixed(2)}</span></div>
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

<!-- Shipping Notice removed — banner now lives statically above #cart-content in index.html -->`;
}

function proceedToCheckout() {
  if (!App.currentUser) { showPage('auth'); return; }
  if (!App.cart.length) { showToast('Your cart is empty', 'warning'); return; }
  showPage('checkout');
}
