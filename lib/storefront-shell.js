'use strict';
// ── Storefront link unfurls ────────────────────────────────────────────────
// A storefront is served by the same index.html as the main marketplace, so a
// shared storefront link carried the marketplace's own title and description:
// pasting https://…/storefront/keplas-hub into WhatsApp produced a card that
// read "HAPPA TRADEMART — Ghana's Premier Multi-Vendor Marketplace", i.e. it
// looked exactly like a link to the main site. The store's name, slogan and
// logo never appeared, because a link preview is built by fetching the HTML —
// crawlers do not run the SPA, so nothing the browser does afterwards can fix
// the card.
//
// So the server answers /storefront/<slug> (and /store-admin/<slug>) with the
// SPA shell whose <head> describes THAT storefront. The body is untouched: the
// app boots exactly as before and routes from the path.
//
// Everything here is pure so it can be unit tested and shared by the Vercel
// function and the local server.

// The <head> region of index.html is wrapped in these markers, and everything
// between them is replaced for a storefront page. Without markers (an older
// deployed shell) injectStorefrontMeta falls back to rewriting the title and
// description tags in place.
const MARK_OPEN = '<!-- happa:page-meta -->';
const MARK_CLOSE = '<!-- /happa:page-meta -->';

const SITE_NAME = 'HAPPA TRADEMART';
const DEFAULT_TITLE = SITE_NAME;
const DEFAULT_DESCRIPTION =
  "HAPPA TRADEMART – Ghana's Premier Multi-Vendor Marketplace. Shop local stores and flash sales.";
// Used only when a store has no shareable http(s) image of its own. Logos and
// banners are stored as base64 data URIs, which a link preview cannot fetch.
const DEFAULT_IMAGE = '/images/icon-512.png';

