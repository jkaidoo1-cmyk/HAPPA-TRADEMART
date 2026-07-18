/* ============================================================
   HAPPA TRADEMART — Ad Banner Engine  (v4)
   ──────────────────────────────────────────────────────────
   SEQUENCE RULE — exactly what the user described:
   ────────────────────────────────────────────────
   Given stores A (5 items), B (5 items), C (4 items), D (3 items)
   the display order is:

     A1, B1, C1, D1,
     A2, B2, C2, D2,
     A3, B3, C3, D3,
     A4, B4, C4, D1,   ← D has only 3, wraps back to D1
     A5, B5, C1, D2,   ← C wraps to C1, D continues from D2
     A1, B1, C2, D3,   ← A wraps to A1 ...
     ...

   Key points:
   • Every "round" picks exactly ONE item from EACH active store,
     in the same fixed store order every time.
   • Each store maintains its own independent product cursor
     that wraps when it reaches the end of that store's list.
   • "Active" means the store still has daily budget remaining.
   • When a store's daily budget is exhausted it is skipped for
     the rest of that calendar day; its slot in the round is
     simply dropped (the other stores keep going).
   • At midnight all budgets reset automatically.

   BUDGET ACCOUNTING
   ─────────────────
   • Each store has a minutesPerDay budget (admin-configured).
   • Each time a store's slide finishes displaying it is charged
     slideMs / 60000 minutes.
   • Spent time is persisted in localStorage keyed by campaign
     id + local date string so it resets each new calendar day.
   ============================================================ */

'use strict';

/* ── Engine global state ───────────────────────────────────── */
const AdEngine = {
  campaigns:        [],
  products:         [],
  stores:           [],
  timers:           {},   // slotId → intervalId
  slots:            {},   // slotId → SlotState (see _buildSlotState)
  lastFetch:        0,
  CACHE_MS:         5 * 60000,
  DEFAULT_SLIDE_MS: 5000,  // fallback slide duration: 5 s
};

/* ──────────────────────────────────────────────────────────── */
/*  localStorage helpers                                        */
/* ──────────────────────────────────────────────────────────── */

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _loadSpent(campaignId) {
  const key = `happa_ads_${campaignId}_${_todayStr()}`;
  try {
    const raw = localStorage.getItem(key);
    return { key, spent: raw ? JSON.parse(raw) : {} };
  } catch (_) {
    return { key, spent: {} };
  }
}

function _saveSpent(key, spent) {
  try { localStorage.setItem(key, JSON.stringify(spent)); } catch (_) {}
}

/* ──────────────────────────────────────────────────────────── */
/*  Public API                                                  */
/* ──────────────────────────────────────────────────────────── */

async function initAdBanners(pageKey) {
  await _ensureCampaigns();
  _ensureProducts();

  const slotMap = { home: 'ad-banner-home', shop: 'ad-banner-shop', stores: 'ad-banner-stores' };
  const slotId  = slotMap[pageKey];
  const slot    = slotId ? document.getElementById(slotId) : null;
  if (!slot) return;

  const campaign = _pickCampaignForPage(pageKey);
  _clearSlot(slotId);

  const state = _buildSlotState(campaign, pageKey);
  if (!state) { 
    _hideSlot(slot); 
    if (pageKey === 'home') {
      const hd = document.getElementById('hero-default');
      if (hd) hd.style.display = '';
    }
    return; 
  }

  if (pageKey === 'home') {
    const hd = document.getElementById('hero-default');
    if (hd) hd.style.display = 'none';
  }

  AdEngine.slots[slotId] = state;
  slot.style.display = '';

  // Render first slide immediately (no charge yet — nothing has been shown)
  _tick(slotId, slot, /* firstRender */ true);

  // Start auto-advance
  AdEngine.timers[slotId] = setInterval(() => {
    const el = document.getElementById(slotId);
    if (el) _tick(slotId, el, false);
  }, state.slideMs);
}

