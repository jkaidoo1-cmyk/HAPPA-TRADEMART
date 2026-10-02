# Egress reduction plan — Happa TradeMart

> **Untracked on purpose.** This file is *not* committed. The repo is public, and
> this document describes where the architecture is inefficient. Decide whether
> you want it in history; `HANDOFF.md` is in the same boat.

## First: measure it, don't reason about it

Egress = **payload size × request count**. Two separate quotas are in play and
only one of them is usually the problem:

| Leg | Metered by | Free-tier size | Visible in Vercel? |
| --- | --- | --- | --- |
| Browser ← Vercel function | Vercel "Fast Data Transfer" | ~100 GB/mo | yes |
| Vercel function ← Supabase | **Supabase egress** | **~5 GB/mo** | **no** |

Supabase's free egress is roughly **20× tighter** than Vercel's, and the Vercel
dashboard never shows it. So shrinking *what the database sends* is the priority.

`api/index.js` now logs one line per list read:

```
[egress] GET /api/storefronts?limit=200 table=storefronts rows=200 bytes=4812083
```

Grep the Vercel deployment logs for `[egress]`, sum `bytes` per route, and you
have the real ranking instead of a guess. Do this before investing in anything
large that is still on the list at the bottom.

---

## Implemented

### 1. Store images were stored — and shipped — twice

`logo_url` and `banner_url` are image data URLs (up to ~180 KB each after client
compression). They were written to their real column **and** mirrored into the
`extra` JSONB column "as a fallback". Every store row therefore paid for each
image twice, and **every `stores` / `storefronts` read moved both copies** —
first Supabase → function, then function → browser.

The mirror was never needed. `writeWithCandidates` already owns the case it
existed for: its slim candidate moves `logo_url` / `banner_url` into `extra`
(via `STORE_OPTIONAL_COLS`) **only when the real column is genuinely absent**.

Removed at all three storefront write sites in `api/index.js` (POST, PUT, PATCH)
and all three in `server.js` (POST, PUT, PATCH). Small text fields (`name`,
`slogan`, `layout`, `only_show_on_storefront`) are still mirrored — they are
cheap and the read path uses them as fallbacks.

**Effect: roughly half the bytes of every store/storefront read.**

### 2. Six write paths swallowed schema errors silently

The storefront PUT and PATCH branches called
`await supabase.from('stores').update(...)` inside a `try/catch`. supabase-js
**resolves** with `{ error }` rather than throwing, so that `catch` could never
fire — a missing column or an RLS rejection was swallowed and the storefront edit
was quietly lost on the deployed backend. That is why the mirror in (1) looked
load-bearing.

- `api/index.js`: all three storefront writes now go through
  `writeWithCandidates` (which also retries a slim payload) and log failures.
- `server.js`: the update result is now inspected. On error it retries once with
  the images carried in `extra`, which is exactly the old fallback but only in
  the case that needs it.

### 3. `limit` was ignored on three read paths, and paging skipped twice

The `storefronts` branch ran `select('*')` with **no bound at all** and never
applied `limit` to its result, so `?limit=200` (admin) and `?limit=6` (homepage)
each pulled every store — logo and banner included — out of Supabase and kept a
handful. The local / no-Supabase branch of the generic read applied `limit` only
when `search` was also present.

Both now honour `limit`/`page`, and the `storefronts` query is bounded **inside
the database** whenever that is provably safe: only when the local `db.json`
fallback holds no `stores` rows (otherwise merging could promote a row into the
requested page) and no `search`/filter is present (those are applied client-side
and would otherwise be checked against a truncated window).

> ⚠️ **Behaviour change:** `GET /api/storefronts?limit=200` now returns at most
> 200 rows where it used to return all of them. That is what callers asked for,
> but if you have more than 200 storefronts the admin list is paginated now.

A second flaw surfaced in the same code: the generic Supabase path pushed the
page offset into the database **and then applied it again** when slicing merged
rows, so page 2 of any paginated list came back empty. No caller passes `page=`,
which is the only reason nobody noticed. Both paths now cap the fetch from row 0
and let the final slice own the offset.

### 4. ETag / conditional GET — the keystone for repeat reads

Every list response was uncacheable (`no-store`), so every page view, every
tab-return and every 20-second poll re-downloaded the entire payload, base64
images included. `sendList` now derives a strong `ETag` from the response bytes
and answers `If-None-Match` with an empty **304**. Freshness is untouched: the
payload is recomputed on every request and the body is only skipped when the
bytes are byte-for-byte identical to what the client already holds.

This is what makes the polls cheap without changing what they do, and it is why
the client-side poll logic below could stay minimal.

Supporting changes:

- `vercel.json`: the two `/api` route entries changed from
  `no-cache, no-store, must-revalidate` to `no-cache, must-revalidate`. Without
  this the browser never stores the response and so never sends
  `If-None-Match` — the ETag would be dead code in production. `/sw.js` keeps
  `no-store` (it has its own two-key header block and was not touched).
  The function's own per-table policy is unchanged: orders/wallet/notifications
  still set `no-store` themselves.
