/* ============================================================
   HAPPA TRADEMART — Local Self-Learning Autofill Tool (Optimized)
   ============================================================
   Improvements:
   - Pre-built keyword index (Map) for O(1) category lookup
   - Debounced autofill to avoid firing on every keystroke
   - Learned-data lookup fully uses key-based Map
   - Smarter description generation with richer context
   ============================================================ */

const LOCAL_AUTOFILL_KEY = 'happa_local_autofill_learned';

// Default templates for description generation
const DEFAULT_TEMPLATES = {
  'Sneakers': [
    "Step out in style with [Name]. Designed for ultimate comfort and durability, making it the perfect choice for your daily walk, run, or casual outing.",
    "Elevate your footwear game with [Name]. Crafted with premium materials for maximum support, breathability, and a sleek modern look."
  ],
  'Sandals': [
    "Enjoy light, breathable comfort with [Name]. The perfect match for warm weather and relaxed days, blending style and comfort effortlessly.",
    "Relax in ultimate ease with [Name]. Features a cushioned footbed and durable straps for all-day wear and casual elegance."
  ],
  'Boots': [
    "Conquer any terrain with [Name]. Crafted with premium materials for maximum support, durability, and a classic look that never goes out of style.",
    "Step out with confidence in [Name]. Sturdy design combined with comfortable interior, built to handle any weather in style."
  ],
  'Electronics': [
    "Experience next-level performance with [Name]. Engineered with advanced features and sleek design to seamlessly power up your daily routine.",
    "Upgrade your tech collection with [Name]. Offering reliable performance, cutting-edge design, and smart features for modern living."
  ],
  'Audio': [
    "Immerse yourself in rich, high-fidelity sound with [Name]. Features crisp audio, deep bass, and comfortable fit for music on the move.",
    "Enjoy crystal-clear audio quality with [Name]. Designed with premium speakers and noise-isolation to deliver an unmatched listening experience."
  ],
  'Skincare': [
    "Nourish and revitalize your skin with [Name]. Formulated with premium ingredients to keep your skin hydrated, glowing, and feeling fresh all day.",
    "Achieve healthy, radiant skin with [Name]. Gently restores moisture balance, targets imperfections, and promotes a natural glowing complexion."
  ],
  'Makeup': [
    "Enhance your natural beauty with [Name]. Delivers flawless coverage and vibrant color that stays fresh and lasts from day to night.",
    "Add a touch of elegance to your beauty routine with [Name]. Easy to apply, long-lasting formula that highlights your best features."
  ],
  'Accessories': [
    "Elevate your look with [Name]. The perfect blend of functionality and style to keep your essentials organized and complement any outfit.",
    "Complete your styling with [Name]. A versatile accessory crafted with meticulous attention to detail and high-quality finishes."
  ],
  'Fashion': [
    "Step up your fashion game with [Name]. Designed with modern styles and comfortable fabrics to keep you looking sharp all day.",
    "Add a touch of style to your wardrobe with [Name]. High-quality tailoring meets casual comfort for any occasion."
  ],
  'Food & Drinks': [
    "Indulge in the delicious taste of [Name]. Made with fresh, high-quality ingredients to satisfy your cravings and delight your senses.",
    "Refresh your day with [Name]. A perfect blend of flavor and quality, crafted to give you a delightful culinary experience."
  ],
  'Home & Living': [
    "Transform your space with [Name]. Combining functional design and stylish aesthetics to bring comfort and warmth to your home.",
    "Upgrade your living space with [Name]. Crafted for durability and style, making it the perfect addition to any modern room."
  ],
  'Books': [
    "Dive into the pages of [Name]. An engaging and thought-provoking read that will captivate your mind and expand your knowledge.",
    "Enhance your collection with [Name]. Perfect for avid readers, offering a compelling narrative and rich insights from cover to cover."
  ],
  'Sports': [
    "Boost your active lifestyle with [Name]. Designed for high performance and durability to support your fitness and athletic goals.",
    "Stay active and perform at your best with [Name]. Premium quality gear built to withstand intense training and casual play."
  ],
  'Toys': [
    "Bring endless fun and creativity to playtime with [Name]. Safe, durable, and perfect for sparks of imagination and learning.",
    "Spark joy and entertainment with [Name]. Designed to keep children engaged and learning through interactive play."
  ],
  'Art': [
    "Express your creativity or decorate your walls with [Name]. A beautiful piece that adds personality and artistic flair to any space.",
    "Celebrate craftsmanship with [Name]. Uniquely designed to stand out and inspire with its fine details and artistic expression."
  ],
  'Services': [
    "Experience professional and reliable service with [Name]. Tailored to meet your specific needs with high efficiency and customer care.",
    "Save time and effort with [Name]. Quality solutions delivered by experienced professionals to ensure your complete satisfaction."
  ],
  'Other': [
    "Experience the quality and versatility of [Name]. Built with premium materials to deliver outstanding performance and exceptional value.",
    "Add versatility to your daily life with [Name]. A reliable solution designed to meet your needs and exceed your expectations."
  ]
};

