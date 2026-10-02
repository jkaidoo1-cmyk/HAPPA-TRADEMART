'use strict';
// ── How many posts a rendor may hold at once ───────────────────────────────
// A rendor's posts are `services` rows (see js/rendor.js): title, price, photo,
// description, with a status of active / paused / archived. Clients only ever
// see the active ones, but a rendor's own dashboard treats paused posts as
// theirs too — so the cap counts both, and removing a post (the trash action
// archives it) frees a slot immediately.
//
// The rule lives here, and every write path asks it, because a cap enforced only
// in the browser is not a cap: the same POST that the button blocks can be sent
// straight to the API.
//
// Pure functions only — both the Vercel function and the local server count rows
// their own way and then ask exceedsLimit().

const MAX_POSTS = 5;

// 'active' and 'paused' are posts the rendor holds; 'archived' is one they threw
// away. A missing status is an active post (the column defaults to active).
const HELD_STATUSES = ['active', 'paused'];
const DISCARDED_STATUSES = ['archived', 'deleted', 'removed'];

function normalizeStatus(status) {
  const s = String(status == null ? '' : status).trim().toLowerCase();
  return s || 'active';
}

/** Does this row occupy one of the rendor's post slots? */
function isHeldPost(row) {
  if (!row) return false;
  if (row.deleted === true || row.deleted === 'true') return false;
  return !DISCARDED_STATUSES.includes(normalizeStatus(row.status));
}

/** How many slots the rendor's rows occupy right now. */
function countHeldPosts(rows, rendorId) {
  const id = String(rendorId == null ? '' : rendorId);
  if (!id) return 0;
  return (rows || []).filter(row => row && String(row.rendor_id) === id && isHeldPost(row)).length;
}

function remainingPosts(rows, rendorId) {
  return Math.max(0, MAX_POSTS - countHeldPosts(rows, rendorId));
}

/**
 * Would this write leave the rendor over the cap?
 *
 * @param {object|null} existing  the row being changed, or null when creating
 * @param {object} body           the fields being written (may be partial)
 * @param {number} heldCount      how many slots the rendor's rows occupy now
 * @returns {boolean}
 */
function exceedsLimit({ existing = null, body = {}, heldCount = 0 } = {}) {
  const merged = { ...(existing || {}), ...(body || {}) };
  if (!isHeldPost(merged)) return false;      // the write frees a slot (or edits a discarded post)
  if (isHeldPost(existing)) return false;     // already held — editing an existing post is not a new one
  return heldCount >= MAX_POSTS;              // filling a new slot
}

function limitMessage(heldCount) {
  const n = Number.isFinite(Number(heldCount)) ? Number(heldCount) : MAX_POSTS;
  return `A rendor can have ${MAX_POSTS} posts at a time — you already have ${n}. Delete a post to publish a new one.`;
}

// The count the client shows and the copy it warns with, kept in step with the
// server rule above.
function postsUsedLabel(heldCount) {
  return `${Math.min(Number(heldCount) || 0, MAX_POSTS)} of ${MAX_POSTS} posts used`;
}

module.exports = {
  MAX_POSTS,
  HELD_STATUSES,
  normalizeStatus,
  isHeldPost,
  countHeldPosts,
  remainingPosts,
  exceedsLimit,
  limitMessage,
  postsUsedLabel
};
