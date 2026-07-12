/* ============================================================
   HAPPA TRADEMART — Admin Profile Panels
   Full-screen slide-in profile viewer for Buyers, Vendors, Rendors
   ============================================================ */

// ── Skeleton loader for panel (before data loads) ─────────
function _apSkeleton(title, color) {
  return `
<div class="ap-panel-inner">
  <div class="ap-panel-topbar" style="background:${color}">
    <button class="ap-back-btn" onclick="closeAdminPanel()"><i class="fas fa-arrow-left"></i></button>
    <div class="ap-topbar-center">
      <div class="ap-topbar-name">${title}</div>
      <div class="ap-topbar-sub">Loading…</div>
    </div>
    <div style="width:36px"></div>
  </div>
  <div class="ap-panel-body" style="padding:20px">
    <div style="display:flex;gap:14px;margin-bottom:18px">
      <div style="width:80px;height:80px;border-radius:16px;background:var(--bg);animation:ap-pulse 1.2s infinite ease-in-out"></div>
      <div style="flex:1;min-width:0">
        <div style="width:60%;height:18px;background:var(--bg);border-radius:8px;margin-bottom:8px;animation:ap-pulse 1.2s infinite ease-in-out"></div>
        <div style="width:80%;height:14px;background:var(--bg);border-radius:6px;margin-bottom:6px;animation:ap-pulse 1.2s infinite ease-in-out 0.1s"></div>
        <div style="width:40%;height:14px;background:var(--bg);border-radius:6px;animation:ap-pulse 1.2s infinite ease-in-out 0.2s"></div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:20px">
      ${[1,2,3,4].map(i=>`
      <div style="flex:1;height:70px;background:var(--bg);border-radius:var(--radius-md);animation:ap-pulse 1.2s infinite ease-in-out ${i*0.1}s"></div>`).join('')}
    </div>
    <div style="height:14px;background:var(--bg);border-radius:8px;margin-bottom:12px;width:30%"></div>
    <div style="height:40px;background:var(--bg);border-radius:var(--radius-md);margin-bottom:10px"></div>
    <div style="height:40px;background:var(--bg);border-radius:var(--radius-md)"></div>
  </div>
</div>
<style>
@keyframes ap-pulse {
  0%, 100% { opacity:0.6; }
  50% { opacity:0.3; }
}
</style>`;
}

// ── Helper: stat card in hero section ─────────────────────
function _apStat(icon, label, value, color) {
  return `
<div class="ap-stat-card">
  <div class="ap-stat-icon" style="background:${color}22">
    <i class="${icon}" style="color:${color}"></i>
  </div>
  <div class="ap-stat-value">${value}</div>
  <div class="ap-stat-label">${label}</div>
</div>`;
}

// ── Helper: info row (label + value) ──────────────────────
function _apRow(label, value) {
  return `
<div class="ap-info-row">
  <div class="ap-info-label">${label}</div>
  <div class="ap-info-value">${value||'—'}</div>
</div>`;
}

// ── Helper: action button in actions tab ──────────────────
function _apBtn(colorClass, icon, text, onclick) {
  return `<div class="ap-action-btn ${colorClass}" onclick="${onclick}"><i class="${icon}"></i>${text}</div>`;
}

// ── Helper: role section in action tab ────────────────────
function _apRoleSection(userId, currentRole) {
  const roles = ['buyer','vendor','rendor'];
  return `
<div class="ap-section-title" style="margin-top:18px">Change User Role</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
  ${roles.map(r => `
  <button class="btn btn-sm ${r===currentRole?'btn-primary':'btn-ghost'}"
          onclick="_apChangeUserRole('${userId}','${r}')"
          ${r===currentRole?'disabled':''}
          style="flex:1;min-width:80px">
    ${r.charAt(0).toUpperCase()+r.slice(1)}
  </button>`).join('')}
</div>`;
}

// ── Helper: password reset section in action tab ──────────
function _apPasswordSection(userId) {
  return `
<div class="ap-section-title" style="margin-top:18px">Password Reset</div>
<div style="display:flex;gap:8px">
  <input type="text" id="ap-new-pw-${userId}" class="form-control" placeholder="New password…" style="flex:1">
  <button class="btn btn-primary btn-sm" onclick="_apResetUserPassword('${userId}')">
    <i class="fas fa-key"></i> Reset
  </button>
</div>`;
}

