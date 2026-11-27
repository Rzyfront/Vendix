-- Migration: Vexi público R1 — la fila `vexi` de `ai_agents` apunta a la app
-- pública `vexi_storefront`, para que la hoja de superadmin de Vexi configure
-- el modelo y el prompt del chat público (igual que la de Vex con
-- `vex_assistant`). Decisión de Rafael, 2026-11-27 17:29.
--
-- DATA IMPACT:
--   Tables affected:     ai_agents
--   Expected row changes: 0 o 1 fila (key='vexi'): app_key 'chat_assistant'
--                        (o NULL) -> 'vexi_storefront'. Ninguna otra columna
--                        ni fila cambia (Vex y demás agentes intactos).
--   Destructive ops:     ninguna. Sin DELETE, DROP, TRUNCATE ni CASCADE.
--   FK/cascade risk:     ninguno. El destino existe (lo exige el EXISTS; lo
--                        inserta 20270106120000_vexi_public_sessions).
--   Idempotency:         el WHERE solo toca la fila mientras siga en su valor
--                        anterior; re-ejecutar no cambia nada. Un app_key
--                        distinto puesto a mano por un operador se respeta.
--   Side effect cubierto: el dock del admin (turnos staff de Vexi, chat y cola)
--                        NO sigue la fila: el código fija `chat_assistant`
--                        (`staffTurnAppKey`), así conserva su prompt y
--                        `{{business_metrics}}`.
--   Approval:            Rafael, chat 2026-11-27 17:29 (decisión 1).
--
-- DOWN (manual, documentado; Prisma no ejecuta down):
--   UPDATE "ai_agents" SET "app_key" = 'chat_assistant', "updated_at" = NOW()
--    WHERE "key" = 'vexi' AND "app_key" = 'vexi_storefront';

UPDATE "ai_agents"
   SET "app_key" = 'vexi_storefront',
       "updated_at" = NOW()
 WHERE "key" = 'vexi'
   AND ("app_key" IS NULL OR "app_key" = 'chat_assistant')
   AND EXISTS (
     SELECT 1 FROM "ai_engine_applications" WHERE "key" = 'vexi_storefront'
   );
