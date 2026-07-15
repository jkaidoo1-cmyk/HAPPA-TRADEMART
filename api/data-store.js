/**
 * In-memory data store with optional JSON file fallback
 * Used on Vercel (ephemeral filesystem) and for local development
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'db.json');

// In-memory cache (persists during Vercel deployment lifetime)
let memoryStore = null;

function loadMemoryStore() {
  if (memoryStore) return memoryStore;
  
  // Try to load from db.json if it exists
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    memoryStore = JSON.parse(raw);
    console.log('[DataStore] Loaded from db.json');
  } catch (err) {
    // Initialize empty store if db.json doesn't exist or is invalid
    memoryStore = {
      users: [],
      stores: [],
      storefronts: [],
      products: [],
      orders: [],
      packages: [],
      services: [],
      wallet_transactions: [],
      notifications: [],
      ad_campaigns: [],
      settings: [],
      referrals: [],
      delivery_rates: [],
      reviews: [],
      service_orders: []
    };
    console.log('[DataStore] Initialized empty store (db.json not found or invalid)');
  }
  
  return memoryStore;
}

function getStore() {
  if (!memoryStore) {
    loadMemoryStore();
  }
  return memoryStore;
}

function ensureTable(table) {
  const store = getStore();
  if (!store[table]) {
    store[table] = [];
  }
}

function saveToFile() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(memoryStore, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[DataStore] Failed to write db.json:', err.message);
    // On Vercel, filesystem writes fail silently; in-memory store still works
    return false;
  }
}

module.exports = {
  getStore,
  ensureTable,
  loadMemoryStore,
  saveToFile,
  dbPath: DB_PATH
};
