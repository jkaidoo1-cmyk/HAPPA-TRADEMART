/* ============================================================
   HAPPA TRADEMART — Local Self-Learning Autofill Tool (Optimized)
   ============================================================ */

const LOCAL_AUTOFILL_KEY = 'happa_local_autofill_learned';

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

// User's objects and logic
const CATEGORIES = {
  'electronics': { label:'Electronics', icon:'fa-solid fa-microchip', keywords:{ 'phone':5,'smartphone':5,'laptop':5,'tablet':5,'headphone':5,'headphones':5,'earbuds':5,'speaker':5,'camera':5,'monitor':5,'tv':5,'television':5,'router':5,'keyboard':5,'mouse':5,'printer':5,'scanner':5,'wireless':3,'bluetooth':3,'usb':3,'hdmi':3,'led':3,'oled':3,'noise cancelling':4,'noise canceling':4,'smart':2,'digital':3,'battery':2,'charger':4,'adapter':3,'cable':2,'gaming':3,'playstation':5,'xbox':5,'nintendo':5,'switch':3,'console':4,'ssd':5,'hdd':5,'ram':5,'processor':5,'gpu':5,'graphics':2,'drone':5,'gopro':5,'dash cam':5,'sony':3,'samsung':3,'apple':3,'lg':3,'dell':4,'hp':3,'lenovo':3,'bose':4,'jbl':4,'logitech':4,'razer':4,'corsair':4,'airpods':5,'macbook':5,'ipad':5,'iphone':5,'galaxy':3,'watch':2,'smartwatch':5,'fitbit':5,'garmin':4,'microphone':5,'webcam':5,'projector':5 }},
  'clothing': { label:'Clothing & Apparel', icon:'fa-solid fa-shirt', keywords:{ 'shirt':5,'t-shirt':5,'tshirt':5,'pants':5,'jeans':5,'dress':5,'jacket':5,'coat':5,'hoodie':5,'sweater':5,'blazer':5,'skirt':5,'shorts':5,'leggings':5,'joggers':5,'underwear':4,'bra':4,'boxers':4,'socks':4,'suit':5,'vest':4,'cardigan':4,'pullover':4,'cotton':2,'denim':3,'silk':2,'wool':2,'linen':2,'polyester':1,'slim fit':2,'regular fit':2,'oversized':2,'fitted':2,'nike':3,'adidas':3,'puma':3,'zara':4,'levis':4,'gucci':4,'prada':4,'ralph lauren':4,'tommy hilfiger':4,'sneakers':4,'running shoes':4,'boots':3,'heels':4,'sandals':3,'loafers':4,'sneaker':4,'shoes':2 }},
  'home-kitchen': { label:'Home & Kitchen', icon:'fa-solid fa-house-chimney', keywords:{ 'sofa':5,'couch':5,'table':3,'chair':3,'bed':4,'mattress':5,'desk':3,'shelf':4,'bookshelf':5,'cabinet':4,'drawer':3,'lamp':5,'chandelier':5,'curtain':4,'rug':4,'carpet':4,'pillow':4,'blanket':4,'towel':3,'bedsheet':4,'duvet':4,'blender':5,'toaster':5,'microwave':5,'oven':4,'fridge':5,'refrigerator':5,'dishwasher':5,'coffee maker':5,'coffeemaker':5,'fryer':5,'air fryer':5,'mixer':4,'kettle':4,'pan':3,'pot':3,'knife':3,'cutlery':4,'cookware':5,'bakeware':5,'instant pot':5,'ikea':5,'kitchenaid':5,'ninja':3,'vacuum':5,'robot vacuum':5,'air purifier':5,'humidifier':5,'dyson':5,'shark':3 }},
  'beauty': { label:'Beauty & Personal Care', icon:'fa-solid fa-spa', keywords:{ 'moisturizer':5,'serum':5,'cleanser':5,'toner':5,'exfoliator':5,'sunscreen':5,'spf':4,'face wash':5,'face mask':5,'foundation':5,'concealer':5,'mascara':5,'eyeliner':5,'lipstick':5,'lip gloss':5,'eyeshadow':5,'blush':5,'highlighter':4,'primer':4,'setting spray':5,'shampoo':5,'conditioner':5,'hair oil':5,'hair mask':5,'dry shampoo':5,'hair dryer':5,'straightener':5,'curler':4,'perfume':5,'cologne':5,'fragrance':5,'eau de':4,'skincare':5,'makeup':5,'cosmetics':5,'beauty':4,'retinol':5,'hyaluronic':5,'vitamin c':4,'niacinamide':5,'ceramide':5,'peptide':4,'aha':4,'bha':4,'la mer':5,'lauder':5,'chanel':4,'dior':4,'mac':3,'nars':5,'fenty':5,'rare beauty':5,'drunk elephant':5,'the ordinary':5,'cerave':5,'cetaphil':5,'neutrogena':4,'maybelline':4,'gillette':5,'razor':3,'deodorant':4 }},
  'sports': { label:'Sports & Outdoors', icon:'fa-solid fa-dumbbell', keywords:{ 'yoga mat':5,'dumbbell':5,'kettlebell':5,'resistance band':5,'treadmill':5,'elliptical':5,'exercise bike':5,'rowing machine':5,'protein':4,'whey':5,'creatine':5,'pre-workout':5,'tent':5,'sleeping bag':5,'backpack':3,'hiking':5,'camping':5,'climbing':5,'fishing':5,'cycling':4,'bicycle':4,'bike':2,'helmet':3,'soccer':5,'basketball':5,'football':4,'baseball':5,'tennis':5,'racket':5,'racquet':5,'golf':5,'swimming':4,'goggles':3,'surfboard':5,'skateboard':5,'north face':5,'patagonia':5,'columbia':4,'under armour':5,'underarmor':5,'reebok':3,'asics':4,'new balance':4 }},
  'toys': { label:'Toys & Games', icon:'fa-solid fa-puzzle-piece', keywords:{ 'lego':5,'doll':5,'action figure':5,'robot toy':5,'puzzle':5,'board game':5,'card game':4,'rc car':5,'remote control':3,'plush':5,'stuffed animal':5,'teddy bear':5,'building block':5,'magnetic':3,'nerf':5,'hot wheels':5,'barbie':5,'fisher-price':5,'hasbro':5,'mattel':5,'art set':4,'crayon':4,'coloring':3,'play-doh':5 }},
  'books': { label:'Books & Media', icon:'fa-solid fa-book', keywords:{ 'book':5,'novel':5,'hardcover':5,'paperback':5,'ebook':5,'audiobook':5,'textbook':5,'workbook':5,'comic':4,'manga':5,'encyclopedia':5,'dictionary':5,'vinyl':5,'record':4,'cd':3,'dvd':3,'blu-ray':4,'album':3,'soundtrack':3 }},
  'food': { label:'Food & Beverages', icon:'fa-solid fa-mug-hot', keywords:{ 'coffee':5,'tea':5,'matcha':5,'cocoa':4,'protein bar':5,'energy bar':5,'snack':4,'chips':4,'chocolate':5,'candy':4,'gummy':3,'honey':5,'jam':4,'sauce':3,'spice':4,'seasoning':4,'organic':2,'vegan':2,'gluten free':2,'keto':3,'wine':5,'beer':5,'whiskey':5,'vodka':5,'rum':4,'juice':4,'smoothie':4,'water bottle':3,'nespresso':5,'starbucks':4 }},
  'jewelry': { label:'Jewelry & Accessories', icon:'fa-solid fa-gem', keywords:{ 'ring':5,'necklace':5,'bracelet':5,'earring':5,'earrings':5,'pendant':5,'charm':4,'brooch':5,'anklet':5,'gold':4,'silver':4,'diamond':5,'pearl':5,'ruby':5,'sapphire':5,'emerald':5,'platinum':5,'titanium':4,'watch':3,'chronograph':5,'cartier':5,'tiffany':5,'pandora':5,'swarovski':5,'sterling':4,'14k':4,'18k':4,'24k':4,'cufflinks':5,'tie clip':4,'wallet':2,'handbag':3,'purse':3,'clutch':4,'tote':3,'louis vuitton':5,'coach':4,'michael kors':5,'kate spade':5,'sunglasses':4,'belt':2,'scarf':3,'gloves':3 }},
  'automotive': { label:'Automotive', icon:'fa-solid fa-car', keywords:{ 'tire':5,'wheel':3,'brake':4,'oil':3,'filter':3,'spark plug':5,'wiper':4,'car seat':5,'dash cam':5,'car charger':5,'floor mat':4,'car cover':5,'phone mount':4,'jump starter':5,'headlight':4,'taillight':4,'exhaust':4,'bosch':4,'michelin':5,'goodyear':5,'castrol':5,'motorcycle':5,'atv':5,'utv':5 }},
  'pet-supplies': { label:'Pet Supplies', icon:'fa-solid fa-paw', keywords:{ 'dog food':5,'cat food':5,'pet food':5,'treat':3,'dog bed':5,'cat tree':5,'litter':5,'litter box':5,'leash':5,'collar':4,'harness':5,'muzzle':5,'aquarium':5,'fish tank':5,'bird cage':5,'dog toy':5,'cat toy':5,'pet toy':5,'grooming':3,'pet':3,'purina':5,'royal canin':5,'blue buffalo':5,'kong':5 }},
  'health': { label:'Health & Wellness', icon:'fa-solid fa-heart-pulse', keywords:{ 'vitamin':5,'supplement':5,'omega-3':5,'probiotic':5,'multivitamin':5,'melatonin':5,'magnesium':5,'zinc':5,'iron':4,'calcium':4,'fiber':3,'collagen':5,'thermometer':5,'blood pressure':5,'glucose monitor':5,'first aid':5,'bandage':4,'compression':3,'massager':5,'foam roller':5,'orthopedic':4,'advil':4,'tylenol':4,'ibuprofen':4,'hand sanitizer':4,'n95':5 }},
  'office': { label:'Office & Stationery', icon:'fa-solid fa-briefcase', keywords:{ 'pen':4,'pencil':4,'notebook':5,'binder':4,'folder':4,'stapler':5,'paper clip':5,'tape':3,'scissors':3,'whiteboard':5,'marker':3,'highlighter':4,'post-it':5,'calculator':5,'label maker':5,'laminator':5,'shredder':5,'desk organizer':5,'file cabinet':5,'moleskine':5,'sharpie':5 }},
  'garden': { label:'Garden & Outdoor Living', icon:'fa-solid fa-leaf', keywords:{ 'plant':4,'pot':3,'planter':5,'garden':5,'soil':4,'fertilizer':5,'compost':5,'mulch':4,'pruner':5,'shears':5,'shovel':5,'rake':5,'hoe':4,'mower':5,'trimmer':4,'hose':4,'sprinkler':5,'greenhouse':5,'bird feeder':5,'fountain':5,'patio':4,'deck':3,'hammock':5,'scotts':5,'miracle-gro':5 }}
};