// ── Pre-built keyword index for O(1) category lookup ──────────────
// Maps each individual keyword → its category
const KEYWORD_INDEX = (() => {
  const index = new Map();
  const rules = [
    { keywords: ['sneaker', 'sneakers', 'running shoes', 'shoes', 'jordans', 'yeezy', 'nike', 'adidas', 'puma', 'trainer', 'trainers'], category: 'Sneakers' },
    { keywords: ['sandal', 'sandals', 'slippers', 'slide', 'slides', 'flip flop', 'crocs', 'birkenstock'], category: 'Sandals' },
    { keywords: ['boot', 'boots', 'chelsea boot', 'timberland', 'combat boot'], category: 'Boots' },
    { keywords: ['earbud', 'earbuds', 'headphone', 'headphones', 'speaker', 'speakers', 'mic', 'microphone', 'airpods', 'soundbar', 'audio'], category: 'Audio' },
    { keywords: ['phone', 'laptop', 'charger', 'cable', 'watch', 'smartwatch', 'tablet', 'screen', 'tv', 'television', 'computer', 'monitor', 'powerbank', 'mouse', 'keyboard', 'usb', 'camera', 'electronics', 'device', 'gadget'], category: 'Electronics' },
    { keywords: ['serum', 'lotion', 'cream', 'moisturizer', 'cleanser', 'sunscreen', 'face wash', 'scrub', 'skincare', 'oil', 'toner'], category: 'Skincare' },
    { keywords: ['makeup', 'lipstick', 'gloss', 'foundation', 'eyeliner', 'mascara', 'palette', 'blush', 'eyeshadow', 'concealer'], category: 'Makeup' },
    { keywords: ['bag', 'backpack', 'ring', 'necklace', 'bracelet', 'wallet', 'belt', 'sunglasses', 'hat', 'cap', 'accessory', 'jewelry', 'scarf', 'purse'], category: 'Accessories' },
    { keywords: ['book', 'books', 'novel', 'textbook', 'notebook', 'diary', 'journal', 'hardcover', 'paperback', 'literature', 'fiction', 'non-fiction'], category: 'Books' },
    { keywords: ['shirt', 't-shirt', 'pants', 'jeans', 'dress', 'skirt', 'jacket', 'coat', 'socks', 'underwear', 'clothing', 'apparel', 'hoodie', 'sweater', 'blouse', 'suit'], category: 'Fashion' },
    { keywords: ['food', 'drink', 'beverage', 'snack', 'chocolate', 'candy', 'coffee', 'tea', 'juice', 'soda', 'spices', 'sauce', 'honey', 'biscuit', 'cookie', 'cookies'], category: 'Food & Drinks' },
    { keywords: ['furniture', 'chair', 'table', 'sofa', 'bed', 'pillow', 'blanket', 'lamp', 'light', 'decor', 'kitchen', 'plate', 'cup', 'organizer', 'rug', 'curtain', 'vase', 'clock'], category: 'Home & Living' },
    { keywords: ['ball', 'bat', 'racket', 'glove', 'sports', 'fitness', 'gym', 'dumbbell', 'yoga', 'mat', 'jersey', 'helmet', 'bicycle', 'bike', 'treadmill'], category: 'Sports' },
    { keywords: ['toy', 'toys', 'doll', 'action figure', 'puzzle', 'board game', 'lego', 'blocks', 'plush', 'game', 'gaming', 'nintendo', 'playstation', 'xbox'], category: 'Toys' },
    { keywords: ['art', 'painting', 'drawing', 'sketch', 'canvas', 'poster', 'print', 'frame', 'sculpture', 'handmade', 'craft', 'pottery'], category: 'Art' },
    { keywords: ['repair', 'cleaning', 'tutor', 'delivery', 'service', 'lessons', 'design', 'custom', 'consulting', 'plumbing', 'laundry'], category: 'Services' }
  ];
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      // Only register first occurrence so high-specificity rules win
      if (!index.has(kw)) index.set(kw, rule.category);
    }
  }
  return index;
})();

// Feature sets for rich description highlights
const COLORS    = new Set(['red', 'blue', 'green', 'black', 'white', 'yellow', 'pink', 'purple', 'orange', 'grey', 'gray', 'brown', 'gold', 'silver', 'beige', 'navy']);
const MATERIALS = new Set(['leather', 'cotton', 'silk', 'wooden', 'wood', 'metal', 'denim', 'wool', 'canvas', 'velvet', 'ceramic', 'polyester', 'suede']);
const BRANDS    = new Set(['nike', 'adidas', 'puma', 'gucci', 'prada', 'apple', 'samsung', 'sony', 'dell', 'hp', 'chanel', 'dior', 'rolex', 'zara']);

// ── localStorage helpers ─────────────────────────────────────────
function getLearnedData() {
  try {
    const raw = localStorage.getItem(LOCAL_AUTOFILL_KEY);
    return raw ? JSON.parse(raw) : { exactNames: {} };
  } catch (e) {
    return { exactNames: {} };
  }
}

