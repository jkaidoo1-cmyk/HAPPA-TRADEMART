/**
 * Shared session/authentication module.
 *
 * Used by server.js (local dev) and api/index.js (deployed backend).
 *
 * Two modes:
 *  - If SESSION_SECRET is set (recommended, required on serverless so tokens
 *    survive instance rotation / cold starts), tokens are stateless HMAC-signed
 *    payloads: `base64url(payload).base64url(hmac)`. Logout is a client-side
 *    clear (token expires via its `exp` claim).
 *  - Without SESSION_SECRET, tokens are random 32-byte values kept in an
 *    in-memory Map (per-instance; fine for the single local server).
 *
 * The secret never leaves the server — it must be set in the environment
 * (Vercel dashboard for the deployed backend, .env locally).
 */

const crypto = require('crypto');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const inMemorySessions = new Map(); // token -> { userId, role, expiresAt }

function sessionSecret() {
  return String(process.env.SESSION_SECRET || '').trim();
}

/**
 * Create a session token for the given user.
 * @returns {string} token
 */
function createSessionToken(userId, role) {
  const secret = sessionSecret();
  if (secret) {
    const payload = Buffer.from(JSON.stringify({
      uid: String(userId),
      role,
      exp: Date.now() + THIRTY_DAYS_MS
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  const token = crypto.randomBytes(32).toString('hex');
  inMemorySessions.set(token, { userId: String(userId), role, expiresAt: Date.now() + THIRTY_DAYS_MS });
  return token;
}

/**
 * Resolve the session from the request's Authorization header.
 * @returns {{userId: string, role: string} | null}
 */
function getSessionUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;

  const secret = sessionSecret();
  if (secret) {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    let sigBuf, expBuf;
    try {
      sigBuf = Buffer.from(sig);
      expBuf = Buffer.from(expected);
    } catch {
      return null;
    }
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      if (!data || !data.uid || Date.now() > (data.exp || 0)) return null;
      return { userId: String(data.uid), role: data.role || 'buyer', token };
    } catch {
      return null;
    }
  }

  const session = inMemorySessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    inMemorySessions.delete(token);
    return null;
  }
  return { userId: session.userId, role: session.role, token };
}

/**
 * Invalidate a token (only meaningful for the in-memory mode; signed tokens
 * simply expire). Caller must pass the raw token.
 */
function revokeToken(token) {
  if (!token) return;
  inMemorySessions.delete(token);
}

/** Express middleware: require a valid session. */
function requireAuth(req, res, next) {
  const session = getSessionUser(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }
  req.userSession = session;
  next();
}

/** Express middleware: require an admin session. */
function requireAdmin(req, res, next) {
  const session = getSessionUser(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }
  if (String(session.role) !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  req.userSession = session;
  next();
}

module.exports = {
  createSessionToken,
  getSessionUser,
  revokeToken,
  requireAuth,
  requireAdmin,
  THIRTY_DAYS_MS
};
