/* ============================================================
   HAPPA TRADEMART — Checkout & Order Splitting Module
   ============================================================ */

let selectedPayment = 'mobile_money';

function renderCheckout() {
  if (App.currentUser && ['admin', 'vendor', 'pending_vendor'].includes(App.currentUser.role)) {
    showPage('home');
    return;
  }
  if (!App.cart.length) { showPage('cart'); return; }

  const c = document.getElementById('checkout-content');
  if (!c) return;

  const totals = getCartTotals();
  const isGuest = !App.currentUser;
  const u = App.currentUser || { name: '', phone: '', email: '', location: 'Accra' };

  const sat = getNextSaturday();

  let guestFormHTML = '';
  if (isGuest) {
    guestFormHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>👤 Guest Customer Details</h3></div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input class="form-control" id="guest-name" placeholder="John Doe" required>
          </div>
          <div class="form-group">
            <label class="form-label">Phone Number</label>
            <input class="form-control" id="guest-phone" type="tel" placeholder="e.g. 0244123456" required>
          </div>
          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input class="form-control" id="guest-email" type="email" placeholder="john@example.com" required>
          </div>
        </div>
      </div>
    `;
  }

  c.innerHTML = `
<div style="padding:16px">

  ${guestFormHTML}

  <!-- Delivery Address -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>📍 Delivery Address</h3></div>
    <div class="card-body">
      <div class="form-group">
        <label class="form-label">Delivery Location</label>
        <select class="form-control form-select" id="checkout-dest" onchange="updateDeliveryFee()">
          ${LOCATIONS.map(l => `<option value="${l}"${l===u.location?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Full Address / Landmark</label>
        <textarea class="form-control" id="checkout-address" rows="2" placeholder="House number, street, landmark…">${u.location || ''}</textarea>
      </div>

    </div>
  </div>

  <!-- Shipping Schedule -->
  <div class="ship-schedule-card" style="margin-bottom:14px">
    <div style="font-size:2rem">📅</div>
    <div>
      <div style="font-weight:700;font-size:.9rem">Scheduled Shipping</div>
      <div style="font-size:.8rem;opacity:.8">Items will be picked up &amp; shipped on</div>
      <span class="ship-date-badge">${sat.toLocaleDateString('en-GH',{weekday:'long',day:'numeric',month:'long'})}</span>
    </div>
  </div>

  <!-- Package Preview -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>📦 Your Packages</h3></div>
    <div class="card-body" style="padding:12px 14px">
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:10px">Each vendor will have a separate package ID for tracking.</p>
      ${Object.entries(groupByVendor(App.cart)).map(([sid, items]) => {
        const pCode = generatePackageCode(items[0].location);
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:.875rem">
          <div><strong>${escHtml(items[0].store_name)}</strong><br><span style="font-size:.75rem;color:var(--text-muted)">${items.length} item${items.length!==1?'s':''} · ${items[0].location}</span></div>
          <code style="background:var(--secondary);color:var(--accent);padding:3px 8px;border-radius:4px;font-size:.75rem;font-weight:700">${pCode}</code>
        </div>`;
      }).join('')}
    </div>
  </div>



  <!-- Discount Coupon -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>🏷️ Discount Coupon</h3></div>
    <div class="card-body">
      <div style="display:flex;gap:8px">
        <input class="form-control" id="checkout-coupon" placeholder="Enter coupon code (optional)" value="${App.appliedCoupon ? escHtml(App.appliedCoupon.code) : ''}">
        <button class="btn btn-outline btn-sm" onclick="applyCoupon()">Apply</button>
      </div>
      <div id="coupon-msg" style="margin-top:6px;font-size:.8rem">
        ${App.appliedCoupon ? '<span style="color:var(--success)"><i class="fas fa-check"></i> Coupon applied!</span>' : ''}
      </div>
    </div>
  </div>

  <!-- Payment Method -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>💳 Payment Method</h3></div>
    <div class="card-body">
      <div class="payment-option ${selectedPayment==='mobile_money'?'selected':''}" onclick="selectPayment('mobile_money')">
        <span class="payment-icon">📱</span>
        <div><div class="payment-name">Mobile Money</div><div class="payment-desc">MTN, Vodafone, Paystack, Stripe</div></div>
        <i class="fas fa-${selectedPayment==='mobile_money'?'check-circle':'circle'}" style="margin-left:auto;color:${selectedPayment==='mobile_money'?'var(--primary)':'var(--border)'}"></i>
      </div>
      <div class="payment-option ${selectedPayment==='card'?'selected':''}" onclick="selectPayment('card')">
        <span class="payment-icon">💳</span>
        <div><div class="payment-name">Bank Card</div><div class="payment-desc">Visa, Mastercard</div></div>
        <i class="fas fa-${selectedPayment==='card'?'check-circle':'circle'}" style="margin-left:auto;color:${selectedPayment==='card'?'var(--primary)':'var(--border)'}"></i>
      </div>

    </div>
  </div>

  ${selectedPayment === 'mobile_money' ? `
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>📱 Mobile Money Details</h3></div>
    <div class="card-body">
      <div class="form-group">
        <label class="form-label">Network</label>
        <select class="form-control form-select" id="momo-network">
          <option>MTN Mobile Money</option>
          <option>Vodafone Cash</option>
          <option>AirtelTigo Money</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Mobile Number</label>
        <input class="form-control" id="momo-number" type="tel" placeholder="024 000 0000" value="${u.phone||''}">
      </div>
    </div>
  </div>` : selectedPayment === 'card' ? `
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>💳 Card Details</h3></div>
    <div class="card-body">
      <div class="form-group">
        <label class="form-label">Card Number</label>
        <input class="form-control" placeholder="0000 0000 0000 0000" maxlength="19">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="form-label">Expiry</label><input class="form-control" placeholder="MM/YY"></div>
        <div class="form-group"><label class="form-label">CVV</label><input class="form-control" placeholder="•••" maxlength="3"></div>
      </div>
    </div>
  </div>` : ''}

  <!-- Order Summary -->
  <div class="checkout-summary" style="margin-bottom:14px">
    <div class="summary-row"><span>Subtotal (${App.cart.reduce((s,i)=>s+i.qty,0)} items)</span><span>GHS ${totals.subtotal.toFixed(2)}</span></div>
    <div class="summary-row"><span>Platform Fee (${PLATFORM_FEE_PCT}%)</span><span>GHS ${totals.platformFee.toFixed(2)}</span></div>
    <!-- Delivery Fee row hashed out temporarily for mean time:
    <div class="summary-row"><span>Delivery Fee</span><span id="checkout-delivery">GHS ${totals.deliveryFee.toFixed(2)}</span></div> -->
    <div class="summary-row" id="discount-row" style="display:${totals.discount > 0 ? 'flex' : 'none'}"><span style="color:var(--success)">Discount</span><span id="discount-amt" style="color:var(--success)">- GHS ${(totals.discount || 0).toFixed(2)}</span></div>
    <div class="summary-row total"><span>Total</span><span class="amount" id="checkout-total">GHS ${totals.total.toFixed(2)}</span></div>
  </div>

  <!-- Place Order -->
  <button class="btn btn-primary btn-block btn-lg" onclick="placeOrder()" id="place-order-btn">
    <i class="fas fa-lock"></i> Place Order · GHS ${totals.total.toFixed(2)}
  </button>
  <p style="text-align:center;font-size:.75rem;color:var(--text-muted);margin-top:8px">
    🔒 Secured by HAPPA TRADEMART Payment Gateway
  </p>
</div>`;
}

function groupByVendor(cart) {
  const storeGroups = {};
  cart.forEach(item => {
    if (!storeGroups[item.store_id]) storeGroups[item.store_id] = [];
    storeGroups[item.store_id].push(item);
  });
  return storeGroups;
}

function selectPayment(method) {
  selectedPayment = method;
  renderCheckout();
}

async function applyCoupon() {
  const code = document.getElementById('checkout-coupon')?.value.trim().toUpperCase();
  const msg = document.getElementById('coupon-msg');
  if (!code) {
    App.appliedCoupon = null;
    if (msg) msg.innerHTML = '';
    updateCheckoutTotalsUI();
    return;
  }
  
  if (msg) msg.innerHTML = '<span><i class="fas fa-spinner fa-spin"></i> Validating…</span>';
  try {
    // Intercept Personal Referral Coupons
    if (code.startsWith('REF-')) {
      const parts = code.split('-');
      if (parts.length > 1 && String(parts[1]) === String(App.currentUser?.id)) {
        const balance = await calculateUserReferralBalance(App.currentUser.id);
        if (balance > 0) {
          if (msg) msg.innerHTML = '<span style="color:var(--success)"><i class="fas fa-check"></i> Referral Balance applied!</span>';
          App.appliedCoupon = { code: code, type: 'GHS', value: balance, is_referral: true };
        } else {
          if (msg) msg.innerHTML = '<span style="color:var(--danger)">No referral balance available</span>';
          App.appliedCoupon = null;
        }
      } else {
        if (msg) msg.innerHTML = '<span style="color:var(--danger)">This referral coupon cannot be used by you</span>';
        App.appliedCoupon = null;
      }
      updateCheckoutTotalsUI();
      return;
    }

    const res = await apiGet('settings', 'key=coupons');
    const couponRow = res?.data?.find(r => r.key === 'coupons');
    let coupons = [];
    if (couponRow && couponRow.value) coupons = JSON.parse(couponRow.value);
    
    const validCoupon = coupons.find(c => String(c.code).trim().toUpperCase() === code);
    if (!validCoupon) {
      if (msg) msg.innerHTML = '<span style="color:var(--danger)">Invalid or expired coupon code</span>';
      App.appliedCoupon = null;
    } else {
      const currentUserId = App.currentUser ? App.currentUser.id : null;
      const usedBy = validCoupon.used_by || [];
      const maxUses = parseInt(validCoupon.max_uses) || 0;

      if (currentUserId && usedBy.includes(currentUserId)) {
        if (msg) msg.innerHTML = '<span style="color:var(--danger)">You have already used this coupon</span>';
        App.appliedCoupon = null;
      } else if (maxUses > 0 && usedBy.length >= maxUses) {
        if (msg) msg.innerHTML = '<span style="color:var(--danger)">This coupon has reached its usage limit</span>';
        App.appliedCoupon = null;
      } else {
        if (msg) msg.innerHTML = '<span style="color:var(--success)"><i class="fas fa-check"></i> Coupon applied!</span>';
        App.appliedCoupon = validCoupon;
      }
    }
  } catch(e) {
    if (msg) msg.innerHTML = '<span style="color:var(--danger)">Error validating coupon</span>';
    App.appliedCoupon = null;
  }
  
  updateCheckoutTotalsUI();
}

function updateCheckoutTotalsUI() {
  const totals = getCartTotals();
  const discRow = document.getElementById('discount-row');
  const discAmt = document.getElementById('discount-amt');
  const totAmt = document.getElementById('checkout-total');
  const btnBtn = document.getElementById('place-order-btn');
  
  if (discRow) discRow.style.display = totals.discount > 0 ? 'flex' : 'none';
  if (discAmt) discAmt.innerHTML = `- GHS ${totals.discount.toFixed(2)}`;
  if (totAmt) totAmt.innerHTML = `GHS ${totals.total.toFixed(2)}`;
  if (btnBtn) btnBtn.innerHTML = `<i class="fas fa-lock"></i> Place Order · GHS ${totals.total.toFixed(2)}`;
  
  if (typeof renderCart === 'function') renderCart();
}

function updateDeliveryFee() {
  updateCheckoutTotalsUI();
}

let _placingOrder = false;
async function placeOrder() {
  if (_placingOrder) return;
  _placingOrder = true;

  const btn = document.getElementById('place-order-btn');
  if (btn) btn.disabled = true;
  const setBtn = window.OptimisticUI?.button(btn, '<i class="fas fa-lock"></i> Place Order');
  if (setBtn) setBtn('saving');

  const dest     = document.getElementById('checkout-dest')?.value || 'Accra';
  const address  = document.getElementById('checkout-address')?.value || '';
  const totals   = getCartTotals(dest);
  const sat      = getNextSaturday();

  let buyerId = App.currentUser ? App.currentUser.id : 'guest_' + Date.now();
  let buyerName = App.currentUser ? App.currentUser.name : document.getElementById('guest-name')?.value || 'Guest Customer';
  let buyerPhone = App.currentUser ? App.currentUser.phone : document.getElementById('guest-phone')?.value || '0000000000';
  let buyerEmail = App.currentUser ? App.currentUser.email : document.getElementById('guest-email')?.value || 'guest@happamart.com';

  if (!buyerName || !buyerPhone || !buyerEmail) {
    showToast('Please fill in all guest details', 'warning');
    _placingOrder = false;
    if (btn) btn.disabled = false;
    if (setBtn) setBtn('idle');
    return;
  }

  // Pre-flight stock availability check: ensure products loaded
  if (!App.allProducts || App.allProducts.length === 0) {
    try {
      const prodsRes = await apiGet('products', 'limit=300');
      App.allProducts = prodsRes?.data || prodsRes || [];
    } catch(e){}
  }

  for (const item of App.cart) {
    let prod = App.allProducts?.find(p => String(p.id) === String(item.id));
    if (!prod) {
      try { prod = await apiFetch('products/' + item.id); } catch(e){}
    }
    if (prod) {
      const stockQty = parseInt(prod.stock_qty) || 0;
      if (stockQty <= 0 || prod.status === 'sold_out') {
        showToast(`"${item.name}" is currently out of stock. Please remove it from cart.`, 'error', 4000);
        _placingOrder = false;
        if (btn) btn.disabled = false;
        if (setBtn) setBtn('idle');
        return;
      }
      if (item.qty > stockQty) {
        showToast(`Only ${stockQty} unit(s) available for "${item.name}".`, 'warning', 4000);
        _placingOrder = false;
        if (btn) btn.disabled = false;
        if (setBtn) setBtn('idle');
        return;
      }
    }
  }

  const orderData = {
    buyer_id: buyerId,
    buyer_name: buyerName,
    buyer_phone: buyerPhone,
    buyer_email: buyerEmail,
    items: App.cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, store_id: i.store_id, buyer_note: i.buyer_note || '' })),
    subtotal: totals.subtotal, platform_fee: totals.platformFee,
    delivery_fee: totals.deliveryFee, total: totals.total,
    payment_method: selectedPayment, payment_ref: 'REF' + Date.now(),
    status: 'paid', delivery_address: address, ship_date: sat.toISOString(),
    referral_code: App.currentUser ? (App.currentUser.referred_by || '') : '', 
    discount: totals.discount || 0,
    coupon_code: App.appliedCoupon ? App.appliedCoupon.code : '',
    buyer_location: dest
  };

  const savedCart = JSON.parse(JSON.stringify(App.cart));
  const savedReferral = App.appliedReferral;
  const usedReferralDiscount = App.appliedCoupon?.is_referral ? totals.discount : 0;
  const savedCoupon = App.appliedCoupon;

  // Perform API post to create order first
  const order = await apiPost('orders', orderData);
  if (!order) {
    if (setBtn) setBtn('failed');
    setTimeout(() => { if (setBtn) setBtn('idle'); }, 2000);
    showToast('Order failed. Please try again.', 'error', 5000);
    _placingOrder = false;
    if (btn) btn.disabled = false;
    return;
  }

  // Clear cart after order is confirmed created
  App.cart = [];
  App.appliedReferral = null;
  App.appliedCoupon = null;
  saveCart();
  if (typeof updateCartBadge === 'function') updateCartBadge();

  if (usedReferralDiscount > 0 && App.currentUser) {
    const newUsed = (parseFloat(App.currentUser.referral_commission_used) || 0) + usedReferralDiscount;
    App.currentUser.referral_commission_used = newUsed;
    apiPatch('users', App.currentUser.id, { referral_commission_used: newUsed });
  }

  // Update coupon usage if a standard coupon was applied
  if (savedCoupon && !savedCoupon.is_referral && App.currentUser) {
    try {
      const res = await apiGet('settings', 'key=coupons');
      const couponRow = res?.data?.find(r => r.key === 'coupons');
      if (couponRow && couponRow.value) {
        let coupons = JSON.parse(couponRow.value);
        let updated = false;
        coupons = coupons.map(c => {
          if (String(c.code).trim().toUpperCase() === String(savedCoupon.code).trim().toUpperCase()) {
            c.used_by = c.used_by || [];
            if (!c.used_by.includes(App.currentUser.id)) {
              c.used_by.push(App.currentUser.id);
              updated = true;
            }
          }
          return c;
        });
        if (updated) {
          await apiPatch('settings', couponRow.id, { value: JSON.stringify(coupons), updated_at: new Date().toISOString() });
        }
      }
    } catch(e) {
      console.error('Failed to update coupon usage:', e);
    }
  }

  // Create packages with complete buyer and delivery metadata
  const storeGroups = groupByVendor(savedCart);
  const packages = [];
  for (const [storeId, items] of Object.entries(storeGroups)) {
    const itemLoc = items[0].location || 'Accra';
    const pCode = generatePackageCode(itemLoc);
    const grossAmt  = items.reduce((s,i) => s + i.price * i.qty, 0);
    const commission = items.reduce((s,i) => s + i.price * i.qty * (i.commission_pct||8)/100, 0);
    const vendorAmt  = grossAmt - commission;
    const d = calcDelivery(itemLoc, dest, items.reduce((s,i) => s + i.weight_kg * i.qty, 0));
    
    const pkg = await apiPost('packages', {
      id: pCode, package_code: pCode, code: pCode, order_id: order.id,
      vendor_id: items[0].vendor_id, store_id: storeId, buyer_id: buyerId,
      buyer_name: buyerName, buyer_phone: buyerPhone, buyer_email: buyerEmail,
      delivery_address: address, delivery_name: buyerName, delivery_phone: buyerPhone,
      delivery_location: dest, notes: address,
      items: items.map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price, buyer_note: i.buyer_note || '' })),
      vendor_amount: vendorAmt, commission_amount: commission, gross_amount: grossAmt, delivery_fee: d.rate,
      status: 'pending',
      vendor_status: 'pending',
      admin_status: 'pending',
      buyer_confirmed: false,
      has_review: false,
      rejected_reason: '',
      tracking_link: '', tracking_number: '',
      delivery_partner: 'Express delivery', pickup_date: sat.toISOString(),
      delivered_date: '', balance_released: false,
      origin_location: itemLoc, dest_location: dest,
      is_intercity: itemLoc !== dest
    });
    if (pkg) packages.push(pkg);

    // Notify vendor
    addNotification(items[0].vendor_id, 'order', '🛒 New Order!', `Package ${pCode}: ${items.length} item(s) ordered`, '');

    // Increment store total_sales and total_orders stats immediately upon purchase completion
    if (storeId) {
      try {
        let storeObj = await apiFetch('stores/' + storeId);
        if (storeObj && storeObj.data) storeObj = Array.isArray(storeObj.data) ? storeObj.data[0] : storeObj.data;
        if (storeObj) {
          const oldSales = parseFloat(storeObj.total_sales) || 0;
          const oldOrders = parseInt(storeObj.total_orders) || 0;
          const updatedSales = oldSales + grossAmt;
          const updatedOrders = oldOrders + 1;
          await apiPatch('stores', storeId, {
            total_sales: updatedSales,
            total_orders: updatedOrders
          }).catch(() => {});
          
          const localStore = (App.allStores || []).find(s => String(s.id) === String(storeId));
          if (localStore) {
            localStore.total_sales = updatedSales;
            localStore.total_orders = updatedOrders;
          }
        }
      } catch(e){}
    }

    // Deduct stock & update product status
    for (const item of items) {
      let prod = App.allProducts?.find(p => String(p.id) === String(item.id));
      if (!prod) {
        try { prod = await apiFetch('products/' + item.id); } catch(e){}
      }
      const currentStock = prod ? (parseInt(prod.stock_qty) || 0) : (parseInt(item.stock_qty) || 10);
      const currentSold  = prod ? (parseInt(prod.total_sold || prod.sold_count) || 0) : 0;
      const newQty = Math.max(0, currentStock - item.qty);
      const isSoldOut = newQty === 0;
      const newStatus = isSoldOut ? 'sold_out' : (prod?.status === 'sold_out' ? 'active' : (prod?.status || 'active'));
      const newSold = currentSold + item.qty;

      await apiPatch('products', item.id, {
        stock_qty: newQty,
        total_sold: newSold,
        sold_count: newSold,
        status: newStatus,
        is_available: !isSoldOut
      });
      if (prod) {
        prod.stock_qty = newQty;
        prod.total_sold = newSold;
        prod.sold_count = newSold;
        prod.status = newStatus;
        prod.is_available = !isSoldOut;
      }
    }
  }

  showPage('order-confirmed');
  renderOrderConfirmation(order, packages);
  showToast('Order placed successfully! 🎉', 'success', 2000);
  if (setBtn) setBtn('saved');
  _placingOrder = false;

  // Trigger simulated order confirmation notification (Email, SMS, WhatsApp)
  simulateOrderNotifications(orderData);
}

function simulateOrderNotifications(order) {
  console.log(`[Notification] Sending Email to ${order.buyer_email}...`);
  console.log(`[Notification] Sending SMS to ${order.buyer_phone}...`);
  console.log(`[Notification] Sending WhatsApp notification to ${order.buyer_phone}...`);
  showToast('Order Confirmation sent via Email, SMS & WhatsApp! 📲', 'info', 3000);
}
function renderOrderConfirmation(order, packages) {
  const c = document.getElementById('order-confirmed-content');
  if (!c) return;

  c.innerHTML = `
    <div style="padding:24px;text-align:center">
      <div style="font-size:4rem;color:#10b981;margin-bottom:12px"><i class="fas fa-check-circle"></i></div>
      <h2 style="font-size:1.5rem;font-weight:900">Order Confirmed!</h2>
      <p style="color:var(--text-muted);font-size:.85rem;margin-top:6px">Your order has been successfully placed. Order ID: <strong>${order.id}</strong></p>
      
      <div class="card" style="margin-top:20px;text-align:left">
        <div class="card-header"><h3>📦 Delivery Details</h3></div>
        <div class="card-body" style="font-size:.85rem;display:grid;gap:6px">
          <div><strong>Recipient:</strong> ${escHtml(order.buyer_name)}</div>
          <div><strong>Phone:</strong> ${escHtml(order.buyer_phone)}</div>
          <div><strong>Email:</strong> ${escHtml(order.buyer_email)}</div>
          <div><strong>Address:</strong> ${escHtml(order.delivery_address || 'Home delivery')}</div>
          <div><strong>Payment Method:</strong> ${escHtml(order.payment_method)}</div>
          <div><strong>Grand Total:</strong> GHS ${order.total.toFixed(2)}</div>
        </div>
      </div>

      <div style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-top:16px;font-size:.78rem">
        <i class="fas fa-info-circle"></i> An order confirmation receipt and tracking link have been sent to you via <strong>Email, SMS &amp; WhatsApp</strong>.
      </div>

      <button class="btn btn-primary btn-block" onclick="showPage('home')" style="margin-top:24px">
        Continue Shopping
      </button>
    </div>
  `;
}
