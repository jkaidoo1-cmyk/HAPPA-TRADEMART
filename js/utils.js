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

// ── On load: handle URL params for deep linking ─────────────
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

// ── Storefront public link ─────────────────────────────────
// The canonical URL for a storefront is a PATH url — /storefront/<slug> — not a
// hash one. The server answers that path with the SPA shell whose <head>
// carries this store's own title, description and logo, so a storefront link
// (the one a vendor copies, or the one "Visit Live Site" opens) previews in
// WhatsApp as the store instead of as the main marketplace. A '#fragment' never
// reaches the server, so no preview card built from a hash link could ever be
// about the store. Both forms still route inside the app.
function storefrontUrl(slug, mode) {
  const clean = String(slug == null ? '' : slug)
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/?(?:#\/?)?(?:storefront|store-admin)\//i, '')
    .replace(/^#/, '')
    .replace(/^\/+/, '');
  const prefix = String(mode || '').toLowerCase() === 'admin' ? '/store-admin/' : '/storefront/';
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
  return origin + prefix + clean;
}
window.storefrontUrl = storefrontUrl;

// ── Scroll to element ──────────────────────────────────────
function scrollToEl(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Copy to clipboard ──────────────────────────────────────
// `navigator.clipboard` is undefined on an insecure origin (a LAN IP over
// plain http) and on older mobile browsers, so the execCommand path stays as
// the fallback rather than being deleted.
async function copyText(text) {
  const value = String(text == null ? '' : text);
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const t = document.createElement('textarea');
    t.value = value;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(t);
    return ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text) {
  return copyText(text);
}

// ── Order codes: tap to copy ───────────────────────────────
// An order code is the one string a buyer, vendor and support agent actually
// read back to each other, and it is printed next to a status badge rather than
// sitting in a field, so selecting it by hand on a phone is fiddly. Every
// surface that shows a code renders it through orderCodeChip() so the code is
// always tappable.
//
// The click listener below is registered in the CAPTURE phase on purpose.
// Chips are rendered inside cards whose inline onclick opens the order detail,
// and a bubble-phase listener on document would run *after* that card handler
// had already opened the modal. Capturing at the document lets us copy the code
// and stop the click before it ever reaches the surrounding card.
function orderCodeChip(code, opts) {
  const value = String(code == null ? '' : code).trim();
  const o = opts || {};
  const style = o.style ? ` style="${o.style}"` : '';
  if (!value) return `<span class="package-code"${style}>—</span>`;
  const icon = o.icon === false ? '' : '<i class="fas fa-cube" style="margin-right:4px"></i>';
  const cls = 'package-code copy-chip' + (o.className ? ' ' + o.className : '');
  return `<span class="${cls}"${style} data-copy-order="${escHtml(value)}"`
    + ` role="button" tabindex="0" title="Tap to copy ${escHtml(value)}">`
    + `${icon}${escHtml(value)}<i class="fas fa-copy copy-chip-icon" aria-hidden="true"></i></span>`;
}

function markChipCopied(chip) {
  const icon = chip.querySelector('.copy-chip-icon');
  chip.classList.add('copied');
  if (icon) { icon.classList.remove('fa-copy'); icon.classList.add('fa-check'); }
  clearTimeout(chip._copyResetTimer);
  chip._copyResetTimer = setTimeout(() => {
    chip.classList.remove('copied');
    if (icon) { icon.classList.remove('fa-check'); icon.classList.add('fa-copy'); }
  }, 1500);
}

async function copyOrderCodeFromChip(chip) {
  const value = chip.getAttribute('data-copy-order') || '';
  if (!value) return;
  const ok = await copyText(value);
  if (ok) markChipCopied(chip);
  if (typeof showToast === 'function') {
    showToast(ok ? `Order code ${value} copied` : 'Could not copy — long-press the code instead', ok ? 'success' : 'warning');
  }
}

function nearestCopyChip(node) {
  return node && node.closest ? node.closest('[data-copy-order]') : null;
}

document.addEventListener('click', (ev) => {
  const chip = nearestCopyChip(ev.target);
  if (!chip) return;
  // Capture phase: stop the enclosing card's onclick before it opens a modal.
  ev.preventDefault();
  ev.stopPropagation();
  copyOrderCodeFromChip(chip);
}, true);

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const chip = nearestCopyChip(ev.target);
  if (!chip) return;
  ev.preventDefault();
  copyOrderCodeFromChip(chip);
}, true);

// ── Image error handler ──────────────────────────────────
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') {
    e.target.src = 'https://placehold.co/200x200?text=No+Image';
  }
}, true);

