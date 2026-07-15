# HAPPA TRADEMART

**Ghana's Premier Multi-Vendor Marketplace** — mobile-first, single-page application built with vanilla HTML, CSS and JavaScript, backed by a RESTful Table API.

---

## 🚀 Run Locally

### Option 1: Node backend

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the backend and static server:
   ```bash
   npm start
   ```
3. Open `http://localhost:9000` in your browser.

### Option 2: Python backend

If Node is unavailable, start the Python backend instead:

```bash
python simple-server.py
```

Then open `http://localhost:9000`.

The app now runs with a real RESTful `/api` backend and persistent `db.json` storage.

## ✅ Completed Features

### 🏠 Public / Home
- Hero banner, location chips, flash-sale countdown, "Near You" section
- Marketplace browse with filter by category / location / campus
- Store listing with filter chips
- Product detail page with add-to-cart
- Search with live dropdown results
- Delivery rates info page
- **Ad banner slots on Home, Shop & Stores pages** — rotating sponsored products from active campaigns
- **Weekly Shipping Day card** on Shop page (days-to-Saturday countdown)

### 🛒 Buyer Experience
- Cart (add / remove / clear) with persistent localStorage
- Checkout with delivery address, wallet or COD payment
- Order confirmation and package tracking
- Buyer dashboard: Overview, Orders, Wallet, Referrals, Saved Stores, Settings (profile + sign-out)
- Referral programme — shareable link, track sign-ups, history
- Cart and cart nav hidden for non-buyer roles

### 🏪 Vendor Dashboard
- Every vendor has exactly one store — vendor and store are the same entity
- Overview: Active Products, Total Orders, Wallet Balance, Store Rating
- Quick Actions (4 tiles): My Store, Add Product, Orders, Analytics
- **My Store** — dedicated full page (banner, logo, products, keywords, stats, Edit Store / Keywords buttons)
- Products tab: add / edit / archive products with stock, price, flash-sale toggle
- Orders tab: view and manage incoming packages (Receive → Process)
- Earnings, Wallet, Referrals, Verify tabs
- **Bottom nav "Stores" relabelled "My Store"** for vendors → navigates to `vendor-my-store` page
- "My Store" bottom-nav item highlights (active class) when on the vendor-my-store page

### 🎨 Rendor Dashboard  *(contact-credentials model — no in-app bookings)*
- **Rendors** are independent service providers (writers, designers, tutors, photographers, etc.)
- They post their work samples and contact credentials; clients reach them **directly** outside the platform
- Rendors pay a **subscription fee** to Admin for platform visibility — no commission or order flow
- **Registration**: 3-way toggle — Buyer / Vendor / **Rendor** (purple-accented)
  - Collects: Display/Brand Name, Service Category, Bio, Starting Price, Skills/Tags
  - Status starts as `pending_approval`; Admin approves before profile goes live
- **Pending screen** (purple branded) with clear next-steps list shown before approval
- **Rendor Hub (6 tabs):**

  | Tab | What it does |
  |---|---|
  | **Overview** | Profile banner (avatar, name, category, tags), subscription status strip, stats (Active Posts, Subscription status, Wallet, Verification), "How Rendors Work" explainer card, Quick Actions, Recent Posts preview |
  | **My Posts** | List of service posts (title, category, description, starting price, image). Add / Edit / Delete (archive) posts. Posts use the `services` table with `rendor_id` — no `service_orders` created |
  | **Contact Info** | WhatsApp, Email, Instagram, X/Twitter, Facebook, Website/Portfolio, Notes. Shown on profile so clients contact directly. Editable via "Edit" button |
  | **Subscription** | Current status card (active / expired), plan cards (Monthly GHS 30 / 3-Month GHS 80 / 6-Month GHS 150), "I've Paid — Notify Admin" flow that sends an in-app notification to all admin accounts, Contact Admin message form |
  | **Wallet** | Balance card (purple gradient), Top Up (`showDepositModal`) + Withdraw (`showWithdrawalModal`) buttons, transaction history (`renderWalletHistory`). Wallet is for platform subscriptions — client payments are off-platform |
  | **Verify** | 3-step: Phone OTP → ID document upload → Admin review (purple-accented). Verified rendors get a `✅ Verified` badge |