const ATTR_PATTERNS = {
  color: /\b(black|white|red|blue|green|yellow|orange|purple|pink|brown|gray|grey|silver|gold|rose gold|navy|beige|teal|coral|mint|burgundy|charcoal|ivory|cream|khaki|lavender|turquoise|magenta|indigo|olive|copper|bronze|space gray|midnight|starlight)\b/gi,
  material: /\b(leather|canvas|cotton|polyester|nylon|silk|wool|denim|linen|mesh|rubber|metal|stainless steel|aluminum|plastic|wood|bamboo|ceramic|glass|carbon fiber|silicone|velvet|suede|chenille|memory foam|latex|foam|titanium|marble|granite|acrylic|resin|porcelain|terracotta|cast iron|copper|brass)\b/gi,
  size: /\b(xs|s|m|l|xl|xxl|xxxl|one size|free size|small|medium|large|extra large|plus size|petite|tall|regular|queen|king|twin|full|california king)\b/gi,
  capacity: /\b(\d+\s*(ml|l|litre|liter|oz|fl oz|gallon|cup|kg|g|gram|lb|pound|tb|quart|mm|cm|m|inch|ft|feet|ah|mah|wh|w|kw|gb|tb|mp|megapixel|lumen|lumens))\b/gi,
  edition: /\b(pro|professional|max|ultra|plus|premium|lite|standard|essential|classic|se|air|mini|nano|micro|xl|super|turbo|sport|limited|special|ultimate|elite|prime|advanced|extreme|phantom|studio|master|grand)\b/gi,
  connectivity: /\b(wireless|wired|bluetooth|wi-fi|wifi|usb-c|usb|lightning|hdmi|displayport|thunderbolt|nfc|3\.5mm|aux|ethernet|type-c)\b/gi,
  feature: /\b(waterproof|water resistant|dustproof|shockproof|noise cancelling|noise canceling|active noise|touchscreen|foldable|collapsible|rechargeable|cordless|portable|compact|lightweight|ergonomic|adjustable|detachable|modular|automatic|smart|hands-free|voice control|app controlled|remote controlled|dual|triple|quad|stereo|mono|surround|hi-fi|hifi|hi-res|high resolution|oled|amoled|ips|retina|4k|8k|hdr|dolby|atmos|fast charging|quick charge|wireless charging|mechanical|membrane|optical|laser)\b/gi,
  gender: /\b(men['']?s|women['']?s|unisex|kids|boys|girls|mens|womens|men|women|child|baby|toddler|infant)\b/gi,
  season: /\b(spring|summer|fall|autumn|winter|all-season|all season|year-round|year round)\b/gi
};

