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

    // Also store in a 30-day cookie for product-share attribution.
    // This survives page refreshes and navigation unlike sessionStorage.
    // Last-referrer-wins: overwrite any existing cookie.
    document.cookie = 'happa_ref=' + encodeURIComponent(ref) +
      '; path=/; max-age=' + (30 * 24 * 60 * 60) + '; SameSite=Lax';

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
    e.target.src = 'https://placehold.co/200x200?text=No+Image';
  }
}, true);

// ── Prevent double-tap zoom on buttons (iOS fix) ──────────
// NOTE: We do NOT call e.preventDefault() here as it would block
// onclick handlers from firing naturally and cause double-activation.
// Instead we use CSS touch-action to suppress zoom without JS interception.
// The CSS rule `touch-action: manipulation` on buttons handles this.

// ── Resumable upload kick-off ──────────────────────────────
// Start sending a compressed image to the server as chunks, in the background.
// Deliberately NOT awaited: the preview must appear instantly, and by the time
// the user submits the form the chunks are usually already uploaded, which is
// what turns a multi-megabyte save request into a few short `asset:` tokens.
// If it does not finish, the image is simply sent inline exactly as before —
// slower, never broken — and the session stays on disk so the next attempt (or
// the next page load) continues from the first missing chunk.
function backgroundUpload(file, dataUrl) {
  if (typeof Uploader === 'undefined' || !Uploader.store) return;
  // `App` is a top-level const, not a window property — `window.App` is always
  // undefined and would disable uploads for everyone.
  if (typeof App === 'undefined' || !App.currentUser) return; // anonymous: nothing to own the chunks
  try {
    Uploader.store(file, dataUrl).then(res => {
      if (!res || !res.assetRef) console.warn('[Upload] image not fully uploaded yet — it will be attached inline');
    }).catch(err => {
      console.warn('[Upload] background upload failed:', err && err.message || err);
    });
  } catch (e) {
    console.warn('[Upload] could not start the upload:', e && e.message || e);
  }
}

// ── Image preview helpers (local gallery / file picker) ───
// Used by vendor product uploads, store logo/banner, and admin store form.
// previewWrapperId : id of the wrapper div shown after selection
// hiddenId         : id of <input type="hidden"> storing base64 data-URL
// Thumb element id is derived by replacing 'preview' → 'thumb' in previewWrapperId.
async function compressImage(file, maxWidth = 750, quality = 0.70) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = ev => {
      const img = new Image();
      img.src = ev.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let q = quality;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        // Keep payloads compact (~180KB max string) so multi-image products fit easily in storage
        const maxChars = 180 * 1024;
        while (dataUrl.length > maxChars && q > 0.45) {
          q = Math.round((q - 0.08) * 100) / 100;
          dataUrl = canvas.toDataURL('image/jpeg', q);
        }
        if (dataUrl.length > maxChars && width > 550) {
          const scale = 550 / width;
          canvas.width = 550;
          canvas.height = Math.round(height * scale);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.60);
        }
        backgroundUpload(file, dataUrl);
        resolve(dataUrl);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// ── Price display helper ─────────────────────────────────
// Renders a saved price for cards/detail pages. Legacy rows (and any future
// bad write) can carry null/undefined — show an honest placeholder instead of
// the infamous "GHS null".
function formatPrice(price) {
  const n = Number(price);
  return Number.isFinite(n) && n >= 0 ? 'GHS ' + n : 'Price unavailable';
}

