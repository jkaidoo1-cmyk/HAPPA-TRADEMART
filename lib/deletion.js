/**
 * Shared logic for account-deletion REQUESTS.
 *
 * Deleting an account used to be immediate and irreversible. Instead a user
 * now *requests* deletion: the platform hides everything they own (so it stops
 * showing up to buyers), the main admin is notified, and the admin investigates
 * and performs the real cascade delete only when there is no issue.
 *
 * Everything here is pure (no express/db dependency) so both backends can share
 * it and it can be unit tested.
 */

// The user status that means "deletion requested, pending admin review". It is
// also stamped on the user's public rows while the request is open.
const PENDING_DELETION = 'pending_deletion';

// Tables that make up a user's public presence, and the column linking a row to
// its owner. On a request each publicly-visible row is moved to
// `pending_deletion`; approving a restore flips those rows back to `active`.
const CONTENT_TABLES = [
  { table: 'stores',       col: 'vendor_id' },
  { table: 'storefronts',  col: 'vendor_id' },
  { table: 'products',     col: 'vendor_id' },
  { table: 'services',     col: 'rendor_id' },
  { table: 'ad_campaigns', col: 'vendor_id' },
];

function norm(value) {
  return String(value == null ? '' : value).toLowerCase();
}

function isPendingDeletion(status) {
  return norm(status) === PENDING_DELETION;
}

/**
 * True when a row is currently reachable by the public and therefore must be
 * hidden. Rows already hidden (draft/suspended stores, sold_out or archived
 * products, inactive services/ads) are left untouched — hiding them would make
 * a later restore wrongly publish something the owner had deliberately parked.
 */
function isPubliclyVisible(table, row) {
  if (!row) return false;
  const st = norm(row.status);
  if (table === 'stores') {
    return st === 'active' || norm(row.storefront_status) === 'active';
  }
  // products / storefronts / services / ad_campaigns are public only while active
  return st === 'active';
}

/**
 * Move every publicly-visible row owned by `userId` to PENDING_DELETION.
 * Mutates the records in place and returns per-table counts.
 *
 * @param {Object<string, Array>} rowsByTable  e.g. { stores, products, services }
 * @param {string} userId
 */
function hideUserContent(rowsByTable, userId) {
  const counts = {};
  for (const { table, col } of CONTENT_TABLES) {
    const rows = (rowsByTable && rowsByTable[table]) || [];
    let changed = 0;
    for (const row of rows) {
      if (!row || String(row[col]) !== String(userId)) continue;
      if (!isPubliclyVisible(table, row)) continue;
      if (isPendingDeletion(row.status)) continue;
      row.status = PENDING_DELETION;
      changed++;
    }
    counts[table] = changed;
  }
  return counts;
}

/**
 * Flip every PENDING_DELETION row owned by `userId` back to `active`.
 * Mutates the records in place and returns per-table counts.
 */
function restoreUserContent(rowsByTable, userId) {
  const counts = {};
  for (const { table, col } of CONTENT_TABLES) {
    const rows = (rowsByTable && rowsByTable[table]) || [];
    let changed = 0;
    for (const row of rows) {
      if (!row || String(row[col]) !== String(userId)) continue;
      if (!isPendingDeletion(row.status)) continue;
      row.status = 'active';
      changed++;
    }
    counts[table] = changed;
  }
  return counts;
}

/**
 * Build the admin-facing notification announcing a deletion request.
 * @param {object} user  the requesting user row (name/email/role used)
 */
function deletionRequestNotification(user) {
  const u = user || {};
  const name = String(u.name || u.preferred_store_name || '').trim();
  const email = String(u.email || '').trim();
  const role = String(u.role || 'user').trim();
  const who = name || email || 'A user';
  const detail = email && name ? `${name} (${email})` : who;
  return {
    user_id: 'admin',
    type: 'admin',
    title: 'Account deletion requested',
    message: `${detail} (${role}) requested account deletion. Their storefront and listings are now hidden — review the account and delete it if there is no issue.`,
    action_url: '#admin-dashboard',
  };
}

module.exports = {
  PENDING_DELETION,
  CONTENT_TABLES,
  isPendingDeletion,
  isPubliclyVisible,
  hideUserContent,
  restoreUserContent,
  deletionRequestNotification,
};
