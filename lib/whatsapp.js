/**
 * WhatsApp Cloud API helper — Meta's official API (no unofficial libraries).
 *
 * Shared by server.js (local dev) and api/index.js (deployed backend).
 * All credentials are read from server-side environment variables and are
 * NEVER exposed to the frontend.
 *
 *   WHATSAPP_PHONE_NUMBER_ID  — WhatsApp phone number ID from Meta
 *   WHATSAPP_ACCESS_TOKEN     — permanent system user access token
 *                               (whatsapp_business_messaging permission)
 *   WHATSAPP_API_VERSION      — e.g. v22.0 (defaults to v22.0)
 *   ADMIN_BASE_URL            — base URL of the admin panel (for order links)
 *   WHATSAPP_ENABLED          — 'false' skips real API calls and logs the
 *                               notification as 'skipped' (local dev/test mode)
 */

const DEFAULT_API_VERSION = 'v22.0';

function isEnabled() {
  const flag = String(process.env.WHATSAPP_ENABLED || 'true').toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no');
}

function apiVersion() {
  return String(process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION).trim();
}

function adminBaseUrl() {
  return String(process.env.ADMIN_BASE_URL || '').trim().replace(/\/+$/, '');
}

/**
 * Validate a vendor WhatsApp number: must start with '+' and contain only
 * digits after it (E.164-style, e.g. +23320xxxxxxx).
 */
function isValidWhatsappNumber(number) {
  if (!number || typeof number !== 'string') return false;
  return /^\+[0-9]{7,15}$/.test(number.trim());
}

function normalizeNumber(number) {
  return String(number || '').trim();
}

/**
 * Build the vendor-facing order notification message body.
 */
function buildOrderMessage({ pkg, vendorName, adminBaseUrl: base }) {
  const pCode = (pkg && (pkg.package_code || pkg.code || pkg.id)) || '';
  const customer = (pkg && (pkg.buyer_name || pkg.delivery_name)) || 'A customer';
  const currency = 'GHS';
  const total = (parseFloat(pkg && (pkg.total != null ? pkg.total : pkg.gross_amount)) || 0).toFixed(2);

  const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
  const itemSummary = items.map(i => `${i.qty || 1}× ${i.name || 'Item'}`).join(', ') || 'Items';

  const lines = [
    `Hi ${vendorName || 'Vendor'}, new order #${pCode} from ${customer}.`,
    `Items: ${itemSummary}`,
    `Total: ${currency}${total}`,
    `Please confirm and prepare for shipment.`
  ];
  if (base) lines.push(`View order: ${base}/#admin-orders`);
  return lines.join('\n');
}

/**
 * Send a plain-text WhatsApp message via the Meta Cloud API.
 * Throws on error so the caller can log the failure.
 */
async function sendWhatsAppText({ to, body }) {
  if (!isEnabled()) {
    const err = new Error('WHATSAPP_ENABLED=false — message skipped (dev/test mode)');
    err.code = 'SKIPPED';
    throw err;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    const err = new Error('WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not configured on the server');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const url = `https://graph.facebook.com/${apiVersion()}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`WhatsApp API ${res.status}: ${text.slice(0, 500)}`);
    err.code = 'API_ERROR';
    throw err;
  }

  return res.json();
}

/**
 * Notify a single vendor about a package (order). Used automatically after
 * order creation and for manual admin resends.
 *
 * ctx = {
 *   getVendor: async (vendorId) => vendorUserRecord | null,
 *   getStore:  async (storeId)  => storeRecord | null,   // only if pkg has no vendor_id
 *   log:       async (record)   => persisted record | null
 * }
 *
 * Never throws: every failure is captured in the order_notifications log so it
 * can never block order creation.
 */
async function notifyVendorOfPackage(pkg, ctx = {}) {
  const { getVendor = async () => null, getStore = async () => null, log = async () => null } = ctx;

  const baseLog = (vendorId) => {
    const now = new Date().toISOString();
    return {
      id: 'on-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100),
      order_id: (pkg && pkg.order_id) || '',
      package_id: (pkg && pkg.id) || '',
      package_code: (pkg && (pkg.package_code || pkg.code)) || '',
      vendor_id: vendorId || '',
      channel: 'whatsapp',
      created_at: now
    };
  };

  try {
    if (!pkg || !pkg.id) return null;

    // Resolve the vendor: prefer pkg.vendor_id, fall back to the store owner.
    let vendorId = pkg.vendor_id ? String(pkg.vendor_id) : null;
    if (!vendorId && pkg.store_id) {
      const store = await getStore(String(pkg.store_id));
      if (store && store.vendor_id) vendorId = String(store.vendor_id);
    }
    if (!vendorId) return null;

    const vendor = await getVendor(vendorId);
    if (!vendor) return null;

    const optedIn =
      vendor.receive_order_notifications_on_whatsapp === true ||
      String(vendor.receive_order_notifications_on_whatsapp) === 'true' ||
      String(vendor.receive_order_notifications_on_whatsapp) === '1';
    const whatsappPhone = normalizeNumber(
      vendor.whatsapp_phone ||
      (vendor.extra && vendor.extra.whatsapp_phone) ||
      ''
    );

    // Vendor hasn't opted in — skip silently (spec: only opted-in vendors get messages).
    if (!optedIn) return null;

    if (!isValidWhatsappNumber(whatsappPhone)) {
      return await log({
        ...baseLog(vendorId),
        status: 'failed',
        error_message: `Invalid WhatsApp number "${whatsappPhone}" — must start with + and contain only digits (e.g. +23320xxxxxxx)`,
        sent_at: null
      });
    }

    const body = buildOrderMessage({
      pkg,
      vendorName: vendor.name || vendor.business_name || 'Vendor',
      adminBaseUrl: adminBaseUrl()
    });

    try {
      await sendWhatsAppText({ to: whatsappPhone, body });
      return await log({ ...baseLog(vendorId), status: 'sent', sent_at: new Date().toISOString(), error_message: '' });
    } catch (err) {
      const status = err && err.code === 'SKIPPED' ? 'skipped' : 'failed';
      return await log({
        ...baseLog(vendorId),
        status,
        sent_at: null,
        error_message: String((err && err.message) || err)
      });
    }
  } catch (err) {
    // Absolute last resort — never let a notification failure break anything.
    try {
      await log({
        ...baseLog(pkg && pkg.vendor_id),
        status: 'failed',
        error_message: String((err && err.message) || err),
        sent_at: null
      });
    } catch (_) {}
    return null;
  }
}

module.exports = {
  isEnabled,
  apiVersion,
  adminBaseUrl,
  isValidWhatsappNumber,
  normalizeNumber,
  buildOrderMessage,
  sendWhatsAppText,
  notifyVendorOfPackage
};