- `sendList` sets `Vary: Authorization` (appending to any existing `Vary`) so no
  shared cache can hand one viewer's list to another.
- `sendList` applies `scrubSensitive` explicitly, because it bypasses
  `res.json`, which is where that scrub is otherwise installed. There is a test
  for this.

### 5. Polling: fewer requests, not just fewer bytes

- **Notification poll** (`js/notifications.js`): each 20-second tick spent *two*
  round trips, because it began with `verifySessionUser()` (which reads the user
  row) before the notification read — roughly 360 requests/hour per logged-in
  user before counting anything else. The session check is now rate-limited to
  once a minute, which still catches a deleted account promptly.
- **Dashboard poll** (`js/app.js`): 15 s → 30 s. It re-reads whole order rows
  with images attached, and an unchanged read is now a 304 anyway.

### 6. Egress meter

`logEgress` records `table`, `rows` and `bytes` for every list read, and every
list branch funnels through `sendList` so a new route cannot silently skip it.

### 7. Cleanup for rows written before the fix

`migrations/006_dedupe_store_images.sql` removes the duplicated `logo_url` /
`banner_url` keys from `extra` on existing rows. It is staged in three parts: a
count you should read first, a repair for rows whose *column* is empty (those
would lose their image), then the strip, then a confirmation count. Safe to
re-run. **Run it in Supabase after deploying.**

---

## Deliberately not done, and why

These were on the original menu. Each is a judgement that it is *not* suitable,
not a matter of effort:

**Column projection to drop image bytes from list reads.** The consumers
(marketplace, storefront, admin) render those images, so omitting the columns
breaks the UI. The byte win has to come from revalidation (done, item 4) or from
moving the images out of the rows entirely (below). Do **not** add a
client-controlled `select=` parameter — that would let a caller ask for
`password_hash`.

**Moving images to Supabase Storage and referencing them by URL.** This is the
real structural fix: catalog reads become text-only, the 2 MB per-image cap can
go, and the resumable uploader writes to Storage instead of rows. It needs a
bucket created in your Supabase account and a data migration, so it cannot be
done or verified from here. **Highest-value remaining item.**

**Dropping the local `db.json` merge from every read.** Each read does a
Supabase round trip *and* a local file read, then merges. That merge is
deliberate resilience — a record written only to `db.json` must stay readable, or
orders vanish from every list page — and it is why the DB-side bound in item 3 is
gated rather than unconditional. Removing it would hide records.

**Capping the `limit=500` call sites.** `limit=500` is already bounded; the waste
was in repeat reads, which item 4 now turns into 304s. Lowering the number would
visibly truncate admin lists for no remaining benefit.

**Hashing static filenames so `/js/*` can be `immutable`.** The project has no
build step, so there is nothing to generate content hashes, and `vercel.json`'s
legacy `routes`/`builds` format cannot give a `?v=` query string a different
cache policy from the bare path. Long-caching `/js/*` without fingerprints would
pin stale JavaScript for a year. The vendored bundles are the bulk of it
(~600 KB) and the service worker already precaches them.

**ETag on `server.js`.** `server.js` does not emit ETags. It is not production —
`vercel.json` routes `/api/(.*)` to `api/index.js` — so this would add no
production benefit. It *does* now match `api/index.js` on the write-path fixes
(items 1–2), which are the ones that can corrupt shared data.

---

## Verification

`npm test` → **91/91 green** (was 85 before this work). `test/egress.test.js`
drives `api/index.js` directly — the file that actually serves production, and
which no other suite covered — with `dataStore.saveToFile` stubbed so it can
never touch the checked-in `db.json`. It asserts:

- `GET /api/storefronts` honours `limit`, including `page=2`;
- a bounded `GET /api/stores` is bounded;
- saving a storefront persists the image on its column and does **not** duplicate
  it into `extra`, while still mirroring the small text fields;
- a repeat list read is an empty **304**, the ETag is stable for unchanged data,
  **changed** data is served with a new ETag rather than 304-ed, and `Vary`
  includes `Authorization`;
- `password_hash` appears in no list response, as a public caller or an admin
  (this guards the `res.json` bypass in item 4);
- against a minimal PostgREST stand-in, so the Supabase path is really exercised
  rather than the local fallback, the `stores` query is capped at
  `offset=0&limit=<page end>` — proving the offset is applied once, and that a
  non-empty local fallback correctly disables the bound.

## Deploy checklist

1. Deploy `main` (Vercel auto-deploys; the `/api` cache-header change is part of
   the config).
2. Run `migrations/005_security_hardening.sql` if you have not already, then
   `migrations/006_dedupe_store_images.sql` — read step 1's count before step 2.
3. Watch `[egress]` lines in the deployment logs for a day and compare routes.
4. An already-installed client may need one reload to pick up the client-side
   polling changes (the service worker version bump evicts the old one).
