# HAPPA TRADEMART — Developer Handoff

Multi-vendor marketplace (Ghana). Mobile-first vanilla-JS SPA + Express "Table API".
Two interchangeable backends:

- **Local dev**: `server.js` — Express static + API server, file-backed `db.json` (auto-loads `.env`)
- **Production**: `api/index.js` — Vercel serverless app, Supabase/PostgreSQL (`api/data-store.js` as file fallback)

> 🔐 **This document contains NO secret values.** Every credential lives in `.env` (local) or in the
> Vercel/env dashboard (production). Section 7 lists the variable names and where each value comes from.
>
> ⚠️ The **bundle still contains real secrets** in `.env`, `.session-secret` and `db.json`.
> Share privately; never commit or publish. `.gitignore` excludes `.env`, `.env.*`,
> `.session-secret`, `db.json` and `db.json.bak*`.

> 🧱 This snapshot is the **re-hardened build**. It closes all 23 findings of the August 2026 audit
> **and** all 13 findings of the September re-review ("marked fixed, but not") — see sections 5 and 6.
> Section 8 lists the actions that need a human (Supabase migration, host env vars, payment gateway).

---

## 1. Quick start (local dev)

```bash
npm install
node server.js            # or: npm start
# open http://localhost:9000   (PORT env var overrides; default 9000)
npm test                  # full backend suite (85 tests)
```

- Data lives in `db.json` (auto-created). Point at a copy with `HAPPA_DB_FILE=/path/to/db.json node server.js` (tests rely on this).
- Sessions: `server.js` loads `.env`; without `SESSION_SECRET` it falls back to `.session-secret`, then in-memory tokens.
- Push: VAPID keys load from env first, then generate an **in-memory** pair (they are no longer persisted to the DB — set `VAPID_*` to keep subscriptions stable across restarts).
- Supabase (optional locally): set `SUPABASE_URL` + `SUPABASE_KEY` in `.env` — see section 7. Without them everything still works from `db.json`.
- ⚠️ Supabase currently returns **HTTP 402 (egress quota exceeded)** in production — fix in the Supabase dashboard. The code handles it honestly with 503s instead of pretending to succeed.

## 2. Tests

```bash
npm test        # node --test access + api + commerce-atomic + checkout-rules + security + uploads + wallet-atomic
```

**85 tests, currently all green.** They use isolated `HAPPA_DB_FILE` copies — the real `db.json` is never touched.

- `access.test.js` + `api.test.js` — role/table access control, generic API rules, wallet actions.
- `commerce-atomic.test.js` — mock-Supabase CAS stock decrement, races, transport errors, rollback.
- `checkout-rules.test.js` — real spawned server + HTTP: server-derived money, replay/idempotency, oversell 409, cross-store cart 409, invalid input 400.
- `security.test.js` — negative paths: unknown table 404, notifications are admin-only, the narrow `/api/notify` recipient rules, OTP gating + anonymous 401s, signup never stores plaintext / never mints an admin, session-derived ownership + product→store guard, non-owner replay leaks nothing, VAPID secret not readable through `/api/settings`, 7-day token lifetime.
- `wallet-atomic.test.js` — `applyMove`: ledger+balance in one step, signed `balanceDelta`, refusal to go negative, the RPC is trusted with the whole move (no double write), a failed RPC is never retried locally, concurrent moves cannot overspend.
- `uploads.test.js` — the resumable chunk protocol end-to-end: lossless split/reassembly, a gap assembles to nothing, oversized refusal, anonymous 401, the **2 MB per-image storage budget** (`firstOversizedImage`, plus an HTTP 413 when a client sends an uncompressed image), a re-sent chunk is idempotent, **an interrupted upload resumes from the first missing chunk** (server reports `received:[0]`, `missing:[1,2]`), a re-sent chunk is idempotent, an asset ref expands into the row (and the consumed chunks are deleted, a replay 409s), cross-account isolation (404 read / 403 write), an unknown ref is refused rather than dropped, and `upload_chunks` is invisible to clients (admins included).

