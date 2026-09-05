async function addNotification(userId, type, title, message, actionUrl = '') {
  if (!userId) return;
  const targetId = String(userId);

  // Check if target user is deleted or no longer exists
  try {
    const usersRes = await apiGet('users', 'limit=500').catch(() => null);
    const userList = usersRes?.data || (Array.isArray(usersRes) ? usersRes : []);
    const targetUser = userList.find(u => String(u.id) === targetId);

    if (targetUser && targetUser.status === 'deleted') {
      console.warn(`[Notification Suppressed] User ${targetId} is deleted.`);
      return;
    }
  } catch(e) {}

  // Smart deduplication guard: title AND message AND target user_id within last 5 seconds
  const nowMs = Date.now();
  const isDup = (App.notifications || []).some(n => {
    if (!n) return false;
    const sameUser = String(n.user_id) === targetId;
    const sameTitle = String(n.title) === String(title);
    const sameMsg = String(n.message) === String(message);
    const notifTime = new Date(n.created_at || 0).getTime();
    return sameUser && sameTitle && sameMsg && Math.abs(nowMs - notifTime) < 5000;
  });

  if (isDup) {
    console.log(`[Notification Deduplicated] Suppressed identical notification "${title}" for user ${targetId}`);
    return;
  }

  const notif = {
    id: 'n' + Date.now() + Math.random().toString(36).substr(2, 5),
    user_id: targetId,
    type: type || 'system',
    title: title || '',
    message: message || '',
    is_read: false,
    action_url: actionUrl || '',
    created_at: new Date().toISOString()
  };

  // Only update local notifications list and badge if target userId matches current user
  if (App.currentUser && String(App.currentUser.id) === targetId) {
    App.notifications.unshift(notif);
    if (App.notifications.length > 100) App.notifications.pop();
    saveNotifs();
    renderNotifBadge();
  }

  // Upload to server DB
  try {
    await apiPost('notifications', notif);
  } catch (err) {
    console.warn('Failed to upload notification to server:', err);
  }

  // Trigger browser push notification (fire-and-forget, non-blocking)
  if (typeof sendPushToUser === 'function' && targetId && String(targetId) !== 'all' && String(targetId) !== 'global') {
    sendPushToUser(targetId, title, message, actionUrl || './');
  }
}
window.addNotification = addNotification;

function renderNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const uid = App.currentUser?.id ? String(App.currentUser.id) : null;
  if (!uid) {
    badge.textContent = '0';
    badge.classList.add('hidden');
    return;
  }
  // Count unread only for current user
  const unread = App.notifications.filter(n => !n.is_read && (String(n.user_id) === uid || n.user_id === 'all' || n.user_id === 'global')).length;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

// ── Fetch server-side notifications and merge into App.notifications ──
async function fetchServerNotifications() {
  if (!App.currentUser || !App.currentUser.id) {
    App.notifications = [];
    saveNotifs();
    renderNotifBadge();
    return;
  }

  // Validate session user status: if deleted, stop polling and log out immediately
  const isValid = await verifySessionUser();
  if (isValid === false) return;

  const uid = String(App.currentUser.id);
  try {
    const res = await apiGet('notifications', `limit=200`);
    const all = res?.data || (Array.isArray(res) ? res : []);
    
    // Filter to current user OR global announcements
    const serverNotifs = all.filter(n => {
      const nUid = String(n.user_id || '');
      return nUid === uid || nUid === 'all' || nUid === 'global';
    });

    const seen = new Set();
    const unique = serverNotifs.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    // Synchronize App.notifications for current user
    App.notifications = unique
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 200);

    saveNotifs();
    renderNotifBadge();
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

// ── Render notifications page ──
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

  // Pull from server
  await fetchServerNotifications();

  const uid = String(App.currentUser.id);
  const userNotifs = App.notifications
    .filter(n => String(n.user_id) === uid || n.user_id === 'all' || n.user_id === 'global')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
  let pushStatus = '';
  if (pushSupported) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const isSubscribed = !!sub;
      pushStatus = `
<div style="margin:0 0 12px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center">
  <div style="display:flex;align-items:center;gap:8px;font-size:.82rem">
    <i class="fas fa-bell" style="color:${isSubscribed ? 'var(--success)' : 'var(--text-muted)'}"></i>
    <span>${isSubscribed ? 'Push notifications are <strong>on</strong>' : 'Push notifications are <strong>off</strong>'}</span>
  </div>
  <button class="btn btn-sm ${isSubscribed ? 'btn-outline' : 'btn-primary'}" onclick="${isSubscribed ? 'unsubscribeFromPush()' : 'subscribeToPush()'}" style="font-size:.75rem;padding:4px 12px">
    ${isSubscribed ? 'Disable' : 'Enable'}
  </button>
</div>`;
    } catch(e) {}
  }

  const hasNotifs = userNotifs.length > 0;
  const actionBar = hasNotifs ? `
<div style="margin:0 0 8px;display:flex;gap:8px">
  <button class="btn btn-ghost btn-sm" onclick="markAllRead()" style="font-size:.73rem;padding:4px 10px"><i class="fas fa-check-double"></i> Mark all read</button>
  <button class="btn btn-ghost btn-sm" onclick="clearAllNotifications()" style="font-size:.73rem;padding:4px 10px;color:var(--danger)"><i class="fas fa-trash"></i> Clear all</button>
</div>` : '';

  c.innerHTML = pushStatus + actionBar + _buildNotifListHTML(userNotifs);
}

