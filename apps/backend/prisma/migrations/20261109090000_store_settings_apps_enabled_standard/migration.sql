-- Apps F1 (odd/tasks/apps-vistas-f1.md, S1/T1): Apps pasa a ser el estándar.
--
-- DATA IMPACT:
--   Tables affected: store_settings (solo UPDATE de la clave JSON settings.apps).
--   Expected row changes: 1 fila por tienda cuyo settings es un objeto JSON y
--     cuyo settings.apps.enabled no es ya true. Conteo previo:
--       SELECT count(*) FROM store_settings
--       WHERE jsonb_typeof(settings) = 'object'
--         AND (settings -> 'apps' ->> 'enabled') IS DISTINCT FROM 'true';
--   Qué escribe: settings.apps = (settings.apps existente, o {}) || {"enabled": true}.
--     Conserva cualquier otra clave de settings y de settings.apps.
--   Filas sin tocar: settings NULL o no-objeto. Esas leen el default del
--     backend (default-store-settings.ts), que ahora también es true.
--   Destructive operations: ninguna. Sin DELETE, DROP, TRUNCATE ni UPDATE sin WHERE.
--   FK/cascade risk: ninguno; no se tocan FKs ni otras tablas.
--   Idempotency: el WHERE excluye las filas que ya tienen enabled=true;
--     correrla dos veces no cambia nada.
--   Reversa (rollback de negocio, sin migración destructiva): el owner apaga
--     el interruptor en Configuración > General > Negocio, o una migración nueva
--     con UPDATE ... SET settings = jsonb_set(settings, '{apps,enabled}', 'false')
--     con su propio WHERE. Con enabled=false el menú queda como antes de Apps.
--   Approval: brief F1 de Rafael (2026-11-03), decisión 1: "Apps ya no se queda
--     apagado: pasa a ser el estándar". Snapshot de prod obligatorio antes del deploy.

UPDATE "store_settings"
SET
  "settings" = jsonb_set(
    "settings",
    '{apps}',
    CASE
      WHEN jsonb_typeof("settings" -> 'apps') = 'object' THEN "settings" -> 'apps'
      ELSE '{}'::jsonb
    END || '{"enabled": true}'::jsonb,
    true
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE jsonb_typeof("settings") = 'object'
  AND ("settings" -> 'apps' ->> 'enabled') IS DISTINCT FROM 'true';