// ── Square product image helper ────────────────────────────
// Scales the photo to COVER a square canvas and crops the overflow, so the
// stored image is edge-to-edge content — exactly how store banners behave in
// their slots. The old letterbox behavior (fit INSIDE on a white canvas)
// baked white bars into the saved file, which then showed as empty gaps on
// the sides of product cards no matter what CSS did.
// Used for product uploads (vendor products, bulk builder, rendor posts).
async function squareImage(file, size = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = ev => {
      const img = new Image();
      img.src = ev.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // JPEG has no alpha — an unpainted pixel would render black, so keep
        // the white base coat even though the cover-draw below overpaints it.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        // Cover, not contain: the larger scale factor fills every edge and the
        // centered draw crops what spills over.
        const scale = Math.max(size / img.width, size / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        ctx.drawImage(img, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
        let q = quality;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        // Keep payloads compact (~180KB max string) — same budget as compressImage
        const maxChars = 180 * 1024;
        while (dataUrl.length > maxChars && q > 0.45) {
          q = Math.round((q - 0.08) * 100) / 100;
          dataUrl = canvas.toDataURL('image/jpeg', q);
        }
        if (dataUrl.length > maxChars) {
          const c2 = document.createElement('canvas');
          c2.width = 550;
          c2.height = 550;
          c2.getContext('2d').drawImage(canvas, 0, 0, 550, 550);
          dataUrl = c2.toDataURL('image/jpeg', 0.60);
        }
        backgroundUpload(file, dataUrl);
        resolve(dataUrl);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

async function previewProductImage(input, previewWrapperId, hiddenId, makeSquare = false) {
  const file = input.files?.[0];
  if (!file) return;

  const maxBytes = 15 * 1024 * 1024; // 15 MB limit before compression
  if (file.size > maxBytes) {
    showToast(`Image too large. Max 15MB.`, 'warning');
    input.value = '';
    return;
  }

  try {
    const base64 = makeSquare ? await squareImage(file, 900, 0.72) : await compressImage(file);
    
    const wrap  = document.getElementById(previewWrapperId);
    const thumb = document.getElementById(previewWrapperId.replace('preview', 'thumb'));
    const hid   = document.getElementById(hiddenId);
    if (hid) hid.value = base64;

    const area = input.previousElementSibling;
    if (area && area.classList.contains('upload-area')) {
      area.style.backgroundImage = `url('${base64}')`;
      area.style.backgroundSize = 'contain';
      area.style.backgroundPosition = 'center';
      area.style.backgroundRepeat = 'no-repeat';
      area.style.border = '1px solid var(--border)';
      Array.from(area.children).forEach(c => c.style.display = 'none');
      if (thumb) thumb.style.display = 'none';
      if (wrap) wrap.style.display = 'flex';
    } else {
      if (thumb) thumb.src = base64;
      if (wrap) wrap.style.display = 'flex';
    }
  } catch (err) {
    showToast('Failed to process image', 'error');
    console.error(err);
  }
}

function clearProductImage(previewWrapperId, fileInputId, hiddenId) {
  const wrap  = document.getElementById(previewWrapperId);
  const thumb = document.getElementById(previewWrapperId.replace('preview', 'thumb'));
  const input = document.getElementById(fileInputId);
  const hid   = document.getElementById(hiddenId);
  
  if (wrap)  wrap.style.display  = 'none';
  if (thumb) thumb.src           = '';
  
  const area = input?.previousElementSibling;
  if (area && area.classList.contains('upload-area')) {
    area.style.backgroundImage = '';
    area.style.border = '';
    Array.from(area.children).forEach(c => c.style.display = '');
  }

  if (input) input.value         = '';
  if (hid)   hid.value           = '';
}

// A product is publicly listable only while it still has stock. Out-of-stock
// products stay in the DB only for pending deliveries (order snapshots need
// them) and are auto-deleted once the last delivery completes.
window.isProductListable = function(product) {
  if (!product) return false;
  if ((parseInt(product.stock_qty) || 0) <= 0) return false;
  if (product.status === 'sold_out' || product.status === 'archived') return false;
  return true;
};

window.shouldShowProductOnMainWebsite = function(product) {
  if (!isProductListable(product)) return false;
  if (!product.store_id) return true;
  const store = (App.allStores || []).find(s => String(s.id) === String(product.store_id));
  if (store) {
    let extra = store.extra;
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch(e) { extra = null; }
    }
    if (extra && (extra.only_show_on_storefront === true || extra.only_show_on_storefront === 'true')) {
      return false;
    }
  }
  return true;
};

// A store is visible on the main site when it is active — either its own
// `status` is 'active', or its storefront is active. Explicit moderation
// statuses (suspended/inactive/pending/rejected) always hide it, so an
// admin-suspended store can't sneak back in via an active storefront.
window.isStoreVisibleOnMain = function(store) {
  if (!store) return false;
  const st = String(store.status || '').toLowerCase();
  if (['suspended', 'inactive', 'pending', 'rejected', 'deleted', 'archived'].includes(st)) return false;
  return st === 'active' || String(store.storefront_status || '').toLowerCase() === 'active';
};

window.shouldShowStoreOnMainWebsite = function(store) {
  if (!store) return true;
  let extra = store.extra;
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra); } catch(e) { extra = null; }
  }
  if (extra && (extra.only_show_on_storefront === true || extra.only_show_on_storefront === 'true')) {
    return false;
  }
  return true;
};

// ── Location Autocomplete ─────────────────────────────────
// Turns a text input into a type-ahead autocomplete field.
// Call: initLocationAutocomplete('input-id', ['Accra','Kumasi',...])
function initLocationAutocomplete(inputId, options) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Create the suggestions container
  let list = document.getElementById(inputId + '-suggestions');
  if (!list) {
    list = document.createElement('div');
    list.id = inputId + '-suggestions';
    list.className = 'autocomplete-list';
    list.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:9999;max-height:200px;overflow-y:auto;background:#fff;border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;box-shadow:0 4px 12px rgba(0,0,0,.12);display:none;';
    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(list);
  }

  function show(matches) {
    if (!matches.length) { list.style.display = 'none'; return; }
    list.innerHTML = matches.slice(0, 15).map(m =>
      '<div class="autocomplete-item" style="padding:8px 12px;cursor:pointer;font-size:.85rem;border-bottom:1px solid var(--border,#eee)" '
      + 'onmouseover="this.style.background=\'var(--bg-secondary,#f5f5f5)\'" '
      + 'onmouseout="this.style.background=\'\'" '
      + 'onmousedown="event.preventDefault();this.closest(\'.form-group,.input-group\').querySelector(\'input\').value=\'' + m.replace(/'/g, "\\'") + '\';this.parentNode.style.display=\'none\'">'
      + escHtml(m) + '</div>'
    ).join('');
    list.style.display = 'block';
  }

  input.addEventListener('input', function() {
    const val = this.value.trim().toLowerCase();
    if (!val) { list.style.display = 'none'; return; }
    const matches = options.filter(o => o.toLowerCase().includes(val));
    show(matches);
  });

  input.addEventListener('focus', function() {
    const val = this.value.trim().toLowerCase();
    if (val) {
      const matches = options.filter(o => o.toLowerCase().includes(val));
      show(matches);
    }
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = 'none';
    }
  });
}


