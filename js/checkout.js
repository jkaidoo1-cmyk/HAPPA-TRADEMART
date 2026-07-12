/* ============================================================
   HAPPA TRADEMART — Checkout & Order Splitting Module
   ============================================================ */

let selectedPayment = 'mobile_money';

function renderCheckout() {
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

  <!-- Referral Discount -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><h3>🎁 Referral Code</h3></div>
    <div class="card-body">
      <div style="display:flex;gap:8px">
        <input class="form-control" id="checkout-refcode" placeholder="Enter referral code (optional)">
        <button class="btn btn-outline btn-sm" onclick="applyReferral()">Apply</button>
      </div>
      <div id="referral-msg" style="margin-top:6px;font-size:.8rem"></div>
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
      <div class="payment-option ${selectedPayment==='wallet'?'selected':''}" onclick="selectPayment('wallet')">
        <span class="payment-icon">👛</span>
        <div><div class="payment-name">HAPPA Wallet</div><div class="payment-desc">Balance: GHS ${(App.currentUser?.wallet_balance||0).toFixed(2)}</div></div>
        <i class="fas fa-${selectedPayment==='wallet'?'check-circle':'circle'}" style="margin-left:auto;color:${selectedPayment==='wallet'?'var(--primary)':'var(--border)'}"></i>
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
    <div class="summary-row"><span>Delivery Fee</span><span id="checkout-delivery">GHS ${totals.deliveryFee.toFixed(2)}</span></div>
    <div class="summary-row" id="discount-row" style="display:none"><span style="color:var(--success)">Discount</span><span id="discount-amt" style="color:var(--success)">- GHS 0.00</span></div>
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

function applyReferral() {
  const code = document.getElementById('checkout-refcode')?.value.trim().toUpperCase();
  if (!code) return;
  const msg = document.getElementById('referral-msg');
  if (code === App.currentUser?.referral_code) {
    if (msg) msg.innerHTML = '<span style="color:var(--danger)">You cannot use your own code</span>';
    return;
  }
  // Simulate referral validation
  if (msg) msg.innerHTML = '<span style="color:var(--success)"><i class="fas fa-check"></i> Referral code applied!</span>';
  App.appliedReferral = code;
}

function updateDeliveryFee() {
  renderCheckout();
}

async function placeOrder() {
  const btn = document.getElementById('place-order-btn');
  const setBtn = window.OptimisticUI?.button(btn, '<i class="fas fa-lock"></i> Place Order');
  if (setBtn) setBtn('saving');

  const dest     = document.getElementById('checkout-dest')?.value || 'Accra';
  const address  = document.getElementById('checkout-address')?.value || '';
  const totals   = getCartTotals();
  const sat      = getNextSaturday();

  let buyerId = App.currentUser ? App.currentUser.id : 'guest_' + Date.now();
  let buyerName = App.currentUser ? App.currentUser.name : document.getElementById('guest-name')?.value || 'Guest Customer';
  let buyerPhone = App.currentUser ? App.currentUser.phone : document.getElementById('guest-phone')?.value || '0000000000';
  let buyerEmail = App.currentUser ? App.currentUser.email : document.getElementById('guest-email')?.value || 'guest@happamart.com';

  if (!buyerName || !buyerPhone || !buyerEmail) {
    showToast('Please fill in all guest details', 'warning');
    if (setBtn) setBtn('idle');
    return;
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
    referral_code: App.appliedReferral || '', discount: 0,
    buyer_location: dest
  };

  const optimisticOrder = {
    id: 'tmp_' + Date.now(),
    ...orderData,
    created_at: new Date().toISOString(),
    _isOptimistic: true
  };
  const savedCart = JSON.parse(JSON.stringify(App.cart));
  const savedReferral = App.appliedReferral;

  App.cart = [];
  App.appliedReferral = null;
  saveCart();
  if (typeof updateCartBadge === 'function') updateCartBadge();

  showPage('order-confirmed');
  renderOrderConfirmation(optimisticOrder, []);
  showToast('Order placed successfully! 🎉', 'success', 2000);
  if (setBtn) setBtn('saved');

  // Background api post
  const order = await apiPost('orders', orderData);
  if (!order) {
    App.cart = savedCart;
    App.appliedReferral = savedReferral;
    saveCart();
    if (typeof updateCartBadge === 'function') updateCartBadge();
    if (setBtn) setBtn('failed');
    setTimeout(() => { if (setBtn) setBtn('idle'); }, 2000);
    showToast('Order failed - cart restored.', 'error', 5000);
    showPage('checkout');
    return;
  }

  // Create packages
  const storeGroups = groupByVendor(savedCart);
  const packages = [];
  for (const [storeId, items] of Object.entries(storeGroups)) {
    const pCode = generatePackageCode(items[0].location);
    const grossAmt  = items.reduce((s,i) => s + i.price * i.qty, 0);
    const commission = items.reduce((s,i) => s + i.price * i.qty * (i.commission_pct||8)/100, 0);
    const vendorAmt  = grossAmt - commission;
    const d = calcDelivery(items[0].location, dest, items.reduce((s,i) => s + i.weight_kg * i.qty, 0));
    
    const pkg = await apiPost('packages', {
      package_code: pCode, order_id: order.id,
      vendor_id: items[0].vendor_id, store_id: storeId, buyer_id: buyerId,
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
      origin_location: items[0].location, dest_location: dest,
      is_intercity: items[0].location !== dest
    });
    if (pkg) packages.push(pkg);

    // Notify vendor
    addNotification(items[0].vendor_id, 'order', '🛒 New Order!', `Package ${pCode}: ${items.length} item(s) ordered`, '');

    // Deduct stock
    for (const item of items) {
      const prod = App.allProducts.find(p => p.id === item.id);
      if (prod) {
        const newQty = Math.max(0, (prod.stock_qty||0) - item.qty);
        await apiPatch('products', item.id, { stock_qty: newQty, total_sold: (prod.total_sold || prod.sold_count || 0) + item.qty });
        prod.stock_qty = newQty;
      }
    }
  }

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