// ── Prevent double-tap zoom on buttons (iOS fix) ────────────────
// NOTE: We do NOT call e.preventDefault() here as it would block
// onclick handlers from firing naturally and cause double-activation.
// Instead we use CSS touch-action to suppress zoom without JS intervention.
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

// ── Display-time image fit ──────────────────────────────────────────────
// Uploads are cover-cropped today, but images saved by an older build had a
// white bar BAKED INTO the jpeg (a portrait photo letterboxed onto a white
// square) — no CSS can ever make those fill the card. When such an image
// loads, detect the symmetric white frame, crop it away and swap in the
// trimmed file, so the photo fills the space the way the user expects.
// Only runs when a frame is actually detected: the common case costs four
// thin pixel reads, and the result is cached per source image.
const _fittedImageCache = new Map();
function fitProductImage(img) {
  try {
    if (!img || img.dataset.fitDone) return;
    img.dataset.fitDone = '1';
    const src = img.currentSrc || img.src || '';
    if (src.slice(0, 10) !== 'data:image') return;   // only local data URIs (canvas must not be tainted)
    const cached = _fittedImageCache.get(src);
    if (cached) { if (cached !== src) img.src = cached; return; }
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const whiteish = (d, i) => d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250;
    const edgesAllWhite = data => { for (let i = 0; i < data.length; i += 4) if (!whiteish(data, i)) return false; return true; };
    // Symmetric white frame = the letterbox signature. One thin strip per side.
    const vertFrame = edgesAllWhite(ctx.getImageData(0, 0, 1, h).data) &&
                      edgesAllWhite(ctx.getImageData(w - 1, 0, 1, h).data);
    const horizFrame = edgesAllWhite(ctx.getImageData(0, 0, w, 1).data) &&
                       edgesAllWhite(ctx.getImageData(0, h - 1, w, 1).data);
    if (!vertFrame && !horizFrame) { _fittedImageCache.set(src, src); return; }

    // A frame was found — measure how far in the real content starts.
    const full = ctx.getImageData(0, 0, w, h).data;
    const at = (x, y) => (y * w + x) * 4;
    const isWhite = (x, y) => whiteish(full, at(x, y));
    let l = 0; while (l < w && vertFrame) { let ok = true; for (let y = 0; y < h; y++) if (!isWhite(l, y)) { ok = false; break; } if (!ok) break; l++; }
    let r = 0; while (r < w - l && vertFrame) { let ok = true; for (let y = 0; y < h; y++) if (!isWhite(w - 1 - r, y)) { ok = false; break; } if (!ok) break; r++; }
    let t = 0; while (t < h && horizFrame) { let ok = true; for (let x = 0; x < w; x++) if (!isWhite(x, t)) { ok = false; break; } if (!ok) break; t++; }
    let b = 0; while (b < h - t && horizFrame) { let ok = true; for (let x = 0; x < w; x++) if (!isWhite(x, h - 1 - b)) { ok = false; break; } if (!ok) break; b++; }

    const cw = w - l - r, ch = h - t - b;
    // Ignore trivial insets (JPEG noise) — only real letterboxing gets cropped —
    // and refuse degenerate results, so a suspiciously all-white image can never
    // be cropped down to a sliver.
    const trivial = (l + r) / w < 0.04 && (t + b) / h < 0.04;
    if (cw < w * 0.2 || ch < h * 0.2 || trivial) { _fittedImageCache.set(src, src); return; }

    const trimmed = document.createElement('canvas');
    trimmed.width = cw; trimmed.height = ch;
    trimmed.getContext('2d').drawImage(c, l, t, cw, ch, 0, 0, cw, ch);
    const out = trimmed.toDataURL('image/jpeg', 0.8);
    _fittedImageCache.set(src, out);
    img.src = out;
  } catch (e) {
    // Cross-origin, decode failure or a hostile image — leave the original alone.
  }
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
  // Hidden while the owner has an open account-deletion request (admin review).
  if (product.status === 'pending_deletion') return false;
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
  // 'pending_deletion' hides a store whose owner asked to delete their account
  // (the admin reviews the request before the real cascade delete runs).
  if (['suspended', 'inactive', 'pending', 'rejected', 'deleted', 'archived', 'pending_deletion'].includes(st)) return false;
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



// ── Turning failures into something a shopper can act on ─────────────────
// window.lastApiError and server responses carry implementation detail by
// design — "HTTP 500: Internal Server Error", "Server rejected the save:
// Unknown resource", a bare "Failed to fetch", a raw permission sentence. Those
// strings used to be printed straight into toasts, so a buyer occasionally got
// told about the backend instead of what happened to their order.
//
// friendlyApiError() is the single place that decides what a person should read.
// It keeps the technical text in the console for debugging, then returns a
// sentence that says what happened and what to do next. Anything our own server
// says in plain language is passed through — that copy is usually the most
// useful thing we have (stock, balance, coupon problems are already specific).
//
// Used by every toast that reports a failed request.
function friendlyApiError(raw, fallback) {
  const generic = fallback || 'Something went wrong. Please try again.';
  let text = '';
  if (raw && typeof raw === 'object') text = String(raw.error || raw.message || '');
  else text = String(raw == null ? '' : raw);
  text = text.trim();

  // Keep the detail where developers can find it, never on screen.
  if (text) { try { console.warn('[API]', text); } catch (e) {} }
  if (!text) return generic;

  // Transport/implementation noise we always hide.
  const internal = /^(server rejected (the )?\w+|timeout|failed to fetch|networkerror|network error|load failed|http \d+|typeerror|referenceerror|syntaxerror|unexpected token|json|unknown error|undefined|null|nan|error)$/i;
  let cleaned = text
    .replace(/^server rejected (the )?\w+:\s*/i, '')
    .replace(/^http \d+:\s*/i, '')
    .trim();
  const lower = cleaned.toLowerCase();
  // Status codes and transport wording live in the ORIGINAL text: stripping the
  // "HTTP 500: " prefix first would hide the very signal that says "this is our
  // fault, not yours" and the raw word would be shown instead.
  const rawLower = text.toLowerCase();

  // Never show a serialized error object, a stack trace, backend vocabulary or
  // a placeholder.
  if (/^[\[{]/.test(text) || /"[a-z_]+"\s*:/.test(text)) return generic;
  if (/cannot read propert|is not a function|undefined is not|postgres|supabase|\bsql\b|foreign key|constraint|violation|stack|at object\.|relation |does not exist|duplicate key|invalid input syntax|too long for type|invalid uuid/i.test(rawLower)) return generic;
  if (/unknown (resource|table|action)|no such table|not implemented|invalid json|malformed|unexpected token|bad json/i.test(rawLower)) return generic;

  // Session and permission problems: say what to do, not who refused what.
  if (/\b(401|unauthorized|unauthenticated)\b/.test(rawLower) || /session (has )?expired|sign in again|invalid token|jwt/.test(lower)) {
    return 'Your session has ended. Please sign in again.';
  }
  if (/\b(403|forbidden)\b/.test(rawLower) || /admin access|only admins|permission|not allowed|not authorised|not authorized/.test(lower)) {
    return "You don't have permission to do that.";
  }
  if (/\b404\b/.test(rawLower) || /not found/.test(lower)) {
    return 'That is no longer available — it may have been removed. Please refresh the page.';
  }

  // Server-side fault or unreachable backend: never blame the user for these.
  if (/\b5\d\d\b/.test(rawLower) || /internal server error|bad gateway|service unavailable|gateway timeout|upstream/.test(lower)) {
    return 'Something went wrong on our end. Please try again in a moment.';
  }
  if (/quota|rate limit|too many requests/.test(rawLower)) {
    return 'Too many requests right now. Please wait a moment and try again.';
  }
  if (/timed? ?out|taking too long/.test(lower)) {
    return 'That took too long to respond. Please try again.';
  }
  // Offline / unreachable: actionable for the user.
  if (/failed to fetch|networkerror|network error|load failed|offline|server unavailable|econnrefused|internet/.test(rawLower)) {
    return 'You appear to be offline. Check your connection and try again.';
  }
  if (/no local (result|data)|local storage|localstorage/.test(rawLower)) {
    return "We couldn't reach the marketplace. Check your connection and try again.";
  }

  // A plain sentence from our own server: pass it through when it is short and
  // clean, otherwise fall back.
  if (internal.test(cleaned)) return generic;
  if (cleaned.length > 180) cleaned = cleaned.slice(0, 177).trimEnd() + '…';
  return cleaned || generic;
}
window.friendlyApiError = friendlyApiError;

// Toast an error without ever printing transport/backend detail at the user.
function showApiErrorToast(raw, fallback) {
  if (typeof showToast !== 'function') return;
  showToast(friendlyApiError(raw, fallback), 'error');
}
window.showApiErrorToast = showApiErrorToast;
