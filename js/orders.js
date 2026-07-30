/* ============================================================
   HAPPA TRADEMART — Order Tracking & Status Management
   Handles all order status flows:
     Vendor:  pending → received → processed | rejected
     Admin:   (any vendor status) → on_delivery → delivered
              (delivered auto-releases vendor earnings)
     Buyer:   read-only view of status + rate store after delivery
   ============================================================ */

// ── Status label maps ─────────────────────────────────────
const VENDOR_STATUS_LABELS = {
  pending:   { text: 'Awaiting Vendor',  css: 'pending'   },
  received:  { text: 'Vendor Received',  css: 'received'  },
  processed: { text: 'Ready for Pickup', css: 'processed' },
  rejected:  { text: 'Rejected',         css: 'rejected'  }
};

const ADMIN_STATUS_LABELS = {
  pending:     { text: 'Not Dispatched', css: 'pending'     },
  on_delivery: { text: 'On Delivery',    css: 'on_delivery' },
  delivered:   { text: 'Delivered',      css: 'delivered'   }
};

function sanitizePackage(pkg) {
  if (!pkg) return pkg;
  pkg.package_code = pkg.package_code || pkg.code || pkg.id || ('ACC-' + Math.floor(10000 + Math.random() * 90000));
  pkg.code = pkg.code || pkg.package_code;
  pkg.id = pkg.id || pkg.package_code;
  pkg.vendor_status = pkg.vendor_status || 'pending';
  pkg.admin_status = pkg.admin_status || 'pending';
  pkg.status = pkg.status || 'pending';

  if (typeof pkg.items === 'string') {
    try { pkg.items = JSON.parse(pkg.items); } catch(e) { pkg.items = []; }
  }
  if (!Array.isArray(pkg.items)) pkg.items = [];

  let subtotal = 0;
  if (pkg.items.length > 0) {
    subtotal = pkg.items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
  }
  if (!subtotal) {
    subtotal = parseFloat(pkg.gross_amount) || parseFloat(pkg.total) || parseFloat(pkg.vendor_amount) || 0;
  }

  pkg.gross_amount = subtotal;
  if (!pkg.commission_amount) pkg.commission_amount = parseFloat((subtotal * 0.05).toFixed(2));
  if (!pkg.vendor_amount) pkg.vendor_amount = parseFloat((subtotal - (pkg.commission_amount || 0)).toFixed(2));

  return pkg;
}

// Buyer-facing combined status (what buyer sees — no confirm action)
function getBuyerDisplayStatus(pkg) {
  const vs = pkg.vendor_status || 'pending';
  const as = pkg.admin_status  || 'pending';

  if (vs === 'rejected')    return { text: 'Order Rejected',  css: 'rejected',    icon: 'fa-times-circle' };
  if (as === 'delivered')   return { text: 'Delivered ✓',     css: 'received',    icon: 'fa-check-double' };
  if (as === 'on_delivery') return { text: 'On Delivery',     css: 'on_delivery', icon: 'fa-truck'        };
  if (vs === 'processed')   return { text: 'Packed & Ready',  css: 'processed',   icon: 'fa-box'          };
  if (vs === 'received')    return { text: 'Vendor Received', css: 'received',    icon: 'fa-store'        };
  return                           { text: 'Processing',      css: 'pending',     icon: 'fa-clock'        };
}