- **Edit Profile** modal — brand name, service category, bio, starting price, tags
- **Edit Contact Info** modal — all 6 contact channels + notes field
- Cart and cart nav hidden for rendors

### 🔧 Admin Panel
- **Overview tab**: platform stats, revenue chart, location chart, pending-approval banners for vendors and rendors
- **Vendors tab**: pending approval list (approve → assign store, or reject), all vendors with stores
- **Rendors tab**:
  - Pending rendors: approve (with corrected notification copy) or reject
  - Active rendors: subscription status pill (green active / red inactive), expiry date
  - **⭐ Sub button** opens `adminActivateRendorSub()` modal — admin selects plan (Monthly/3-Month/6-Month), start date, activates subscription via PATCH and notifies rendor
  - 🔔 Notify button (`adminNotifyUser`) — send custom title + message
  - 🚫 Suspend button (`adminSuspendUser`) — suspend with in-app notification + reload
- **Users tab**: search, view all users, suspend / activate
- **Orders tab**: all packages with detail view
- **Analytics tab**: revenue and location charts
- **Wallet tab**: admin transaction list, withdrawal approvals
- **Ads tab**: full campaign CRUD — create, edit, pause/activate, delete ad campaigns. Per-store daily budget, page targeting, slide duration
- **Settings tab**: platform settings (commission tiers, delivery fee, platform fee, vendor/rendor auto-approve, etc.)

### 📢 Ad Banner Engine (v4)
- Strict store-rotation: one item per active store in fixed order; each store has its own daily-minutes budget
- Budgets stored in localStorage (`happa_ads_<campaignId>_<date>`), reset at midnight
- Slots: `ad-banner-home`, `ad-banner-shop`, `ad-banner-stores`
- Admin CRUD: `loadAdminAds`, `showAddAdCampaignModal`, `showEditAdCampaignModal`, `saveAdCampaign`, `toggleAdCampaignStatus`, `deleteAdCampaign`

### 🔑 Authentication
- Login + Register (3 roles: Buyer, Vendor, Rendor)
- Quick-login demo buttons (Buyer / Vendor / Admin)
- Phone OTP verification (demo — OTP logged to console)
- Forgot password modal (demo flow)
- Referral code auto-save at signup — auto-saves referrer's store if vendor
- Role-based redirect: admin → admin-dashboard, vendor → vendor-dashboard, rendor → rendor-dashboard, buyer → buyer-dashboard
- Admin preview mode (switch role as buyer/vendor/rendor, exit back to admin)

### 💳 Commission & Wallet
- Platform commission tiers: 8% (GHS 1-50), 6% (51-100), 4% (101-500), 3% (501-1000), 2% (1001+)
- Platform fee: 1.5% applied at checkout
- `gross_amount`, `vendor_amount`, `commission_amount` stored on every package
- Wallet: deposit (MTN/Vodafone/AirtelTigo MoMo, Visa/Mastercard), withdraw (MoMo + bank transfer)
- Min deposit GHS 1 · Min withdrawal GHS 10 · Max 1 pending withdrawal

---

## 📁 File Structure

```
index.html                  Main SPA shell
css/
  style.css                 Full mobile-first stylesheet (CSS variables, components, responsive)
js/
  app.js                    Core state, navigation (showPage, updateNavForUser, navMap), API helpers
  auth.js                   Login, register, OTP, referral, role-switch, quick-login
  marketplace.js            Product grid, store grid, filter chips
  cart.js                   Cart add/remove/update, cart badge
  checkout.js               Checkout flow, package creation, commission calc
  orders.js                 Buyer/vendor/admin order management, package detail, reviews
  buyer.js                  Buyer dashboard (overview, orders, wallet, referrals, saved stores)
  vendor.js                 Vendor dashboard (tabs, store page, products, earnings, referrals)
  rendor.js                 Rendor Hub (posts, contact info, subscription, wallet, verify)
  admin.js                  Admin panel (vendors, rendors, users, orders, ads, analytics, wallet, settings)
  admin-settings.js         Platform settings tab logic
  wallet.js                 Deposit/withdraw modals, transaction history, admin wallet
  notifications.js          Notification badge, fetch, render, mark-read, polling
  search.js                 Live search dropdown
  delivery.js               Delivery rates page
  utils.js                  previewProductImage, clearProductImage helpers
  ads.js                    AdEngine v4 — fetch, cache, rotate, budget, render banner slots
```

