/* ============================================================
   HAPPA TRADEMART — Utility Functions
   ============================================================ */

// ── UUID Generator ────────────────────────────────────────
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Currency Formatter ─────────────────────────────────────
function formatCurrency(amount, currency = 'GHS') {
  return `${currency} ${parseFloat(amount || 0).toFixed(2)}`;
}

// ── Phone formatter ────────────────────────────────────────
function formatPhone(phone) {
  if (!phone) return '';
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 10) return `0${clean.slice(1,4)} ${clean.slice(4,7)} ${clean.slice(7)}`;
  return phone;
}

// ── Truncate text ──────────────────────────────────────────
function truncate(str, max = 60) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── Debounce ───────────────────────────────────────────────
function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── Deep clone ─────────────────────────────────────────────
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── URL param reader ───────────────────────────────────────
function getUrlParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

// ── On load: handle URL params for deep linking ────────────
window.addEventListener('DOMContentLoaded', () => {
  const ref = getUrlParam('ref');
  if (ref) {
    // Persist the referral code in sessionStorage so it survives
    // SPA navigation without re-reading the URL bar each time.
    sessionStorage.setItem('pending_ref', ref);

    // Also auto-fill the hidden field if the register form is already
    // rendered (older path kept for safety).
    const regRefEl = document.getElementById('reg-ref');
    if (regRefEl) regRefEl.value = ref;

    // Show a subtle banner so the user knows they were referred
    setTimeout(() => {
      if (!App?.currentUser) {
        showToast('👋 You were invited! Sign up to get started.', 'info');
      }
    }, 1200);
  }

  const product = getUrlParam('product');
  if (product) setTimeout(() => openProduct(product), 500);
});

// ── Scroll to element ──────────────────────────────────────
function scrollToEl(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Copy to clipboard ──────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    return true;
  }
}

// ── Image error handler ────────────────────────────────────
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') {
    e.target.src = 'https://via.placeholder.com/200x200?text=No+Image';
  }
}, true);

// ── Prevent double-tap zoom on buttons (iOS fix) ──────────
// NOTE: We do NOT call e.preventDefault() here as it would block
// onclick handlers from firing naturally and cause double-activation.
// Instead we use CSS touch-action to suppress zoom without JS interception.
// The CSS rule `touch-action: manipulation` on buttons handles this.

// ── Image preview helpers (local gallery / file picker) ───
// Used by vendor product uploads, store logo/banner, and admin store form.
// previewWrapperId : id of the wrapper div shown after selection
// hiddenId         : id of <input type="hidden"> storing base64 data-URL
// Thumb element id is derived by replacing 'preview' → 'thumb' in previewWrapperId.
function previewProductImage(input, previewWrapperId, hiddenId) {
  const file = input.files?.[0];
  if (!file) return;

  const maxBytes = hiddenId.includes('banner') ? 3 * 1024 * 1024   // 3 MB for banners
                 : hiddenId.includes('logo')   ? 2 * 1024 * 1024   // 2 MB for logos
                 :                               5 * 1024 * 1024;  // 5 MB for products

  if (file.size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    showToast(`Image too large. Max ${mb}MB for this field.`, 'warning');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    const wrap  = document.getElementById(previewWrapperId);
    const thumb = document.getElementById(previewWrapperId.replace('preview', 'thumb'));
    const hid   = document.getElementById(hiddenId);
    if (thumb) thumb.src = ev.target.result;
    if (wrap)  wrap.style.display = 'flex';
    if (hid)   hid.value = ev.target.result; // store full base64 data-URL
  };
  reader.readAsDataURL(file);
}

function clearProductImage(previewWrapperId, fileInputId, hiddenId) {
  const wrap  = document.getElementById(previewWrapperId);
  const thumb = document.getElementById(previewWrapperId.replace('preview', 'thumb'));
  const input = document.getElementById(fileInputId);
  const hid   = document.getElementById(hiddenId);
  if (wrap)  wrap.style.display  = 'none';
  if (thumb) thumb.src           = '';
  if (input) input.value         = '';
  if (hid)   hid.value           = '';
}