// ── Buyer: package card (used in dashboard) ───────────────
function buyerPackageCard(rawPkg) {
  const pkg = sanitizePackage(rawPkg);
  const ds = getBuyerDisplayStatus(pkg);
  const vs = pkg.vendor_status || 'pending';
  const as = pkg.admin_status  || 'pending';

  return `
<div class="package-card" onclick="showPackageDetailModal('${pkg.id}')">
  <div class="package-header">
    <span class="package-code"><i class="fas fa-cube" style="margin-right:4px"></i>${pkg.package_code || '—'}</span>
    <span class="status-badge status-${ds.css}"><i class="fas ${ds.icon}" style="margin-right:3px"></i>${ds.text}</span>
  </div>
  <div class="package-body">
    <div class="order-tracking-bar">
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

    <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">
      <i class="fas fa-map-marker-alt" style="margin-right:3px"></i>${pkg.origin_location||'?'} → ${pkg.dest_location||'?'}
      &nbsp;·&nbsp;<i class="fas fa-calendar" style="margin-right:3px"></i>${pkg.pickup_date ? formatDate(pkg.pickup_date) : 'Next Saturday'}
    </div>

    <div style="font-size:.84rem;margin-bottom:8px;font-weight:500">
      ${(pkg.items||[]).slice(0,2).map(i=>`<div style="display:flex;justify-content:space-between"><span>${escHtml(i.name||'')} × ${i.qty}</span><span>GHS ${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
      ${(pkg.items||[]).length > 2 ? `<div style="color:var(--text-muted);font-size:.78rem">+${(pkg.items||[]).length-2} more items</div>` : ''}
    </div>

    ${vs === 'rejected' ? `
    <div class="order-alert order-alert-danger">
      <i class="fas fa-exclamation-circle"></i>
      <div><strong>Rejected:</strong> ${escHtml(pkg.rejected_reason || 'Product unavailable')}. Refund sent to your wallet.</div>
    </div>` : ''}

    ${as === 'delivered' && !pkg.has_review ? `
    <button class="btn btn-outline btn-sm btn-block" style="margin-top:8px"
            onclick="event.stopPropagation();showOrderReviewModal('${pkg.store_id}','${pkg.id}')">
      <i class="fas fa-star"></i> Rate Store
    </button>` : ''}

    ${as === 'delivered' && pkg.has_review ? `
    <div style="text-align:center;font-size:.78rem;color:var(--success);margin-top:8px">
      <i class="fas fa-check"></i> You reviewed this order
    </div>` : ''}
  </div>
</div>`;
}

// ── Buyer: full package detail modal ─────────────────────
async function showPackageDetailModal(packageId) {
  const pkg = await apiFetch('packages/' + packageId);
  if (!pkg) { showToast('Could not load order details', 'error'); return; }

  const ds = getBuyerDisplayStatus(pkg);
  const vs = pkg.vendor_status || 'pending';
  const as = pkg.admin_status  || 'pending';
  const itemSubtotal = parseFloat(pkg.gross_amount || pkg.total) || (Array.isArray(pkg.items) ? pkg.items.reduce((s,i)=>s+(parseFloat(i.price)||0)*(parseInt(i.qty)||1),0) : 0);
  const total = itemSubtotal + (parseFloat(pkg.delivery_fee)||0);

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">📦 ${pkg.package_code || 'Order Detail'}</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body" style="overflow-y:auto;max-height:80vh">

  <!-- Status Badge -->
  <div style="text-align:center;margin-bottom:16px">
    <span class="status-badge status-${ds.css}" style="font-size:.85rem;padding:6px 18px">
      <i class="fas ${ds.icon}" style="margin-right:5px"></i>${ds.text}
    </span>
  </div>

  <!-- Tracking Steps -->
  <div class="order-tracking-bar order-tracking-bar-lg" style="margin-bottom:18px">
    <div class="tracking-step ${vs !== 'pending' && vs !== 'rejected' ? 'done' : vs === 'rejected' ? 'fail' : 'active'}">
      <div class="tracking-dot"></div>
      <div class="tracking-label">Vendor<br><span style="font-weight:400">${VENDOR_STATUS_LABELS[vs]?.text || vs}</span></div>
    </div>
    <div class="tracking-line ${vs === 'processed' || as !== 'pending' ? 'done' : ''}"></div>
    <div class="tracking-step ${as === 'on_delivery' || as === 'delivered' ? 'done' : vs === 'processed' ? 'active' : ''}">
      <div class="tracking-dot"></div>
      <div class="tracking-label">In Transit<br><span style="font-weight:400">${as === 'on_delivery' ? 'On the way' : as === 'delivered' ? 'Arrived' : vs === 'processed' ? 'Ready for pickup' : 'Waiting'}</span></div>
    </div>
    <div class="tracking-line ${as === 'delivered' ? 'done' : ''}"></div>
    <div class="tracking-step ${as === 'delivered' ? 'done' : ''}">
      <div class="tracking-dot"></div>
      <div class="tracking-label">Delivered<br><span style="font-weight:400">${as === 'delivered' ? 'Completed ✓' : 'Pending'}</span></div>
    </div>
  </div>

  <!-- Rejection Alert -->
  ${vs === 'rejected' ? `
  <div class="order-alert order-alert-danger" style="margin-bottom:14px">
    <i class="fas fa-times-circle" style="flex-shrink:0"></i>
    <div>
      <strong>Order Rejected</strong><br>
      <span style="font-size:.82rem">${escHtml(pkg.rejected_reason || 'The vendor was unable to fulfil this order.')}</span><br>
      <span style="font-size:.8rem;color:var(--success)">💰 Refund of GHS ${total.toFixed(2)} sent to your wallet</span>
    </div>
  </div>` : ''}

  <!-- Items -->
  <div class="card" style="margin-bottom:12px">
    <div class="card-body" style="padding:12px">
      <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">Items in this Package</div>
      ${(pkg.items||[]).map(i=>`
      <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:.84rem">
        <div style="display:flex;justify-content:space-between">
          <span>${escHtml(i.name||'')} <span style="color:var(--text-muted)">× ${i.qty}</span></span>
          <span style="font-weight:600">GHS ${(i.price*i.qty).toFixed(2)}</span>
        </div>
        ${i.buyer_note ? `<div style="font-size:.72rem;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:3px 7px;margin-top:3px;display:flex;align-items:flex-start;gap:4px"><i class="fas fa-comment-dots" style="flex-shrink:0;margin-top:1px"></i><span><strong>Note:</strong> ${escHtml(i.buyer_note)}</span></div>` : ''}
      </div>`).join('')}
      <div style="display:flex;justify-content:space-between;font-size:.82rem;color:var(--text-muted);padding:4px 0">
        <span>Delivery Fee</span><span>GHS ${(pkg.delivery_fee||0).toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.9rem;font-weight:700;padding:6px 0;color:var(--primary)">
        <span>Total Paid</span><span>GHS ${total.toFixed(2)}</span>
      </div>
    </div>
  </div>

  <!-- Delivery Info -->
  <div class="card" style="margin-bottom:12px">
    <div class="card-body" style="padding:12px;font-size:.83rem">
      <div style="font-weight:700;margin-bottom:8px">Delivery Info</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div><span style="color:var(--text-muted)">From</span><br><strong>${escHtml(pkg.origin_location||'—')}</strong></div>
        <div><span style="color:var(--text-muted)">To</span><br><strong>${escHtml(pkg.dest_location||'—')}</strong></div>
        <div><span style="color:var(--text-muted)">Pickup</span><br><strong>${pkg.pickup_date ? formatDate(pkg.pickup_date) : 'Next Saturday'}</strong></div>
        <div><span style="color:var(--text-muted)">Partner</span><br><strong>${escHtml(pkg.delivery_partner||'HAPPA Logistics')}</strong></div>
      </div>
      ${pkg.tracking_link ? `<a href="${pkg.tracking_link}" target="_blank" class="btn btn-outline btn-sm btn-block" style="margin-top:10px"><i class="fas fa-external-link-alt"></i> Track Externally</a>` : ''}
    </div>
  </div>

  <!-- Rate store (only after admin delivers) -->
  ${as === 'delivered' && !pkg.has_review ? `
  <button class="btn btn-primary btn-block" style="margin-top:8px"
          onclick="closeModalForce();showOrderReviewModal('${pkg.store_id}','${pkg.id}')">
    <i class="fas fa-star"></i> Rate This Store
  </button>` : ''}

  ${as === 'delivered' && pkg.has_review ? `
  <div style="text-align:center;font-size:.82rem;color:var(--success);margin-top:8px;padding:10px">
    <i class="fas fa-star" style="color:#fbbf24"></i> You have reviewed this order. Thank you!
  </div>` : ''}

</div>`);
}

