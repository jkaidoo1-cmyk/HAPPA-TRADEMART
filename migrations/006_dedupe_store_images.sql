-- 006_dedupe_store_images.sql
-- Reclaim the store logo/banner data URLs that earlier code mirrored into the
-- `stores.extra` JSONB column IN ADDITION to writing them to their real
-- columns (`logo_url`, `banner_url`).
--
-- Why this matters: those two values are base64 image data URLs (up to ~2 MB
-- each). Storing them twice meant every `stores` / `storefronts` read had to
-- move both copies — Supabase -> function and then function -> browser — so each
-- store cost roughly double the bytes it needed to on every page view and on
-- every 20-second notification/dashboard poll.
--
-- The write paths (api/index.js and server.js) no longer mirror them. This
-- migration cleans up the rows written before that fix.
--
-- Run in the Supabase SQL editor. Safe to re-run. Equivalent to running
-- `update stores set extra = extra - 'logo_url' - 'banner_url' where …`, but
-- split into a check you should read before the destructive half.

-- ── Step 1: read this first ───────────────────────────────────────────────
-- These rows have an EMPTY image column but a populated `extra` copy. Step 2
-- would strip the only copy they have and their logo/banner would disappear.
-- Expect 0. If it is not 0, run step 1b before step 2.
select count(*) as rows_that_would_lose_an_image
  from stores
 where (logo_url   is null or logo_url   = '')
   and extra ? 'logo_url';

-- ── Step 1b: repair them (promote `extra` into the column) ────────────────
-- Only needed if step 1 returned a non-zero count.
update stores
   set logo_url   = coalesce(nullif(logo_url,   ''), extra->>'logo_url'),
       banner_url = coalesce(nullif(banner_url, ''), extra->>'banner_url')
 where (logo_url   is null or logo_url   = '')
   and extra ? 'logo_url';

-- ── Step 2: drop the duplicate keys ───────────────────────────────────────
-- The `-` operator removes only the named keys; every other key in `extra`
-- (layout, only_show_on_storefront, slogan, name, …) is preserved, so nothing
-- that the read path promotes from `extra` is affected.
update stores
   set extra = extra - 'logo_url' - 'banner_url'
 where extra ? 'logo_url'
    or extra ? 'banner_url';

-- ── Step 3: confirm ───────────────────────────────────────────────────────
-- Expect 0.
select count(*) as remaining_duplicates
  from stores
 where extra ? 'logo_url'
    or extra ? 'banner_url';