// ── Helper: danger zone (delete account) ──────────────────
function _apDangerZone(userId, userName) {
  const nameSafe = (userName||'').replace(/'/g,"\\'");
  return `
<div class="ap-section-title" style="margin-top:20px;color:var(--danger)">⚠️ Danger Zone</div>
<div class="ap-action-btn ap-action-red"
     onclick="if(confirm('Are you ABSOLUTELY sure you want to delete ${nameSafe||'this user'}? This CANNOT be undone!')){_apDeleteUser('${userId}')}">
  <i class="fas fa-user-slash"></i>
  Delete User Account
</div>`;
}

// ── Action helpers ─────────────────────────────────────────
async function _apChangeUserRole(userId, role) {
  if (!confirm('Change user role?')) return;
  await apiPatch('users', userId, { role });
  showToast(`Role updated to ${role} ✅`, 'success');
  closeAdminPanel();
}
async function _apResetUserPassword(userId) {
  const el = document.getElementById('ap-new-pw-' + userId);
  const pw = el?.value?.trim();
  if (!pw) { showToast('Enter a new password', 'warning'); return; }
  await apiPatch('users', userId, { password: pw });
  showToast('Password reset ✅', 'success');
  if (el) el.value = '';
}
async function _apDeleteUser(userId) {
  showToast('Cleaning user dependencies...', 'info');
  try {
    // 1. Fetch and delete any associated store (and its cascades)
    const storeRes = await apiGet('stores', 'limit=500').catch(() => null);
    const userStore = (storeRes?.data || []).find(s => String(s.vendor_id) === String(userId));
    if (userStore) {
      // Cascading store clean up
      const prodRes = await apiGet('products', 'limit=500').catch(() => null);
      const storeProducts = (prodRes?.data || []).filter(p => String(p.store_id) === String(userStore.id));
      
      const revRes = await apiGet('reviews', 'limit=500').catch(() => null);
      const storeReviews = (revRes?.data || []).filter(r => 
        String(r.store_id) === String(userStore.id) || storeProducts.some(p => String(p.id) === String(r.product_id))
      );

      for (const r of storeReviews) { await apiDelete('reviews', r.id).catch(() => {}); }
      for (const p of storeProducts) { await apiDelete('products', p.id).catch(() => {}); }

      const pkgRes = await apiGet('packages', 'limit=500').catch(() => null);
      const storePkgs = (pkgRes?.data || []).filter(pkg => String(pkg.store_id) === String(userStore.id));
      for (const pkg of storePkgs) { await apiDelete('packages', pkg.id).catch(() => {}); }

      const ordRes = await apiGet('orders', 'limit=500').catch(() => null);
      const storeOrders = (ordRes?.data || []).filter(o => String(o.store_id) === String(userStore.id));
      for (const o of storeOrders) { await apiDelete('orders', o.id).catch(() => {}); }

      const adsRes = await apiGet('ad_campaigns', 'limit=500').catch(() => null);
      const storeAds = (adsRes?.data || []).filter(ad => String(ad.store_id) === String(userStore.id));
      for (const ad of storeAds) { await apiDelete('ad_campaigns', ad.id).catch(() => {}); }

      await apiDelete('stores', userStore.id).catch(() => {});
    }

    // 2. Delete wallet transactions
    const txRes = await apiGet('wallet_transactions', 'limit=500').catch(() => null);
    const userTx = (txRes?.data || []).filter(t => String(t.user_id) === String(userId));
    for (const t of userTx) { await apiDelete('wallet_transactions', t.id).catch(() => {}); }

    // 3. Delete services (Rendors)
    const svcRes = await apiGet('services', 'limit=500').catch(() => null);
    const userSvcs = (svcRes?.data || []).filter(s => String(s.rendor_id) === String(userId));
    for (const s of userSvcs) { await apiDelete('services', s.id).catch(() => {}); }

    // 4. Delete notifications
    const notRes = await apiGet('notifications', 'limit=500').catch(() => null);
    const userNotifs = (notRes?.data || []).filter(n => String(n.user_id) === String(userId));
    for (const n of userNotifs) { await apiDelete('notifications', n.id).catch(() => {}); }

    // 5. Delete referrals
    const refRes = await apiGet('referrals', 'limit=500').catch(() => null);
    const userRefs = (refRes?.data || []).filter(r => String(r.referrer_id) === String(userId) || String(r.referred_id) === String(userId));
    for (const r of userRefs) { await apiDelete('referrals', r.id).catch(() => {}); }

  } catch(e) {
    console.error('Cascading delete for user failed:', e);
  }

  showToast('Deleting user account...', 'info');
  const res = await apiDelete('users', userId).catch(err => {
    console.error('Delete user error:', err);
    return null;
  });

  if (res !== null) {
    showToast('User deleted ✅', 'success');
  } else {
    showToast('User deleted from local cache ✅', 'success');
  }
  closeAdminPanel();
  if (typeof refreshAdminVendorsFull === 'function') refreshAdminVendorsFull().catch(() => {});
  if (typeof loadAdminRendors === 'function') loadAdminRendors().catch(() => {});
  if (typeof refreshAdminUsersList === 'function') refreshAdminUsersList().catch(() => {});
  if (typeof renderAdminDashboard === 'function') renderAdminDashboard().catch(() => {});
}

// ── Store helpers ─────────────────────────────────────────
async function _apMarkStorePaid(storeId) {
  await apiPatch('stores', storeId, { is_paid: true });
  showToast('Store marked as paid ✅', 'success');
}
async function _apDeleteStore(storeId, vendorName) {
  if (!confirm(`Are you sure you want to delete ${vendorName||'this vendor'}'s store PERMANENTLY?`)) return;
  await apiDelete('stores', storeId);
  showToast('Store deleted ✅', 'success');
  closeAdminPanel();
}
async function _apToggleProductAvail(prodId, userId) {
  // Toggle is_available locally first for instant feedback
  const prods = window._apCache?.[userId]?.products || [];
  const p = prods.find(x=>x.id===prodId);
  if (p) { p.is_available = !(p.is_available !== false); }
  _apRenderVendorProducts(userId);
  // Then patch
  await apiPatch('products', prodId, { is_available: p?.is_available });
}
async function _apDeleteProduct(prodId, userId) {
  if (!confirm('Delete this product permanently?')) return;
  await apiDelete('products', prodId);
  const prods = window._apCache?.[userId]?.products || [];
  window._apCache[userId].products = prods.filter(x=>x.id!==prodId);
  _apRenderVendorProducts(userId);
  showToast('Product deleted ✅', 'success');
}
async function _apSaveProductEdit(prodId, userId, form) {
  const data = {};
  new FormData(form).forEach((v,k)=>{ data[k]=v; });
  data.is_available = !!form.querySelector('[name=is_available]')?.checked;
  data.is_flash_sale = !!form.querySelector('[name=is_flash_sale]')?.checked;
  data.price = parseFloat(data.price) || 0;
  data.original_price = data.original_price ? parseFloat(data.original_price) : null;
  data.stock_qty = parseInt(data.stock_qty || '0');
  data.weight_kg = data.weight_kg ? parseFloat(data.weight_kg) : null;
  // Update images array with new URL if provided
  if (data.image_url) {
    data.images = [data.image_url];
  }
  delete data.image_url;
  const btn = form.querySelector('[type=submit]');
  const setBtn = OptimisticUI.button(btn, '<i class="fas fa-save"></i> Save');
  setBtn('saving');

  // Snapshot for rollback
  const prods = window._apCache?.[userId]?.products || [];
  const idx = prods.findIndex(x => x.id === prodId);
  const snap = idx > -1 ? { ...prods[idx] } : null;

  // Optimistic local update
  if (idx > -1) {
    prods[idx] = { ...prods[idx], ...data };
    window._apCache[userId].products = prods;
  }

  try {
    await apiPatch('products', prodId, data);
    setBtn('saved');
    OptimisticUI.pulse(form);
    showToast('Product updated ✅', 'success', 2000);
    _apRenderVendorProducts(userId);
    setTimeout(() => {
      form.closest('[id^=ap-prod-edit-]').style.display = 'none';
    }, 600);
  } catch (err) {
    if (snap && idx > -1) {
      prods[idx] = snap;
      window._apCache[userId].products = prods;
    }
    setBtn('failed');
    OptimisticUI.shake(form);
    showToast('Could not save product: ' + (err?.message || 'network error'), 'error', 4000);
  }
}

// ── Verification helpers ───────────────────────────────────
function _apPatchUserOptimistic(userId, patch, successMsg) {
  const idx = App.allUsers.findIndex(u => u.id === userId);
  const snap = idx > -1 ? { ...App.allUsers[idx] } : null;
  if (snap) Object.assign(App.allUsers[idx], patch);
  return apiPatch('users', userId, patch)
    .then(() => { showToast(successMsg, 'success', 2000); })
    .catch(err => {
      if (snap && idx > -1) App.allUsers[idx] = snap;
      showToast('Action failed: ' + (err?.message || 'network error'), 'error', 4000);
      throw err;
    });
}
async function _apGrantPhoneVerify(userId) {
  try { await _apPatchUserOptimistic(userId, { is_verified: true }, 'Phone verified ✅'); }
  catch (e) {}
}
async function _apRevokePhoneVerify(userId) {
  try { await _apPatchUserOptimistic(userId, { is_verified: false }, 'Phone verification revoked'); }
  catch (e) {}
}
async function _apGrantIdVerify(userId) {
  try { await _apPatchUserOptimistic(userId, { id_verified: true }, 'ID verified ✅'); }
  catch (e) {}
}
async function _apRevokeIdVerify(userId) {
  try { await _apPatchUserOptimistic(userId, { id_verified: false }, 'ID verification revoked'); }
  catch (e) {}
}
async function _apSuspendUser(userId) {
  try { await _apPatchUserOptimistic(userId, { status: 'suspended' }, 'Account suspended'); }
  catch (e) {}
}
async function _apActivateUser(userId) {
  try { await _apPatchUserOptimistic(userId, { status: 'active' }, 'Account activated ✅'); }
  catch (e) {}
}

// ── Tab switcher — scoped to the PANEL wrapper ────────────
function _apSwitch(btn, tabId, panelId) {
  const panel = document.getElementById(panelId) || document.body;
  panel.querySelectorAll('.ap-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  panel.querySelectorAll('.ap-tab-pane').forEach(p => p.style.display = 'none');
  panel.querySelector('#'+tabId).style.display = 'block';
}

// ── Render user transactions into wallet tab ─────────────
function _apRenderUserTxns(userId, data, targetPrefix) {
  const wrap = document.getElementById(targetPrefix+userId);
  if (!wrap) return;
  const txns = data || window._apCache?.[userId]?.txns || [];
  if (!txns.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-muted)"><i class="fas fa-receipt"></i><div style="margin-top:6px">No transactions yet</div></div>';
    return;
  }
  const isCredit = t => ['deposit','earning','refund','referral_reward','admin_credit'].includes(t.type);
  wrap.innerHTML = txns.sort((a,b)=>(b.created_at||0)-(a.created_at||0)).map(t => `
    <div class="ap-txn-row">
      <div class="ap-txn-icon" style="background:${isCredit(t)?'#d1fae5':'#fee2e2'}">
        <i class="fas fa-arrow-${isCredit(t)?'down':'up'}" style="color:${isCredit(t)?'#059669':'#dc2626'};font-size:.85rem"></i>
      </div>
      <div class="ap-txn-info">
        <div class="ap-txn-type">${(t.type||'unknown').replace(/_/g,' ')}</div>
        ${t.description ? `<div class="ap-txn-desc">${escHtml(t.description)}</div>` : ''}
        <div class="ap-txn-date">${formatDateTime(t.created_at)}</div>
      </div>
      <div class="ap-txn-amount">
        <div class="ap-txn-val" style="color:${isCredit(t)?'#059669':'#dc2626'}">${isCredit(t)?'+':'-'} GHS ${(t.amount||0).toFixed(2)}</div>
        <span class="status-badge status-${t.status||'completed'}" style="font-size:.6rem">${t.status||'completed'}</span>
      </div>
    </div>
  `).join('');
}

// ── Render vendor products into products tab ──────────────
function _apRenderVendorProducts(userId, data) {
  const wrap = document.getElementById('avt-products-body-'+userId);
  if (!wrap) return;
  const products = data || window._apCache?.[userId]?.products || [];
  if (!products.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:40px 0"><i class="fas fa-cube"></i><h3>No products yet</h3><p>This vendor has not added any products.</p></div>';
    return;
  }
  wrap.innerHTML = products.sort((a,b) => (b.created_at||0) - (a.created_at||0)).map(p => {
    const avail = p.is_available !== false;
    const editId = 'ap-prod-edit-'+p.id;
    const priceSafe = (p.price||0).toFixed(2);
    const origSafe = (p.original_price||'');
    const stockSafe = (p.stock_qty || 0);
    const weightSafe = (p.weight_kg || '');
    const imgSafe = escHtml((p.images||[])[0] || '');
    return `
    <div class="ap-prod-card">
      <div class="ap-prod-main">
        <img src="${imgSafe||'https://placehold.co/128x128?text=Product'}" alt="" class="ap-prod-img" onerror="this.src='https://placehold.co/128x128?text=Product'">
        <div class="ap-prod-info">
          <div class="ap-prod-name">${escHtml(p.name)}</div>
          <div class="ap-prod-meta">
            <span class="status-badge status-${avail?'active':'inactive'}" style="font-size:.65rem">${avail?'Available':'Hidden'}</span>
            ${p.is_flash_sale?'<span class="status-badge" style="background:#fffbea;color:#b45309;border:none">⚡ Flash Sale</span>':''}
            <span style="color:var(--text-muted);font-size:.8rem">${escHtml(p.category||'—')}</span>
          </div>
          <div class="ap-prod-price">
            GHS ${priceSafe}
            ${p.original_price ? `<span style="color:var(--text-muted);text-decoration:line-through;margin-left:6px">GHS ${parseFloat(p.original_price).toFixed(2)}</span>` : ''}
          </div>
          <div class="ap-prod-bottom" style="display:flex;justify-content:space-between;align-items:center;width:100%">
            <span style="font-size:.8rem;color:var(--text-muted)">Stock: <strong style="color:${stockSafe===0?'var(--danger)':'var(--text)'}">${stockSafe}</strong> unit${stockSafe===1?'':'s'}</span>
            <span style="font-size:.75rem;color:var(--text-muted)">${weightSafe?weightSafe+'kg':'—'}</span>
          </div>
        </div>
        <div class="ap-prod-actions">
          <button class="btn btn-ghost btn-sm" title="Toggle availability" onclick="_apToggleProductAvail('${p.id}','${userId}')"><i class="fas fa-eye${avail?'-slash':''}"></i></button>
          <button class="btn btn-ghost btn-sm" title="Edit product" onclick="document.getElementById('${editId}').style.display=document.getElementById('${editId}').style.display==='none'?'block':'none'"><i class="fas fa-pen"></i></button>
          <button class="btn btn-ghost btn-sm" title="Delete product" onclick="_apDeleteProduct('${p.id}','${userId}')"><i class="fas fa-trash-alt" style="color:var(--danger)"></i></button>
        </div>
      </div>
      <div id="${editId}" style="display:none;background:var(--bg-alt,#f8fafc);border-top:1px solid var(--border);padding:14px;margin-top:12px">
        <div style="font-weight:800;margin-bottom:10px">Edit product</div>
        <form onsubmit="event.preventDefault();_apSaveProductEdit('${p.id}','${userId}',this)">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input class="form-control" name="name" value="${escHtml(p.name||'')}" required>
          </div>
          <div style="display:flex;gap:8px">
            <div class="form-group" style="flex:1">
              <label class="form-label">Price (GHS)</label>
              <input class="form-control" name="price" type="number" min="0" step="0.01" value="${priceSafe}" required>
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Original Price</label>
              <input class="form-control" name="original_price" type="number" min="0" step="0.01" value="${origSafe}" placeholder="—">
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <div class="form-group" style="flex:1">
              <label class="form-label">Stock Qty</label>
              <input class="form-control" name="stock_qty" type="number" min="0" value="${stockSafe}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Weight (kg)</label>
              <input class="form-control" name="weight_kg" type="number" min="0" step="0.01" value="${weightSafe}" placeholder="—">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <select class="form-control form-select" name="category">
              ${CATEGORIES.map(c=>`<option value="${c}" ${c===p.category?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Short Description</label>
            <input class="form-control" name="short_desc" value="${escHtml(p.short_desc||'')}" placeholder="Brief summary…">
          </div>
          <div class="form-group">
            <label class="form-label">Cover Image URL</label>
            <input class="form-control" name="image_url" value="${imgSafe}" placeholder="https://…">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="is_available" ${avail?'checked':''} style="width:15px;height:15px">
              Product is Available (visible to buyers)
            </label>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="is_flash_sale" ${p.is_flash_sale?'checked':''} style="width:15px;height:15px">
              ⚡ Flash Sale Active
            </label>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" type="submit" style="flex:1"><i class="fas fa-save"></i> Save</button>
            <button class="btn btn-ghost btn-sm" type="button" style="flex:1" onclick="document.getElementById('${editId}').style.display='none'">Cancel</button>
          </div>
        </form>
      </div>
    </div>
    `;
  }).join('');
}

// ── Render vendor packages into orders tab ────────────────
function _apRenderVendorPackages(userId, data) {
  const wrap = document.getElementById('avt-orders-body-'+userId);
  if (!wrap) return;
  const pkgs = data || window._apCache?.[userId]?.pkgs || [];
  if (!pkgs.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:40px 0"><i class="fas fa-box-open"></i><h3>No orders yet</h3><p>No packages have been made through this vendor.</p></div>';
    return;
  }
  wrap.innerHTML = pkgs.sort((a,b)=>(b.created_at||0)-(a.created_at||0)).map(p => `
    <div class="ap-pkg-card">
      <div class="ap-pkg-top">
        <div><strong>#${p.package_code||'—'}</strong></div>
        <span class="status-badge status-${p.status||'pending'}" style="font-size:.65rem">${p.status||'pending'}</span>
      </div>
      <div class="ap-pkg-body">
        <div style="font-weight:800">${p.origin_location||'—'} → ${p.dest_location||'—'}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:4px">${(p.items||[]).length} item${(p.items||[]).length===1?'':'s'}</div>
        ${(p.items||[]).some(i=>i.buyer_note)?'<div style="font-size:.75rem;color:#b45309;margin-top:6px;background:#fffbea;padding:6px;border-radius:6px">💬 <strong>Buyer note:</strong> '+escHtml((p.items||[]).find(i=>i.buyer_note)?.buyer_note)+'</div>':''}
      </div>
      <div class="ap-pkg-bottom">
        <div style="color:var(--text-muted);font-size:.75rem">${formatDateTime(p.created_at)}</div>
        <div style="font-weight:800;color:var(--success)">GHS ${(p.vendor_amount||0).toFixed(2)}</div>
      </div>
    </div>
  `).join('');
}

// ── Embedded store preview in vendor panel ─────────────────
function _apRenderEmbeddedStore(storeId, userId, products) {
  const wrap = document.getElementById('ap-store-preview-'+userId);
  if (!wrap) return;
  const store = window._apCache?.[userId]?.store;
  const productsForPreview = (products||[]).filter(p=>p.is_available!==false).slice(0,8);
  wrap.innerHTML = `
  <div class="ap-preview-top">
    ${store?.banner_url?`<img src="${escHtml(store.banner_url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`:''}
  </div>
  <div class="ap-preview-middle">
    <div class="ap-preview-avatar">
      <img src="${store?.logo_url||'https://placehold.co/64x64?text=Store'}" alt="">
    </div>
    <div class="ap-preview-info">
      <div class="ap-preview-name">${escHtml(store?.name||'Store')}</div>
      <div class="ap-preview-sub">${store?.location||''}</div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <span class="status-badge status-${store?.status||'active'}">${store?.status||'active'}</span>
        ${store?.is_paid?'<span class="status-badge status-paid">Paid</span>':''}
      </div>
    </div>
  </div>
  <div style="font-weight:900;font-size:.8rem;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">Products in store</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
    ${productsForPreview.map(p=>`
    <div style="aspect-ratio:1;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)">
      <img src="${(p.images||[])[0]||'https://placehold.co/80x80?text=P'}" style="width:100%;height:100%;object-fit:cover">
    </div>`).join('')}
  </div>
  `;
}

// ── Quick-save functions for buyer & store edits ───────────
async function _apSaveBuyerInfo(userId, form) {
  const data = {};
  new FormData(form).forEach((v,k)=>{ data[k]=v; });

  const btn = form.querySelector('[type=submit]');
  const setBtn = OptimisticUI.button(btn, '<i class="fas fa-save"></i> Save Changes');
  setBtn('saving');

  // Snapshot user for rollback
  const userIdx = App.allUsers.findIndex(u => u.id === userId);
  const snap = userIdx > -1 ? { ...App.allUsers[userIdx] } : null;

  // Optimistic local update
  if (snap) Object.assign(App.allUsers[userIdx], data);

  try {
    await apiPatch('users', userId, data);
    setBtn('saved');
    showToast('Account info updated ✅', 'success', 2000);
    OptimisticUI.pulse(form);
    // Re-open panel to refresh the content
    await adminOpenBuyerProfile(userId);
  } catch (err) {
    if (snap && userIdx > -1) {
      App.allUsers[userIdx] = snap;
    }
    setBtn('failed');
    OptimisticUI.shake(form);
    showToast('Could not save: ' + (err?.message || 'network error'), 'error', 4000);
  }
}
async function _apSaveStore(storeId, form) {
  const data = {};
  new FormData(form).forEach((v,k)=>{ data[k]=v; });
  data.is_paid = !!form.querySelector('[name=is_paid]')?.checked;
  if (data.store_price) data.store_price = parseFloat(data.store_price);
  // Parse keywords into array if not already
  if (typeof data.keywords === 'string' && data.keywords.trim()) {
    data.keywords = data.keywords.split(',').map(s => s.trim()).filter(Boolean);
  }

  const btn = form.querySelector('[type=submit]');
  const setBtn = OptimisticUI.button(btn, '<i class="fas fa-save"></i> Save');
  setBtn('saving');

  // Snapshot store for rollback
  const storeIdx = App.allStores.findIndex(s => s.id === storeId);
  const snap = storeIdx > -1 ? { ...App.allStores[storeIdx] } : null;

  // Optimistic local update
  if (snap) Object.assign(App.allStores[storeIdx], data);

  try {
    await apiPatch('stores', storeId, data);
    setBtn('saved');
    showToast('Store updated ✅', 'success', 2000);
    OptimisticUI.pulse(form);
    setTimeout(() => closeAdminPanel(), 800);
  } catch (err) {
    if (snap && storeIdx > -1) {
      App.allStores[storeIdx] = snap;
    }
    setBtn('failed');
    OptimisticUI.shake(form);
    showToast('Could not save store: ' + (err?.message || 'network error'), 'error', 4000);
  }
}

// ── Render helpers for new full page mode ─────────────────
function _apRenderVendorProductsForPage(userId, data) {
  const wrap = document.getElementById('ap-v-products-wrap');
  if (!wrap) return;
  const products = data || (window._apCache?.[userId]?.products || []);
  if (!products.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:30px 0;background:white;border-radius:var(--radius-md);border:1px solid var(--border)"><i class="fas fa-cube"></i><h3>No products yet</h3><p>This vendor has not added any products.</p></div>';
    return;
  }
  const available = products.filter(p => p.is_available !== false).length;
  const outStock  = products.filter(p => (p.stock_qty || 0) === 0).length;
  const flash     = products.filter(p => p.is_flash_sale).length;
  wrap.innerHTML = `
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--border)">
          <div style="font-weight:900;font-size:1.2rem;color:var(--primary)">${products.length}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">Total</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--border)">
          <div style="font-weight:900;font-size:1.2rem;color:var(--success)">${available}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">Available</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--border)">
          <div style="font-weight:900;font-size:1.2rem;color:var(--danger)">${outStock}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">Out of Stock</div>
        </div>
        ${flash ? `
        <div style="background:#fffbea;padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid #fde68a">
          <div style="font-weight:900;font-size:1.2rem;color:#b45309">${flash}</div>
          <div style="font-size:.7rem;color:#92400e">Flash Sale</div>
        </div>` : '<div></div>'}
      </div>
      ${products.sort((a,b) => (b.created_at||0) - (a.created_at||0)).map(p => {
        const avail = p.is_available !== false;
        const editId = 'ap-v-prod-edit-' + p.id;
        const priceSafe = (p.price||0).toFixed(2);
        const origSafe = (p.original_price||'');
        const stockSafe = (p.stock_qty || 0);
        const weightSafe = (p.weight_kg || '');
        const imgSafe = escHtml((p.images||[])[0] || '');
        return `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);margin-bottom:10px;overflow:hidden">
          <div style="display:flex;align-items:center;gap:10px;padding:10px">
            <img src="${imgSafe||'https://placehold.co/48x48?text=Product'}" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0" onerror="this.src='https://placehold.co/48x48?text=Product'">
            <div style="flex:1;min-width:0">
              <div style="font-weight:800;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
                ${escHtml(p.category||'—')} · Stock: <strong>${stockSafe}</strong>${stockSafe===0?' ⚠️':''}
                ${p.is_flash_sale ? ' · <span style="color:#b45309">⚡ Flash</span>' : ''}
              </div>
              <div style="font-size:.8rem;margin-top:2px">
                <strong style="color:var(--primary)">GHS ${priceSafe}</strong>
                ${p.original_price ? '<span style="color:var(--text-muted);text-decoration:line-through;margin-left:5px">GHS ' + parseFloat(p.original_price).toFixed(2) + '</span>' : ''}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
              <span class="status-badge status-${avail?'active':'inactive'}" style="font-size:.6rem">${avail?'Available':'Hidden'}</span>
              <div style="display:flex;gap:5px">
                <button class="btn btn-ghost btn-sm" style="padding:3px 7px;font-size:.7rem;color:var(--primary)" title="Edit product" onclick="document.getElementById('${editId}').style.display=document.getElementById('${editId}').style.display==='none'?'block':'none'">
                  <i class="fas fa-pen"></i>
                </button>
                <button class="btn btn-ghost btn-sm" style="padding:3px 7px;font-size:.7rem;color:${avail?'#b45309':'var(--success)'}" title="${avail?'Hide product':'Make available'}" onclick="_apToggleProductAvail('${p.id}','${userId}');_apRenderVendorProductsForPage('${userId}')">
                  <i class="fas fa-eye${avail?'-slash':''}"></i>
                </button>
                <button class="btn btn-ghost btn-sm" style="padding:3px 7px;font-size:.7rem;color:var(--danger)" title="Delete product" onclick="if(confirm('Delete this product permanently?'))_apDeleteProduct('${p.id}','${userId}');_apRenderVendorProductsForPage('${userId}')">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
          <div id="${editId}" style="display:none;background:var(--bg-alt,#f8fafc);border-top:1px solid var(--border);padding:12px">
            <div style="font-size:.72rem;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Edit Product</div>
            <form onsubmit="event.preventDefault();_apSaveProductEdit('${p.id}','${userId}',this);_apRenderVendorProductsForPage('${userId}')">
              <div class="form-group">
                <label class="form-label">Name</label>
                <input class="form-control" name="name" value="${escHtml(p.name||'')}" required>
              </div>
              <div style="display:flex;gap:8px">
                <div class="form-group" style="flex:1">
                  <label class="form-label">Price (GHS)</label>
                  <input class="form-control" name="price" type="number" min="0" step="0.01" value="${priceSafe}" required>
                </div>
                <div class="form-group" style="flex:1">
                  <label class="form-label">Original Price</label>
                  <input class="form-control" name="original_price" type="number" min="0" step="0.01" value="${origSafe}" placeholder="—">
                </div>
              </div>
              <div style="display:flex;gap:8px">
                <div class="form-group" style="flex:1">
                  <label class="form-label">Stock Qty</label>
                  <input class="form-control" name="stock_qty" type="number" min="0" value="${stockSafe}">
                </div>
                <div class="form-group" style="flex:1">
                  <label class="form-label">Weight (kg)</label>
                  <input class="form-control" name="weight_kg" type="number" min="0" step="0.01" value="${weightSafe}" placeholder="—">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Category</label>
                <select class="form-control form-select" name="category">
                  ${CATEGORIES.map(c=>`<option value="${c}" ${c===p.category?'selected':''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Short Description</label>
                <input class="form-control" name="short_desc" value="${escHtml(p.short_desc||'')}" placeholder="Brief summary…">
              </div>
              <div class="form-group">
                <label class="form-label">Cover Image URL</label>
                <input class="form-control" name="image_url" value="${imgSafe}" placeholder="https://…">
              </div>
              <div class="form-group">
                <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" name="is_available" ${avail?'checked':''} style="width:15px;height:15px">
                  Product is Available (visible to buyers)
                </label>
              </div>
              <div class="form-group">
                <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" name="is_flash_sale" ${p.is_flash_sale?'checked':''} style="width:15px;height:15px">
                  ⚡ Flash Sale Active
                </label>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-primary btn-sm" type="submit" style="flex:1"><i class="fas fa-save"></i> Save</button>
                <button class="btn btn-ghost btn-sm" type="button" style="flex:1" onclick="document.getElementById('${editId}').style.display='none'">Cancel</button>
              </div>
            </form>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function _apRenderVendorPackagesForPage(userId, data) {
  const wrap = document.getElementById('ap-v-orders-wrap');
  if (!wrap) return;
  const pkgs = data || (window._apCache?.[userId]?.pkgs || []);
  if (!pkgs.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:30px 0;background:white;border-radius:var(--radius-md);border:1px solid var(--border)"><i class="fas fa-box-open"></i><h3>No orders yet</h3><p>No packages have been made through this vendor.</p></div>';
    return;
  }
  const pending = pkgs.filter(p=>p.status==='pending').length;
  const delivered = pkgs.filter(p=>['delivered','confirmed'].includes(p.status)).length;
  wrap.innerHTML = `
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--border)">
          <div style="font-weight:900;font-size:1.2rem;color:var(--primary)">${pkgs.length}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">Total</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--border)">
          <div style="font-weight:900;font-size:1.2rem;color:#b45309">${pending}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">Pending</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--border)">
          <div style="font-weight:900;font-size:1.2rem;color:var(--success)">${delivered}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">Delivered</div>
        </div>
      </div>
      ${pkgs.sort((a,b)=>(b.created_at||0)-(a.created_at||0)).map(p => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.9rem"><code>${p.package_code||'—'}</code></div>
            <div style="font-size:.78rem;color:var(--text-muted)">${p.origin_location||'—'} → ${p.dest_location||'—'} · ${(p.items||[]).length} item${(p.items||[]).length===1?'':'s'}
              ${(p.items||[]).some(i=>i.buyer_note)?'<span style="display:inline-block;margin-left:6px;color:#b45309;font-weight:800">• Buyer note</span>':''}
            </div>
            <div style="font-size:.72rem;color:var(--text-muted)">${formatDateTime(p.created_at)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:800;color:var(--success)">GHS ${(p.vendor_amount||0).toFixed(2)}</div>
            <span class="status-badge status-${p.status||'pending'}" style="font-size:.62rem">${p.status||'pending'}</span>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function _apRenderUserTxnsForPage(userId, data, targetId) {
  const wrap = document.getElementById(targetId);
  if (!wrap) return;
  const txns = data || (window._apCache?.[userId]?.txns || []);
  if (!txns.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-muted)"><i class="fas fa-receipt"></i><div style="margin-top:6px">No transactions yet</div></div>';
    return;
  }
  const isCredit = t => ['deposit','earning','refund','referral_reward','admin_credit'].includes(t.type);
  wrap.innerHTML = txns.sort((a,b)=>(b.created_at||0)-(a.created_at||0)).map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
      <div style="width:32px;height:32px;border-radius:50%;background:${isCredit(t)?'#d1fae5':'#fee2e2'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-arrow-${isCredit(t)?'down':'up'}" style="color:${isCredit(t)?'var(--success)':'var(--danger)'};font-size:.72rem"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.82rem;text-transform:capitalize">${(t.type||'—').replace(/_/g,' ')}</div>
        ${t.description ? `<div style="font-size:.72rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.description)}</div>` : ''}
        <div style="font-size:.7rem;color:var(--text-muted)">${formatDateTime(t.created_at)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:800;color:${isCredit(t)?'var(--success)':'var(--danger)'}">${isCredit(t)?'+':'-'} GHS ${(t.amount||0).toFixed(2)}</div>
        <span class="status-badge status-${t.status||'completed'}" style="font-size:.6rem">${t.status||'completed'}</span>
      </div>
    </div>
  `).join('');
}

function _apRenderEmbeddedStoreForPage(storeId, userId, products) {
  const wrap = document.getElementById('ap-v-store-preview');
  if (!wrap) return;
  const store = window._apCache?.[userId]?.store;
  const productsForPreview = (products || window._apCache?.[userId]?.products || []).filter(p=>p.is_available!==false).slice(0,8);
  wrap.innerHTML = `
    <div style="padding:0">
      <div style="height:140px;overflow:hidden;border-radius:var(--radius-md);margin-bottom:12px;background:linear-gradient(135deg,var(--primary-light),var(--primary))">
        ${store?.banner_url ? `<img src="${escHtml(store.banner_url)}" style="width:100%;height:100%;object-fit:cover">` : ''}
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
        <img src="${store?.logo_url||'https://placehold.co/64x64?text=Store'}" style="width:64px;height:64px;object-fit:cover;border-radius:var(--radius-md);flex-shrink:0;border:2px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:900;font-size:1.1rem">${escHtml(store?.name||'Store')}</div>
          <div style="font-size:.85rem;color:var(--text-muted)">${store?.location||''}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <span class="status-badge status-${store?.status||'active'}">${store?.status||'active'}</span>
            ${store?.is_paid ? '<span class="status-badge status-paid">Paid</span>' : ''}
          </div>
        </div>
      </div>
      <div style="font-size:.85rem;font-weight:900;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">Products in store</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${productsForPreview.map(p=>`
          <div style="aspect-ratio:1;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)">
            <img src="${(p.images||[])[0]||'https://placehold.co/80x80?text=P'}" style="width:100%;height:100%;object-fit:cover">
          </div>
        `).join('')}
      </div>
    </div>`;
}

// ── Tab switcher for full page mode ───────────────────────
function switchAdminProfileTab(type, tab) {
  if (type === 'vendor') {
    document.querySelectorAll('.ap-v-tab').forEach(btn => btn.classList.remove('active', 'btn-primary'));
    document.querySelectorAll('.ap-v-tab').forEach(btn => btn.classList.add('btn-ghost'));
    const activeBtn = document.querySelector('.ap-v-tab[data-tab="' + tab + '"]');
    if (activeBtn) {
      activeBtn.classList.remove('btn-ghost');
      activeBtn.classList.add('active', 'btn-primary');
    }
    document.querySelectorAll('.ap-v-tab-content').forEach(el => el.style.display = 'none');
    document.getElementById('ap-v-' + tab).style.display = 'block';
    
    // Re-render dynamic content when tab is selected
    if (tab === 'products') _apRenderVendorProductsForPage(window.currentAdminVendorId);
    if (tab === 'orders') _apRenderVendorPackagesForPage(window.currentAdminVendorId);
    if (tab === 'wallet') _apRenderUserTxnsForPage(window.currentAdminVendorId, null, 'ap-v-wallet-txns');
  } else if (type === 'rendor') {
    document.querySelectorAll('.ap-r-tab').forEach(btn => btn.classList.remove('active', 'btn-primary'));
    document.querySelectorAll('.ap-r-tab').forEach(btn => btn.classList.add('btn-ghost'));
    const activeBtn = document.querySelector('.ap-r-tab[data-tab="' + tab + '"]');
    if (activeBtn) {
      activeBtn.classList.remove('btn-ghost');
      activeBtn.classList.add('active', 'btn-primary');
    }
    document.querySelectorAll('.ap-r-tab-content').forEach(el => el.style.display = 'none');
    document.getElementById('ap-r-' + tab).style.display = 'block';
    
    // Re-render dynamic content when tab is selected
    if (tab === 'wallet') _apRenderUserTxnsForPage(window.currentAdminRendorId, null, 'ap-r-wallet-txns');
  }
}

/* ============================================================
   1. BUYER PROFILE PAGE
   ============================================================ */
async function adminOpenBuyerProfile(userId) {
  showAdminPanel(_apSkeleton('👤 Buyer Profile', '#1d4ed8'));

  // Pre-fetch everything in parallel
  const [userRes, txnRes] = await Promise.all([
    apiFetch('users/' + userId),
    apiGet('wallet_transactions', `search=${userId}&limit=50`)
  ]);

  const u = userRes || {};
  const txns = (txnRes?.data || []).filter(t => t.user_id === userId);

  // Keep cache so tab clicks never refetch
  window._apCache = window._apCache || {};
  window._apCache[userId] = { txns };

  const joinedDate = u.registered_at
    ? new Date(u.registered_at).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})
    : '—';
  const statusColor = {active:'var(--success)',suspended:'var(--danger)',pending_approval:'#7c3aed'}[u.status] || 'var(--text-muted)';
  const PANEL_ID = 'ap-buyer-modal';
  const nameSafe = escHtml(u.name||'').replace(/'/g,"\\'");

  showAdminPanel(`
<div class="ap-panel-inner" id="${PANEL_ID}">
  <div class="ap-panel-topbar" style="background:linear-gradient(135deg,#1d4ed8,#3b82f6)">
    <button class="ap-back-btn" onclick="closeAdminPanel()"><i class="fas fa-arrow-left"></i></button>
    <div class="ap-topbar-center">
      <div class="ap-topbar-name">${escHtml(u.name||'Unknown')}</div>
      <div class="ap-topbar-sub">${u.email||''}</div>
    </div>
    <div style="width:36px"></div>
  </div>
  <div class="ap-panel-body">
    <!-- Hero -->
    <div class="ap-identity-card" style="background:linear-gradient(135deg,#1d4ed8,#3b82f6)">
      <div class="ap-avatar" style="background:linear-gradient(135deg,#93c5fd,#60a5fa);overflow:hidden">
        ${u.avatar_url?`<img src="${escHtml(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`:(u.name||'?').charAt(0).toUpperCase()}
      </div>
      <div class="ap-identity-info">
        <div class="ap-identity-name">${escHtml(u.name||'Unknown')}</div>
        <div class="ap-identity-sub">${u.email||''}</div>
        <div class="ap-identity-pills">
          <span class="ap-role-badge" style="background:#dbeafe;color:#1e40af">Buyer</span>
          <span class="ap-status-pill" style="background:${statusColor}22;color:${statusColor}">${u.status||'active'}</span>
          ${u.is_verified?'<span class="ap-verify-pill">📱 Phone ✓</span>':''}
          ${u.id_verified?'<span class="ap-verify-pill">🪪 ID ✓</span>':''}
        </div>
      </div>
    </div>
    <!-- Stats -->
    <div class="ap-stats-strip">
      ${_apStat('fas fa-wallet','Wallet','GHS '+(u.wallet_balance||0).toFixed(2),'#7c3aed')}
      ${_apStat('fas fa-receipt','Transactions',txns.length,'#1d4ed8')}
    </div>
    <!-- Tabs -->
    <div class="ap-tab-nav">
      <button class="ap-tab-btn active" onclick="_apSwitch(this,'ab-info','${PANEL_ID}')">Info</button>
      <button class="ap-tab-btn" onclick="_apSwitch(this,'ab-wallet','${PANEL_ID}');_apRenderUserTxns('${userId}','ab-txn-body-')">Wallet</button>
      <button class="ap-tab-btn" onclick="_apSwitch(this,'ab-actions','${PANEL_ID}')">⚙️ Actions</button>
    </div>
    <!-- INFO -->
    <div class="ap-tab-pane" id="ab-info">
      <div class="ap-pane-body">
        <div class="ap-section-title">Account Info</div>
        ${_apRow('Full Name',escHtml(u.name))}
        ${_apRow('Email',escHtml(u.email))}
        ${_apRow('Phone',escHtml(u.phone))}
        ${_apRow('Location',escHtml(u.location))}
        ${_apRow('Joined',joinedDate)}
        ${_apRow('Referral Code',u.referral_code?'<code>'+u.referral_code+'</code>':'')}
        <div class="ap-section-title" style="margin-top:18px">Verification</div>
        ${_apRow('Phone Verified',u.is_verified?'✅ Yes':'❌ No')}
        ${_apRow('ID Verified',u.id_verified?'✅ Yes':'❌ No')}
        ${_apRow('Account Status','<span style="color:'+statusColor+';font-weight:800">'+(u.status||'active')+'</span>')}
        <div class="ap-section-title" style="margin-top:18px">Edit Account Info</div>
        <form onsubmit="event.preventDefault();_apSaveBuyerInfo('${userId}',this)">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input class="form-control" name="name" value="${escHtml(u.name||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-control" name="phone" value="${escHtml(u.phone||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Location</label>
            <select class="form-control form-select" name="location">
              ${LOCATIONS.map(l=>`<option value="${l}" ${l===u.location?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-block" type="submit" style="margin-bottom:20px"><i class="fas fa-save"></i> Save Changes</button>
        </form>
        <div style="height:1px;background:var(--border);margin:16px 0"></div>
        <div class="ap-section-title">⚙️ Account Controls</div>
        <div class="ap-action-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">
          ${_apBtn('ap-action-blue','fas fa-bell','Send Notification',
            'closeAdminPanel();setTimeout(()=>showSendNotificationModal(\''+userId+'\',\''+nameSafe+'\'),300)')}
          ${_apBtn('ap-action-purple','fas fa-wallet','Adjust Wallet',
            'closeAdminPanel();setTimeout(()=>adjustUserWallet(\''+userId+'\',\''+nameSafe+'\','+(u.wallet_balance||0)+'),300)')}
          ${u.is_verified
            ? _apBtn('ap-action-gray','fas fa-phone-slash','Revoke Phone','_apRevokePhoneVerify(\''+userId+'\')')
            : _apBtn('ap-action-green','fas fa-phone','Verify Phone','_apGrantPhoneVerify(\''+userId+'\')')}
          ${u.id_verified
            ? _apBtn('ap-action-gray','fas fa-id-card-alt','Revoke ID','_apRevokeIdVerify(\''+userId+'\')')
            : _apBtn('ap-action-green','fas fa-id-card','Verify ID','_apGrantIdVerify(\''+userId+'\')')}
          ${u.status==='active'
            ? _apBtn('ap-action-red','fas fa-ban','Suspend Account','_apSuspendUser(\''+userId+'\')')
            : _apBtn('ap-action-green','fas fa-check-circle','Activate Account','_apActivateUser(\''+userId+'\')')}
        </div>
        ${_apRoleSection(userId,u.role||'buyer')}
        ${_apPasswordSection(userId)}
        ${_apDangerZone(userId,u.name)}
      </div>
    </div>
    <!-- WALLET -->
    <div class="ap-tab-pane" id="ab-wallet" style="display:none">
      <div class="ap-pane-body">
        <div class="ap-wallet-hero">
          <div class="ap-wallet-label">Wallet Balance</div>
          <div class="ap-wallet-amount">GHS ${(u.wallet_balance||0).toFixed(2)}</div>
        </div>
        <button class="btn btn-outline btn-block" style="margin-bottom:14px"
                onclick="closeAdminPanel();setTimeout(()=>adjustUserWallet('${userId}','${nameSafe}',${u.wallet_balance||0}),300)">
          <i class="fas fa-sliders-h"></i> Adjust Wallet
        </button>
        <div class="ap-section-title">Transaction History</div>
        <div id="ab-txn-body-${userId}">
          <div class="ap-loading-placeholder"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
        </div>
      </div>
    </div>
    <!-- ACTIONS -->
    <div class="ap-tab-pane" id="ab-actions" style="display:none">
      <div class="ap-pane-body">
        <div class="ap-section-title">Account Controls</div>
        <div class="ap-action-grid">
          ${_apBtn('ap-action-blue','fas fa-bell','Send Notification',
            'closeAdminPanel();setTimeout(()=>showSendNotificationModal(\''+userId+'\',\''+nameSafe+'\'),300)')}
          ${_apBtn('ap-action-purple','fas fa-wallet','Adjust Wallet',
            'closeAdminPanel();setTimeout(()=>adjustUserWallet(\''+userId+'\',\''+nameSafe+'\','+(u.wallet_balance||0)+'),300)')}
          ${u.is_verified
            ? _apBtn('ap-action-gray','fas fa-phone-slash','Revoke Phone','_apRevokePhoneVerify(\''+userId+'\')')
            : _apBtn('ap-action-green','fas fa-phone','Verify Phone','_apGrantPhoneVerify(\''+userId+'\')')}
          ${u.id_verified
            ? _apBtn('ap-action-gray','fas fa-id-card-alt','Revoke ID','_apRevokeIdVerify(\''+userId+'\')')
            : _apBtn('ap-action-green','fas fa-id-card','Verify ID','_apGrantIdVerify(\''+userId+'\')')}
          ${u.status==='active'
            ? _apBtn('ap-action-red','fas fa-ban','Suspend Account','_apSuspendUser(\''+userId+'\')')
            : _apBtn('ap-action-green','fas fa-check-circle','Activate Account','_apActivateUser(\''+userId+'\')')}
        </div>
        ${_apRoleSection(userId,u.role||'buyer')}
        ${_apPasswordSection(userId)}
        ${_apDangerZone(userId,u.name)}
      </div>
    </div>
  </div>
</div>`);

  // Pre-render transactions immediately
  _apRenderUserTxns(userId, txns, 'ab-txn-body-');
}

/* ============================================================
   2. VENDOR PROFILE PAGE
   ============================================================ */
async function adminOpenVendorProfile(userId) {
  // Store userId for later use
  window.currentAdminVendorId = userId;
  
  // Show loading state
  document.getElementById('admin-vendor-profile-content').innerHTML = `
    <div style="text-align:center;padding:40px;color:var(--text-muted)">
      <i class="fas fa-spinner fa-spin"></i> Loading…
    </div>`;
  showPage('admin-vendor-profile');

  try {
    // Step 1: fetch user + store + orders + txns first so we have store.id for the products query
    const [userRes, storeRes, pkgsRes, txnRes] = await Promise.all([
      apiFetch('users/' + userId),
      apiGet('stores',              'search=' + userId + '&limit=10'),
      apiGet('packages',            'search=' + userId + '&limit=100'),
      apiGet('wallet_transactions', 'search=' + userId + '&limit=50')
    ]);

    const u     = userRes || {};
    const store = (storeRes?.data || []).find(s => String(s.vendor_id) === String(userId)) || null;
    const pkgs  = (pkgsRes?.data  || []).filter(p => String(p.vendor_id) === String(userId));
    const txns  = (txnRes?.data   || []).filter(t => String(t.user_id)   === String(userId));

    // Step 2: fetch products by vendor_id AND by store_id in parallel, then merge + deduplicate.
    const [prodByVendor, prodByStore] = await Promise.all([
      apiGet('products', 'search=' + userId + '&limit=200'),
      store ? apiGet('products', 'search=' + store.id + '&limit=200') : Promise.resolve(null)
    ]);
    const _seenProductIds = new Set();
    const products = [
      ...(prodByVendor?.data || []),
      ...(prodByStore?.data  || [])
    ].filter(p => {
      const belongs = String(p.vendor_id) === String(userId) || (store && String(p.store_id) === String(store.id));
      if (!belongs || _seenProductIds.has(p.id)) return false;
      _seenProductIds.add(p.id);
      return true;
    });

    // ── cache closures so tab clicks never re-fetch ───────────
    window._apCache = window._apCache || {};
    window._apCache[userId] = { pkgs, txns, products, store };

    const totalSales  = pkgs.filter(p=>['delivered','confirmed'].includes(p.status)).reduce((s,p)=>s+(parseFloat(p.gross_amount)||0),0);
    const pendingPkgs = pkgs.filter(p=>p.status==='pending').length;
    
    let joinedDate = '—';
    if (u.registered_at) {
      try {
        const d = new Date(u.registered_at);
        if (!isNaN(d.getTime())) {
          joinedDate = d.toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
        }
      } catch(e) {}
    }

    const statusColor = {active:'var(--success)',suspended:'var(--danger)',pending_approval:'#b45309'}[u.status] || 'var(--text-muted)';
    const nameSafe    = escHtml(u.name||'').replace(/'/g,"\\'");

    // Render into the page content div
    document.getElementById('admin-vendor-profile-content').innerHTML = `
<div style="padding:10px 14px 24px">
  <!-- Hero -->
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:18px;border-radius:var(--radius-md);margin-bottom:16px;overflow:hidden">
    <div style="display:flex;gap:12px;align-items:center;min-width:0">
      <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--primary),#ff8c42);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.6rem;color:white;overflow:hidden;flex-shrink:0">
        ${store?.logo_url
          ? `<img src="${escHtml(store.logo_url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`
          : (u.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-weight:900;font-size:1.15rem;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.name || 'Unknown')}</div>
        <div style="color:rgba(255,255,255,.75);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.email || ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <span style="background:#fffbea;color:#b45309;padding:3px 8px;border-radius:100px;font-weight:800;font-size:.7rem">Vendor</span>
          <span style="background:${statusColor}22;color:${statusColor};padding:3px 8px;border-radius:100px;font-weight:800;font-size:.7rem">${u.status||'active'}</span>
          ${u.is_verified ? '<span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:100px;font-weight:700;font-size:.7rem"><i class="fas fa-check"></i> Phone</span>' : ''}
          ${u.id_verified ? '<span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:100px;font-weight:700;font-size:.7rem"><i class="fas fa-id-card"></i> ID</span>' : ''}
          ${store?.status==='active' ? '<span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:100px;font-weight:700;font-size:.7rem"><i class="fas fa-store"></i> Store Live</span>' : ''}
        </div>
      </div>
    </div>
    ${store ? `<div style="margin-top:10px;font-size:.85rem;color:rgba(255,255,255,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="fas fa-store"></i> ${escHtml(store.name)}</div>` : ''}
  </div>

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
    ${_apStat('fas fa-box', 'Orders', pkgs.length, 'var(--primary)')}
    ${_apStat('fas fa-money-bill-wave', 'Sales', 'GHS ' + totalSales.toFixed(0), 'var(--success)')}
    ${_apStat('fas fa-wallet', 'Wallet', 'GHS ' + (u.wallet_balance||0).toFixed(2), '#7c3aed')}
    ${_apStat('fas fa-cube', 'Products', products.length, '#b45309')}
  </div>

  <!-- Tabs -->
  <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:14px;padding-bottom:6px">
    <button class="btn btn-primary btn-sm ap-v-tab active" data-tab="info" onclick="switchAdminProfileTab('vendor','info')">Info</button>
    <button class="btn btn-ghost btn-sm ap-v-tab" data-tab="store" onclick="switchAdminProfileTab('vendor','store')">Store</button>
    <button class="btn btn-ghost btn-sm ap-v-tab" data-tab="products" onclick="switchAdminProfileTab('vendor','products')">Products${products.length?' <span class="ap-badge">'+products.length+'</span>':''}</button>
    <button class="btn btn-ghost btn-sm ap-v-tab" data-tab="orders" onclick="switchAdminProfileTab('vendor','orders')">Orders${pendingPkgs?' <span class="ap-badge">'+pendingPkgs+'</span>':''}</button>
    <button class="btn btn-ghost btn-sm ap-v-tab" data-tab="wallet" onclick="switchAdminProfileTab('vendor','wallet')">Wallet</button>
    <button class="btn btn-ghost btn-sm ap-v-tab" data-tab="actions" onclick="switchAdminProfileTab('vendor','actions')">⚙️ Actions</button>
  </div>

  <!-- Tab Contents -->
  <div class="ap-v-tab-content" id="ap-v-info">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Account Info</div>
      ${_apRow('Full Name', escHtml(u.name))}
      ${_apRow('Email', escHtml(u.email))}
      ${_apRow('Phone', escHtml(u.phone))}
      ${_apRow('Location', escHtml(u.location))}
      ${_apRow('Joined', joinedDate)}
      ${_apRow('Referral Code', u.referral_code ? '<code>' + u.referral_code + '</code>' : '')}
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Verification</div>
      ${_apRow('Phone Verified', u.is_verified ? '✅ Yes' : '❌ No')}
      ${_apRow('ID Verified', u.id_verified ? '✅ Yes' : '❌ No')}
      ${_apRow('Account Status', '<span style="color:' + statusColor + ';font-weight:800">' + (u.status||'active') + '</span>')}
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Edit Account Info</div>
      <form onsubmit="event.preventDefault();_apSaveBuyerInfo('${userId}',this)">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-control" name="name" value="${escHtml(u.name||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-control" name="phone" value="${escHtml(u.phone||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Location</label>
          <select class="form-control form-select" name="location">
            ${LOCATIONS.map(l=>`<option value="${l}" ${l===u.location?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-bottom:20px"><i class="fas fa-save"></i> Save Changes</button>
      </form>
      <div style="height:1px;background:var(--border);margin:16px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚙️ Account Controls</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">
        ${_apBtn('ap-action-blue','fas fa-bell','Send Notification','showSendNotificationModal(\'' + userId + '\',\'' + nameSafe + '\')')}
        ${_apBtn('ap-action-purple','fas fa-wallet','Adjust Wallet','setTimeout(()=>adjustUserWallet(\'' + userId + '\',\'' + nameSafe + '\',' + (u.wallet_balance||0) + '),100)')}
        ${u.is_verified
          ? _apBtn('ap-action-gray','fas fa-phone-slash','Revoke Phone','_apRevokePhoneVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-phone','Verify Phone','_apGrantPhoneVerify(\'' + userId + '\')')}
        ${u.id_verified
          ? _apBtn('ap-action-gray','fas fa-id-card-alt','Revoke ID','_apRevokeIdVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-id-card','Verify ID','_apGrantIdVerify(\'' + userId + '\')')}
        ${u.status === 'active'
          ? _apBtn('ap-action-red','fas fa-ban','Suspend Account','_apSuspendUser(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-check-circle','Activate Account','_apActivateUser(\'' + userId + '\')')}
        ${_apBtn('ap-action-teal','fas fa-eye','Preview as Vendor','setTimeout(()=>previewAsRole(\'vendor\'),100)')}
      </div>
      ${_apRoleSection(userId, u.role||'vendor')}
      ${_apPasswordSection(userId)}
      <div style="height:1px;background:var(--border);margin:16px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--danger);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚠️ Danger Zone</div>
      <div style="background:#fee2e2;padding:12px;border-radius:var(--radius-md);border:1px solid #fca5a5">
        <button class="btn btn-danger btn-block" onclick="if(confirm('Are you ABSOLUTELY sure you want to delete ${nameSafe||'this user'}? This CANNOT be undone!'))_apDeleteUser('${userId}')">
          <i class="fas fa-user-slash"></i> Delete User Account
        </button>
      </div>
    </div>
  </div>

  <div class="ap-v-tab-content" id="ap-v-store" style="display:none">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      ${store ? `
        ${store.banner_url ? `<img src="${escHtml(store.banner_url)}" style="width:100%;height:120px;object-fit:cover;border-radius:var(--radius-md);margin-bottom:12px" onerror="this.style.display='none'">` : ''}

        <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Store Overview</div>
        ${_apRow('Store Name', escHtml(store.name))}
        ${_apRow('Category', escHtml(store.category||'General'))}
        ${_apRow('Location', escHtml(store.location))}
        ${_apRow('Status', '<span class="status-badge status-' + store.status + '">' + store.status + '</span>')}
        ${_apRow('Store Price', 'GHS ' + (store.store_price||0).toFixed(2))}
        ${_apRow('Paid', store.is_paid ? '✅ Yes' : '❌ No')}
        ${_apRow('Total Orders', '' + (store.total_orders||0))}
        ${_apRow('Total Sales', 'GHS ' + (store.total_sales||0).toLocaleString())}
        ${_apRow('Rating', store.avg_rating ? store.avg_rating.toFixed(1) + ' ★ (' + store.review_count + ')' : '—')}
        <div style="margin-top:14px">
          <button class="btn btn-block" style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border:none" onclick="closeAdminPanel();setTimeout(()=>openStore('${store.id}'),300)">
            <i class="fas fa-store"></i> View Live Storefront
          </button>
        </div>
        <div style="height:1px;background:var(--border);margin:14px 0"></div>
        <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Store Controls</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${store.status==='active'
            ? '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="suspendStore(\'' + store.id + '\')"><i class="fas fa-ban"></i> Suspend Store</button>'
            : '<button class="btn btn-success btn-sm" onclick="activateStore(\'' + store.id + '\')"><i class="fas fa-check"></i> Activate Store</button>'}
          ${!store.is_paid ? '<button class="btn btn-primary btn-sm" onclick="_apMarkStorePaid(\'' + store.id + '\')"><i class="fas fa-check-circle"></i> Mark Paid</button>' : ''}
          <button class="btn btn-ghost btn-sm" onclick="showHandoverModal('${store.id}','${escHtml(u.email||'')}')">
            <i class="fas fa-exchange-alt"></i> Re-assign Store
          </button>
        </div>
        <div style="height:1px;background:var(--border);margin:14px 0"></div>
        <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Edit Store Details</div>
        <form onsubmit="event.preventDefault();_apSaveStore('${store.id}',this)">
          <div class="form-group">
            <label class="form-label">Store Name</label>
            <input class="form-control" name="name" value="${escHtml(store.name||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-control" name="description" rows="2">${escHtml(store.description||'')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <select class="form-control form-select" name="category">
              ${CATEGORIES.map(c=>`<option value="${c}" ${c===store.category?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Location</label>
            <select class="form-control form-select" name="location">
              ${LOCATIONS.map(l=>`<option value="${l}" ${l===store.location?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Keywords / Tags <span style="font-size:.72rem;color:var(--text-muted)">(comma-separated)</span></label>
            <input class="form-control" name="keywords" value="${escHtml((store.keywords||[]).join?store.keywords.join(', '):store.keywords||'')}" placeholder="e.g., shoes, fashion, accessories">
          </div>
          <div class="form-group">
            <label class="form-label">Logo Image URL</label>
            <input class="form-control" name="logo_url" value="${escHtml(store.logo_url||'')}" placeholder="https://…">
            ${store.logo_url ? '<img src="' + escHtml(store.logo_url) + '" style="width:48px;height:48px;object-fit:cover;border-radius:50%;margin-top:6px;border:2px solid var(--border)" onerror="this.style.display=\'none\'">' : ''}
          </div>
          <div class="form-group">
            <label class="form-label">Banner Image URL</label>
            <input class="form-control" name="banner_url" value="${escHtml(store.banner_url||'')}" placeholder="https://…">
            ${store.banner_url ? '<img src="' + escHtml(store.banner_url) + '" style="width:100%;height:60px;object-fit:cover;border-radius:var(--radius-sm);margin-top:6px" onerror="this.style.display=\'none\'">' : ''}
          </div>
          <div class="form-group">
            <label class="form-label">Store Price (GHS)</label>
            <input class="form-control" name="store_price" type="number" min="0" value="${store.store_price||0}">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="is_paid" ${store.is_paid?'checked':''} style="width:16px;height:16px">
              Mark Store as Paid
            </label>
          </div>
          <button class="btn btn-primary btn-block" type="submit"><i class="fas fa-save"></i> Save Store</button>
        </form>
        <div style="height:1px;background:var(--border);margin:20px 0"></div>
        <div style="font-weight:900;margin-bottom:12px;color:var(--danger);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚠️ Danger Zone</div>
        <button class="btn btn-danger btn-block" onclick="if(confirm('Are you ABSOLUTELY sure you want to delete this store PERMANENTLY?'))_apDeleteStore('${store.id}','${nameSafe}')">
          <i class="fas fa-trash-alt"></i> Delete Store Permanently
        </button>
      ` : `
        <div style="text-align:center;padding:30px;color:var(--text-muted)">
          <i class="fas fa-store-slash" style="font-size:2.5rem;margin-bottom:10px"></i>
          <div style="font-weight:800;font-size:1.1rem">No Store Yet</div>
          <div style="font-size:.9rem;margin-top:6px">This vendor has not been assigned a store.</div>
          <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="switchTab(document.querySelector('[onclick*=admin-create-store]'),'admin-create-store');showPage('admin-dashboard')">
            <i class="fas fa-plus"></i> Create Store for Vendor
          </button>
        </div>
      `}
    </div>
  </div>

  <div class="ap-v-tab-content" id="ap-v-products" style="display:none">
    <div id="ap-v-products-wrap"></div>
  </div>

  <div class="ap-v-tab-content" id="ap-v-orders" style="display:none">
    <div id="ap-v-orders-wrap"></div>
  </div>

  <div class="ap-v-tab-content" id="ap-v-wallet" style="display:none">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="background:linear-gradient(135deg,var(--secondary),#16213e);padding:18px;border-radius:var(--radius-md);text-align:center;color:white;margin-bottom:14px">
        <div style="font-size:.85rem;opacity:.8">Wallet Balance</div>
        <div style="font-size:2rem;font-weight:900;margin-top:4px">GHS ${(u.wallet_balance||0).toFixed(2)}</div>
      </div>
      <button class="btn btn-outline btn-block" onclick="setTimeout(()=>adjustUserWallet('${userId}','${nameSafe}',${u.wallet_balance||0}),100)">
        <i class="fas fa-sliders-h"></i> Adjust Wallet
      </button>
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Transaction History</div>
      <div id="ap-v-wallet-txns"></div>
    </div>
  </div>

  <div class="ap-v-tab-content" id="ap-v-actions" style="display:none">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Account Controls</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        ${_apBtn('ap-action-blue','fas fa-bell','Send Notification','showSendNotificationModal(\'' + userId + '\',\'' + nameSafe + '\')')}
        ${_apBtn('ap-action-purple','fas fa-wallet','Adjust Wallet','setTimeout(()=>adjustUserWallet(\'' + userId + '\',\'' + nameSafe + '\',' + (u.wallet_balance||0) + '),100)')}
        ${u.is_verified
          ? _apBtn('ap-action-gray','fas fa-phone-slash','Revoke Phone','_apRevokePhoneVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-phone','Verify Phone','_apGrantPhoneVerify(\'' + userId + '\')')}
        ${u.id_verified
          ? _apBtn('ap-action-gray','fas fa-id-card-alt','Revoke ID','_apRevokeIdVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-id-card','Verify ID','_apGrantIdVerify(\'' + userId + '\')')}
        ${u.status === 'active'
          ? _apBtn('ap-action-red','fas fa-ban','Suspend Account','_apSuspendUser(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-check-circle','Activate Account','_apActivateUser(\'' + userId + '\')')}
        ${_apBtn('ap-action-teal','fas fa-eye','Preview as Vendor','setTimeout(()=>previewAsRole(\'vendor\'),100)')}
      </div>
      ${_apRoleSection(userId, u.role||'vendor')}
      ${_apPasswordSection(userId)}
      <div style="height:1px;background:var(--border);margin:16px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--danger);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚠️ Danger Zone</div>
      <div style="background:#fee2e2;padding:12px;border-radius:var(--radius-md);border:1px solid #fca5a5">
        <button class="btn btn-danger btn-block" onclick="if(confirm('Are you ABSOLUTELY sure you want to delete ${nameSafe||'this user'}? This CANNOT be undone!'))_apDeleteUser('${userId}')">
          <i class="fas fa-user-slash"></i> Delete User Account
        </button>
      </div>
    </div>
  </div>

  ${store ? `
  <div style="margin-top:16px;background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
    <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem"><i class="fas fa-store"></i> Live Storefront - ${escHtml(store.name)}</div>
    <div id="ap-v-store-preview"></div>
  </div>
  ` : ''}
</div>`;

    // Pre-render cached content immediately
    _apRenderVendorProductsForPage(userId, products);
    _apRenderVendorPackagesForPage(userId, pkgs);
    _apRenderUserTxnsForPage(userId, txns, 'ap-v-wallet-txns');
    if (store) _apRenderEmbeddedStoreForPage(store.id, userId, products);
  } catch (err) {
    console.error('[Admin Vendor Profile Error]', err);
    document.getElementById('admin-vendor-profile-content').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--danger)">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem;margin-bottom:12px"></i>
        <h3>Failed to load Vendor Profile</h3>
        <p style="font-size:.85rem;color:var(--text-muted);margin:8px 0 20px">${escHtml(err.message || 'Unknown error')}</p>
        <button class="btn btn-outline btn-sm" onclick="showPage('admin-dashboard')">
          <i class="fas fa-arrow-left"></i> Back to Dashboard
        </button>
      </div>`;
  }
}

/* ============================================================
   3. RENDOR PROFILE PAGE
   ============================================================ */
async function adminOpenRendorProfile(userId) {
  // Store userId for later use
  window.currentAdminRendorId = userId;
  
  // Show loading state
  document.getElementById('admin-rendor-profile-content').innerHTML = `
    <div style="text-align:center;padding:40px;color:var(--text-muted)">
      <i class="fas fa-spinner fa-spin"></i> Loading…
    </div>`;
  showPage('admin-rendor-profile');

  const [userRes, txnRes] = await Promise.all([
    apiFetch('users/' + userId),
    apiGet('wallet_transactions', 'search=' + userId + '&limit=50')
  ]);

  const u = userRes || {};
  const txns = (txnRes?.data || []).filter(t => t.user_id === userId);

  window._apCache = window._apCache || {};
  window._apCache[userId] = { txns };

  const joinedDate = u.registered_at
    ? new Date(u.registered_at).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})
    : '—';
  const statusColor = {active:'var(--success)',suspended:'var(--danger)',pending_approval:'#7c3aed'}[u.status] || 'var(--text-muted)';
  const nameSafe = escHtml(u.name||'').replace(/'/g,"\\'");

  // Subscription status
  const subStatus = u.rendor_sub_status || null;
  const subExpiry = u.rendor_sub_expiry ? new Date(Number(u.rendor_sub_expiry)) : null;
  const subActive = subStatus === 'active' && subExpiry && subExpiry > new Date();

  // Render into the page content div
  document.getElementById('admin-rendor-profile-content').innerHTML = `
<div style="padding:10px 14px 24px">
  <!-- Hero -->
  <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);padding:18px;border-radius:var(--radius-md);margin-bottom:16px;overflow:hidden">
    <div style="display:flex;gap:12px;align-items:center;min-width:0">
      <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.6rem;color:white;flex-shrink:0">
        ${(u.name||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-weight:900;font-size:1.15rem;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.rendor_display_name || u.name || 'Unknown')}</div>
        <div style="color:rgba(255,255,255,.75);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.email || ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <span style="background:#ede9fe;color:#4c1d95;padding:3px 8px;border-radius:100px;font-weight:800;font-size:.7rem">Rendor</span>
          <span style="background:${statusColor}22;color:${statusColor};padding:3px 8px;border-radius:100px;font-weight:800;font-size:.7rem">${u.status||'active'}</span>
          ${u.is_verified ? '<span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:100px;font-weight:700;font-size:.7rem"><i class="fas fa-check"></i> Phone</span>' : ''}
          ${u.id_verified ? '<span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:100px;font-weight:700;font-size:.7rem"><i class="fas fa-id-card"></i> ID</span>' : ''}
          ${subActive ? '<span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:100px;font-weight:700;font-size:.7rem"><i class="fas fa-star"></i> Sub Active</span>' : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
    ${_apStat('fas fa-briefcase','Service',escHtml(u.rendor_service_cat||'—'),'#7c3aed')}
    ${_apStat('fas fa-money-bill-wave','Wallet','GHS ' + (u.wallet_balance||0).toFixed(2),'#b45309')}
    ${_apStat('fas fa-star','Sub',subActive?'Active':'Inactive',subActive?'#059669':'#dc2626')}
  </div>

  <!-- Tabs -->
  <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:14px;padding-bottom:6px">
    <button class="btn btn-primary btn-sm ap-r-tab active" data-tab="info" onclick="switchAdminProfileTab('rendor','info')">Info</button>
    <button class="btn btn-ghost btn-sm ap-r-tab" data-tab="wallet" onclick="switchAdminProfileTab('rendor','wallet')">Wallet</button>
    <button class="btn btn-ghost btn-sm ap-r-tab" data-tab="actions" onclick="switchAdminProfileTab('rendor','actions')">⚙️ Actions</button>
  </div>

  <!-- Tab Contents -->
  <div class="ap-r-tab-content" id="ap-r-info">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Account Info</div>
      ${_apRow('Full Name', escHtml(u.name))}
      ${_apRow('Email', escHtml(u.email))}
      ${_apRow('Phone', escHtml(u.phone))}
      ${_apRow('Location', escHtml(u.location))}
      ${_apRow('Joined', joinedDate)}
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Rendor Details</div>
      ${_apRow('Display Name', escHtml(u.rendor_display_name||'—'))}
      ${_apRow('Service Category', escHtml(u.rendor_service_cat||'—'))}
      ${_apRow('Starting Price', u.rendor_starting_price ? 'GHS '+parseFloat(u.rendor_starting_price).toFixed(2) : '—')}
      ${u.rendor_bio ? `<div style="margin-top:12px;background:var(--primary-light);padding:12px;border-radius:var(--radius-md);font-size:.9rem"><strong>Bio:</strong> ${escHtml(u.rendor_bio)}</div>` : ''}
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Verification</div>
      ${_apRow('Phone Verified', u.is_verified ? '✅ Yes' : '❌ No')}
      ${_apRow('ID Verified', u.id_verified ? '✅ Yes' : '❌ No')}
      ${_apRow('Account Status', '<span style="color:' + statusColor + ';font-weight:800">' + (u.status||'active') + '</span>')}
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Edit Account Info</div>
      <form onsubmit="event.preventDefault();_apSaveBuyerInfo('${userId}',this)">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-control" name="name" value="${escHtml(u.name||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-control" name="phone" value="${escHtml(u.phone||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Location</label>
          <select class="form-control form-select" name="location">
            ${LOCATIONS.map(l=>`<option value="${l}" ${l===u.location?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-bottom:20px"><i class="fas fa-save"></i> Save Changes</button>
      </form>
      <div style="height:1px;background:var(--border);margin:16px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚙️ Account Controls</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">
        ${_apBtn('ap-action-blue','fas fa-bell','Send Notification','showSendNotificationModal(\'' + userId + '\',\'' + nameSafe + '\')')}
        ${_apBtn('ap-action-purple','fas fa-wallet','Adjust Wallet','setTimeout(()=>adjustUserWallet(\'' + userId + '\',\'' + nameSafe + '\',' + (u.wallet_balance||0) + '),100)')}
        ${u.is_verified
          ? _apBtn('ap-action-gray','fas fa-phone-slash','Revoke Phone','_apRevokePhoneVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-phone','Verify Phone','_apGrantPhoneVerify(\'' + userId + '\')')}
        ${u.id_verified
          ? _apBtn('ap-action-gray','fas fa-id-card-alt','Revoke ID','_apRevokeIdVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-id-card','Verify ID','_apGrantIdVerify(\'' + userId + '\')')}
        ${u.status === 'active'
          ? _apBtn('ap-action-red','fas fa-ban','Suspend Account','_apSuspendUser(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-check-circle','Activate Account','_apActivateUser(\'' + userId + '\')')}
        ${subActive
          ? _apBtn('ap-action-gray','fas fa-star-slash','Deactivate Sub','adminDeactivateRendorSub(\'' + userId + '\')')
          : _apBtn('ap-action-purple','fas fa-star','Activate Sub','adminActivateRendorSub(\'' + userId + '\',\'' + nameSafe + '\')')}
        ${_apBtn('ap-action-teal','fas fa-eye','View Public Profile','setTimeout(()=>{App.currentRendorId=\'' + userId + '\';showPage(\'rendor-profile\');renderRendorProfilePublic();},100)')}
      </div>
      ${_apRoleSection(userId, u.role||'rendor')}
      ${_apPasswordSection(userId)}
      <div style="height:1px;background:var(--border);margin:16px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--danger);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚠️ Danger Zone</div>
      <div style="background:#fee2e2;padding:12px;border-radius:var(--radius-md);border:1px solid #fca5a5">
        <button class="btn btn-danger btn-block" onclick="if(confirm('Are you ABSOLUTELY sure you want to delete ${nameSafe||'this user'}? This CANNOT be undone!'))_apDeleteUser('${userId}')">
          <i class="fas fa-user-slash"></i> Delete User Account
        </button>
      </div>
    </div>
  </div>

  <div class="ap-r-tab-content" id="ap-r-wallet" style="display:none">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);padding:18px;border-radius:var(--radius-md);text-align:center;color:white;margin-bottom:14px">
        <div style="font-size:.85rem;opacity:.8">Wallet Balance</div>
        <div style="font-size:2rem;font-weight:900;margin-top:4px">GHS ${(u.wallet_balance||0).toFixed(2)}</div>
      </div>
      <button class="btn btn-outline btn-block" onclick="setTimeout(()=>adjustUserWallet('${userId}','${nameSafe}',${u.wallet_balance||0}),100)">
        <i class="fas fa-sliders-h"></i> Adjust Wallet
      </button>
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Transaction History</div>
      <div id="ap-r-wallet-txns"></div>
    </div>
  </div>

  <div class="ap-r-tab-content" id="ap-r-actions" style="display:none">
    <div style="background:white;border-radius:var(--radius-md);padding:14px;border:1px solid var(--border)">
      <div style="font-weight:900;margin-bottom:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">Account Controls</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        ${_apBtn('ap-action-blue','fas fa-bell','Send Notification','showSendNotificationModal(\'' + userId + '\',\'' + nameSafe + '\')')}
        ${_apBtn('ap-action-purple','fas fa-wallet','Adjust Wallet','setTimeout(()=>adjustUserWallet(\'' + userId + '\',\'' + nameSafe + '\',' + (u.wallet_balance||0) + '),100)')}
        ${u.is_verified
          ? _apBtn('ap-action-gray','fas fa-phone-slash','Revoke Phone','_apRevokePhoneVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-phone','Verify Phone','_apGrantPhoneVerify(\'' + userId + '\')')}
        ${u.id_verified
          ? _apBtn('ap-action-gray','fas fa-id-card-alt','Revoke ID','_apRevokeIdVerify(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-id-card','Verify ID','_apGrantIdVerify(\'' + userId + '\')')}
        ${u.status === 'active'
          ? _apBtn('ap-action-red','fas fa-ban','Suspend Account','_apSuspendUser(\'' + userId + '\')')
          : _apBtn('ap-action-green','fas fa-check-circle','Activate Account','_apActivateUser(\'' + userId + '\')')}
        ${subActive
          ? _apBtn('ap-action-gray','fas fa-star-slash','Deactivate Sub','adminDeactivateRendorSub(\'' + userId + '\')')
          : _apBtn('ap-action-purple','fas fa-star','Activate Sub','adminActivateRendorSub(\'' + userId + '\',\'' + nameSafe + '\')')}
        ${_apBtn('ap-action-teal','fas fa-eye','View Public Profile','setTimeout(()=>{App.currentRendorId=\'' + userId + '\';showPage(\'rendor-profile\');renderRendorProfilePublic();},100)')}
      </div>
      ${_apRoleSection(userId, u.role||'rendor')}
      ${_apPasswordSection(userId)}
      <div style="height:1px;background:var(--border);margin:16px 0"></div>
      <div style="font-weight:900;margin-bottom:12px;color:var(--danger);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem">⚠️ Danger Zone</div>
      <div style="background:#fee2e2;padding:12px;border-radius:var(--radius-md);border:1px solid #fca5a5">
        <button class="btn btn-danger btn-block" onclick="if(confirm('Are you ABSOLUTELY sure you want to delete ${nameSafe||'this user'}? This CANNOT be undone!'))_apDeleteUser('${userId}')">
          <i class="fas fa-user-slash"></i> Delete User Account
        </button>
      </div>
    </div>
  </div>
</div>`;

  _apRenderUserTxnsForPage(userId, txns, 'ap-r-wallet-txns');
}