function saveLearnedData(data) {
  try {
    localStorage.setItem(LOCAL_AUTOFILL_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save learned data:', e);
  }
}

// ── Core prediction engine ───────────────────────────────────────
/**
 * Predicts the category and generates a description for a given product name.
 * Uses a pre-built Map index for O(1) keyword lookup (vs. nested loops).
 * @param {string} name
 * @returns {{category: string, description: string}}
 */
function localPredictAndGenerate(name) {
  if (!name || !name.trim()) return { category: 'Other', description: '' };

  const cleanName = name.trim();
  const lowerName = cleanName.toLowerCase();
  const learned   = getLearnedData();

  // 1. Exact match in learned data (O(1) Map lookup)
  if (learned.exactNames) {
    const exact = learned.exactNames[lowerName];
    if (exact) return { category: exact.category, description: exact.description };

    // 2. Partial match — learned name contained inside the typed name
    for (const [learnedName, data] of Object.entries(learned.exactNames)) {
      if (lowerName.includes(learnedName)) {
        const escaped = learnedName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return {
          category: data.category,
          description: data.description.replace(new RegExp(escaped, 'gi'), cleanName)
        };
      }
    }
  }

  // 3. Score-based category detection using the pre-built keyword index
  const tokens = lowerName.split(/[\s\-_,.]+/);
  const scores  = new Map(); // category → score

  for (const token of tokens) {
    // Exact token match (score: 3)
    if (KEYWORD_INDEX.has(token)) {
      const cat = KEYWORD_INDEX.get(token);
      scores.set(cat, (scores.get(cat) || 0) + 3);
    }
  }
  // Substring match for multi-word keywords (score: 1) — only for unscored categories
  for (const [kw, cat] of KEYWORD_INDEX) {
    if (kw.includes(' ') && lowerName.includes(kw)) {
      scores.set(cat, (scores.get(cat) || 0) + 2);
    } else if (!tokens.includes(kw) && lowerName.includes(kw)) {
      scores.set(cat, (scores.get(cat) || 0) + 1);
    }
  }

  let category = 'Other';
  let highestScore = 0;
  for (const [cat, score] of scores) {
    if (score > highestScore) { highestScore = score; category = cat; }
  }

  // 4. Extract features for richer description highlights
  const highlights = [];
  for (const token of tokens) {
    if (BRANDS.has(token) && highlights.length < 3) {
      highlights.push(`premium quality from ${token.charAt(0).toUpperCase() + token.slice(1)}`);
    }
    if (COLORS.has(token) && highlights.length < 3) {
      highlights.push(`a stylish ${token} finish`);
    }
    if (MATERIALS.has(token) && highlights.length < 3) {
      highlights.push(`crafted with high-grade ${token}`);
    }
  }

  let highlightSentence = '';
  if (highlights.length > 0) {
    const head = highlights.slice(0, -1).join(', ');
    const tail = highlights.slice(-1)[0];
    highlightSentence = ' Featuring ' + (head ? head + ', and ' : '') + tail + '.';
  }

  // 5. Generate description from templates (deterministic, no randomness)
  const templates = DEFAULT_TEMPLATES[category] || DEFAULT_TEMPLATES['Other'];
  const tplIdx    = cleanName.length % templates.length;
  const description = templates[tplIdx].replace('[Name]', cleanName) + highlightSentence;

  return { category, description };
}

// ── Debounced autofill wrappers ───────────────────────────────────
// Prevents `localPredictAndGenerate` from running on every single keystroke.
const _debounceTimers = new Map();

/**
 * Debounced version of localPredictAndGenerate.
 * @param {string} key      - Unique key per field (e.g. "bap-5" or "new-p")
 * @param {string} name     - Product name input
 * @param {Function} cb     - Callback receives {category, description}
 * @param {number} [delay]  - ms to wait (default 300)
 */
function localPredictDebounced(key, name, cb, delay = 300) {
  if (_debounceTimers.has(key)) clearTimeout(_debounceTimers.get(key));
  _debounceTimers.set(key, setTimeout(() => {
    _debounceTimers.delete(key);
    if (name && name.trim().length >= 3) {
      cb(localPredictAndGenerate(name));
    }
  }, delay));
}

// ── Learning from user corrections ───────────────────────────────
/**
 * Learns from user corrections when they modify generated values.
 * @param {string} name
 * @param {string} category
 * @param {string} description
 */
function localLearnCorrection(name, category, description) {
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  const lowerName = cleanName.toLowerCase();
  const learned   = getLearnedData();

  if (!learned.exactNames) learned.exactNames = {};
  learned.exactNames[lowerName] = {
    category: category.trim(),
    description: description.trim()
  };

  saveLearnedData(learned);
  console.log(`[Local Autofill] Learned correction for "${cleanName}":`, learned.exactNames[lowerName]);
}

window.localPredictAndGenerate  = localPredictAndGenerate;
window.localPredictDebounced    = localPredictDebounced;
window.localLearnCorrection     = localLearnCorrection;