---

## 🗄️ Data Models

| Table | Key Fields |
|---|---|
| `users` | id, name, email, phone, role (buyer/vendor/rendor/admin), status, wallet_balance, is_verified, id_verified, referral_code, **rendor_display_name, rendor_service_cat, rendor_bio, rendor_starting_price, rendor_tags**, **rendor_whatsapp, rendor_email, rendor_instagram, rendor_twitter, rendor_facebook, rendor_website, rendor_contact_other**, **rendor_sub_status, rendor_sub_expiry, rendor_sub_plan**, preferred_store_* (vendor registration) |
| `stores` | id, name, slug, vendor_id, category, location, campus, status, logo_url, banner_url, keywords, avg_rating, total_sales, total_orders, store_price, is_paid |
| `products` | id, name, store_id, vendor_id, category, price, original_price, stock_qty, images, is_flash_sale, is_available |
| `orders` | id, buyer_id, items, subtotal, platform_fee, delivery_fee, total, payment_method, status, delivery_address |
| `packages` | id, package_code, order_id, vendor_id, store_id, buyer_id, gross_amount, vendor_amount, commission_amount, delivery_fee, status, vendor_status, admin_status, buyer_confirmed, balance_released, is_intercity |
| `services` | id, rendor_id, title, category, description, price, image_url, status *(used as rendor Posts — no booking flow)* |
| `wallet_transactions` | id, user_id, type, amount, balance_before, balance_after, payment_method, status |
| `notifications` | id, user_id, type, title, message, is_read, action_url |
| `ad_campaigns` | id, name, store_ids, store_budgets (JSON), interval_value, interval_unit, duration_days, start_date, end_date, status, pages, show_store_name |
| `referrals` | id, referrer_id, referred_id, type, reward_pct, reward_amount, status |
| `settings` | id, key, value, label, type |
| `delivery_rates` | id, origin, destination, base_rate, per_kg_rate, est_days, is_local |
| `reviews` | id, target_id, target_type, reviewer_id, rating, comment, approved |

> `service_orders` table exists in schema but is **not used** — rendors do not accept in-app orders.

---

## 🚦 Role Access Matrix

| Feature | Guest | Buyer | Vendor | Rendor | Admin |
|---|---|---|---|---|---|
| Browse marketplace/stores | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cart + Checkout | ✅ | ✅ | ❌ | ❌ | preview |
| Buyer dashboard | | ✅ | | | preview |
| Vendor dashboard | | | ✅ | | preview |
| **Bottom nav "My Store"** | | | ✅ | | |
| Rendor Hub | | | | ✅ | |
| Admin panel | | | | | ✅ |
| Create posts (services) | | | | ✅ | |
| Activate rendor subscription | | | | ❌ (request only) | ✅ |

---

## 🔗 Entry Points

| Route (hash/pageId) | Description |
|---|---|
| `/` or `/#home` | Home page |
| `/#marketplace` | Marketplace / Shop |
| `/#stores` | Public store listing |
| `/#auth` | Login / Register |
| `/#buyer-dashboard` | Buyer dashboard (auth required) |
| `/#vendor-dashboard` | Vendor dashboard (vendor role) |
| `/#vendor-my-store` | Vendor's store full page |
| `/#rendor-dashboard` | Rendor Hub (rendor role) |
| `/#admin-dashboard` | Admin panel (admin role) |
| `/#notifications` | Notifications page |
| `/#delivery` | Delivery rates |
| `/#privacy` | Privacy policy |

---

## 👤 Demo Accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@happatrademart.com | admin123 |
| Vendor | kwame@test.com | vendor123 |
| Buyer | ama@test.com | buyer123 |

---

## 🐛 Bugs Fixed (This Session)

| # | File | Bug | Fix |
|---|---|---|---|
| 1 | rendor.js | Called `showWithdrawModal()` — function is `showWithdrawalModal()` | Corrected name |
| 2 | admin.js | `interval_unit` fallback was `'minutes'`; AdEngine expects `'seconds'` | Changed to `'seconds'` |
| 3 | admin.js | `adminNotifyUser` / `adminSuspendUser` were referenced but missing | Implemented both functions |
| 4 | rendor.js | Dashboard had full service-booking / order flow (in-app orders) | Rewritten to contact-credentials + subscription model |
| 5 | app.js | Bottom-nav `bnav-stores` always showed "Stores" for all roles | Vendors see "My Store" → `vendor-my-store`; others see "Stores" |
| 6 | app.js | navMap mapped `vendor-my-store` to `'profile'` (wrong highlight) | Changed to `'stores'` so "My Store" bottom-nav item highlights |
| 7 | admin.js | Rendor approval notification mentioned "bookings" (old model) | Updated copy to match contact-credentials model |