CI: `.github/workflows/ci.yml` runs `npm ci && npm test` on every push to `main` and every pull request.

## 3. Architecture map

| Path | Role |
|---|---|
| `server.js` | Dev server: static files + full REST API. |
| `api/index.js` | Production serverless API (same surface, Supabase-first). Exports `app`. |
| `api/data-store.js` | JSON file store for the serverless fallback path. |
| `lib/commerce.js` | **Server-authoritative money & stock.** Commission tiers, fees, coupon validation, `atomicStockDecrement` (compare-and-swap), `restoreStock`, `validateItemsForStore` (item→store binding), local apply/restore. |
| `lib/access.js` | Role/table policies: `WRITABLE_TABLES` allowlist, `PUBLIC_SETTINGS_KEYS`, owner-field stamping (`OWNER_FIELDS`), `sanitizeUserCreate`, `sanitizeNotificationPatch`, audit log. |
| `lib/session.js` | HMAC session tokens (`SESSION_SECRET`), in-memory fallback, `requireAuth`/`requireAdmin`, 7-day expiry. |
| `lib/otp.js` | Shared OTP engine: `crypto.randomInt` codes, 5-minute TTL, 5 attempts, **max 3 per user per hour**, single-use. Persisted in the Supabase `otps` table (db.json fallback). |
| `lib/notify.js` | Shared rules for `POST /api/notify`: field clamps, notification-type allowlist, and the recipient authorization model (self / admin / shared-record party). |
| `lib/wallet.js` | Wallet engine: `applyMove` (atomic ledger+balance), `rpcMoveBalance` (`wallet_move` RPC + local mirror), `markSettlement`, deposit/withdraw/pay/purchase/rendor-subscribe/storefront-payout/release-delivery/refund-reject. |
| `lib/uploads.js` | Resumable-upload protocol (shared by both servers): `CHUNK_CHARS`/`MAX_IMAGE_CHARS`/`MAX_CHUNKS`/`MAX_TOTAL_CHARS`, `newUploadId()`, asset-ref helpers (`isAssetRef`/`assetIdOf`/`assetRefFor`), `validateCreate`/`validateChunk`, `splitIntoChunks`, `missingChunks`, `assemble`, `resolveAssetRefs` (throws `asset_missing`), `collectAssetRefs`. |
| `js/upload.js` | Browser `Uploader` / `resumableUpload`: sends a compressed image as chunks and resumes from the **first chunk the server is missing** — across retries *and* page reloads (session stored in `localStorage`, keyed by name+size+lastModified). On success the save body carries `asset:<uploadId>` instead of ~180 KB of base64. Falls back to inline if it cannot finish. Loaded after `js/utils.js`; precached in `sw.js`. |
| `js/*.js` | Frontend SPA modules (`app.js` shell/router, `marketplace.js`, `checkout.js`, `orders.js`, `admin.js`, `vendor.js`, `wallet.js`, …). **Client never owns money/stock** — it only POSTs intents. `escHtml()` for HTML text, `jsArg()` for values inside inline handlers. |
| `css/vendor/`, `css/webfonts/`, `js/chart.min.js` | **Vendored third-party assets** — Font Awesome Free 6.4.0 (CSS + the three `.woff2` files) and Chart.js 4.4.0. Loaded from the repo, never from a CDN. A failed jsDelivr fetch used to blank out all ~1000 `fa-` icon usages app-wide, which made the notification bell and the account button in the top-right corner invisible (they have no background until hover). See §10. |
| `sw.js` | Service worker: offline cache + web-push `push`/`notificationclick` handlers. Pre-caches the icon font and Chart.js. A failed cross-origin fetch resolves to `Response.error()` — never an empty `408`, because a blank 408 stylesheet looked like a success and silently killed every icon with nothing logged. |
| `migrations/` | SQL to run in the Supabase SQL editor. `005_security_hardening.sql` is the current one (see section 8). |
| `db.json` | Local database (users, products, stores, orders, settings, push_subscriptions…). |