function stopAdBanners() {
  Object.keys(AdEngine.timers).forEach(id => _clearSlot(id));
  AdEngine.slots = {};
}

async function refreshAdBanners() {
  AdEngine.lastFetch = 0;
  stopAdBanners();
  await _ensureCampaigns();
  _ensureProducts();
  ['home', 'shop', 'stores'].forEach(k => initAdBanners(k));
}

/* ──────────────────────────────────────────────────────────── */
/*  Campaign / product cache                                    */
/* ──────────────────────────────────────────────────────────── */

async function _ensureCampaigns() {
  const now = Date.now();
  if (now - AdEngine.lastFetch < AdEngine.CACHE_MS && AdEngine.campaigns.length) return;
  try {
    const res   = await apiGet('ad_campaigns', 'limit=100');
    const nowMs = Date.now();
    AdEngine.campaigns = (res?.data || [])
      .filter(c => {
        if (c.status !== 'active') return false;
        const start = c.start_date ? Number(c.start_date) : 0;
        const end   = c.end_date   ? Number(c.end_date)   : Infinity;
        return nowMs >= start && nowMs <= end;
      })
      .map(c => {
        // store_budgets is saved as a JSON string in the text DB field
        if (typeof c.store_budgets === 'string') {
          try { c.store_budgets = JSON.parse(c.store_budgets); } catch (_) { c.store_budgets = {}; }
        }
        return c;
      });

    const settingsRes = await apiGet('settings', 'key=hero_banners');
    const heroRow = settingsRes?.data?.find(r => r.key === 'hero_banners');
    try {
      AdEngine.heroBanners = heroRow && heroRow.value ? JSON.parse(heroRow.value) : [];
    } catch(e) { AdEngine.heroBanners = []; }

    AdEngine.lastFetch = nowMs;
  } catch (e) { console.warn('[AdEngine] fetch failed:', e); }
}

function _ensureProducts() {
  if (App.allProducts?.length) AdEngine.products = App.allProducts;
  if (App.allStores?.length)   AdEngine.stores   = App.allStores;
}

function _pickCampaignForPage(pageKey) {
  return AdEngine.campaigns.find(c =>
    Array.isArray(c.pages) && c.pages.includes(pageKey)
  ) || null;
}

function _slideDuration(campaign) {
  const v = Number(campaign.interval_value) || 0;
  if (v && campaign.interval_unit === 'seconds') return Math.max(2000, v * 1000);
  return AdEngine.DEFAULT_SLIDE_MS;
}

/* ──────────────────────────────────────────────────────────── */
/*  Slot state                                                  */
/* ──────────────────────────────────────────────────────────── */

/*
 * SlotState shape:
 * {
 *   campaign,
 *   slideMs,
 *   showStoreName,
 *
 *   // One entry per store in the campaign (order = admin's selection order).
 *   // Never mutated — used to rebuild activeRing on midnight reset.
 *   allStoreEntries: [
 *     { sid, products: Product[], cursor: number },
 *     ...
 *   ],
 *
 *   // Active subset (same objects, just filtered).
 *   // Stores are removed from here when budget is exhausted.
 *   activeRing: [same StoreEntry refs],
 *
 *   ringIndex: number,   // which store in activeRing shows NEXT
 *
 *   // The StoreEntry that is CURRENTLY on screen (so we can charge it
 *   // when the slide finishes — avoids all index-arithmetic bugs).
 *   currentEntry: StoreEntry | null,
 *
 *   budgets: { sid: minutesPerDay },
 *   spent:   { sid: minutesSpentToday },
 *   spentKey: string,
 * }
 */