const MAX_TITLE = 70;
const MAX_DESCRIPTION = 160;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collapse(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  const t = collapse(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trim() + '…';
}

function firstText(...values) {
  for (const v of values) {
    const t = collapse(v);
    if (t) return t;
  }
  return '';
}

function titleCaseSlug(slug) {
  return collapse(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// A shareable image must be a real URL a crawler can fetch. Data URIs (how the
// storefront editor stores uploads) and empty values become the platform image.
function absoluteImage(value, origin) {
  const raw = collapse(value);
  if (!raw) return '';
  if (/^data:/i.test(raw)) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(origin || '').replace(/\/+$/, '');
  if (!base) return '';
  return base + (raw.startsWith('/') ? raw : '/' + raw);
}

/**
 * The <head> metadata for one storefront page.
 *
 * @param {object} input
 * @param {object} input.storefront  the storefront row (name, slogan, about_us, …)
 * @param {object} input.store      the underlying store row (category, location, …)
 * @param {string} input.slug       the url slug from the path
 * @param {string} input.origin     e.g. https://happa-trademart-dwxh.vercel.app
 * @param {string} input.kind       'storefront' | 'store-admin'
 */
function storefrontShareMeta({ storefront = {}, store = {}, slug = '', origin = '', kind = 'storefront' } = {}) {
  const name = firstText(storefront.name, store.name, titleCaseSlug(slug), SITE_NAME);
  const isAdmin = kind === 'store-admin';

  const title = isAdmin
    ? truncate(`${name} — Store Admin`, MAX_TITLE)
    : truncate(`${name} — ${SITE_NAME}`, MAX_TITLE);

  const own = firstText(storefront.meta_description, storefront.about_us, storefront.slogan, store.slogan, store.description);
  const where = [firstText(store.category), firstText(store.location)].filter(Boolean).join(' · ');
  const description = truncate(
    own || (where ? `${name} on ${SITE_NAME} — ${where}. Shop this store on HAPPA.` : `${name} on ${SITE_NAME}. Shop this store on HAPPA.`),
    MAX_DESCRIPTION
  );

  const image =
    absoluteImage(storefront.banner_url, origin) ||
    absoluteImage(storefront.logo_url, origin) ||
    absoluteImage(store.banner_url, origin) ||
    absoluteImage(store.logo_url, origin) ||
    absoluteImage(DEFAULT_IMAGE, origin);

  const path = (isAdmin ? '/store-admin/' : '/storefront/') + encodeURIComponent(String(slug || ''));
  const canonical = origin ? String(origin).replace(/\/+$/, '') + path : path;

  return {
    title,
    description: description || DEFAULT_DESCRIPTION,
    image,
    canonical,
    robots: isAdmin ? 'noindex, nofollow' : '',
    siteName: SITE_NAME
  };
}

function metaBlock(meta) {
  const e = escapeHtml;
  const tags = [
    `<title>${e(meta.title || DEFAULT_TITLE)}</title>`,
    `<meta name="description" content="${e(meta.description || DEFAULT_DESCRIPTION)}">`
  ];
  if (meta.robots) tags.push(`<meta name="robots" content="${e(meta.robots)}">`);
  tags.push(
    `<link rel="canonical" href="${e(meta.canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${e(meta.siteName || SITE_NAME)}">`,
    `<meta property="og:title" content="${e(meta.title || DEFAULT_TITLE)}">`,
    `<meta property="og:description" content="${e(meta.description || DEFAULT_DESCRIPTION)}">`,
    `<meta property="og:url" content="${e(meta.canonical)}">`
  );
  if (meta.image) tags.push(`<meta property="og:image" content="${e(meta.image)}">`);
  tags.push(
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${e(meta.title || DEFAULT_TITLE)}">`,
    `<meta name="twitter:description" content="${e(meta.description || DEFAULT_DESCRIPTION)}">`
  );
  if (meta.image) tags.push(`<meta name="twitter:image" content="${e(meta.image)}">`);
  return tags.join('\n  ');
}

// ── A storefront page carries no PWA hooks ─────────────────────────────────
// The storefront shares the app's shell, so it used to be served with the app's
// manifest link and its mobile-web-app-capable / apple-mobile-web-app-* metas
// still in place. That is what let an OS treat a storefront URL as part of the
// installed HAPPA TRADEMART app: tapping a storefront link handed it to the
// installed app instead of the browser, and "Add to Home Screen" while on a
// storefront created a standalone app for that store.
//
// A storefront is a plain store page, so every hook that makes a page
// installable is stripped from these two paths only — the manifest link and the
// app-capable metas. The app's own pages keep all of them. Icons and
// theme-color stay: a normal web page may have both, and neither makes the page
// launchable as an app.
const MANIFEST_LINK = /<link\s+[^>]*rel=["']manifest["'][^>]*>\s*/gi;
const APP_CAPABLE_META = /<meta\s+[^>]*name=["'](?:mobile-web-app-capable|apple-mobile-web-app-capable|apple-mobile-web-app-status-bar-style|apple-mobile-web-app-title|application-name)["'][^>]*>\s*/gi;
const NO_PWA_NOTE = '<!-- No PWA hooks on a storefront page — see lib/storefront-shell.js -->\n  ';

function stripPwaHooks(html) {
  return String(html == null ? '' : html)
    .replace(MANIFEST_LINK, NO_PWA_NOTE)
    .replace(APP_CAPABLE_META, '');
}

/**
 * Replace the page metadata in the SPA shell. The rest of the document is
 * returned byte-for-byte, so the app boots exactly as it does today — except
 * that a storefront page is also stripped of the app's PWA hooks.
 */
function injectStorefrontMeta(html, meta) {
  const source = String(html == null ? '' : html);
  if (!source) return source;
  const block = metaBlock(meta || {});

  const open = source.indexOf(MARK_OPEN);
  const close = open > -1 ? source.indexOf(MARK_CLOSE, open) : -1;
  if (open > -1 && close > open) {
    return stripPwaHooks(
      source.slice(0, open + MARK_OPEN.length) + '\n  ' + block + '\n  ' + source.slice(close)
    );
  }

  // Older/foreign shell without markers: swap the title and description, then
  // add the rest right after the description tag.
  let out = source.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title || DEFAULT_TITLE)}</title>`);
  const descTag = /<meta\s+name=["']description["'][^>]*>/i;
  if (descTag.test(out)) {
    out = out.replace(descTag, `<meta name="description" content="${escapeHtml(meta.description || DEFAULT_DESCRIPTION)}">\n  ${block}`);
  } else {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, m => m + '\n  ' + block);
  }
  return stripPwaHooks(out);
}

// The slug in a storefront path, decoded and sanity-checked.
function slugFromPath(pathname) {
  const m = /^\/(?:storefront|store-admin)\/([^/?#]+)/i.exec(String(pathname || ''));
  if (!m) return '';
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
  return collapse(slug).slice(0, 120);
}

module.exports = {
  MARK_OPEN,
  MARK_CLOSE,
  SITE_NAME,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  DEFAULT_IMAGE,
  escapeHtml,
  truncate,
  absoluteImage,
  storefrontShareMeta,
  injectStorefrontMeta,
  stripPwaHooks,
  slugFromPath
};