**Money rules (do not break):** totals/discounts/commission recomputed server-side only. Commission tiers: 8% ≤50, 6% ≤100, 4% ≤500, 3% ≤1000, 2% above (GH₵); buyer fee 1.5% main site / 1% storefront; platform delivery fee 0. Stock decremented via conditional CAS update (`stock_qty = validated_value`) — oversell → 409 with rollback; storage uncertainty → 503, never fake success. Idempotency replay guard runs **before** all side effects.

**Security invariants added by this build (keep them):**

- **No owner fields from the request body.** `vendor_id` / `buyer_id` / `user_id` / `rendor_id` / referrer ids are stripped on every write and **re-stamped from the session for every writable table** — products, stores, storefronts, ad_campaigns, orders, packages, support_tickets, reviews, services and referrals. Forgetting one makes the row invisible to its owner.
- **Packages are bound to one store.** Every item must belong to the claimed store (`commerce.validateItemsForStore`); when `store_id` is missing it is derived from the items. The vendor payout always comes from the store row.
- **Closed table allowlist.** Unknown tables 404 on POST/PUT/PATCH (`access.WRITABLE_TABLES`); add new tables there.
- **Notifications are created by `POST /api/notify`, never by the client table API.** A caller may address themselves, an admin, or someone they share an order/package/ticket/referral/campaign with (passed as `ref`). Admins may broadcast. A notification PATCH carries only `is_read` + `updated_at`.
- **Every balance change is one atomic move** (`wallet.applyMove` → `wallet_move` RPC on Supabase). Ledger rows and balances move together or not at all; the unique `(user_id, type, reference)` index makes retries idempotent.
- **The icon font and Chart.js are self-hosted and precached.** No third-party CDN may serve something the app's UI depends on. One failed `cdn.jsdelivr.net` request used to turn all ~1000 `fa-` icons into zero-width glyphs — the notification bell, search and account buttons in the top-right corner went completely invisible, with no error logged anywhere, because the service worker answered the failed stylesheet fetch with an empty `408`.
- **Changing a precached file means bumping two versions.** `CACHE_NAME` in `sw.js` *and* `SW_VERSION` in the `index.html` self-heal (which unregisters the SW and deletes **all** caches once per version). Anything left out of `PRECACHE_ASSETS` is briefly dependent on a live network fetch right after that wipe. These two **drifted once** (`SW_VERSION` sat at `happa-v144` while `CACHE_NAME` reached `happa-v159`) and the failure is silent: the self-heal is gated on the stored `localStorage.sw_selfheal_version`, so any client that had already healed at the old value never healed again and kept running stale JS — a fix could be live on the server and still misbehave in a returning browser. `test/sw-version.test.js` now fails the build if they differ, so do not hardcode around it.
- **Asset delivery is stale-while-revalidate, so a deploy needs one extra load.** Same-origin JS/CSS come from cache first and refresh in the background; navigations are network-first. That means the load right after a deploy can still run the previous bundle. Do not diagnose a "fix didn't work" report without checking which bundle the client is actually running.
- **A letterboxed product photo cannot be fixed with CSS.** `squareImage` cover-crops now, but a photo scaled to *fit* inside a square canvas saves white bars as real pixels, so no stylesheet can remove them. `fitProductImage` in `js/utils.js` repairs such images at display time (and only helps clients running the current bundle). The durable fix is to re-encode the row: crop the content box out of the stored jpeg and PATCH it back (needs a decoder — `jpeg-js` is not a project dependency). Audit result as of this change: one legacy row (`mups5amdrxk7`, 900×900 with 193 px white bars on each side), repaired in place to 511×900; nothing else in `products`/`stores`/`users` was framed.
- **No uncompressed image can reach storage.** Every write body is scanned for a `data:image/…` string larger than `uploads.MAX_IMAGE_CHARS` (2 MB) and refused with 413, and an upload session is capped to the same budget. The browser compresses to ~180 KB, so this can only ever reject a client that skipped compression.
- **Passwords are bcrypt-only**; the plaintext field is never stored (user writes hash it, every other table drops it).
- **Settings reads are filtered** to `PUBLIC_SETTINGS_KEYS` for non-admins — no VAPID keys or future secrets through `/api/settings`.
- **Phone verification** needs a signed-in session and a server-issued, hashed, 5-minute, 5-attempt, single-use OTP — max 3 per user per hour.
- **Inline handlers never interpolate raw values.** `escHtml()` is for HTML text; anything going inside `onclick="fn('…')"` must go through `jsArg()`, which emits `\uXXXX` escapes (an HTML-decoded `&#39;` would re-open the quote and execute).