// ── Buyer: review modal ───────────────────────────────────
function showOrderReviewModal(storeId, packageId) {
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">⭐ Rate & Review Store</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.85rem;color:var(--text-light);margin-bottom:16px">
    Your review helps other shoppers. Reviews are available after delivery.
  </p>
  <div class="form-group">
    <label class="form-label">Your Rating</label>
    <div id="star-row" style="display:flex;gap:10px;font-size:2rem;margin-bottom:4px;cursor:pointer">
      <i class="far fa-star rating-star" onclick="selectRating(1)"></i>
      <i class="far fa-star rating-star" onclick="selectRating(2)"></i>
      <i class="far fa-star rating-star" onclick="selectRating(3)"></i>
      <i class="far fa-star rating-star" onclick="selectRating(4)"></i>
      <i class="far fa-star rating-star" onclick="selectRating(5)"></i>
    </div>
    <div id="rating-label" style="font-size:.8rem;color:var(--text-muted)">Select a rating</div>
    <input type="hidden" id="review-rating" value="0">
  </div>
  <div class="form-group">
    <label class="form-label">Your Review <span style="color:var(--text-muted)">(optional)</span></label>
    <textarea class="form-control" id="review-comment" rows="3"
      placeholder="e.g. Great products and fast dispatch!"></textarea>
  </div>
  <button class="btn btn-primary btn-block" onclick="submitOrderReview('${storeId}','${packageId}')">
    <i class="fas fa-paper-plane"></i> Submit Review
  </button>
</div>`);
  selectRating(5);
}

const RATING_WORDS = ['','Terrible','Poor','Okay','Good','Excellent'];

function selectRating(rating) {
  const input = document.getElementById('review-rating');
  const label = document.getElementById('rating-label');
  if (input) input.value = rating;
  if (label) label.textContent = RATING_WORDS[rating] || '';
  document.querySelectorAll('#star-row .rating-star').forEach((s, i) => {
    if (i < rating) {
      s.className = 'fas fa-star rating-star';
      s.style.color = '#fbbf24';
    } else {
      s.className = 'far fa-star rating-star';
      s.style.color = '#9ca3af';
    }
  });
}

async function submitOrderReview(storeId, packageId) {
  const rating  = parseInt(document.getElementById('review-rating')?.value || '0');
  const comment = (document.getElementById('review-comment')?.value || '').trim();
  const u = App.currentUser;

  if (!rating) { showToast('Please select a rating first', 'warning'); return; }
  if (!u)      { showToast('You must be logged in', 'error'); return; }

  await apiPost('reviews', {
    target_id:     storeId,
    target_type:   'store',
    reviewer_id:   u.id,
    reviewer_name: u.name,
    rating,
    comment,
    order_id:      packageId,
    approved:      true,
    flagged:       false
  });

  await apiPatch('packages', packageId, { has_review: true });

  // Update store avg_rating
  const storeRes = await apiFetch('stores/' + storeId);
  if (storeRes) {
    const oldCount = parseInt(storeRes.review_count) || 0;
    const oldAvg   = parseFloat(storeRes.avg_rating)  || 0;
    const newCount = oldCount + 1;
    const newAvg   = ((oldAvg * oldCount) + rating) / newCount;
    await apiPatch('stores', storeId, {
      review_count: newCount,
      avg_rating:   Math.round(newAvg * 10) / 10
    });
  }

  closeModalForce();
  showToast('⭐ Review submitted! Thank you.', 'success');
  refreshBuyerOrdersList();
}

// ── Buyer: refresh orders list in-place ──────────────────
async function refreshBuyerOrdersList() {
  const listEl = document.getElementById('buyer-orders-list');
  const uid    = App.currentUser?.id;
  if (!listEl || !uid) { renderBuyerDashboard(); return; }

  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>';
  const res  = await apiGet('packages', 'limit=200');
  const pkgs = (res?.data || []).filter(p => p.buyer_id === uid);
  listEl.innerHTML = pkgs.length
    ? pkgs.map(p => buyerPackageCard(p)).join('')
    : '<div class="empty-state" style="padding:30px"><i class="fas fa-inbox"></i><h3>No orders yet</h3><p>Your orders will appear here after checkout</p></div>';
}

// ── Buyer: filter orders ──────────────────────────────────
function filterBuyerOrders(filter, el) {
  const tabs = el?.closest?.('.tab-nav');
  if (tabs) tabs.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');

  const list = document.getElementById('buyer-orders-list');
  if (!list) return;

  Array.from(list.querySelectorAll('.package-card')).forEach(card => {
    const badge = card.querySelector('.status-badge');
    const text  = (badge?.textContent || '').toLowerCase();
    let show = true;
    if (filter === 'pending')     show = text.includes('processing') || text.includes('vendor') || text.includes('packed');
    if (filter === 'on_delivery') show = text.includes('delivery') || text.includes('transit');
    if (filter === 'delivered')   show = text.includes('delivered');
    if (filter === 'rejected')    show = text.includes('rejected');
    card.style.display = show ? '' : 'none';
  });
}

// ── Vendor: order status update ───────────────────────────
const _vendorStatusInFlight = new Set();
async function updateVendorStatus(packageId, newStatus) {
  if (_vendorStatusInFlight.has(packageId)) return;
  _vendorStatusInFlight.add(packageId);

  const btn = (typeof event !== 'undefined') ? event?.target?.closest('button') : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  let pkg = null;
  try {
    pkg = await apiFetch('packages/' + packageId);
    if (pkg && pkg.data && Array.isArray(pkg.data)) pkg = pkg.data[0];
  } catch(e){}

  if (!pkg && App.allPackages) {
    pkg = App.allPackages.find(p => String(p.id) === String(packageId) || String(p.package_code) === String(packageId) || String(p.code) === String(packageId));
  }
  if (!pkg) {
    pkg = { id: packageId, package_code: packageId };
  }

  pkg = sanitizePackage(pkg);
  const targetId = pkg.id || packageId;
  const pCode = pkg.package_code || targetId;

  const currentVs = pkg.vendor_status || 'pending';
  const validTransitions = { pending: ['received'], received: ['processed'] };
  if (!(validTransitions[currentVs] || []).includes(newStatus)) {
    showToast(`Cannot change status from "${currentVs}" to "${newStatus}"`, 'warning');
    _vendorStatusInFlight.delete(packageId);
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.originalHtml || 'Action'; }
    return;
  }

  await apiPatch('packages', targetId, { vendor_status: newStatus });
  
  // Update in-memory package object
  pkg.vendor_status = newStatus;
  if (App.allPackages) {
    const memPkg = App.allPackages.find(p => String(p.id) === String(targetId) || String(p.package_code) === String(targetId) || String(p.code) === String(targetId));
    if (memPkg) memPkg.vendor_status = newStatus;
  }

  const msgs = {
    received:  `Your order ${pCode} has been received by the vendor and is being prepared.`,
    processed: `Your order ${pCode} is packed and ready for pickup.`
  };
  if (msgs[newStatus] && pkg.buyer_id) {
    addNotification(pkg.buyer_id, 'order',
      newStatus === 'received' ? '✅ Order Received' : '📦 Order Packed', msgs[newStatus]);
  }

  showToast(`Order marked as ${newStatus} ✅`, 'success');
  _vendorStatusInFlight.delete(packageId);
  const vid = App.currentUser?.id;
  if (vid && document.getElementById('vendor-orders-list')) {
    await refreshVendorOrders(vid);
  } else {
    renderVendorDashboard();
  }
}

// ── Vendor: reject order modal ────────────────────────────
function showRejectOrderModal(packageId) {
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">⚠️ Reject Order</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="order-alert order-alert-warning" style="margin-bottom:14px">
    <i class="fas fa-exclamation-triangle"></i>
    <div>The buyer will be <strong>fully refunded</strong> and you cannot undo this action.</div>
  </div>
  <div class="form-group">
    <label class="form-label">Reason for Rejection <span style="color:var(--danger)">*</span></label>
    <textarea class="form-control" id="reject-reason" rows="3"
      placeholder="e.g. Item out of stock, Cannot fulfil this order" required></textarea>
  </div>
  <button class="btn btn-danger btn-block" onclick="confirmRejectOrder('${packageId}')">
    <i class="fas fa-times-circle"></i> Confirm Rejection & Refund Buyer
  </button>
  <button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="closeModalForce()">Cancel</button>
</div>`);
}

