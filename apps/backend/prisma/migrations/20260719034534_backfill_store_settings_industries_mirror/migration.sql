-- DATA IMPACT:
-- Tables affected: store_settings
-- Expected row changes: sincroniza el mirror JSON
--   store_settings.settings.general.industries DESDE la columna canónica
--   stores.industries (industry_enum[], fuente de verdad). Sólo se re-escriben
--   las filas cuyo mirror difiere de la columna (incluye mirror NULL/ausente).
--   Filas esperadas en LOCAL al momento de crear la migración: ~6-11 (tiendas
--   onboardeadas antes del fix de código quedaron con el mirror desincronizado).
--   Motivo: MenuFilterService y la UI de settings leen el mirror JSON; si está
--   desincronizado, tiendas no-retail ocultan módulos de su industria.
-- Destructive operations: none (un solo UPDATE acotado por WHERE con join +
--   IS DISTINCT FROM; sin CASCADE / DROP / DELETE / TRUNCATE).
-- FK/cascade risk: none (no se tocan FKs ni se borran filas; sólo se escribe la
--   key settings->general->industries, preservando el resto del JSON).
-- Idempotency: guardada por WHERE (... IS DISTINCT FROM ...); una segunda
--   ejecución encuentra 0 filas drifteadas y afecta 0 registros.
-- Approval: aprobada por el usuario para LOCAL, documentada en chat. PROD queda
--   pendiente de aprobación explícita + snapshot de la DB de producción.

-- Backfill del mirror settings.general.industries desde stores.industries.
-- (a) Crea el objeto `general` si falta ANTES de setear general.industries.
-- (b) Sólo toca filas drifteadas (idempotente vía IS DISTINCT FROM).
-- (c) Sólo tiendas con industries no vacío.
UPDATE "store_settings" ss
SET "settings" = jsonb_set(
      jsonb_set(
        COALESCE(ss."settings", '{}'::jsonb),
        '{general}',
        COALESCE(ss."settings"->'general', '{}'::jsonb),
        true
      ),
      '{general,industries}',
      to_jsonb(s."industries"::text[]),
      true
    ),
    "updated_at" = NOW()
FROM "stores" s
WHERE ss."store_id" = s."id"
  AND s."industries" IS NOT NULL
  AND COALESCE(array_length(s."industries", 1), 0) >= 1
  AND (ss."settings"->'general'->'industries') IS DISTINCT FROM to_jsonb(s."industries"::text[]);
