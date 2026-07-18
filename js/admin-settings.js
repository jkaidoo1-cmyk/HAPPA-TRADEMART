/* ============================================================
   HAPPA TRADEMART — Admin Settings Module
   Full settings load / save for all 6 categories + commission tiers
   ============================================================ */

// All settings keys with their defaults and input type
const SETTINGS_CONFIG = [
  { key: 'delivery_fee_local',         id: 'setting-delivery-local',             type: 'number',   default: '5'    },
  { key: 'delivery_fee_intercity',     id: 'setting-delivery-intercity',         type: 'number',   default: '15'   },
  // Wallet & Withdrawals
  { key: 'min_withdrawal',             id: 'setting-min-withdrawal',             type: 'number',   default: '50'   },
  { key: 'max_pending_withdrawals',    id: 'setting-max-pending-withdrawals',    type: 'number',   default: '3'    },
  { key: 'withdrawal_days',            id: 'setting-withdrawal-days',            type: 'number',   default: '2'    },
  // Referral
  { key: 'referral_reward_pct',        id: 'setting-referral-reward-pct',        type: 'number',   default: '3'    },
  // Vendor Requirements
  { key: 'require_phone_verify',       id: 'setting-require-phone-verify',       type: 'checkbox', default: 'true' },
  { key: 'require_id_verify',          id: 'setting-require-id-verify',          type: 'checkbox', default: 'true' },
  { key: 'vendor_auto_approve',        id: 'setting-vendor-auto-approve',        type: 'checkbox', default: 'false'},
  // Note: announcement fields are loaded separately (outside the form) via loadAdminSettings
  // but saved via sendAnnouncement() / clearAnnouncement()
];

// ── Load all settings from DB → populate form fields ─────
async function loadAdminSettings() {
  const res = await apiGet('settings', 'limit=200');
  const rows = res?.data || [];

  for (const cfg of SETTINGS_CONFIG) {
    const row = rows.find(r => r.key === cfg.key);
    const val = row ? row.value : cfg.default;
    const el  = document.getElementById(cfg.id);
    if (!el) continue;

    if (cfg.type === 'checkbox') {
      el.checked = val === 'true' || val === true;
    } else {
      el.value = val;
    }
  }

  // Populate announcement fields (outside the form — loaded separately)
  const announcementFields = [
    { key: 'announcement_active', id: 'setting-announcement-active', type: 'checkbox', default: 'false' },
    { key: 'announcement_text',   id: 'setting-announcement-text',   type: 'textarea', default: ''      },
    { key: 'announcement_type',   id: 'setting-announcement-type',   type: 'select',   default: 'info'  },
  ];
  for (const cfg of announcementFields) {
    const row = rows.find(r => r.key === cfg.key);
    const val = row ? row.value : cfg.default;
    const el  = document.getElementById(cfg.id);
    if (!el) continue;
    if (cfg.type === 'checkbox') el.checked = val === 'true';
    else el.value = val;
  }

  // (AI provider cards now live on their own admin-ai tab — see loadAISettings)

  // Also load commission tiers
  loadCommissionTiersFromRows(rows);

  // Load hero banners
  const heroRow = rows.find(r => r.key === 'hero_banners');
  try {
    _heroBanners = heroRow && heroRow.value ? JSON.parse(heroRow.value) : [];
  } catch(e) { _heroBanners = []; }
  renderHeroBannersEditor();

  // Load coupons
  const couponRow = rows.find(r => r.key === 'coupons');
  try {
    _coupons = couponRow && couponRow.value ? JSON.parse(couponRow.value) : [];
  } catch(e) { _coupons = []; }
  if (typeof renderCouponsEditor === 'function') renderCouponsEditor();

  // Refresh the sidebar "AI Keys" badge
  if (typeof window.refreshAIBadge === 'function') {
    try { await window.refreshAIBadge(); } catch (_) {}
  }
}