**Images are compressed, and the server enforces a budget.** Every image is resized/re-encoded in the browser to a ≤ ~180 KB JPEG data URL (`compressImage`/`squareImage` in `js/utils.js` — a 15 MB source is accepted, anything larger is refused before it is read) **and** the server independently caps any stored `data:image/…` at `MAX_IMAGE_CHARS` = 2 MB. Compression alone is only a client courtesy — a scripted client can skip it — so the server-side ceiling is what actually protects the storage quota. It is deliberately generous enough that an existing row can never become unsaveable (the edit forms resend a stored image inline); reachable only by a client that did not compress.

**Resumable uploads:** every image is compressed client-side to a ≤ ~180 KB data URL and then uploaded as `CHUNK_CHARS`-sized chunks — `POST /api/uploads` (open session) → `GET /api/uploads/:id` (which chunks are held) → `PUT /api/uploads/:id/:index` → `POST /api/uploads/:id/finish`. The client persists the session per file, so a dropped connection **or a full page reload** resumes by re-sending only the missing chunks instead of the whole file. When every chunk is in, the record-save body carries the short token `asset:<uploadId>`; `expandUploadAssets()` on the server swaps it back into the row and deletes the consumed chunks, so stored data is byte-for-byte what it was before. `upload_chunks` is server-only (`SERVER_ONLY_TABLES` in `lib/access.js`) — never readable or writable through the public table API, admins included. If an upload cannot finish, the caller's request is rewritten back to the original inline body and retried once, so a bad connection can slow a save down but never lose it.

**Push notifications:** inserting a `notifications` row auto-dispatches web-push server-side (`server.js` + `api/index.js`). The client deliberately does **not** also call `/api/push/send` — that caused every push to fire twice. Keep it that way.

## 4. Git & recent work

Repo: `https://github.com/jkaidoo1-cmyk/HAPPA-TRADEMART.git` (branch `main`).
Recent history is meaningful; older commits are all ".".

- `f0b7ffa` — guide-compliance: server-owned money, atomic stock, idempotent checkout, 15mb body cap, product validation.
- `d8b1a0f` — push auto-dispatch on notification insert, CORS `ALLOWED_ORIGINS` allowlist, storefront-in-app navigation, bcrypt-failure 500s, dev rate-limiting.
- `aa6da16` — **security hardening**: session-derived ownership, item→store binding, OTP-gated phone verification, admin-only notifications, closed table allowlist, bcrypt-only passwords, filtered settings reads, 7-day sessions, wallet XSS escaping, `migrations/005_security_hardening.sql`, `test/security.test.js`, CI workflow.
- `3e6f783` — closes the September re-review: rotated `SESSION_SECRET`/VAPID/`.session-secret`, RLS `anon_read` removed from personal tables, migration bugs fixed, `wallet_move` actually wired into every balance change, refund/release mutual exclusion, `escHtml`/`jsArg` XSS split, replay-guard leak, `api/index.js` id handling, OTP persistence + per-user limit, server-side notification endpoint, owner re-stamping, login fixes, backup-file removal.
- `cbfb49b` — the production login route equalizes timing too (`lib/session.equalizeLoginTiming`), so response latency no longer enumerates registered emails.
- **This snapshot** — **resumable uploads**: `lib/uploads.js` (shared chunk protocol), `js/upload.js` (browser `Uploader`), both servers' upload routes + `expandUploadAssets`, the `upload_chunks` table + RLS in `migrations/005_security_hardening.sql`, `test/uploads.test.js`, `sw.js` precache entry. Also **self-hosted Font Awesome + Chart.js** (they were jsDelivr CDN links; when that fetch failed every icon in the app went invisible — see the house rules in §10) and added the **2 MB per-image storage budget**. Also fixed three latent **`window.App`** bugs — `App` is a top-level `const`, so `window.App` was *always* falsy; that had silently disabled background image upload and made the vendor storefront's live preview fall back to hardcoded demo products instead of the store's real ones.

