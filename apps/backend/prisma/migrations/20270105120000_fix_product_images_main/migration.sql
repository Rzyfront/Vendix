-- Fix: products that have images but no main image.
--
-- POS, product list and ecommerce cards read only `product_images.is_main = true`.
-- `ProductsService.addImage` (used by Vex `manage_product_images`) created images
-- with is_main = false when the caller did not send is_main, so those products
-- showed no picture until someone saved them from the admin editor. The code fix
-- ships in the same PR; this migration repairs existing rows.
--
-- DATA IMPACT:
--   Table: product_images (UPDATE only; no INSERT/DELETE, no schema change).
--   Rows touched: exactly ONE row per product that has >= 1 image and ZERO images
--   with is_main = true. The chosen row is the one with the lowest sort_order
--   (NULL treated as 0, the column default) and, on a tie, the lowest id.
--   Expected count = result of:
--     SELECT count(DISTINCT pi.product_id) FROM product_images pi
--     WHERE pi.product_id IS NOT NULL
--       AND NOT EXISTS (SELECT 1 FROM product_images m
--                       WHERE m.product_id = pi.product_id AND m.is_main = true);
--   Products that already have a main image, and every other row, are untouched.
--   Why it is safe: the column already exists; it only flips a presentation boolean
--   false/NULL -> true; no screen depends on it being false; the editor save path
--   already applies the very same rule ("Asegurar que solo haya un is_main").
--   Idempotent: the NOT EXISTS guard makes a second run update 0 rows.
--   No FK, no CASCADE, no TRUNCATE, no DELETE.

UPDATE product_images AS pi
SET is_main = true
FROM (
  SELECT DISTINCT ON (c.product_id) c.id
  FROM product_images AS c
  WHERE c.product_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM product_images AS m
      WHERE m.product_id = c.product_id
        AND m.is_main = true
    )
  ORDER BY c.product_id, COALESCE(c.sort_order, 0) ASC, c.id ASC
) AS pick
WHERE pi.id = pick.id
  AND pi.is_main IS DISTINCT FROM true;
