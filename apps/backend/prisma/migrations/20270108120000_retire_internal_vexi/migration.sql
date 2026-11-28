-- agentes-admin (odd/tasks/agentes-admin-vex-principal.md, S5/T3): el Vexi
-- interno (dock flotante del admin) deja de existir. Vexi queda solo en las
-- apps públicas (settings.vexi_public, que esta migración NO toca) y el agente
-- interno es Vex. Las tiendas que hoy tienen settings.vexi.enabled = true
-- quedan apagadas.
--
-- DATA IMPACT:
--   Tables affected: store_settings (solo UPDATE de la clave JSON settings.vexi).
--   Expected row changes: 1 fila por tienda con settings.vexi.enabled = true
--     (booleano JSON; es la única forma que abría el dock: el guard exigía
--     `=== true`, así que un "true" de texto nunca lo encendió y no se toca).
--     Conteo previo:
--       SELECT count(*) FROM store_settings
--       WHERE jsonb_typeof(settings) = 'object'
--         AND jsonb_typeof(settings -> 'vexi') = 'object'
--         AND (settings -> 'vexi' -> 'enabled') = 'true'::jsonb;
--   Qué escribe: settings.vexi = settings.vexi existente
--     || {"enabled": false, "retired_internal_enabled": true}.
--     La marca retired_internal_enabled deja constancia de qué tiendas lo
--     tenían encendido (sirve para la reversa). Conserva cualquier otra clave
--     de settings y de settings.vexi.
--   No toca: settings.vexi_public (Vexi público sigue apagado por defecto y
--     donde la tienda lo encendió sigue encendido), settings.vex, la fila
--     global ai_agents 'vexi' (la usa el chat público), ni ai_conversations /
--     ai_messages: el historial del Vexi interno se conserva intacto y queda
--     de solo lectura (el backend ya no corre turnos de Vexi desde el admin).
--   Destructive operations: ninguna. Sin DELETE, DROP, TRUNCATE ni UPDATE sin WHERE.
--   FK/cascade risk: ninguno; no se tocan FKs ni otras tablas.
--   Idempotency: el WHERE solo toma filas con enabled = true; tras correr,
--     enabled es false y una segunda ejecución no cambia nada.
--   Reversa (down documentado; correr solo si se revierte el código que retira
--     el Vexi interno, como migración nueva):
--       UPDATE "store_settings"
--       SET "settings" = jsonb_set(
--             "settings" #- '{vexi,retired_internal_enabled}',
--             '{vexi,enabled}', 'true'::jsonb)
--       WHERE jsonb_typeof("settings") = 'object'
--         AND jsonb_typeof("settings" -> 'vexi') = 'object'
--         AND ("settings" -> 'vexi' ->> 'retired_internal_enabled') = 'true';
--   Approval: encargo de Rafael (2026-11-27), F6: «Migración (idempotente, con
--     down documentado) para las tiendas que hoy tienen el Vexi interno
--     activo: queda apagado sin romper conversaciones existentes».
--     Snapshot de prod obligatorio antes del deploy.
-- Skill: vendix-prisma-migrations.

UPDATE "store_settings"
SET
  "settings" = jsonb_set(
    "settings",
    '{vexi}',
    ("settings" -> 'vexi')
      || '{"enabled": false, "retired_internal_enabled": true}'::jsonb
  ),
  "updated_at" = now()
WHERE jsonb_typeof("settings") = 'object'
  AND jsonb_typeof("settings" -> 'vexi') = 'object'
  AND ("settings" -> 'vexi' -> 'enabled') = 'true'::jsonb;
