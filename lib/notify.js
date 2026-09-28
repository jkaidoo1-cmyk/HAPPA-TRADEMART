/**
 * Shared logic for the narrow notification endpoint (#10).
 *
 * Background: notifications used to be created directly by the browser
 * (`apiPost('notifications', …)`) from ~59 call sites, because inserting a row
 * auto-dispatches a web-push. That made every notification forgeable and turned
 * the endpoint into an open push relay, so POST on the notifications table is
 * now server/admin-only — which silently broke order, approval and support
 * alerts. This module backs `POST /api/notify`, which restores those alerts
 * without reopening the relay: the caller supplies a recipient, and the server
 * checks that they are allowed to address that person, then builds and stores
 * the row itself.
 *
 * Everything here is pure logic (no express/db dependency) so both backends can
 * share it and it can be unit tested.
 */

// Notification kinds the client is allowed to request. Unknown values fall back
// to 'system' rather than being rejected — a typo must not lose an alert.
const NOTIFY_TYPES = new Set([
  'system', 'order', 'payment', 'wallet', 'earning', 'stock', 'delivery',
  'support', 'referral', 'subscription', 'promotion', 'review', 'announcement',
  'admin'
]);

const MAX_RECIPIENT = 80;
const MAX_TITLE = 120;
const MAX_MESSAGE = 500;
const MAX_ACTION_URL = 300;

// Tables whose rows link two accounts, and the columns holding the parties.
// A caller may address someone else when they share such a row (buyer↔vendor,
// referrer↔referred, ticket owner↔admin).
const PARTY_TABLES = {
  // A user row links two accounts when one referred the other (referred_by).
  // 'id' is included so "the row belongs to me" counts as one side.
  users: ['id', 'referred_by'],
  orders: ['buyer_id', 'vendor_id'],
  packages: ['buyer_id', 'vendor_id'],
  support_tickets: ['user_id'],
  referrals: ['referrer_id', 'referred_id'],
  service_orders: ['buyer_id', 'rendor_id'],
  ad_campaigns: ['vendor_id']
};

// Broadcast pseudo-recipients. Only admins may use them.
const BROADCAST_TARGETS = new Set(['all', 'global']);

// The pseudo-recipient every signed-in user (and anonymous signup/support flow)
// may address: the platform's admins.
const ADMIN_TARGET = 'admin';

// Strip control characters — notification text is rendered into HTML and the
// push payload, and raw control bytes have no legitimate use there.
function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

/**
 * Validate and normalize a /api/notify request body.
 * @returns {{ok: true, value: object} | {ok: false, status: number, error: string}}
 */
function sanitizeNotifyBody(body = {}) {
  const to = cleanText(body.to != null ? body.to : body.user_id, MAX_RECIPIENT);
  const title = cleanText(body.title, MAX_TITLE);
  if (!to) return { ok: false, status: 400, error: 'A recipient is required.' };
  if (!title) return { ok: false, status: 400, error: 'A notification title is required.' };

  let type = cleanText(body.type, 24).toLowerCase();
  if (!NOTIFY_TYPES.has(type)) type = 'system';

  // Optional pointer at the row that links caller and recipient. Required for
  // any cross-user notification that is not addressed to an admin.
  let ref = null;
  const rawRef = body.ref;
  if (rawRef && typeof rawRef === 'object') {
    const table = String(rawRef.table || '');
    const id = cleanText(rawRef.id, MAX_RECIPIENT);
    if (PARTY_TABLES[table] && id) ref = { table, id };
  }

  return {
    ok: true,
    value: {
      user_id: to,
      type,
      title,
      message: cleanText(body.message, MAX_MESSAGE),
      action_url: cleanText(body.action_url || body.actionUrl, MAX_ACTION_URL),
      ref
    }
  };
}

/** True when `record` lists `userId` as one of the parties of its table. */
function isParty(record, table, userId) {
  const cols = PARTY_TABLES[table];
  if (!record || !cols || !userId) return false;
  const id = String(userId);
  return cols.some(c => String(record[c] == null ? '' : record[c]) === id);
}

/** True when both users appear on the same row of the given table. */
function recordLinksBoth(record, table, userA, userB) {
  return isParty(record, table, userA) && isParty(record, table, userB);
}

/**
 * Decide whether `viewer` may send this notification.
 *
 * @param {object}  args
 * @param {object|null} args.viewer            session ({userId, role}) or null
 * @param {object}  args.value                 sanitized body from sanitizeNotifyBody
 * @param {boolean} [args.recipientIsAdmin]    recipient account has role admin
 * @param {boolean} [args.sharedEntity]        caller+recipient share a ref row
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
function authorizeNotify({ viewer = null, value, recipientIsAdmin = false, sharedEntity = false }) {
  const target = String(value.user_id);

  // Admins keep full reach: approvals, announcements, wallet adjustments.
  if (viewer && String(viewer.role) === 'admin') return { ok: true };

  if (BROADCAST_TARGETS.has(target)) {
    return { ok: false, status: 403, error: 'Announcements can only be sent by an admin.' };
  }

  // Escalating to the platform's admins (signup alerts, support tickets,
  // withdrawal requests, password reset requests) is open to any caller,
  // including anonymous signup — bounded by the notify rate limiter.
  if (target === ADMIN_TARGET || recipientIsAdmin) return { ok: true };

  if (!viewer) {
    return { ok: false, status: 401, error: 'Sign in to send this notification.' };
  }

  // Your own inbox is always fair game (order confirmations, receipts).
  if (String(viewer.userId) === target) return { ok: true };

  // Otherwise the two users must share the row they are talking about:
  // buyer↔vendor on an order/package, referrer↔referred, ticket owner↔staff.
  if (sharedEntity && value.ref) return { ok: true };

  return {
    ok: false,
    status: 403,
    error: 'You can only notify yourself, an admin, or someone you share an order, package, ticket, referral or campaign with.'
  };
}

module.exports = {
  NOTIFY_TYPES,
  PARTY_TABLES,
  ADMIN_TARGET,
  BROADCAST_TARGETS,
  MAX_TITLE,
  MAX_MESSAGE,
  sanitizeNotifyBody,
  isParty,
  recordLinksBoth,
  authorizeNotify,
  cleanText
};
