-- DATA IMPACT:
-- Tables affected: accounts_payable (solo se agrega un INDICE UNICO PARCIAL; no muta filas).
-- Expected row changes: none. Impone la invariante "una sola CxP por OC"
--   (source_type='purchase_order', source_id) a nivel de base de datos.
-- Verificado read-only 2026-07-20:
--   PROD: 0 grupos de CxP duplicados por (source_type='purchase_order', source_id) -> el indice
--     se crea limpio sobre las 7 CxP distintas existentes (source_id 557,559,560,562,563,566,568).
--   DEV: 0 duplicados.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none.
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS.
-- Nota sobre la fusion de CxP duplicadas (prevista en el plan original): es INNECESARIA. El
--   pre-check confirmo 0 duplicados en prod y dev, por lo que no se incluye ninguna sentencia de
--   fusion (evita shippear un DELETE/UPDATE destructivo que nunca dispararia). Si aparecieran
--   duplicados antes del deploy, este CREATE UNIQUE INDEX fallara de forma SEGURA (bloquea el deploy
--   sin destruir datos) y se resolveria con una migracion de fusion dedicada, aprobada aparte.
-- Approval: gated (Fase 5). Pre-check presentado al usuario para firma.

-- Prisma no puede expresar un indice unico parcial (WHERE ...) en @@unique -> SQL crudo, igual que
-- los indices parciales del puente pago OC<->CxP (migracion 20260720192919_pop_payment_bridge_links).
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_payable_po_source_unique"
    ON "accounts_payable"("source_id")
    WHERE "source_type" = 'purchase_order' AND "source_id" IS NOT NULL;
