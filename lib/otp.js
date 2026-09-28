'use strict';
// lib/otp.js — one-time passcodes for phone verification (#1).
//
// Storage is pluggable because the two backends differ: the deployed API must
// share codes across serverless instances (Supabase `otps` table), while the
// local dev server keeps them in db.json. A store adapter provides:
//
//   countOtpsSince(userId, purpose, sinceMs) -> number
//   clearPendingOtps(userId, purpose)        -> void
//   insertOtp(row)                           -> void
//   findPendingOtp(userId, purpose)          -> row | null
//   updateOtp(id, patch)                     -> void
//
// Codes are always generated with crypto.randomInt (never Math.random — a
// predictable OTP is guessable) and stored bcrypt-hashed by the caller.

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;          // a code lives five minutes
const MAX_ATTEMPTS = 5;                 // wrong guesses before it is burned
const RECENT_WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 3;                 // SMS requests per account per hour (abuse/cost)

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function newOtpId() {
  return 'otp-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

/** Issue (and store, hashed by the caller) a fresh code for one account. */
async function issueOtp(store, { userId, purpose = 'verify_phone', codeHash }) {
  const uid = String(userId || '');
  if (!uid) return { ok: false, status: 400, error: 'A signed-in account is required.' };

  const recent = await store.countOtpsSince(uid, purpose, Date.now() - RECENT_WINDOW_MS);
  if (recent >= MAX_PER_HOUR) {
    return { ok: false, status: 429, error: 'Too many codes requested. Please try again in an hour.' };
  }

  // Only one live code per account: an older, un-consumed code stops working
  // the moment a new one is requested.
  await store.clearPendingOtps(uid, purpose);
  const row = {
    id: newOtpId(),
    user_id: uid,
    purpose,
    code_hash: codeHash,
    attempts: 0,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    consumed_at: null
  };
  await store.insertOtp(row);
  return { ok: true, row };
}

function findPendingOtp(store, { userId, purpose = 'verify_phone' }) {
  return store.findPendingOtp(String(userId || ''), purpose);
}

function isExpired(row) {
  return !!(row && row.expires_at && Date.now() > new Date(row.expires_at).getTime());
}

function isLockedOut(row) {
  return !!row && (row.attempts || 0) >= MAX_ATTEMPTS;
}

module.exports = {
  TTL_MS,
  MAX_ATTEMPTS,
  MAX_PER_HOUR,
  RECENT_WINDOW_MS,
  generateCode,
  newOtpId,
  issueOtp,
  findPendingOtp,
  isExpired,
  isLockedOut
};