// ── Quick local-only render — used after mark-read / clear ───
function renderNotificationsLocal() {
  const c = document.getElementById('notifications-content');
  if (!c) return;

  const uid = App.currentUser?.id ? String(App.currentUser.id) : null;
  if (!uid) {
    c.innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <i class="fas fa-bell-slash"></i>
        <h3>Sign in to see notifications</h3>
      </div>`;
    return;
  }
  let userNotifs = App.notifications.filter(n => String(n.user_id) === uid || n.user_id === 'all' || n.user_id === 'global');
  userNotifs = userNotifs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

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
    const wasRead = n.is_read;

    // Optimistic: mark as read immediately
    n.is_read = true;
    saveNotifs();

    const el = document.querySelector(`.notif-item[onclick*="${notifId}"]`)
      || document.querySelector(`[data-notif-id="${notifId}"]`);
    if (el) {
      el.classList.remove('unread');
      const dot = el.querySelector('.notif-unread-dot');
      if (dot) dot.remove();
      if (window.OptimisticUI) OptimisticUI.pulse(el);
    }
    renderNotifBadge();

    // Patch server in background
    if (notifId) {
      try {
        await apiPatch('notifications', notifId, { is_read: true });
      } catch (e) {
        n.is_read = wasRead;
        saveNotifs();
        renderNotifBadge();
        if (el) {
          el.classList.add('unread');
          if (window.OptimisticUI) OptimisticUI.shake(el);
        }
      }
    }
  }
  renderNotificationsLocal();
}

async function markAllRead() {
  const uid = App.currentUser?.id ? String(App.currentUser.id) : null;
  App.notifications.forEach(n => {
    if (!uid || String(n.user_id) === uid || n.user_id === 'all' || n.user_id === 'global') n.is_read = true;
  });
  saveNotifs();
  renderNotifBadge();
  renderNotificationsLocal();
  showToast('All notifications marked as read', 'info');

  if (uid) {
    try {
      const res = await apiGet('notifications', `limit=200`);
      const all = res?.data || (Array.isArray(res) ? res : []);
      const unread = all.filter(n => (String(n.user_id) === uid || n.user_id === 'all' || n.user_id === 'global') && !n.is_read);
      await Promise.all(unread.map(n => apiPatch('notifications', n.id, { is_read: true })));
    } catch(e) { /* silent */ }
  }
}

async function clearAllNotifications() {
  if (!confirm('Clear all notifications? This cannot be undone.')) return;

  const uid = App.currentUser?.id ? String(App.currentUser.id) : null;
  if (uid) {
    App.notifications = App.notifications.filter(n => n.user_id && String(n.user_id) !== uid && n.user_id !== 'all' && n.user_id !== 'global');
  } else {
    App.notifications = [];
  }
  saveNotifs();
  renderNotifBadge();
  renderNotificationsLocal();
  showToast('Notifications cleared', 'info');

  if (uid) {
    try {
      const res = await apiGet('notifications', `limit=200`);
      const all = res?.data || (Array.isArray(res) ? res : []);
      const mine = all.filter(n => String(n.user_id) === uid);
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

// ── Push Notifications (Browser Push API) ───────────────────
// Stores subscription server-side; shows real browser notifications
// even when the tab is in the background or the app is closed.

async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Push API not supported in this browser');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    // Check if already subscribed
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // Re-sync with server in case it was lost
      await _syncSubscription(existing);
      return;
    }
    // Auto-request permission on user interaction (browser requires gesture)
    // Don't auto-prompt — wait for user to click enable button
  } catch(e) {
    console.warn('[Push] init error:', e);
  }
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Push notifications are not supported in this browser', 'info');
    return false;
  }
  try {
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notification permission denied. Please allow notifications in your browser settings.', 'warning');
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    // Get VAPID key from server
    const res = await apiFetch('push/vapid-key');
    const vapidKey = res?.publicKey;
    if (!vapidKey) {
      showToast('Push notifications not configured', 'error');
      return false;
    }
    // Convert VAPID key to Uint8Array
    const appServerKey = _urlBase64ToUint8Array(vapidKey);
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey
    });
    // Store subscription on server
    await apiPost('push/subscribe', {
      subscription: {
        endpoint: subscription.endpoint,
        keys: subscription.toJSON().keys
      },
      user_id: App.currentUser?.id || 'anonymous'
    });
    showToast('Push notifications enabled 🔔', 'success');
    if (typeof renderNotifications === 'function') renderNotifications();
    return true;
  } catch(e) {
    console.error('[Push] Subscribe failed:', e);
    showToast('Failed to enable push notifications', 'error');
    return false;
  }
}

async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiPost('push/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    showToast('Push notifications disabled', 'info');
    if (typeof renderNotifications === 'function') renderNotifications();
  } catch(e) {
    console.warn('[Push] Unsubscribe error:', e);
  }
}

async function _syncSubscription(subscription) {
  try {
    await apiPost('push/subscribe', {
      subscription: {
        endpoint: subscription.endpoint,
        keys: subscription.toJSON().keys
      },
      user_id: App.currentUser?.id || 'anonymous'
    });
  } catch(e) {
    console.warn('[Push] Sync failed:', e);
  }
}

// Helper: convert VAPID public key to Uint8Array
function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ── Send push from client (calls server endpoint) ───────────
async function sendPushToUser(userId, title, body, url) {
  try {
    await apiPost('push/send', { user_id: userId, title, body, url });
  } catch(e) {
    console.warn('[Push] sendPushToUser failed:', e);
  }
}

// Auto-init push when user logs in
function _hookPushInit() {
  if (App.currentUser && App.currentUser.id) {
    // Delay to avoid blocking page load
    setTimeout(() => initPushNotifications(), 3000);
  }
}
// Hook into existing auth flow
if (typeof window !== 'undefined') {
  window._hookPushInit = _hookPushInit;
  window.subscribeToPush = subscribeToPush;
  window.unsubscribeFromPush = unsubscribeFromPush;
  window.sendPushToUser = sendPushToUser;
}
