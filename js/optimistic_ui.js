/* ============================================================
   HAPPA TRADEMART — Optimistic UI Helpers
   ------------------------------------------------------------
   A small toolkit for making the UI feel instant. The pattern
   is: update local state + render immediately, run the network
   request in the background, and roll back only if the server
   rejects the change.
   ============================================================ */

const OptimisticUI = {
  // ── Animation primitives ─────────────────────────────────
  _injectStyles() {
    if (document.getElementById('optimistic-ui-styles')) return;
    const s = document.createElement('style');
    s.id = 'optimistic-ui-styles';
    s.textContent = `
      @keyframes ou-pulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.06); }
      }
      @keyframes ou-shake {
        0%, 100% { transform: translateX(0); }
        20%      { transform: translateX(-3px); }
        40%      { transform: translateX(3px); }
        60%      { transform: translateX(-2px); }
        80%      { transform: translateX(2px); }
      }
      @keyframes ou-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes ou-pop {
        0%   { transform: scale(0.85); opacity: 0; }
        60%  { transform: scale(1.08); opacity: 1; }
        100% { transform: scale(1); }
      }
      .ou-pulse      { animation: ou-pulse 0.4s ease; }
      .ou-shake      { animation: ou-shake 0.35s ease; }
      .ou-fade-in    { animation: ou-fade-in 0.25s ease-out; }
      .ou-pop        { animation: ou-pop 0.35s ease-out; }
      .ou-pending    { opacity: 0.65; pointer-events: none; }
      .ou-saved      { box-shadow: 0 0 0 2px var(--success) inset !important; transition: box-shadow 0.4s; }
      .ou-failed     { box-shadow: 0 0 0 2px var(--danger) inset !important; }
      .ou-btn-saving { display: inline-flex; align-items: center; gap: 6px; }
    `;
    document.head.appendChild(s);
  },

  /**
   * Briefly pulse an element to draw the eye to a change.
   * Pass a CSS selector or an Element.
   */
  pulse(target) {
    this._injectStyles();
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    el.classList.remove('ou-pulse');
    // restart animation
    void el.offsetWidth;
    el.classList.add('ou-pulse');
    setTimeout(() => el.classList.remove('ou-pulse'), 500);
  },

  /** Shake an element to indicate an error. */
  shake(target) {
    this._injectStyles();
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    el.classList.remove('ou-shake');
    void el.offsetWidth;
    el.classList.add('ou-shake');
    setTimeout(() => el.classList.remove('ou-shake'), 400);
  },

  /** Fade an element in (e.g. a newly added review or wishlist card). */
  fadeIn(target) {
    this._injectStyles();
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    el.classList.add('ou-fade-in');
  },

  /**
   * Mark an element as "pending" while a request is in flight.
   * Returns a `finalize(success)` callback to clean up.
   */
  pending(target) {
    this._injectStyles();
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return () => {};
    el.classList.add('ou-pending');
    return (success = true) => {
      el.classList.remove('ou-pending');
      if (success) {
        el.classList.add('ou-saved');
        setTimeout(() => el.classList.remove('ou-saved'), 1200);
      } else {
        el.classList.add('ou-failed');
        setTimeout(() => el.classList.remove('ou-failed'), 1200);
      }
    };
  },

  /**
   * The core helper — apply a local mutation immediately, run a
   * network call, and roll back if the network call fails.
   *
   * @param {object}   opts
   * @param {Function} opts.apply    () => any   — local mutation, returns a snapshot
   * @param {Function} opts.rollback (snap) => void — undo the mutation
   * @param {Function} opts.request  () => Promise — network call
   * @param {string}   opts.success  toast / msg
   * @param {string}   opts.error    fallback error toast
   * @param {Element}  opts.spinner  optional element to flip to "saving" state
   * @returns {Promise<any>}
   */
  async apply({ apply, rollback, request, success = 'Saved!', error = 'Could not save', spinner }) {
    let snap = null;
    try {
      snap = apply();
    } catch (e) {
      console.warn('[OptimisticUI.apply] apply() failed:', e);
    }
    const finalize = this.pending(spinner);
    try {
      const result = await request();
      finalize(true);
      if (success) showToast(success, 'success', 2200);
      return result;
    } catch (err) {
      console.warn('[OptimisticUI.apply] request failed, rolling back:', err);
      if (snap !== null && typeof rollback === 'function') {
        try { rollback(snap); } catch (e) { console.warn('rollback failed:', e); }
      }
      finalize(false);
      if (error) showToast(error + (err?.message ? ` — ${err.message}` : ''), 'error', 4000);
      throw err;
    }
  },

  // ── Button state machine ────────────────────────────────
  /**
   * Set a button into a "saving…" / "saved ✓" / "failed" state.
   * Returns a `setState(state)` function.
   *
   *   const set = OptimisticUI.button(btn, 'Save changes');
   *   set('saving');       // shows spinner + "Saving…"
   *   set('saved');        // shows check + "Saved"
   *   set('failed');       // shows x  + "Failed"
   *   set('idle');         // back to default
   */
  button(btn, idleText = 'Save') {
    if (!btn) return () => {};
    const ORIGINAL_HTML = btn.innerHTML;
    const STATES = {
      idle:    () => { btn.disabled = false; btn.innerHTML = ORIGINAL_HTML; },
      saving:  () => { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; },
      saved:   () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Saved ✓'; btn.classList.add('ou-saved');
                      setTimeout(() => { btn.classList.remove('ou-saved'); btn.innerHTML = ORIGINAL_HTML; }, 1600); },
      failed:  () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-times-circle"></i> Failed'; btn.classList.add('ou-failed');
                      setTimeout(() => { btn.classList.remove('ou-failed'); btn.innerHTML = ORIGINAL_HTML; }, 2000); }
    };
    return (state) => (STATES[state] || STATES.idle)();
  },

  // ── Skeleton placeholder for "loading" rows ─────────────
  skeletonRow(text = 'Loading…', height = 14) {
    return `<div style="height:${height}px;background:linear-gradient(90deg,var(--bg) 0%,#e8eaf0 50%,var(--bg) 100%);background-size:200% 100%;animation:ou-shimmer 1.4s linear infinite;border-radius:6px"></div>`;
  }
};

// Expose globally
window.OptimisticUI = OptimisticUI;
