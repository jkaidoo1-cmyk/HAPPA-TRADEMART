/* ============================================================
   HAPPA TRADEMART — Notifications Module
   ============================================================ */

function renderNotifBadge() {
  const uid = App.currentUser?.id;
  // Count unread only for current user (server-synced or local)
  const unread = uid
    ? App.notifications.filter(n => !n.is_read && n.user_id === uid).length
    : App.notifications.filter(n => !n.is_read).length;
  const badge  = document.getElementById('notif-badge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Fetch server-side notifications and merge into App.notifications ──
// This is the key function that pulls announcement notifications from the DB
async function fetchServerNotifications() {
  if (!App.currentUser) return;
  const uid = App.currentUser.id;
  try {
    // Fetch notifications for this user — try two pages to catch announcements
    const [res1, res2] = await Promise.all([
      apiGet('notifications', `limit=200&page=1`),
      apiGet('notifications', `limit=200&page=2`)
    ]);
    const all = [...(res1?.data || []), ...(res2?.data || [])];
    // Deduplicate by id, then filter to this user
    const seen = new Set();
    const unique = all.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });
    const serverNotifs = unique.filter(n => n.user_id === uid);
    if (!serverNotifs.length) return;

    // Build a Set of IDs already in local cache
    const localIds = new Set(App.notifications.map(n => n.id));
    let changed = false;

    for (const sn of serverNotifs) {
      if (!localIds.has(sn.id)) {
        // New notification from server — prepend
        App.notifications.unshift(sn);
        changed = true;
      } else {
        // Sync is_read status from server (server is source of truth)
        const local = App.notifications.find(n => n.id === sn.id);
        if (local && sn.is_read && !local.is_read) {
          local.is_read = true;
          changed = true;
        }
      }
    }

    if (changed) {
      // Sort newest-first and cap at 200
      App.notifications = App.notifications
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 200);
      saveNotifs();
      renderNotifBadge();
    }
  } catch(e) {
    console.warn('Failed to fetch server notifications', e);
  }
}

// ── Poll for new notifications every 60 s when user is logged in ──
let _notifPollTimer = null;
function startNotifPolling() {
  stopNotifPolling();
  if (!App.currentUser) return;
  _notifPollTimer = setInterval(async () => {
    if (!App.currentUser) { stopNotifPolling(); return; }
    await fetchServerNotifications();
  }, 60000);
}
function stopNotifPolling() {
  if (_notifPollTimer) { clearInterval(_notifPollTimer); _notifPollTimer = null; }
}

// ── Helper: build the notification list HTML ─────────────────
function _buildNotifListHTML(notifs) {
  if (!notifs.length) {
    return `
<div class="empty-state" style="padding:60px 20px">
  <i class="fas fa-bell-slash"></i>
  <h3>No notifications</h3>
  <p>You're all caught up! 🎉</p>
</div>`;
  }
  return notifs.map(n => notifItemHTML(n)).join('');
}

// ── Render notifications page — fetches from API so announcements appear ──
async function renderNotifications() {
  const c = document.getElementById('notifications-content');
  if (!c) return;

  if (!App.currentUser) {
    c.innerHTML = `
<div class="empty-state" style="padding:60px 20px">
  <i class="fas fa-bell-slash"></i>
  <h3>Sign in to see notifications</h3>
</div>`;
    return;
  }

  // Show loading spinner while fetching
  c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

  // Pull from server (announcements live here)
  await fetchServerNotifications();

  const uid = App.currentUser.id;
  const userNotifs = App.notifications
    .filter(n => n.user_id === uid)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  c.innerHTML = _buildNotifListHTML(userNotifs);
}

// ── Quick local-only render — used after mark-read / clear ───
function renderNotificationsLocal() {
  const c = document.getElementById('notifications-content');
  if (!c) return;

  const uid = App.currentUser?.id;
  let userNotifs = uid
    ? App.notifications.filter(n => n.user_id === uid)
    : App.notifications.slice(0, 5);
  userNotifs = userNotifs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  c.innerHTML = _buildNotifListHTML(userNotifs);
}

