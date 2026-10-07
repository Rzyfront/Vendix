-- DATA IMPACT:
-- Tables affected: products
-- Business rule: an ingredient (is_ingredient = true) is never published on ecommerce
--   nor featured.
-- Expected row changes (prod, 2026-10-03): 40 rows (store 94: 26, store 86: 10,
--   store 105: 3, store 114: 1). None of them has had ecommerce sales.
-- Columns touched: available_for_ecommerce, is_featured (boolean flags only) and updated_at.
-- Destructive operations: none (no DELETE/TRUNCATE/DROP/CASCADE; no rows removed).
-- FK/cascade risk: none (no key or relation column is modified).
-- Idempotency: guarded by WHERE; a second run affects 0 rows.
-- Rollback trace: the ids of the affected rows are emitted via RAISE NOTICE below.
--   Manual rollback (use the ids from the notice / deploy log):
--     UPDATE products SET available_for_ecommerce = true WHERE id IN (<ids from notice>);
--     (is_featured must be restored per the ids/flags recorded in the notice)
-- Approval: explicit, given by the owner in chat on 2026-10-03.

DO $$
DECLARE
  affected text;
BEGIN
  SELECT string_agg(
           id::text || ':ecom=' || available_for_ecommerce::text || ',feat=' || is_featured::text,
           '; ' ORDER BY id)
    INTO affected
    FROM products
   WHERE is_ingredient = true
     AND (available_for_ecommerce = true OR is_featured = true);

  RAISE NOTICE 'ingredients_never_on_ecommerce: affected products (id:flags) = %', COALESCE(affected, '(none)');
END $$;

UPDATE products
   SET available_for_ecommerce = false,
       is_featured = false,
       updated_at = now()
 WHERE is_ingredient = true
   AND (available_for_ecommerce = true OR is_featured = true);