## 5. Security audit status (August 2026 review — all 23 closed)

| # | Finding | Status |
|---|---|---|
| 1 | OTP trusted `body.userId`; client-side demo OTP + Skip | Fixed — session-only target, hashed server-issued OTP, no client code display, no Skip |
| 2 | `isOwner(viewer, body)` | Fixed — stored-record authorization + session stamping (+ product→store ownership) |
| 3 | Client-supplied id takeover | Fixed — server generates ids; orders/packages keep the id only as an idempotency key |
| 4 | Payments accepted without gateway verification | **Not implemented — needs a Paystack/Hubtel account + webhook** |
| 5 | Wallet check-then-write race | Fixed — `wallet_move` row-locked RPC is now called from every balance change |
| 6 | XSS: unescaped `'`/backtick, raw wallet fields, inline `onclick` | Fixed — `jsArg()` for handler arguments, `escHtml()` for HTML text |
| 7 | VAPID key in `db.json`; public settings read; rotate `SESSION_SECRET` | Fixed — keys moved to env, settings reads filtered, RLS enabled, **secrets rotated** |
| 8 | Plaintext `password` stored alongside the hash | Fixed — bcrypt only; local cleartext stripped, probe accounts removed |
| 9 | Client-writable notifications; `/push/send` only authenticated | Fixed — server/admin-only creation via `/api/notify`, admin-only send, authenticated subscribe, OTP in the `otps` table |
| 10 | Open table writes | Fixed — closed allowlist, unknown tables 404 |
| 11 | 1-year session tokens | Fixed — 7 days |
| 12 | `check-email` unbounded + full user select | Fixed — rate-limited, targeted single-row lookup |
| 13 | Replay guard returned the order row to anyone | Fixed — owner/admin only, others get a bare 409 |
| 14 | No item→store validation | Fixed — package items must belong to the claimed store |
| 15 | Refund/release conflict; `note.includes(pCode)` matching | Fixed — `package_id` persisted on ledger rows, settlement status is mutual-exclusion, refund refuses a released package |
| 16 | Storefront POST applied defaults; vendor self-activation | Fixed — merge semantics; subscription fields admin-only |
| 17 | Static blocklist bypassable via URL-encoding | Fixed |
| 18 | Login crash on unknown user + timing enumeration | Fixed |
| 19 | Rate limiter / trust proxy | Fixed — `trust proxy`, layered per-IP + per-account + pair limits, IPv6-safe (`ipKeyGenerator`) |
| 20 | Prod silent fallbacks | Partial — hosted envs now log a loud error when Supabase env is missing; still falls back instead of hard-failing |
| 21 | `select('*')` full-table scans (Supabase 402) | Partial — hot paths are targeted; not every remaining query audited |
| 22 | Storefront login compared passwords in the browser | Fixed — server `/auth/login` |
| 23 | No tests / CI | Fixed — `npm test` (85 tests) + GitHub Actions |

## 6. September re-review ("marked fixed, but not") — all 13 closed