let _rejectingOrder = false;
async function confirmRejectOrder(packageId) {
  if (_rejectingOrder) return;
  _rejectingOrder = true;

  const rejectBtn = document.querySelector('.modal-body .btn-danger');
  if (rejectBtn) rejectBtn.disabled = true;

  const reason = (document.getElementById('reject-reason')?.value || '').trim();
  if (!reason) { showToast('Please state a reason for rejection', 'warning'); _rejectingOrder = false; if (rejectBtn) rejectBtn.disabled = false; return; }

  let pkg = null;
  try {
    pkg = await apiFetch('packages/' + packageId);
    if (pkg && pkg.data && Array.isArray(pkg.data)) pkg = pkg.data[0];
  } catch(e){}

  if (!pkg && App.allPackages) {
    pkg = App.allPackages.find(p => String(p.id) === String(packageId) || String(p.package_code) === String(packageId) || String(p.code) === String(packageId));
  }
  if (!pkg) {
    pkg = { id: packageId, package_code: packageId };
  }

  pkg = sanitizePackage(pkg);
  const targetId = pkg.id || packageId;
  const pCode = pkg.package_code || targetId;

  const vs = pkg.vendor_status || 'pending';
  if (vs === 'processed' || vs === 'rejected') {
    showToast('Cannot reject an order that is already processed or rejected.', 'warning');
    _rejectingOrder = false;
    closeModalForce(); return;
  }

  await apiPatch('packages', targetId, {
    vendor_status:   'rejected',
    rejected_reason: reason,
    status:          'cancelled'
  });

  pkg.vendor_status = 'rejected';
  pkg.rejected_reason = reason;
  pkg.status = 'cancelled';
  if (App.allPackages) {
    const memPkg = App.allPackages.find(p => String(p.id) === String(targetId) || String(p.package_code) === String(targetId) || String(p.code) === String(targetId));
    if (memPkg) {
      memPkg.vendor_status = 'rejected';
      memPkg.rejected_reason = reason;
      memPkg.status = 'cancelled';
    }
  }

  // Full refund to buyer: money paid for product + delivery (excluding platform fee which website retains in platform revenue)
  const productCost = parseFloat(pkg.gross_amount) || (Array.isArray(pkg.items) ? pkg.items.reduce((s,i)=>s+(parseFloat(i.price)||0)*(parseInt(i.qty)||1),0) : 0);
  const deliveryFee = parseFloat(pkg.delivery_fee) || 0;
  const refundAmt = productCost + deliveryFee;
  if (pkg.buyer_id) {
    let buyer = null;
    try {
      buyer = await apiFetch('users/' + pkg.buyer_id);
      if (buyer && buyer.data && Array.isArray(buyer.data)) buyer = buyer.data[0];
    } catch(e){}
    if (!buyer && App.allUsers) buyer = App.allUsers.find(u => String(u.id) === String(pkg.buyer_id));

    if (buyer) {
      const newBal = (parseFloat(buyer.wallet_balance)||0) + refundAmt;
      buyer.wallet_balance = newBal;
      await apiPatch('users', pkg.buyer_id, { wallet_balance: newBal });
      await apiPost('wallet_transactions', {
        user_id:        pkg.buyer_id,
        type:           'refund',
        amount:         refundAmt,
        payment_method: 'wallet',
        status:         'completed',
        note:           `Refund for rejected order ${pCode}: ${reason}`
      });
      addNotification(pkg.buyer_id, 'order', '💰 Order Refunded',
        `Your order ${pCode} was rejected by the vendor. GHS ${refundAmt.toFixed(2)} refunded to your wallet. Reason: ${reason}`);
    } else {
      // Guest customer refund tracking record
      await apiPost('wallet_transactions', {
        user_id:        pkg.buyer_id,
        type:           'refund',
        amount:         refundAmt,
        payment_method: 'guest_refund',
        status:         'completed',
        note:           `Guest Refund (${pkg.buyer_name || 'Guest'} - ${pkg.buyer_phone || 'N/A'}): Order ${pCode} rejected. Reason: ${reason}`
      });
    }
  }

  // Restore product stock & update status back to active
  if (Array.isArray(pkg.items)) {
    for (const item of pkg.items) {
      if (!item.id) continue;
      let prod = App.allProducts?.find(p => String(p.id) === String(item.id));
      if (!prod) {
        try { prod = await apiFetch('products/' + item.id); } catch(e){}
      }
      if (prod) {
        const currentStock = parseInt(prod.stock_qty) || 0;
        const currentSold  = parseInt(prod.total_sold || prod.sold_count) || 0;
        const restoredQty  = currentStock + (parseInt(item.qty) || 1);
        const restoredSold = Math.max(0, currentSold - (parseInt(item.qty) || 1));
        await apiPatch('products', item.id, {
          stock_qty: restoredQty,
          total_sold: restoredSold,
          sold_count: restoredSold,
          status: 'active',
          is_available: true
        });
        prod.stock_qty = restoredQty;
        prod.total_sold = restoredSold;
        prod.sold_count = restoredSold;
        prod.status = 'active';
        prod.is_available = true;
      }
    }
  }

  _rejectingOrder = false;
  closeModalForce();
  showToast(`Order rejected. Buyer refunded GHS ${refundAmt.toFixed(2)}.`, 'warning');
  const vid = App.currentUser?.id;
  if (vid && document.getElementById('vendor-orders-list')) {
    await refreshVendorOrders(vid);
  } else {
    renderVendorDashboard();
  }
}