---

## 🗺️ Schema Changes (This Session)

### `users` table — 9 new fields added
| Field | Type | Purpose |
|---|---|---|
| `rendor_whatsapp` | text | Rendor's WhatsApp contact |
| `rendor_email` | text | Rendor's public email |
| `rendor_instagram` | text | Rendor's Instagram handle |
| `rendor_twitter` | text | Rendor's X/Twitter handle |
| `rendor_facebook` | text | Rendor's Facebook page |
| `rendor_website` | text | Rendor's website/portfolio |
| `rendor_contact_other` | rich_text | Other contact notes |
| `rendor_sub_status` | text | `active` / `expired` / `none` |
| `rendor_sub_expiry` | text | Unix timestamp (ms) string |
| `rendor_sub_plan` | text | `monthly` / `quarterly` / `biannual` |

### `packages` table — 1 new field
| Field | Type | Purpose |
|---|---|---|
| `gross_amount` | number | Pre-commission subtotal (GHS) |

---

## 🔮 Recommended Next Steps

1. **Buyer-side rendor discovery** — add a "Services" filter chip in the marketplace that displays rendor posts, with links to the rendor's public profile showing their contact info and all posts
2. **Public rendor profile page** — shareable URL showing brand name, bio, category, verified badge, posts, and contact credentials (no login required)
3. **Real payment gateway** — integrate Paystack or MTN MoMo API for wallet top-ups and subscription payments; replace demo OTP with real SMS (Twilio / Arkesel)
4. **Admin subscription management** — filter rendors by sub status; bulk-expire / bulk-notify; export rendor list
5. **Vendor analytics** — real chart data from orders table (not random), top products, revenue by period
6. **Multi-image products** — carousel on product detail, multiple URLs in `images` array
7. **Ad campaign analytics** — impressions, clicks, time-spent per campaign in admin Ads tab
8. **Push notifications** — Web Push API so admins and vendors get notified of new orders without polling
9. **Search improvements** — index rendor posts alongside products; display rendors in search results
10. **PWA / offline support** — service worker, manifest, install-to-homescreen prompt

---

## 🏪 Store vs. Standalone Storefront Architecture

To avoid confusion, HAPPA separates the built-in marketplace **Store** from the customizable standalone **Storefront**:

| Feature | Store (Marketplace Profile) | Storefront (Standalone Landing Page) |
| :--- | :--- | :--- |
| **Concept** | The main vendor profile integrated directly into HAPPA marketplace. | A customized, standalone e-commerce page designed specifically for the vendor's direct sales. |
| **Creation** | Automatically created when a vendor account is created. | Manually configured, saved, and submitted by the vendor from the dashboard. |
| **Visibility** | Publicly browsable directly on the HAPPA website (under `/#stores` and product details). | Isolated from the main marketplace; accessible *only* via its unique URL. |
| **URL Route** | `/#store-detail/<store_id>` (marketplace route). | `/#storefront/<url_slug>` (standalone direct landing route). |
| **Customization** | Standard marketplace theme, styling, and navigation. | Personalized themes (Classic, Bold, Modern, Neumorphic), custom colors, logo, and fonts. |
| **Lifecycle** | Lifetime tied directly to the vendor's account status. | Draft, pending layout review by admin, approved and active, or deactivated. |
| **Subscription** | Always free as part of the vendor account. | Paid monthly plans (Starter / Growth / Pro) required for publication. |

### Database Schema Decoupling
- **`stores`**: Contains core vendor account records (name, rating, phone, email, location, subscription status, etc.) integrated into the marketplace.
- **`storefronts`**: A dedicated table storing custom layouts (custom name, slogan, theme, primary_color, secondary_color, font_family, logo_url, banner_url, business_hours, shipping/return policies, social links, url_slug, status, admin_feedback).