// ── Save all settings to DB ───────────────────────────────
async function saveAdminSettings(e) {
  e.preventDefault();

  const btn = e.target?.querySelector('[type=submit]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  // Fetch existing settings once
  const res   = await apiGet('settings', 'limit=100');
  const rows  = res?.data || [];

  const upsert = async (key, value) => {
    const existing = rows.find(r => r.key === key);
    if (existing) {
      await apiPatch('settings', existing.id, { value: String(value), updated_at: new Date().toISOString() });
    } else {
      await apiPost('settings', {
        key,
        value:      String(value),
        label:      key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        type:       'text',
        updated_at: new Date().toISOString()
      });
    }
  };

  // Read and save every field
  const saves = SETTINGS_CONFIG.map(cfg => {
    const el = document.getElementById(cfg.id);
    if (!el) return Promise.resolve();
    const val = cfg.type === 'checkbox' ? String(el.checked) : el.value;
    return upsert(cfg.key, val);
  });

  await Promise.all(saves);

  // Save commission tiers
  await saveCommissionTiers(rows);

  // Save hero banners
  await upsert('hero_banners', JSON.stringify(_heroBanners));

  // Save coupons
  await upsert('coupons', JSON.stringify(_coupons));

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }

  // Flash the success message
  const msg = document.getElementById('settings-saved-msg');
  if (msg) {
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
  showToast('⚙️ Settings saved successfully!', 'success');

  // Apply vendor_auto_approve logic in memory
  const autoApproveEl = document.getElementById('setting-vendor-auto-approve');
  if (autoApproveEl) App._vendorAutoApprove = autoApproveEl.checked;
}
// ── Commission Tier Editor ────────────────────────────────
// Default sales tiers matching app.js COMMISSION constant
const DEFAULT_COMMISSION_TIERS = [
  { min: 1,    max: 50,    pct: 8 },
  { min: 51,   max: 100,   pct: 6 },
  { min: 101,  max: 500,   pct: 4 },
  { min: 501,  max: 1000,  pct: 3 },
  { min: 1001, max: 99999, pct: 2 },
];

// Default referral tiers (flat by default — same % regardless of order size)
const DEFAULT_REFERRAL_TIERS = [
  { min: 1,    max: 99999, pct: 3 },
];

let _commissionTiers        = null;
let _referralCommissionTiers = null;

function loadCommissionTiersFromRows(rows) {
  // Sales tiers
  const tiersRow = rows.find(r => r.key === 'commission_tiers');
  if (tiersRow && tiersRow.value) {
    try { _commissionTiers = JSON.parse(tiersRow.value); }
    catch(e) { _commissionTiers = [...DEFAULT_COMMISSION_TIERS]; }
  } else {
    _commissionTiers = [...DEFAULT_COMMISSION_TIERS];
  }
  renderCommissionTiersEditor();

  // Referral tiers
  const refTiersRow = rows.find(r => r.key === 'referral_commission_tiers');
  if (refTiersRow && refTiersRow.value) {
    try { _referralCommissionTiers = JSON.parse(refTiersRow.value); }
    catch(e) { _referralCommissionTiers = [...DEFAULT_REFERRAL_TIERS]; }
  } else {
    _referralCommissionTiers = [...DEFAULT_REFERRAL_TIERS];
  }
  renderReferralCommissionTiersEditor();
}

// ── Sales commission tier UI ──────────────────────────────
function renderCommissionTiersEditor() {
  const list = document.getElementById('commission-tiers-list');
  if (!list) return;
  if (!_commissionTiers) _commissionTiers = [...DEFAULT_COMMISSION_TIERS];
  list.innerHTML = _commissionTiers.map((tier, i) => `
<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center">
  <input class="form-control" type="number" min="0" step="1" value="${tier.min}"
         oninput="_commissionTiers[${i}].min=parseFloat(this.value)||0"
         style="font-size:.82rem;padding:6px 8px" placeholder="Min">
  <input class="form-control" type="number" min="0" step="1" value="${tier.max >= 99999 ? 99999 : tier.max}"
         oninput="_commissionTiers[${i}].max=parseFloat(this.value)||99999"
         style="font-size:.82rem;padding:6px 8px" placeholder="Max">
  <div style="display:flex;align-items:center;gap:4px">
    <input class="form-control" type="number" min="0" max="100" step="0.5" value="${tier.pct}"
           oninput="_commissionTiers[${i}].pct=parseFloat(this.value)||0"
           style="font-size:.82rem;padding:6px 8px" placeholder="%">
    <span style="font-size:.8rem;color:var(--text-muted);flex-shrink:0">%</span>
  </div>
  <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);padding:4px 8px"
          onclick="removeCommissionTier(${i})" title="Remove">
    <i class="fas fa-trash-alt"></i>
  </button>
</div>`).join('');
}

function addCommissionTier() {
  if (!_commissionTiers) _commissionTiers = [...DEFAULT_COMMISSION_TIERS];
  const last   = _commissionTiers[_commissionTiers.length - 1];
  const newMin = last ? Math.min(last.max + 1, 99998) : 1;
  _commissionTiers.push({ min: newMin, max: 99999, pct: 2 });
  renderCommissionTiersEditor();
}

function removeCommissionTier(index) {
  if (!_commissionTiers || _commissionTiers.length <= 1) {
    showToast('You need at least one sales commission tier', 'warning');
    return;
  }
  _commissionTiers.splice(index, 1);
  renderCommissionTiersEditor();
}

// ── Referral commission tier UI ───────────────────────────
function renderReferralCommissionTiersEditor() {
  const list = document.getElementById('referral-commission-tiers-list');
  if (!list) return;
  if (!_referralCommissionTiers) _referralCommissionTiers = [...DEFAULT_REFERRAL_TIERS];
  list.innerHTML = _referralCommissionTiers.map((tier, i) => `
<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center">
  <input class="form-control" type="number" min="0" step="1" value="${tier.min}"
         oninput="_referralCommissionTiers[${i}].min=parseFloat(this.value)||0"
         style="font-size:.82rem;padding:6px 8px" placeholder="Min">
  <input class="form-control" type="number" min="0" step="1" value="${tier.max >= 99999 ? 99999 : tier.max}"
         oninput="_referralCommissionTiers[${i}].max=parseFloat(this.value)||99999"
         style="font-size:.82rem;padding:6px 8px" placeholder="Max">
  <div style="display:flex;align-items:center;gap:4px">
    <input class="form-control" type="number" min="0" max="100" step="0.5" value="${tier.pct}"
           oninput="_referralCommissionTiers[${i}].pct=parseFloat(this.value)||0"
           style="font-size:.82rem;padding:6px 8px" placeholder="%">
    <span style="font-size:.8rem;color:var(--text-muted);flex-shrink:0">%</span>
  </div>
  <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);padding:4px 8px"
          onclick="removeReferralCommissionTier(${i})" title="Remove">
    <i class="fas fa-trash-alt"></i>
  </button>
</div>`).join('');
}

function addReferralCommissionTier() {
  if (!_referralCommissionTiers) _referralCommissionTiers = [...DEFAULT_REFERRAL_TIERS];
  const last   = _referralCommissionTiers[_referralCommissionTiers.length - 1];
  const newMin = last ? Math.min(last.max + 1, 99998) : 1;
  _referralCommissionTiers.push({ min: newMin, max: 99999, pct: 3 });
  renderReferralCommissionTiersEditor();
}

function removeReferralCommissionTier(index) {
  if (!_referralCommissionTiers || _referralCommissionTiers.length <= 1) {
    showToast('You need at least one referral commission tier', 'warning');
    return;
  }
  _referralCommissionTiers.splice(index, 1);
  renderReferralCommissionTiersEditor();
}

// ── Save both tier types ──────────────────────────────────
async function saveCommissionTiers(existingRows) {
  const rows  = existingRows || (await apiGet('settings', 'limit=100'))?.data || [];
  const upsertTier = async (key, tiers) => {
    if (!tiers || !tiers.length) return;
    const value    = JSON.stringify(tiers);
    const existing = rows.find(r => r.key === key);
    if (existing) await apiPatch('settings', existing.id, { value, updated_at: new Date().toISOString() });
    else          await apiPost('settings', { key, value, label: key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), type: 'json', updated_at: new Date().toISOString() });
  };
  await Promise.all([
    upsertTier('commission_tiers',          _commissionTiers),
    upsertTier('referral_commission_tiers', _referralCommissionTiers)
  ]);
}

