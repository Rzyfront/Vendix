-- Apps · Fase 0 (odd/tasks/apps-module.md, S2/T2): backfill de store_apps.
--
-- DATA IMPACT:
--   Tables affected: store_apps (solo INSERT). stores, domain_settings y
--     crm_landing_pages solo se LEEN.
--   Expected row changes:
--     - 1 fila kind='ecommerce', status='published' por tienda con al menos un
--       domain_settings app_type='STORE_ECOMMERCE' y status='active'; su
--       domain_settings_id es el primario de esos dominios (o el de menor id).
--     - 1 fila kind='landing', status='published' por tienda con
--       crm_landing_pages enabled=true y published_json no nulo (mismo criterio
--       con el que CrmPublicService sirve la landing).
--     - Ninguna otra fila: la ausencia de fila es `not_installed`.
--     Conteo esperado = (#tiendas con ecommerce activo) + (#landings publicadas).
--   Destructive operations: ninguna. Sin UPDATE, DELETE, DROP, TRUNCATE.
--   FK/cascade risk: ninguno; no se tocan FKs.
--   Idempotency: ON CONFLICT (store_id, kind) DO NOTHING. Correrla dos veces
--     no duplica ni pisa filas existentes.
--   Reversa (manual, documentada; vía migración nueva si hiciera falta):
--     Fase 0 no escribe store_apps desde la API, así que todas las filas
--     ecommerce/landing salen de este backfill:
--     DELETE FROM store_apps WHERE kind IN ('ecommerce','landing');
--   Approval: plan apps-module aprobado por Rafael (brief Fase 0, 2026-11-01).

-- ecommerce: tienda con dominio STORE_ECOMMERCE activo.
INSERT INTO "store_apps" ("store_id", "kind", "status", "domain_settings_id", "published_at")
SELECT DISTINCT ON (ds."store_id")
  ds."store_id",
  'ecommerce'::"app_kind_enum",
  'published'::"app_status_enum",
  ds."id",
  COALESCE(ds."created_at", CURRENT_TIMESTAMP)
FROM "domain_settings" ds
JOIN "stores" s ON s."id" = ds."store_id"
WHERE ds."app_type" = 'STORE_ECOMMERCE'
  AND ds."status" = 'active'
  AND ds."store_id" IS NOT NULL
ORDER BY ds."store_id", ds."is_primary" DESC, ds."id" ASC
ON CONFLICT ("store_id", "kind") DO NOTHING;

-- landing: tienda con crm_landing_pages publicada.
INSERT INTO "store_apps" ("store_id", "kind", "status", "published_at")
SELECT
  clp."store_id",
  'landing'::"app_kind_enum",
  'published'::"app_status_enum",
  COALESCE(clp."published_at", CURRENT_TIMESTAMP)
FROM "crm_landing_pages" clp
WHERE clp."enabled" = true
  AND clp."published_json" IS NOT NULL
ON CONFLICT ("store_id", "kind") DO NOTHING;