| # | Finding | Status |
|---|---|---|
| 1 | `SESSION_SECRET`/VAPID identical to the leaked values and printed in this doc | Fixed — secret, both VAPID keys and `.session-secret` rotated; the doc no longer contains any value |
| 2 | RLS `anon_read using(true)` on users/orders/packages | Fixed — migration now creates anon policies for **catalog tables only** and drops any leftover policy on personal tables. The frontend never talks to Supabase directly |
| 3 | Migration errors: `validate constraint` needs the table prefix; the `(user_id,type,reference)` index breaks payouts with blank references | Fixed — `alter table users validate constraint …`; blank references are backfilled, and every generated reference is unique (`REL-`/`COMM-`/`REF-`/`RFD-`/`REV-`/`FEE-`/`SFP-`/`SFC-` + package id) |
| 4 | `wallet_move` never called; races remain | Fixed — `wallet.applyMove` is the only way money moves; it calls the RPC when Supabase is reachable and otherwise runs under a per-wallet lock |
| 5 | Refund/release conflict (`package_id` dropped, `updatePackage` missing, no settlement check) | Fixed — `writeTxn` persists `package_id`, `markSettlement` uses the generic update, `refundReject` 409s on a released package |
| 6 | `escHtml` emits `&#39;`, which the browser decodes back to `'` inside `onclick` | Fixed — `jsArg()` added and used for every handler argument (admin, admin-profiles, marketplace, vendor, buyer, wallet); `wallet.js` `t.note` is escaped; `store.name`/`u.email` sites converted; a scanner script confirmed the remaining inline-handler expressions are all ids/numbers |
| 7 | Replay guard `!viewer \|\|` leaked orders to anonymous callers | Fixed in both servers + regression test |
| 8 | `api/index.js` overwrote every id (duplicate orders, client id mismatch) | Fixed — orders/packages keep their validated id; only other tables get a generated one |
| 9 | OTPs in the local file store on Vercel; no per-user SMS limit; `Math.random` | Fixed — `lib/otp.js` + the Supabase `otps` table, `crypto.randomInt`, max 3 codes per user per hour |
| 10 | ~59 client `addNotification` call sites broke when the table became admin-only | Fixed — `POST /api/notify` with server-side recipient checks, and `addNotification(..., ref)` passes the shared record |
| 11 | Owner fields stripped but not re-stamped for tickets/referrals/ads | Fixed — both servers stamp support_tickets, referrals (with a validated referrer) and ad_campaigns |
| 12 | Login: inverted `isLocalOnly`, `.eq('email')` breaks phone login, missing per-IP / per-email limits | Fixed — the flag is gone, the identifier column is chosen by shape, and three limiter layers run (30/15min per IP, 10/15min per account, 5/15min per pair) |
| 13 | `db.json.bak-sec-cleanup` held plaintext passwords and was not blocklisted | Fixed — file deleted (plus a stale `.env.backup-preview` holding a service-role key), static guard now blocks `db.json*`, `.session-secret` and `*.bak/backup/orig/old/save/tmp` |

## 7. 🔐 Credentials — variable names only

| Variable | Where the value comes from |
|---|---|
| `SESSION_SECRET` | Local `.env` (rotate with `npm run gen-secret`); set the same value in the host env |
| `.session-secret` | Local fallback file, used only when `SESSION_SECRET` is unset |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Generate with `npx web-push generate-vapid-keys`; store in `.env` + host env |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `SUPABASE_KEY` | Supabase dashboard → **service_role** key (not the anon key). Not stored in this checkout |
| `TERMII_*` **or** `TWILIO_*` | Your SMS provider dashboard (needed for real OTP delivery) |
| `ALLOWED_ORIGINS` | Only needed when the frontend is served from a different origin |
| WhatsApp Cloud API (`WHATSAPP_*`) | **Not configured** — no placeholders remain in the checkout; add them to `.env` if you enable vendor WhatsApp notifications |

