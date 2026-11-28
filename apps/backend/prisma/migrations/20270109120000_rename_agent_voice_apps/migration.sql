-- apps-sistema-voz: las aplicaciones de voz `vexi_voice_tts` y
-- `vexi_voice_stt` las comparten los agentes (Vex y Vexi), no solo Vexi. Solo
-- cambia el nombre visible y la descripción en Super Admin › AI Engine.
--
-- DATA IMPACT:
--   Tables affected: ai_engine_applications (solo UPDATE de name, description
--     y updated_at).
--   Expected row changes: hasta 2 filas (key = 'vexi_voice_tts' y
--     key = 'vexi_voice_stt'), solo si existen y si su name o description
--     difieren del nuevo texto. 0 filas si no existen.
--     Conteo previo:
--       SELECT key, name, description FROM ai_engine_applications
--       WHERE key IN ('vexi_voice_tts', 'vexi_voice_stt');
--   No toca: key (el código busca estas apps por clave: VOICE_TTS_APP_KEY /
--     VOICE_STT_APP_KEY; cambiarla rompería la voz), config_id, prompts,
--     metadata (voz, formato, volumen), is_active ni ninguna otra fila.
--   Destructive operations: ninguna. Sin DELETE, DROP, TRUNCATE ni UPDATE sin
--     WHERE.
--   FK/cascade risk: ninguno; no se tocan FKs ni otras tablas.
--   Idempotency: WHERE por key + IS DISTINCT FROM; una segunda ejecución no
--     cambia nada.
--   Reversa (down documentado; correr solo como migración nueva si se revierte
--     el renombre):
--       UPDATE "ai_engine_applications"
--       SET "name" = 'Vexi — Voz: dictado (TTS)',
--           "description" = 'Sintetiza en audio cada segmento de la respuesta de Vexi para el modo voz',
--           "updated_at" = now()
--       WHERE "key" = 'vexi_voice_tts';
--       UPDATE "ai_engine_applications"
--       SET "name" = 'Vexi — Voz: transcripción (STT)',
--           "description" = 'Convierte el turno hablado del usuario en texto para que lo procese el agente de chat',
--           "updated_at" = now()
--       WHERE "key" = 'vexi_voice_stt';
--   Approval: encargo de Rafael (2026-11-27 20:49): «migración idempotente
--     que actualice solo name/description de esas dos filas si existen (con
--     down documentado)». No cambiar las key.
-- Skill: vendix-prisma-migrations.

UPDATE "ai_engine_applications"
SET
  "name" = 'Agentes — Voz: dictado (TTS)',
  "description" = 'Sintetiza en audio cada segmento de la respuesta del agente para el modo voz',
  "updated_at" = now()
WHERE "key" = 'vexi_voice_tts'
  AND (
    "name" IS DISTINCT FROM 'Agentes — Voz: dictado (TTS)'
    OR "description" IS DISTINCT FROM 'Sintetiza en audio cada segmento de la respuesta del agente para el modo voz'
  );

UPDATE "ai_engine_applications"
SET
  "name" = 'Agentes — Voz: transcripción (STT)',
  "description" = 'Convierte el turno hablado del usuario en texto para que lo procese el agente',
  "updated_at" = now()
WHERE "key" = 'vexi_voice_stt'
  AND (
    "name" IS DISTINCT FROM 'Agentes — Voz: transcripción (STT)'
    OR "description" IS DISTINCT FROM 'Convierte el turno hablado del usuario en texto para que lo procese el agente'
  );
