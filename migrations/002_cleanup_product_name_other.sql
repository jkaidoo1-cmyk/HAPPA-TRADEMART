-- 002 — Products whose name is the literal "Other" (created by old upload flows
-- that fell back to the category when the vendor left the name blank) are data
-- artifacts. A product name is never the category "Other" — blank it so listings,
-- cart items, order tracking and share captions show nothing instead.
-- Run this once in the Supabase SQL Editor. It only touches rows whose NAME is
-- exactly "Other"; the category column is left untouched.

UPDATE products
SET name = '',
    updated_at = NOW()
WHERE BTRIM(COALESCE(name, '')) = 'Other';

-- Also scrub the name snapshots already copied onto existing order items and
-- storefront carts, so old orders stop showing "Other" even before re-render.
UPDATE packages
SET items = (
  SELECT jsonb_agg(
    CASE
      WHEN item->>'name' IS NOT NULL AND BTRIM(item->>'name') = 'Other'
      THEN item - 'name' || jsonb_build_object('name', '')
      ELSE item
    END
  )
  FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) AS item
)
WHERE items IS NOT NULL
  AND items::text LIKE '%"Other"%';

UPDATE orders
SET items = (
  SELECT jsonb_agg(
    CASE
      WHEN item->>'name' IS NOT NULL AND BTRIM(item->>'name') = 'Other'
      THEN item - 'name' || jsonb_build_object('name', '')
      ELSE item
    END
  )
  FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) AS item
)
WHERE items IS NOT NULL
  AND items::text LIKE '%"Other"%';