// ── Admin: update package delivery status ─────────────────
// Admin can mark On Delivery any time (override), and Delivered after On Delivery.
// Marking Delivered auto-releases vendor earnings.
const _adminStatusInFlight = new Set();
async function updateAdminStatus(packageId, newStatus) {
  if (_adminStatusInFlight.has(packageId)) return;
  _adminStatusInFlight.add(packageId);

  const btn = (typeof event !== 'undefined') ? event?.target?.closest('button') : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  let rawPkg = null;
  try {
    rawPkg = await apiFetch('packages/' + packageId);
    if (rawPkg && rawPkg.data && Array.isArray(rawPkg.data)) rawPkg = rawPkg.data[0];
  } catch(e){}

  if (!rawPkg || !rawPkg.id) {
    const pkgsRes = await apiGet('packages', 'limit=200').catch(() => null);
    const allPkgs = pkgsRes?.data || App.allPackages || [];
    rawPkg = allPkgs.find(p => String(p.id) === String(packageId) || String(p.package_code) === String(packageId) || String(p.code) === String(packageId) || String(p.order_id) === String(packageId));
  }

  if (!rawPkg) {
    showToast('Package not found', 'error');
    _adminStatusInFlight.delete(packageId);
    if (btn) btn.disabled = false;
    return;
  }
  const pkg = sanitizePackage(rawPkg);
  const targetId = pkg.id;

  const as = pkg.admin_status || 'pending';
  if (newStatus === 'on_delivery' && as === 'delivered') {
    showToast('Package is already delivered.', 'info');
    _adminStatusInFlight.delete(packageId);
    if (btn) btn.disabled = false;
    return;
  }
  if (newStatus === 'delivered' && pkg.balance_released) {
    showToast('Package is already delivered and earnings released.', 'info');
    _adminStatusInFlight.delete(packageId);
    if (btn) btn.disabled = false;
    return;
  }
  if (as === newStatus) {
    showToast(`Package is already "${newStatus}".`, 'info');
    _adminStatusInFlight.delete(packageId);
    if (btn) btn.disabled = false;
    return;
  }

  const statusMap = { on_delivery: 'in_transit', delivered: 'delivered' };

  await apiPatch('packages', targetId, {
    admin_status: newStatus,
    status:       statusMap[newStatus] || pkg.status,
    ...(newStatus === 'delivered' ? { delivered_date: new Date().toISOString(), balance_released: true } : {})
  });

  if (pkg.order_id) {
    await apiPatch('orders', pkg.order_id, { status: statusMap[newStatus] || 'delivered' }).catch(() => {});
  }

  // Auto-release vendor earnings on delivery
  // vendor_amount already has commission deducted at checkout (it's what vendor earns, not order total)
  if (newStatus === 'delivered') {
    const vendor = await apiFetch('users/' + pkg.vendor_id);
    if (vendor) {
      // vendor_amount is the net amount after platform commission was deducted at order time
      const earnAmt      = parseFloat(pkg.vendor_amount)      || 0;
      const commAmt      = parseFloat(pkg.commission_amount)  || 0;
      const newBal       = (parseFloat(vendor.wallet_balance) || 0) + earnAmt;
      await apiPatch('users', pkg.vendor_id, { wallet_balance: newBal });
      await apiPost('wallet_transactions', {
        user_id:        pkg.vendor_id,
        type:           'earning',
        amount:         earnAmt,
        payment_method: 'system',
        status:         'completed',
        note:           `Earnings released: ${pkg.package_code} — GHS ${earnAmt.toFixed(2)} paid to vendor (commission GHS ${commAmt.toFixed(2)} retained by platform)`
      });
      addNotification(pkg.vendor_id, 'earning', '💰 Payment Released',
        `GHS ${earnAmt.toFixed(2)} from order ${pkg.package_code} has been released to your wallet.`);
    }

    // Update store total_sales and total_orders stats
    if (pkg.store_id) {
      try {
        let storeObj = await apiFetch('stores/' + pkg.store_id);
        if (storeObj && storeObj.data) storeObj = Array.isArray(storeObj.data) ? storeObj.data[0] : storeObj.data;
        if (storeObj) {
          const earnAmt = parseFloat(pkg.vendor_amount) || parseFloat(pkg.total) || 0;
          const oldSales = parseFloat(storeObj.total_sales) || 0;
          const oldOrders = parseInt(storeObj.total_orders) || 0;
          await apiPatch('stores', pkg.store_id, {
            total_sales: oldSales + earnAmt,
            total_orders: oldOrders + 1
          }).catch(() => {});
        }
      } catch(e){}
    }

    // Update product total_sold counts
    if (Array.isArray(pkg.items)) {
      for (const item of pkg.items) {
        const pId = item.id || item.product_id;
        if (pId) {
          try {
            let pObj = await apiFetch('products/' + pId);
            if (pObj && pObj.data) pObj = Array.isArray(pObj.data) ? pObj.data[0] : pObj.data;
            if (pObj) {
              const oldSold = parseInt(pObj.total_sold || pObj.sold_count) || 0;
              await apiPatch('products', pId, {
                total_sold: oldSold + (parseInt(item.qty) || 1)
              }).catch(() => {});
            }
          } catch(e){}
        }
      }
    }

    // Process referral reward if any
    try {
      const refRes = await apiGet('referrals', `referred_id=${pkg.buyer_id}&status=active&limit=10`);
      const refs = refRes?.data || [];
      if (refs.length > 0) {
        for (const refItem of refs) {
          const referrer = await apiFetch('users/' + refItem.referrer_id);
          if (referrer) {
            const vendorAmt = parseFloat(pkg.vendor_amount) || 0;
            const pct = typeof getEffectiveReferralCommissionPct === 'function'
              ? getEffectiveReferralCommissionPct(vendorAmt)
              : 3;
            const reward = parseFloat((vendorAmt * (pct / 100)).toFixed(2));

            if (reward > 0) {
              // Update referral status and record reward
              await apiPatch('referrals', refItem.id, {
                reward_amount: reward,
                reward_pct: pct,
                order_id: pkg.order_id || pkg.id,
                status: 'completed'
              });

              // Update referrer wallet balance
              const oldBal = parseFloat(referrer.wallet_balance) || 0;
              const newBal = parseFloat((oldBal + reward).toFixed(2));
              await apiPatch('users', referrer.id, { wallet_balance: newBal });

              // Record transaction
              await apiPost('wallet_transactions', {
                user_id: refItem.referrer_id,
                type: 'referral_reward',
                amount: reward,
                balance_before: oldBal,
                balance_after: newBal,
                payment_method: 'system',
                status: 'completed',
                note: `Referral Reward: Earned ${pct}% on referred purchase by ${pkg.buyer_name || 'referred buyer'} (${pkg.package_code})`
              });

              // Notify referrer
              addNotification(
                refItem.referrer_id,
                'referral',
                '🎁 Referral Reward Received!',
                `You earned GHS ${reward.toFixed(2)} (${pct}%) referral reward from ${pkg.buyer_name || 'a friend'}'s purchase ${pkg.package_code}.`
              );
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Referral Reward Error]', err);
    }
  }

  // Notify buyer
  const notifs = {
    on_delivery: ['🚚 Your Order is On the Way!',
      `Package ${pkg.package_code} has been dispatched and is on its way to you.`],
    delivered:   ['📬 Order Delivered!',
      `Package ${pkg.package_code} has been delivered. You can now rate the store.`]
  };
  if (notifs[newStatus])
    addNotification(pkg.buyer_id, 'order', notifs[newStatus][0], notifs[newStatus][1]);

  showToast(`Package marked as "${newStatus}" ✅`, 'success');
  _adminStatusInFlight.delete(packageId);
  await refreshAdminOrdersList();
}

// ── Admin: re-fetch and re-render just the orders list ────
async function refreshAdminOrdersList() {
  const listEl = document.getElementById('admin-orders-list');
  if (!listEl) { 
    if (!App.isBackgroundRefresh) renderAdminDashboard(); 
    return; 
  }

  if (!App.isBackgroundRefresh && (!listEl.children.length || !listEl.innerHTML.trim())) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Refreshing…</div>';
  }

  const [pkgsRes, usersRes] = await Promise.all([
    apiGet('packages', 'limit=200'),
    apiGet('users',    'limit=200')
  ]);
  const allPkgs  = pkgsRes?.data  || [];
  const allUsers = usersRes?.data || [];

  listEl.innerHTML = allPkgs.length
    ? allPkgs.map(pkg => adminPackageRowHTML(pkg, allUsers)).join('')
    : '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No packages yet</h3></div>';
}

// ── Admin: package row card ───────────────────────────────
function adminPackageRowHTML(rawPkg, allUsers) {
  const pkg = sanitizePackage(rawPkg);
  const buyer  = allUsers.find(u => u.id === pkg.buyer_id);
  const vendor = allUsers.find(u => u.id === pkg.vendor_id);
  const vs  = pkg.vendor_status || 'pending';
  const as  = pkg.admin_status  || 'pending';
  const itemSubtotal = parseFloat(pkg.gross_amount || pkg.total) || (Array.isArray(pkg.items) ? pkg.items.reduce((s,i)=>s+(parseFloat(i.price)||0)*(parseInt(i.qty)||1),0) : 0);
  const total = itemSubtotal + (parseFloat(pkg.delivery_fee)||0);

  const vsLabel = VENDOR_STATUS_LABELS[vs] || { text: vs, css: 'pending' };
  const asLabel = ADMIN_STATUS_LABELS[as]  || { text: as, css: 'pending' };

  // Admin can mark On Delivery any time the package isn't cancelled or already delivered
  const canMarkOnDelivery = vs !== 'rejected' && as === 'pending';
  const canMarkDelivered  = as === 'on_delivery';

  return `
<div class="card" style="margin-bottom:12px">
  <div class="card-body" style="padding:14px">
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div>
        <div style="font-weight:800;font-size:.92rem">📦 ${escHtml(pkg.package_code||'—')}</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">
          Buyer: <strong>${buyer ? escHtml(buyer.name) : (pkg.buyer_name ? escHtml(pkg.buyer_name) : 'Guest')}</strong>
          &nbsp;·&nbsp; Vendor: <strong>${vendor ? escHtml(vendor.name) : 'Unknown'}</strong>
        </div>
        <div style="font-size:.72rem;color:var(--text-muted)">${escHtml(pkg.origin_location||'?')} → ${escHtml(pkg.dest_location||'?')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:800;color:var(--primary);font-size:.92rem">GHS ${total.toFixed(2)}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">${(pkg.items||[]).length} item(s)</div>
      </div>
    </div>

    <!-- Status grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="padding:8px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);text-align:center">
        <div style="font-size:.68rem;font-weight:600;color:var(--text-muted);margin-bottom:4px">VENDOR STATUS</div>
        <span class="status-badge status-${vsLabel.css}" style="font-size:.68rem">${vsLabel.text}</span>
      </div>
      <div style="padding:8px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);text-align:center">
        <div style="font-size:.68rem;font-weight:600;color:var(--text-muted);margin-bottom:4px">DELIVERY STATUS</div>
        <span class="status-badge status-${asLabel.css}" style="font-size:.68rem">${asLabel.text}</span>
      </div>
    </div>

    <!-- Order-level buyer notes summary (shown when any item has a note) -->
    ${(pkg.items||[]).some(i=>i.buyer_note) ? `
    <div style="margin-bottom:10px;background:#fefce8;border:1.5px solid #fde047;border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:.72rem;font-weight:800;color:#92400e;margin-bottom:5px;display:flex;align-items:center;gap:5px;text-transform:uppercase;letter-spacing:.4px">
        <i class="fas fa-comment-dots" style="color:#ca8a04"></i> Buyer Notes
      </div>
      ${(pkg.items||[]).filter(i=>i.buyer_note).map(i=>`
      <div style="font-size:.75rem;color:#713f12;padding:3px 0;border-bottom:1px solid #fde68a;display:flex;gap:6px;align-items:flex-start">
        <span style="font-weight:700;flex-shrink:0">${escHtml(i.name||'')}:</span>
        <span>${escHtml(i.buyer_note)}</span>
      </div>`).join('')}
    </div>` : ''}

    <!-- Items list with buyer notes -->
    <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
      ${(pkg.items||[]).map(i=>`
      <div style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:.82rem">
        <div style="display:flex;justify-content:space-between">
          <span>${escHtml(i.name||'')} <span style="color:var(--text-muted)">× ${i.qty}</span></span>
          <span style="font-weight:600">GHS ${((i.price||0)*(i.qty||1)).toFixed(2)}</span>
        </div>
        ${i.buyer_note ? `<div style="font-size:.72rem;background:#fefce8;border:1px solid #fde047;border-radius:4px;padding:4px 8px;margin-top:3px;display:flex;align-items:flex-start;gap:5px;color:#713f12"><i class="fas fa-comment-dots" style="flex-shrink:0;margin-top:1px;color:#ca8a04"></i><span><strong>Buyer's note:</strong> ${escHtml(i.buyer_note)}</span></div>` : ''}
      </div>`).join('')}
    </div>

    <!-- Admin Action Buttons -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${vs === 'rejected' ? `
        <span style="font-size:.78rem;color:var(--danger)"><i class="fas fa-ban"></i> Cancelled by Vendor — no dispatch needed</span>
      ` : as === 'delivered' ? `
        <span style="font-size:.78rem;color:var(--success)"><i class="fas fa-check-double"></i> Delivered &amp; earnings released</span>
      ` : `
        ${as === 'pending' ? `
        <button class="btn btn-primary btn-sm" data-label="Mark On Delivery"
                onclick="updateAdminStatus('${pkg.id}','on_delivery')">
          <i class="fas fa-truck"></i> Mark On Delivery
        </button>` : ''}
        <button class="btn btn-success btn-sm" data-label="Mark Delivered"
                onclick="updateAdminStatus('${pkg.id}','delivered')">
          <i class="fas fa-check-circle"></i> Mark Delivered
        </button>
      `}
    </div>
  </div>
</div>`;
}

// ── Vendor: package detail card ───────────────────────────
function packageDetailHTML(rawPkg) {
  const pkg = sanitizePackage(rawPkg);
  const vs = pkg.vendor_status || 'pending';
  const as = pkg.admin_status  || 'pending';
  const vsLabel = VENDOR_STATUS_LABELS[vs] || { text: vs, css: 'pending' };
  const pkgId = pkg.id;
  const pCode = pkg.package_code;

  return `
<div class="package-card">
  <div class="package-header">
    <span class="package-code"><i class="fas fa-cube" style="margin-right:4px"></i>${escHtml(pCode)}</span>
    <span class="status-badge status-${vsLabel.css}" style="font-size:.72rem">${vsLabel.text}</span>
  </div>
  <div class="package-body">

    <!-- Vendor Action Panel -->
    <div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:var(--radius-sm);border:1.5px solid var(--border)">
      <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Your Action</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">

        ${vs === 'pending' ? `
        <button class="btn btn-success btn-sm" onclick="updateVendorStatus('${pkgId}','received')">
          <i class="fas fa-check"></i> Mark Received
        </button>
        <button class="btn btn-danger btn-sm" onclick="showRejectOrderModal('${pkgId}')">
          <i class="fas fa-times"></i> Reject
        </button>` : ''}

        ${vs === 'received' ? `
        <span class="status-badge status-received" style="font-size:.72rem"><i class="fas fa-check"></i> Received</span>
        <button class="btn btn-primary btn-sm" onclick="updateVendorStatus('${pkgId}','processed')">
          <i class="fas fa-box"></i> Mark Processed
        </button>
        <button class="btn btn-danger btn-sm" onclick="showRejectOrderModal('${pkgId}')">
          <i class="fas fa-times"></i> Reject
        </button>` : ''}

        ${vs === 'processed' ? `
        <span class="status-badge status-processed" style="font-size:.72rem"><i class="fas fa-check-double"></i> Processed</span>
        <span style="font-size:.78rem;color:var(--text-muted)">Waiting for admin dispatch</span>` : ''}

        ${vs === 'rejected' ? `
        <span class="status-badge status-rejected" style="font-size:.72rem"><i class="fas fa-ban"></i> Rejected</span>
        <span style="font-size:.78rem;color:var(--text-muted)">${escHtml(pkg.rejected_reason||'')}</span>` : ''}
      </div>

      ${as !== 'pending' ? `
      <div style="margin-top:8px;font-size:.75rem;padding-top:8px;border-top:1px solid var(--border)">
        <span style="color:var(--text-muted)">Delivery:</span>
        <span class="status-badge status-${ADMIN_STATUS_LABELS[as]?.css||'pending'}" style="font-size:.68rem;margin-left:4px">
          ${ADMIN_STATUS_LABELS[as]?.text || as}
        </span>
      </div>` : ''}
    </div>

    <!-- Route -->
    <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px">
      ${escHtml(pkg.origin_location||'?')} → ${escHtml(pkg.dest_location||'?')}
      ${pkg.is_intercity ? ' (Intercity)' : ' (Local)'}
    </div>

    <!-- Order-level buyer notes summary (shown when any item has a note) -->
    ${(pkg.items||[]).some(i=>i.buyer_note) ? `
    <div style="margin-bottom:10px;background:#fefce8;border:1.5px solid #fde047;border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:.72rem;font-weight:800;color:#92400e;margin-bottom:5px;display:flex;align-items:center;gap:5px;text-transform:uppercase;letter-spacing:.4px">
        <i class="fas fa-comment-dots" style="color:#ca8a04"></i> Buyer Notes
      </div>
      ${(pkg.items||[]).filter(i=>i.buyer_note).map(i=>`
      <div style="font-size:.75rem;color:#713f12;padding:3px 0;border-bottom:1px solid #fde68a;display:flex;gap:6px;align-items:flex-start">
        <span style="font-weight:700;flex-shrink:0">${escHtml(i.name||'')}:</span>
        <span>${escHtml(i.buyer_note)}</span>
      </div>`).join('')}
    </div>` : ''}

    <!-- Items -->
    ${(pkg.items||[]).map(i=>`
    <div style="padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:.82rem;display:flex;justify-content:space-between">
        <span>${escHtml(i.name||'')} × ${i.qty}</span>
        <span>GHS ${((i.price||0)*(i.qty||1)).toFixed(2)}</span>
      </div>
      ${i.buyer_note ? `<div style="font-size:.72rem;background:#fefce8;border:1px solid #fde047;border-radius:4px;padding:4px 8px;margin-top:3px;display:flex;align-items:flex-start;gap:5px;color:#713f12"><i class="fas fa-comment-dots" style="flex-shrink:0;margin-top:1px;color:#ca8a04"></i><span><strong>Buyer's note:</strong> ${escHtml(i.buyer_note)}</span></div>` : ''}
    </div>`).join('')}

    <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-top:8px;font-weight:700">
      <span>Your Earnings</span>
      <span>GHS ${(parseFloat(pkg.vendor_amount)||0).toFixed(2)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--text-muted)">
      <span>Commission</span><span>− GHS ${(parseFloat(pkg.commission_amount)||0).toFixed(2)}</span>
    </div>

    ${!pkg.balance_released
      ? `<div style="font-size:.73rem;color:var(--warning);margin-top:6px"><i class="fas fa-clock"></i> Payment held until delivery is confirmed</div>`
      : `<div style="font-size:.73rem;color:var(--success);margin-top:6px"><i class="fas fa-check-circle"></i> Payment released to your wallet</div>`}
  </div>
</div>`;
}

// ── Vendor: refresh orders list in-place ─────────────────
async function refreshVendorOrders(vendorId) {
  const listEl = document.getElementById('vendor-orders-list');
  if (!listEl) { renderVendorDashboard(); return; }

  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Refreshing…</div>';

  const res  = await apiGet('packages', 'vendor_id=' + encodeURIComponent(vendorId));
  const rawPkgs = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  const pkgs = rawPkgs.filter(p => String(p.vendor_id) === String(vendorId));

  listEl.innerHTML = pkgs.length
    ? pkgs.map(pkg => packageDetailHTML(pkg)).join('')
    : '<div class="empty-state" style="padding:30px"><i class="fas fa-inbox"></i><h3>No orders yet</h3><p>New orders will appear here</p></div>';
}