function extractAttrs(name) {
  const a = {};
  for (const [k, r] of Object.entries(ATTR_PATTERNS)) {
    const m = name.match(r);
    if (m) a[k] = [...new Set(m.map(x => x.toLowerCase()))];
  }
  return a;
}

function classifyProduct(name) {
  const l = name.toLowerCase(), scores = {};
  for (const [ck, cd] of Object.entries(CATEGORIES)) {
    let s = 0;
    for (const [kw, w] of Object.entries(cd.keywords)) {
      const rx = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      const m = l.match(rx);
      if (m) s += w * m.length;
    }
    if (s > 0) scores[ck] = s;
  }
  if (!Object.keys(scores).length) return { category: 'other', confidence: 0.3 };
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { category: sorted[0][0], confidence: Math.min(0.98, 0.5 + (sorted[0][1] / total) * 0.48) };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function getFirst(a) { return a && a.length ? a[0] : null; }
function getN(a, n) { return a && a.length ? a.slice(0, n).map(cap) : []; }

function cleanName(name) {
  let n = name.trim();
  return n.length > 55 ? n.substring(0, 52) + '...' : n;
}

const HUMAN_ADJ = {
  electronics: ['crisp','clean','punchy','sleek','beefy','snappy','polished','no-nonsense','seriously good','ridiculously light','built to last','the real deal','worth every penny'],
  clothing: ['buttery soft','broken-in feel','ridiculously comfy','clean-cut','laid-back','sharp','effortless','light as air','the kind you reach for every morning','staple-worthy'],
  'home-kitchen': ['sleek','sturdy','gorgeous','no-fuss','handles like a dream','a serious upgrade','the kind that makes you actually want to cook','built like a tank','quiet as a whisper'],
  beauty: ['no-fuss','gentle but effective','the good stuff','holy grail material','your skin will thank you','straight-up works','zero BS','the one everyone asks about'],
  sports: ['solid','no-slip','pushes you harder','light but tough','the real workout partner','built for sweat','serious but not intimidating','game-changing'],
  toys: ['the kind kids obsess over','seriously fun','keeps them busy for hours','way better than screen time','the birthday gift that actually lands','simple but addictive'],
  books: ['the kind you can\'t put down','a page-turner','stays with you','worth re-reading','the one everyone\'s talking about','a quiet masterpiece'],
  food: ['the good stuff','seriously addictive','no weird aftertaste','smooth','rich','the kind you hoard','honestly delicious','better than the store brand'],
  jewelry: ['timeless','understated','the kind you never take off','gets compliments every time','delicate but sturdy','quietly luxurious','gift-ready'],
  automotive: ['solid','no-nonsense','built tough','the reliable choice','does exactly what it should','a proper upgrade','worth the investment'],
  'pet-supplies': ['your pet will go nuts for this','tough enough for actual use','the one that actually lasts','vet-approved vibes','simple and effective','no junk materials'],
  health: ['no gimmicks','the real deal','clean ingredients','actually works','easy to stick with','the daily habit you won\'t dread','straight-up effective'],
  office: ['the desk upgrade you didn\'t know you needed','satisfying to use','clean and functional','the kind that makes work less painful','seriously good for the price'],
  garden: ['built to actually last','makes gardening enjoyable','the kind of quality your grandparents would approve','no-nonsense','handles the elements'],
  other: ['honestly great','does what it says','no regrets','the kind you\'d recommend to a friend','simple and solid','better than expected']
};

const TEMPLATES_BY_CAT = {
  'electronics': [
    f => `${f.nameRef} — ${f.feat1 ? f.feat1 + ', ' : ''}${f.adj}.`,
    f => `Say hello to the ${f.nameRef}. ${f.feat1 ? f.feat1 + ' and ' : ''}${f.adj}.`,
    f => `${f.nameRef}. ${f.featAnd ? f.featAnd + ' — ' : ''}${f.adj}.`,
    f => f.capRef ? `${f.nameRef} with ${f.capRef}. ${f.adj}.` : `${f.nameRef}. ${f.adj}.`,
    f => f.connRef ? `${f.nameRef} — ${f.connRef}, ${f.feat1 || f.adj}.` : `${f.nameRef}. ${f.feat1 || f.adj}.`,
    f => `Finally, a ${f.nameRef.toLowerCase().replace(/^the /,'')} that's ${f.adj}.`,
    f => `${f.nameRef}: ${f.featList || f.adj}. No compromises.`,
    f => `${f.adj} — that's the ${f.nameRef.toLowerCase()} in a nutshell.`,
    f => f.feat1 && f.feat2 ? `${f.nameRef}. ${f.feat1}, ${f.feat2.toLowerCase()}, and ${f.adj}.` : `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} doesn't mess around. ${f.featAnd || f.adj}.`,
  ],
  'clothing': [
    f => `${f.colorMat || f.nameRef} — ${f.adj}. ${f.sizeRef ? f.sizeRef + ' fit.' : ''}`,
    f => `Your new go-to: the ${f.nameRef.toLowerCase()}. ${f.adj}.`,
    f => `${f.nameRef} in ${f.colorMat || f.matOnly}. ${f.adj}.`,
    f => f.sizeRef ? `${f.colorOnly ? f.colorOnly + ' ' : ''}${f.nameRef.toLowerCase()}, ${f.sizeRef}. ${f.adj}.` : `${f.nameRef}. ${f.adj}.`,
    f => `${f.adj}. That's the ${f.nameRef.toLowerCase()} — ${f.colorMat || 'classic'}.`,
    f => `The ${f.nameRef.toLowerCase()} you'll reach for every single day. ${f.adj}.`,
    f => `${f.colorMat || f.nameRef}. ${f.adj}, ${f.sizeRef ? f.sizeRef + ' fit' : 'versatile fit'}.`,
    f => f.genderRef ? `${f.genderRef} ${f.nameRef.toLowerCase()} in ${f.colorOnly || f.matOnly}. ${f.adj}.` : `${f.nameRef}. ${f.adj}.`,
  ],
  'home-kitchen': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that actually makes life easier. ${f.adj}.`,
    f => `${f.matOnly ? f.matOnly + ' ' : ''}${f.nameRef.toLowerCase()} — ${f.adj}.`,
    f => f.capRef ? `${f.nameRef} (${f.capRef}). ${f.adj}.` : `${f.nameRef}. ${f.adj}.`,
    f => `Upgrade your ${f.matOnly ? f.matOnly.toLowerCase() : 'space'} with the ${f.nameRef.toLowerCase()}. ${f.adj}.`,
    f => `${f.nameRef}: ${f.featList || f.adj}. No regrets.`,
    f => `Honest ${f.matOnly ? f.matOnly.toLowerCase() : 'build quality'} and ${f.adj.toLowerCase()} — that's the ${f.nameRef.toLowerCase()}.`,
    f => f.feat1 ? `${f.nameRef}. ${f.feat1} and ${f.adj.toLowerCase()}.` : `${f.nameRef}. ${f.adj}.`,
  ],
  'beauty': [
    f => `${f.nameRef} — ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that actually delivers. ${f.adj}.`,
    f => `${f.nameRef}. ${f.adj}. No fluff.`,
    f => `Skip the rest — the ${f.nameRef.toLowerCase()} is ${f.adj}.`,
    f => f.feat1 ? `${f.nameRef}. ${f.feat1}, ${f.adj.toLowerCase()}.` : `${f.nameRef}. ${f.adj}.`,
    f => `${f.adj}: that's the ${f.nameRef.toLowerCase()} in a nutshell.`,
    f => `Your skin (or hair) will thank you. The ${f.nameRef.toLowerCase()}.`,
    f => `The ${f.nameRef.toLowerCase()} — the one that actually works.`,
  ],
  'sports': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `Built for real effort — the ${f.nameRef.toLowerCase()}. ${f.adj}.`,
    f => `${f.nameRef}: ${f.featList || f.adj}. No shortcuts.`,
    f => f.matOnly ? `${f.matOnly} ${f.nameRef.toLowerCase()}. ${f.adj}.` : `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that keeps up with you. ${f.adj}.`,
    f => `${f.adj}. That's the ${f.nameRef.toLowerCase()}.`,
  ],
  'toys': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'books': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'food': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'jewelry': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'automotive': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'pet-supplies': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'health': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'office': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'garden': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `The ${f.nameRef.toLowerCase()} that ${f.adj.toLowerCase()}.`,
  ],
  'other': [
    f => `${f.nameRef}. ${f.adj}.`,
    f => `${f.nameRef} — ${f.adj}.`,
    f => `${f.adj}. That's the ${f.nameRef.toLowerCase()}.`,
  ]
};