function _buildSlotState(campaign, pageKey) {
  const storeIds = campaign && Array.isArray(campaign.store_ids) ? campaign.store_ids : [];
  const budgets   = campaign ? (campaign.store_budgets || {}) : {};
  const { key: spentKey, spent } = campaign ? _loadSpent(campaign.id) : { key: '', spent: {} };

  // Build one entry per store that actually has eligible products
  const allStoreEntries = [];

  if (pageKey === 'home' && AdEngine.heroBanners && AdEngine.heroBanners.length > 0) {
    // Inject admin hero banners as a pseudo-store
    const heroProducts = AdEngine.heroBanners.map((url, i) => ({
      id: `hero-${i}`,
      name: '',
      images: [url],
      is_hero: true,
      price: 0,
      original_price: 0
    }));
    allStoreEntries.push({ sid: 'admin_hero', products: heroProducts, cursor: 0 });
  }

  for (const sid of storeIds) {
    const products = AdEngine.products.filter(p =>
      p.status !== 'archived' && p.store_id === sid
    );
    if (!products.length) continue;
    allStoreEntries.push({ sid, products, cursor: 0 });
  }
  if (!allStoreEntries.length) return null;

  // Active ring = stores that still have budget today
  const activeRing = allStoreEntries.filter(e => {
    if (e.sid === 'admin_hero') return true;
    const budget = Number(budgets[e.sid]) || 30;
    return (spent[e.sid] || 0) < budget;
  });
  if (!activeRing.length) return null;

  return {
    campaign,
    slideMs:       campaign ? _slideDuration(campaign) : AdEngine.DEFAULT_SLIDE_MS,
    showStoreName: campaign ? campaign.show_store_name !== false : false,
    allStoreEntries,
    activeRing,
    ringIndex:     0,
    currentEntry:  null,   // set on first tick
    budgets,
    spent,
    spentKey,
  };
}

/* ──────────────────────────────────────────────────────────── */
/*  Core tick — called once immediately + every slideMs        */
/* ──────────────────────────────────────────────────────────── */

function _tick(slotId, slot, firstRender) {
  const state = AdEngine.slots[slotId];
  if (!state) return;

  // 1. Midnight check — if calendar day changed, reset all budgets
  _maybeResetBudgets(state);

  // 2. Charge the slide that just finished (skip on very first render)
  if (!firstRender && state.currentEntry) {
    _chargeEntry(state, state.currentEntry);
  }

  // 3. If no stores left, hide the banner
  if (!state.activeRing.length) {
    _clearSlot(slotId);
    _hideSlot(slot);
    return;
  }

  // 4. Wrap ringIndex safely (activeRing may have shrunk after a charge)
  state.ringIndex = state.ringIndex % state.activeRing.length;

  // 5. Pick the store whose turn it is
  const entry = state.activeRing[state.ringIndex];

  // 6. Pick that store's next product (independent round-robin per store)
  const product = entry.products[entry.cursor % entry.products.length];
  entry.cursor++;

  // 7. Advance ringIndex so the NEXT tick uses the next store
  state.ringIndex = (state.ringIndex + 1) % state.activeRing.length;

  // 8. Remember which entry is now on screen (so step 2 charges it next tick)
  state.currentEntry = entry;

  // 9. Render
  const storeObj = AdEngine.stores.find(s => s.id === entry.sid) || {};
  _renderSlide(slot, slotId, product, storeObj, state);
}

/* ──────────────────────────────────────────────────────────── */
/*  Budget accounting                                           */
/* ──────────────────────────────────────────────────────────── */

/**
 * Charge slideMs worth of time to `entry`.
 * If that exhausts its daily budget, remove it from activeRing.
 * Adjust ringIndex so the next store in line is still correct.
 */