function openNotificationPopup(notifId) {
  const n = App.notifications.find(n => n.id === notifId);
  if (!n) return;
  
  const timeStr = n.created_at
    ? (typeof formatDateTime === 'function' ? formatDateTime(n.created_at) : new Date(n.created_at).toLocaleString())
    : '';
    
  const iconMap = {
    order:    'fas fa-shopping-bag',
    delivery: 'fas fa-truck',
    stock:    'fas fa-exclamation-triangle',
    referral: 'fas fa-gift',
    system:   'fas fa-info-circle',
    wallet:   'fas fa-wallet',
    promo:    'fas fa-tag',
    warning:  'fas fa-exclamation-triangle'
  };
  const icon = iconMap[n.type] || 'fas fa-bell';
  
  const colorMap = {
    order:    { badgeBg: '#d1fae5', text: '#065f46', iconBg: '#10b981' },
    delivery: { badgeBg: '#dbeafe', text: '#1e40af', iconBg: '#3b82f6' },
    stock:    { badgeBg: '#fef3c7', text: '#92400e', iconBg: '#f59e0b' },
    referral: { badgeBg: '#f3e8ff', text: '#5b21b6', iconBg: '#8b5cf6' },
    system:   { badgeBg: '#ffe5d9', text: '#9a3412', iconBg: '#e85d04' },
    wallet:   { badgeBg: '#d1fae5', text: '#065f46', iconBg: '#10b981' },
    promo:    { badgeBg: '#fce7f3', text: '#9d174d', iconBg: '#ec4899' },
    warning:  { badgeBg: '#fee2e2', text: '#991b1b', iconBg: '#ef4444' }
  };
  const theme = colorMap[n.type] || { badgeBg: '#ffe5d9', text: '#9a3412', iconBg: '#e85d04' };
  
  if (typeof showModal === 'function') {
    showModal(`
<div style="position:relative; overflow:visible; margin:15px 5px -10px 5px; font-family:'Outfit', sans-serif">
  <!-- Neumorphic Floating Overlapping Circular Icon Badge -->
  <div style="position:absolute; top:-38px; left:16px; width:44px; height:44px; border-radius:50%; background:#e6e9ef; color:${theme.iconBg}; display:flex; align-items:center; justify-content:center; font-size:1.25rem; box-shadow: 0 4px 10px rgba(0,0,0,0.06); z-index:2">
    <i class="${icon}"></i>
  </div>
  
  <!-- Neumorphic Modal Card -->
  <div class="notif-popup-card" style="border-radius:24px; background:#e6e9ef; box-shadow: 0 12px 30px rgba(0,0,0,0.06); padding:28px 24px 24px 24px; text-align:left; position:relative; z-index:1">
    <!-- Neumorphic Close Button -->
    <button onclick="closeModalForce()" style="position:absolute; top:16px; right:16px; width:28px; height:28px; border-radius:50%; background:#e6e9ef; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border:none; display:flex; align-items:center; justify-content:center; color:#6b7280; cursor:pointer; font-size:0.9rem; transition:all 0.15s" onmousedown="this.style.boxShadow='inset 0 1px 3px rgba(0,0,0,0.05)'" onmouseup="this.style.boxShadow='0 2px 5px rgba(0,0,0,0.05)'"><i class="fas fa-times"></i></button>
    
    <div style="margin-top:10px; margin-bottom:12px; display:flex; align-items:center; gap:8px">
      <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:1.1px; font-weight:800; color:${theme.text}; background:#e6e9ef; box-shadow: inset 0 1px 3px rgba(0,0,0,0.04); padding:4px 12px; border-radius:12px">${n.type || 'system'}</span>
      <span style="font-size:0.75rem; color:#8a909d"><i class="far fa-clock"></i> ${timeStr}</span>
    </div>
    
    <h3 style="font-size:1.15rem; font-weight:900; color:#1f2937; line-height:1.4; margin-bottom:8px; font-family:'Outfit', sans-serif">${escHtml(n.title || '')}</h3>
    <p style="font-size:0.875rem; color:#4b5563; line-height:1.6; margin:0; word-break:break-word; font-family:'Outfit', sans-serif">${escHtml(n.message || '')}</p>
  </div>
</div>`, true); // center modal

    // Style override to let glassy modal card render properly without default white background or scrollbars
    const modalCenter = document.querySelector('.modal-center');
    if (modalCenter) {
      modalCenter.style.background = 'transparent';
      modalCenter.style.boxShadow = 'none';
      modalCenter.style.overflow = 'visible';
      modalCenter.style.maxHeight = 'none';
    }
  }
  
  // Mark as read immediately when viewed
  if (typeof markNotifRead === 'function') {
    markNotifRead(notifId);
  }
}

function notifItemHTML(n) {
  const typeClass  = 'notif-' + (n.type || 'system');
  const iconMap = {
    order:    'fas fa-shopping-bag',
    delivery: 'fas fa-truck',
    stock:    'fas fa-exclamation-triangle',
    referral: 'fas fa-gift',
    system:   'fas fa-info-circle',
    wallet:   'fas fa-wallet',
    promo:    'fas fa-tag',
    warning:  'fas fa-exclamation-triangle'
  };
  const icon = iconMap[n.type] || 'fas fa-bell';
  const timeStr = n.created_at
    ? (typeof formatDateTime === 'function' ? formatDateTime(n.created_at) : new Date(n.created_at).toLocaleString())
    : '';
  return `
<div class="notif-item ${n.is_read ? '' : 'unread'} ${typeClass}" onclick="openNotificationPopup('${n.id}')">
  <div class="notif-icon"><i class="${icon}"></i></div>
  <div class="notif-content">
    <div class="notif-title">${escHtml(n.title || '')}</div>
    <div class="notif-msg">${escHtml(n.message || '')}</div>
    <div class="notif-time">${timeStr}</div>
  </div>
  ${!n.is_read ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--primary);flex-shrink:0;margin-top:4px"></div>' : ''}
</div>`;
}