function buildHumanDesc(cat, name, attrs) {
  const n = cleanName(name);
  const color = cap(getFirst(attrs.color) || '');
  const material = cap(getFirst(attrs.material) || '');
  const materials = getN(attrs.material, 2);
  const matStr = materials.join(' and ') || 'premium';
  const size = getFirst(attrs.size);
  const sizeStr = size ? size.toUpperCase() : '';
  const capStr = getN(attrs.capacity, 2).join(' / ') || '';
  const edition = cap(getFirst(attrs.edition) || '');
  const feats = getN(attrs.feature, 3);
  const feat = cap(getFirst(attrs.feature) || '');
  const feat2 = feats[1] || '';
  const feat3 = feats[2] || '';
  const conn = getN(attrs.connectivity, 2).join(' and ') || '';
  const gender = getFirst(attrs.gender) || '';
  const genderS = gender ? gender.replace(/s$/, '') + "'s" : '';
  const adjs = HUMAN_ADJ[cat] || HUMAN_ADJ.other;
  const adj = pick(adjs);

  const fragments = {
    nameRef: n,
    colorMat: [color, matStr].filter(Boolean).join(' '),
    colorOnly: color,
    matOnly: matStr,
    featList: feats.filter(Boolean).join(', '),
    featAnd: feats.filter(Boolean).join(' and '),
    feat1: feat,
    feat2: feat2,
    capRef: capStr ? capStr + ' capacity' : '',
    connRef: conn ? conn + ' connectivity' : '',
    edRef: edition,
    sizeRef: sizeStr,
    genderRef: genderS,
    adj: adj,
  };

  const templates = TEMPLATES_BY_CAT[cat] || TEMPLATES_BY_CAT.other;
  let desc = pick(templates)(fragments);
  return desc.replace(/\s+/g, ' ').replace(/\.\./g, '.').replace(/ ,/g, ',').trim();
}