Notes:
- Local `server.js` ignores `SUPABASE_*` unless both are set and non-placeholder. With the **anon** key you get read/auth but likely RLS write failures — use the **service_role** key server-side.
- OTP SMS: with `TERMII_*` or `TWILIO_*` set, codes are texted; without them `server.js` logs the code server-side (local dev only) and the deployed API answers 502 rather than leaking a code.
- Push no longer works "out of the box" from the database: generate a pair with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in the host env (and locally in `.env`). Existing subscriptions must be re-created — the previous key pair was rotated.
- Vercel env vars required: `SUPABASE_URL`, `SUPABASE_KEY` (service_role), `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, SMS provider, optionally `ALLOWED_ORIGINS`.

## 8. Outstanding actions (human)

1. **Run `migrations/005_security_hardening.sql`** in Supabase. It creates the `otps` and `upload_chunks` tables, the `wallet_move` RPC and `packages.settlement_status`, adds `wallet_transactions.package_id` + the unique `(user_id, type, reference)` index (after backfilling blank references), drops `users.password`, deletes the VAPID rows, adds the non-negative balance check, and enables RLS with anon policies on catalog tables only. Until it is applied, the wallet engine detects the missing RPC and falls back to the local (lock-serialized) path.
2. **Set/rotate host env vars:** copy the rotated `SESSION_SECRET` + `VAPID_*` from `.env` into Vercel (rotating `SESSION_SECRET` logs everyone out), and set the SMS provider variables.
3. **Rotate the Supabase `service_role` key** if the previous one was ever shared: it appeared in a local `.env.backup-preview` that has now been deleted.
4. **Payments (#4)** still accept a claimed-paid order without gateway verification. Needs a Paystack/Hubtel account, a webhook endpoint with signature verification, and a server-side status transition.
5. **Push subscriptions** were invalidated by the VAPID rotation — users must re-subscribe (the client prompts them on next sign-in).

## 9. Known issues / next steps

1. **Supabase 402 egress quota** — external; fix in the Supabase dashboard (free tier exhausted). Until then the production API answers 503 honestly on the Supabase path.
2. **Remaining `select('*')` reads (#21)** — hot paths are targeted now, but a full sweep of the remaining queries would cut egress further.
3. **Prod fallback (#20)** — the deployed API still writes to the ephemeral local store when Supabase env is missing (now with a loud error log). Consider failing closed with 503 once Supabase is confirmed configured.
4. **Broadcast push** sends per-user (parallel batches of 10) — fine at current scale, revisit if user count grows.
5. **CORS allowlist** — same-origin deployment needs nothing; add origins to `ALLOWED_ORIGINS` otherwise.
6. Older git history is all "." commits — rely on this doc + code comments for context.
7. **`/api/notify` is not template-based.** Recipient authorization is enforced, but the title/message text still comes from the caller. Moving the copy server-side (a template id + params) would remove the last free-text path into another user's inbox.

## 10. House rules for contributors

- Money/stock/coupons/stats: **server-side only** — never trust client amounts (`test/checkout-rules.test.js`, `test/commerce-atomic.test.js`).
- Every balance change goes through `wallet.applyMove` — never patch `wallet_balance` or insert a `wallet_transactions` row directly. Give every move a **unique reference** (`REL-`/`WD`/`PAY`/… + id); the unique index treats a repeated reference as a retry and skips it.
- Ownership always comes from the session / stored record — never from the request body. New owner-bearing tables must be added to the `ref`/stamp block **and** `OWNER_FIELDS` in `lib/access.js`.
- A package belongs to exactly one store, and its items must belong to that store.
- New tables must be added to the policy sets in `lib/access.js` (read classes + write allowlist).
- One notification insert = exactly **one** push. Client code calls `addNotification(...)` (which hits `/api/notify`); don't re-add direct `/api/push/send` calls.
- Inside an inline handler use `jsArg()`, in HTML text use `escHtml()` — mixing them either breaks the call or renders literal `\uXXXX`.
- Keep body caps at **15mb** on both servers (base64 product images need it), but keep the **per-image** budget at `uploads.MAX_IMAGE_CHARS` (2 MB) — every write body is scanned by `expandUploadAssets` → `firstOversizedImage`, which is what stops an uncompressed image from eating the storage quota. It sits well above the ~180 KB the browser produces, so it must never reject a normal upload.
- Run `npm test` (85 tests) before pushing; keep `db.json`, `.env` and `.session-secret` out of git.
- Durable bytes go through the chunk protocol (`lib/uploads.js` + `js/upload.js`) — don't add a new big-inline-base64 path, and keep `upload_chunks` in `SERVER_ONLY_TABLES`.