function _chargeEntry(state, entry) {
  const sid          = entry.sid;
  if (sid === 'admin_hero') return; // Do not charge admin hero banners
  const slideMinutes = state.slideMs / 60000;

  state.spent[sid] = (state.spent[sid] || 0) + slideMinutes;
  _saveSpent(state.spentKey, state.spent);

  const budget = Number(state.budgets[sid]) || 30;
  if (state.spent[sid] < budget) return;  // still has budget — nothing to remove

  // Budget exhausted — find and remove this entry from activeRing
  const idx = state.activeRing.indexOf(entry);
  if (idx === -1) return;

  state.activeRing.splice(idx, 1);

  /*
   * Adjust ringIndex:
   * After the splice, ringIndex may now point past the end, or may be
   * pointing at what was previously the "next" store but has shifted left.
   *
   * Case A: removed entry was BEFORE ringIndex → shift left by 1
   * Case B: removed entry was AT ringIndex (i.e. it was the one about
   *         to be shown next) → ringIndex already points at the right
   *         next element because everything shifted left.
   * Case C: removed entry was AFTER ringIndex → no adjustment needed.
   *
   * Since we always remove the entry that was just shown, which is
   * ringIndex - 1 (mod N, before removal), case A applies when
   * idx < ringIndex, which will be true when ringIndex > 0 after
   * we advanced it.  When ringIndex wrapped to 0 (entry was last in
   * ring), nothing shifts so no adjustment needed.
   */
  if (idx < state.ringIndex) {
    state.ringIndex = Math.max(0, state.ringIndex - 1);
  }
  // Clamp in case ring is now empty or ringIndex equals new length
  if (state.activeRing.length > 0) {
    state.ringIndex = state.ringIndex % state.activeRing.length;
  }

  console.info(`[AdEngine] ${sid} daily budget exhausted — removed from rotation.`);
}

/**
 * If the calendar day has changed since state was built / last checked,
 * reset all spent counters and restore the full activeRing.
 */
function _maybeResetBudgets(state) {
  if (!state.campaign) return;
  const todayKey = `happa_ads_${state.campaign.id}_${_todayStr()}`;
  if (state.spentKey === todayKey) return;   // still same day

  state.spentKey = todayKey;
  state.spent    = {};
  _saveSpent(todayKey, {});

  // Restore all stores that have products (re-use the same entry objects
  // so cursors are preserved — products continue from where they were)
  state.activeRing = state.allStoreEntries.filter(e => e.products.length > 0);
  state.ringIndex  = 0;
  console.info('[AdEngine] New day — budgets reset.');
}

/* ──────────────────────────────────────────────────────────── */
/*  DOM rendering                                              */
/* ──────────────────────────────────────────────────────────── */