function localPredictAndGenerate(name) {
  if (!name || !name.trim()) return { category: 'other', description: '' };
  
  const cleanName = name.trim();
  const lowerName = cleanName.toLowerCase();
  const learned   = getLearnedData();

  if (learned.exactNames && learned.exactNames[lowerName]) {
    return {
      category: learned.exactNames[lowerName].category,
      description: learned.exactNames[lowerName].description
    };
  }

  const attrs = extractAttrs(name);
  const catRes = classifyProduct(name);
  const desc = buildHumanDesc(catRes.category, name, attrs);

  // Map internal category keys to dropdown option values.
  // Updated to match expanded product dropdown categories.
  const CAT_MAP = {
    'electronics': 'Electronics',
    'clothing':    'Clothing & Apparel', // refined below to Sneakers/Sandals/Boots
    'home-kitchen':'Home & Living',      // refined below to Kitchen & Dining
    'beauty':      'Skincare',           // refined below to Makeup & Beauty / Hair & Body
    'sports':      'Sports & Fitness',
    'toys':        'Toys & Games',
    'books':       'Books & Stationery',
    'food':        'Food & Drinks',
    'jewelry':     'Accessories',
    'automotive':  'Automotive',
    'pet-supplies':'Pet Supplies',
    'health':      'Health & Wellness',
    'office':      'Books & Stationery',
    'garden':      'Home & Living'
  };

  let uiCat = CAT_MAP[catRes.category] || 'Other';
  const lower = name.toLowerCase();

  // Refine beauty → Makeup & Beauty or Hair & Body
  if (uiCat === 'Skincare') {
    if (lower.includes('makeup') || lower.includes('lipstick') || lower.includes('mascara') ||
        lower.includes('foundation') || lower.includes('concealer') || lower.includes('blush') ||
        lower.includes('eyeshadow') || lower.includes('eyeliner') || lower.includes('lip gloss') ||
        lower.includes('primer') || lower.includes('contour') || lower.includes('highlighter')) {
      uiCat = 'Makeup & Beauty';
    } else if (lower.includes('shampoo') || lower.includes('conditioner') || lower.includes('hair') ||
               lower.includes('body wash') || lower.includes('lotion') || lower.includes('shower')) {
      uiCat = 'Hair & Body';
    }
  }

  // Refine clothing/footwear → specific category
  if (catRes.category === 'clothing') {
    if (lower.includes('sneaker') || lower.includes('shoe') || lower.includes('trainer') || lower.includes('runner')) uiCat = 'Sneakers';
    else if (lower.includes('sandal') || lower.includes('flip flop') || lower.includes('slipper')) uiCat = 'Sandals';
    else if (lower.includes('boot') || lower.includes('stiletto') || lower.includes('heel')) uiCat = 'Boots';
    else if (lower.includes('watch') || lower.includes('bag') || lower.includes('purse') || lower.includes('wallet') || lower.includes('belt') || lower.includes('scarf') || lower.includes('sunglasses') || lower.includes('hat') || lower.includes('cap')) uiCat = 'Accessories';
  }

  // Refine home-kitchen → Kitchen & Dining for cookware/appliances
  if (catRes.category === 'home-kitchen') {
    if (lower.includes('pan') || lower.includes('pot') || lower.includes('knife') || lower.includes('blender') ||
        lower.includes('toaster') || lower.includes('microwave') || lower.includes('oven') || lower.includes('fryer') ||
        lower.includes('kettle') || lower.includes('cookware') || lower.includes('bakeware') || lower.includes('cutlery') ||
        lower.includes('dish') || lower.includes('cup') || lower.includes('mug') || lower.includes('bowl') ||
        lower.includes('plate') || lower.includes('coffee maker') || lower.includes('mixer')) {
      uiCat = 'Kitchen & Dining';
    }
  }

  // Refine electronics → specific subcategory
  if (uiCat === 'Electronics') {
    if (lower.includes('headphone') || lower.includes('earphone') || lower.includes('earbuds') || lower.includes('earbud') ||
        lower.includes('speaker') || lower.includes('audio') || lower.includes('sound') || lower.includes('music') ||
        lower.includes('airpods') || lower.includes('buds') || lower.includes('bose') || lower.includes('jbl') ||
        lower.includes('sonos') || lower.includes('subwoofer') || lower.includes('amp') || lower.includes('amplifier')) {
      uiCat = 'Audio & Sound';
    } else if (lower.includes('phone') || lower.includes('iphone') || lower.includes('samsung') || lower.includes('tablet') ||
               lower.includes('ipad') || lower.includes('android') || lower.includes('mobile') || lower.includes('galaxy')) {
      uiCat = 'Phones & Tablets';
    } else if (lower.includes('laptop') || lower.includes('macbook') || lower.includes('notebook') || lower.includes('computer') ||
               lower.includes('pc') || lower.includes('desktop') || lower.includes('chromebook') || lower.includes('lenovo') ||
               lower.includes('dell') || lower.includes('hp') || lower.includes('asus') || lower.includes('acer')) {
      uiCat = 'Computers & Laptops';
    }
  }

  // Refine jewelry → Accessories
  if (catRes.category === 'jewelry') uiCat = 'Accessories';

  return { category: uiCat, description: desc };
}