async function markNotifRead(notifId) {
  const n = App.notifications.find(n => n.id === notifId);
  if (n) {
    // Snapshot for rollback
    const wasRead = n.is_read;

    // Optimistic: mark as read immediately
    n.is_read = true;
    saveNotifs();

    // Find the DOM element and animate
    const el = document.querySelector(`.notif-item[onclick*="${notifId}"]`)
      || document.querySelector(`[data-notif-id="${notifId}"]`);
    if (el) {
      el.classList.remove('unread');
      // Remove the unread dot
      const dot = el.querySelector('.notif-unread-dot');
      if (dot) dot.remove();
      OptimisticUI.pulse(el);
    }
    renderNotifBadge();

    // Patch server in background (silent fail)
    if (notifId && notifId.length > 10 && !notifId.startsWith('n')) {
      try {
        await apiPatch('notifications', notifId, { is_read: true });
      } catch (e) {
        // Rollback
        n.is_read = wasRead;
        saveNotifs();
        renderNotifBadge();
        if (el) {
          el.classList.add('unread');
          OptimisticUI.shake(el);
        }
      }
    }
  }
  renderNotificationsLocal();
}

async function markAllRead() {
  const uid = App.currentUser?.id;
  App.notifications.forEach(n => {
    if (!uid || n.user_id === uid) n.is_read = true;
  });
  saveNotifs();
  renderNotifBadge();
  renderNotificationsLocal();
  showToast('All notifications marked as read', 'info');

  // Patch all unread server records
  if (App.currentUser) {
    try {
      const res = await apiGet('notifications', `limit=200`);
      const unread = (res?.data || []).filter(n => n.user_id === uid && !n.is_read);
      await Promise.all(unread.map(n => apiPatch('notifications', n.id, { is_read: true })));
    } catch(e) { /* silent */ }
  }
}

async function clearAllNotifications() {
  if (!confirm('Clear all notifications? This cannot be undone.')) return;

  const uid = App.currentUser?.id;
  if (uid) {
    App.notifications = App.notifications.filter(n => n.user_id && n.user_id !== uid);
  } else {
    App.notifications = [];
  }
  saveNotifs();
  renderNotifBadge();
  renderNotificationsLocal();
  showToast('Notifications cleared', 'info');

  // Delete from server
  if (uid) {
    try {
      const res = await apiGet('notifications', `limit=200`);
      const mine = (res?.data || []).filter(n => n.user_id === uid);
      await Promise.all(mine.map(n => apiDelete('notifications', n.id)));
    } catch(e) { /* silent */ }
  }
}

// ── Push Notification Simulation ─────────────────────────
function simulatePushNotification(title, body, type = 'system') {
  if (!App.currentUser) return;
  addNotification(App.currentUser.id, type, title, body);
  showToast(`${title}: ${body}`, type === 'order' ? 'success' : type === 'stock' ? 'warning' : 'info');
}

// ── Notification Templates ────────────────────────────────
const NotifTemplates = {
  orderPlaced: (orderId, pkgCodes) =>
    addNotification(App.currentUser?.id, 'order', '✅ Order Confirmed!',
      `Order #${orderId}. Packages: ${pkgCodes.join(', ')}`),

  packageShipped: (userId, pkgCode, trackingLink) =>
    addNotification(userId, 'delivery', '🚚 Package Shipped!',
      `Package ${pkgCode} is on the way. Track: ${trackingLink || 'SMS will be sent'}`, trackingLink),

  packageDelivered: (userId, pkgCode) =>
    addNotification(userId, 'delivery', '🎉 Package Delivered!',
      `Package ${pkgCode} has been delivered. Please rate your experience.`),

  lowStock: (vendorId, productName, qty) =>
    addNotification(vendorId, 'stock', '⚠️ Low Stock Alert',
      `"${productName}" has only ${qty} unit(s) left. Consider restocking.`),

  soldOut: (vendorId, productName) =>
    addNotification(vendorId, 'stock', '❌ Item Sold Out',
      `"${productName}" is now out of stock and hidden from buyers.`),

  referralEarning: (userId, amount) =>
    addNotification(userId, 'referral', '🎁 Referral Reward!',
      `You earned GHS ${amount.toFixed(2)} from a referral purchase.`),

  newVendor: (userId) =>
    addNotification(userId, 'system', '🏪 Store Assigned!',
      'A new store has been assigned to you. Complete verification to start selling.'),

  welcomeBack: (userId, name) =>
    addNotification(userId, 'system', '👋 Welcome back!',
      `Hello ${name}! Check out today's flash deals.`)
};