function _renderSlide(slot, slotId, product, store, state) {
  const img      = product.images?.[0] || '';
  const isHero   = product.is_hero;
  const discount = !isHero && (product.original_price > product.price)
    ? Math.round((1 - product.price / product.original_price) * 100) : 0;

  const slideHTML = `
<div class="ads-slide ads-slide--active"
     ${!isHero ? `onclick="openProduct('${product.id}')" role="button" tabindex="0" aria-label="Sponsored: ${escHtml(product.name)}"` : ''}>

  ${img
    ? `<div class="ads-slide-bg" style="background-image:url('${escHtml(img)}')"></div>`
    : `<div class="ads-slide-bg ads-slide-bg--empty"></div>`}

  <div class="ads-img-wrap" ${isHero ? 'style="width:100%;height:100%;padding:0;max-width:none"' : ''}>
    ${img
      ? `<img class="ads-img" src="${escHtml(img)}" alt="${isHero ? 'Hero Banner' : escHtml(product.name)}" loading="lazy"
              ${isHero ? 'style="width:100%;height:100%;object-fit:cover;border-radius:0"' : ''}
              onerror="this.closest('.ads-img-wrap').classList.add('ads-img-wrap--err')">`
      : `<div class="ads-img-placeholder"><i class="fas fa-shopping-bag"></i></div>`}
  </div>

  ${!isHero ? `
  <div class="ads-info">
    <div class="ads-badges">
      <span class="ads-badge-sponsored"><i class="fas fa-ad"></i> Sponsored</span>
      ${discount > 0 ? `<span class="ads-badge-discount">${discount}% OFF</span>` : ''}
    </div>
    ${state.showStoreName && store.name
      ? `<div class="ads-store-name"><i class="fas fa-store"></i> ${escHtml(store.name)}</div>`
      : ''}
    <h2 class="ads-product-name">${escHtml(product.name)}</h2>
    <div class="ads-price-row">
      <span class="ads-price">GHS ${Number(product.price).toFixed(2)}</span>
      ${product.original_price > product.price
        ? `<span class="ads-original-price">GHS ${Number(product.original_price).toFixed(2)}</span>`
        : ''}
    </div>
    <button class="ads-cta" tabindex="-1">Shop Now <i class="fas fa-arrow-right"></i></button>
  </div>` : ''}
</div>`;

  const dotsHTML     = _buildStoreDots(state);
  const progressHTML = `<div class="ads-progress-bar" id="ads-progress-${slotId}">
  <div class="ads-progress-fill" id="ads-progress-fill-${slotId}"></div>
</div>`;

  const ssEl = slot.querySelector('.ads-slideshow');
  if (ssEl) {
    // Transition: exit old slide, enter new one
    const oldSlide = ssEl.querySelector('.ads-slide');
    if (oldSlide) {
      oldSlide.classList.remove('ads-slide--active');
      oldSlide.classList.add('ads-slide--exit');
      setTimeout(() => oldSlide.parentNode && oldSlide.remove(), 600);
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = slideHTML;
    ssEl.insertBefore(tmp.firstElementChild, ssEl.firstChild);

    // Refresh store dots in place
    const oldDots = ssEl.querySelector('.ads-store-dots');
    if (oldDots) oldDots.outerHTML = dotsHTML;

  } else {
    // First render — build the full shell
    slot.innerHTML = `
<div class="ads-slideshow" id="ads-ss-${slotId}">
  ${slideHTML}
  ${dotsHTML}
  ${progressHTML}
</div>`;
  }

  // Restart the progress bar
  requestAnimationFrame(() => {
    const fill = document.getElementById(`ads-progress-fill-${slotId}`);
    if (!fill) return;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = `width ${state.slideMs}ms linear`;
    fill.style.width = '100%';
  });
}

/* ──────────────────────────────────────────────────────────── */
/*  Store-dot budget indicators                                 */
/* ──────────────────────────────────────────────────────────── */

function _buildStoreDots(state) {
  const { activeRing, currentEntry, budgets, spent } = state;
  if (activeRing.length <= 1) return '<div class="ads-store-dots"></div>';

  const dotsHTML = activeRing.map(e => {
    const storeObj = AdEngine.stores.find(s => s.id === e.sid) || {};
    const budget   = Number(budgets[e.sid]) || 30;
    const used     = spent[e.sid] || 0;
    const pct      = Math.min(100, Math.round((used / budget) * 100));
    const active   = currentEntry && e.sid === currentEntry.sid;
    const name     = storeObj.name ? escHtml(storeObj.name) : e.sid.slice(0, 6);
    return `<div class="ads-store-dot${active ? ' ads-store-dot--active' : ''}"
                 title="${name} — ${pct}% of daily budget used"
                 style="--budget-pct:${pct}%">
              <span class="ads-store-dot-fill"></span>
            </div>`;
  }).join('');

  return `<div class="ads-store-dots">${dotsHTML}</div>`;
}

/* ──────────────────────────────────────────────────────────── */
/*  Slot helpers                                               */
/* ──────────────────────────────────────────────────────────── */

function _hideSlot(slot) {
  slot.innerHTML   = '';
  slot.style.display = 'none';
}

function _clearSlot(slotId) {
  const tid = AdEngine.timers[slotId];
  if (tid) { clearInterval(tid); delete AdEngine.timers[slotId]; }
  delete AdEngine.slots[slotId];
}