const _debounceTimers = new Map();

function localPredictDebounced(key, name, cb, delay = 300) {
  if (_debounceTimers.has(key)) clearTimeout(_debounceTimers.get(key));
  _debounceTimers.set(key, setTimeout(() => {
    _debounceTimers.delete(key);
    if (name && name.trim().length >= 3) {
      cb(localPredictAndGenerate(name));
    }
  }, delay));
}

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

const SAMPLE_AI_PRODUCTS = [
  "Nike Air Max Pulse",
  "adidas Ultraboost Light",
  "Sony WH-1000XM5 Wireless Headphones",
  "Apple MacBook Air 13\" M3",
  "Cerave Hydrating Facial Cleanser",
  "Fenty Beauty Gloss Bomb",
  "Leather Minimalist Wallet",
  "Minimalist Ceramic Coffee Mug"
];

async function autoGenerateProductInfo(base64Image) {
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Grab name from DOM if possible, otherwise use random sample
  let nameEl = document.getElementById('new-p-name') || document.getElementById('edit-p-name') || document.getElementById('addProductName');
  let name = nameEl && nameEl.value.trim() ? nameEl.value : SAMPLE_AI_PRODUCTS[Math.floor(Math.random() * SAMPLE_AI_PRODUCTS.length)];

  const res = localPredictAndGenerate(name);
  return { 
    name: name, 
    category: res.category, 
    description: res.description 
  };
}

window.autoGenerateProductInfo = autoGenerateProductInfo;