// ── Runtime helper: get effective commission pct for a price ─
function getEffectiveCommissionPct(price) {
  const tiers = _commissionTiers && _commissionTiers.length ? _commissionTiers : null;
  if (tiers) {
    for (const t of tiers) {
      const maxVal = t.max >= 99999 ? Infinity : t.max;
      if (price >= t.min && price <= maxVal) return t.pct;
    }
    return tiers[tiers.length - 1]?.pct || 2;
  }
  if (typeof COMMISSION !== 'undefined') {
    for (const [min, max, pct] of COMMISSION) {
      if (price >= min && price <= max) return pct;
    }
  }
  return 2;
}

// ── Runtime helper: get referral commission pct for a purchase amount ─
function getEffectiveReferralCommissionPct(amount) {
  const tiers = _referralCommissionTiers && _referralCommissionTiers.length ? _referralCommissionTiers : null;
  if (tiers) {
    for (const t of tiers) {
      const maxVal = t.max >= 99999 ? Infinity : t.max;
      if (amount >= t.min && amount <= maxVal) return t.pct;
    }
    return tiers[tiers.length - 1]?.pct || 3;
  }
  return 3; // absolute fallback
}

// ── Hero Banners Editor ─────────────────────────────────────
function renderHeroBannersEditor() {
  const container = document.getElementById('admin-hero-banners-container');
  if (!container) return;
  if (!_heroBanners.length) {
    container.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);font-style:italic">No banners uploaded. Using default gradient.</div>';
    return;
  }
  container.innerHTML = _heroBanners.map((b64, i) => `
    <div style="position:relative;width:120px;height:60px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">
      <img src="${b64}" style="width:100%;height:100%;object-fit:cover;display:block">
      <button type="button" onclick="removeHeroBanner(${i})" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;background:rgba(220,38,38,.85);color:#fff;border:none;font-size:.65rem;display:flex;align-items:center;justify-content:center;cursor:pointer">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

window.uploadHeroBanner = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _heroBanners.push(e.target.result);
    renderHeroBannersEditor();
  };
  reader.readAsDataURL(file);
};

window.removeHeroBanner = function(index) {
  _heroBanners.splice(index, 1);
  renderHeroBannersEditor();
};

// ── Coupons Editor ──────────────────────────────────────────
function renderCouponsEditor() {
  const container = document.getElementById('admin-coupons-list');
  if (!container) return;
  if (!_coupons.length) {
    container.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);font-style:italic">No coupons active.</div>';
    return;
  }
  container.innerHTML = _coupons.map((c, i) => `
    <div style="background:#f8f9fa; border:1px solid var(--border); padding:8px; border-radius:8px; margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr 80px 80px auto;gap:6px;margin-bottom:6px;align-items:center">
        <input class="form-control" placeholder="Code (e.g. SAVE10)" value="${escHtml(c.code)}" oninput="updateCoupon(${i},'code',this.value)">
        <select class="form-control form-select" onchange="updateCoupon(${i},'type',this.value)">
          <option value="%" ${c.type === '%' ? 'selected' : ''}>%</option>
          <option value="GHS" ${c.type === 'GHS' ? 'selected' : ''}>GHS</option>
        </select>
        <input class="form-control" type="number" min="0" step="0.01" value="${c.value}" oninput="updateCoupon(${i},'value',this.value)">
        <button type="button" class="btn btn-outline" style="color:var(--danger);border-color:var(--danger);padding:0;width:34px;height:34px;display:flex;align-items:center;justify-content:center" onclick="removeCoupon(${i})">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.75rem; color:var(--text-muted); white-space:nowrap; margin-bottom:0">Max Uses (0=unlimited):</label>
        <input class="form-control" type="number" min="0" step="1" value="${c.max_uses || 0}" oninput="updateCoupon(${i},'max_uses',this.value)" style="width:80px; padding:4px; height:auto; font-size:0.8rem">
        <span style="font-size:0.75rem; color:var(--text-light); margin-left:auto">
          Used: ${c.used_by ? c.used_by.length : 0} times
        </span>
      </div>
    </div>
  `).join('');
}

window.addCoupon = function() {
  _coupons.push({ code: '', type: '%', value: 0, max_uses: 0, used_by: [] });
  renderCouponsEditor();
};

window.updateCoupon = function(i, field, val) {
  if (field === 'value') {
    _coupons[i][field] = parseFloat(val) || 0;
  } else if (field === 'max_uses') {
    _coupons[i][field] = parseInt(val, 10) || 0;
  } else {
    _coupons[i][field] = val;
  }
};

window.removeCoupon = function(i) {
  _coupons.splice(i, 1);
  renderCouponsEditor();
};

window.renderCouponsEditor = renderCouponsEditor;

// getSetting is defined in app.js
