-- Migration: registra MiniMax T2A como transporte de síntesis de voz elegible
--
-- DATA IMPACT:
--   Tablas mutadas:
--     ai_engine_configs   INSERT de 1 fila
--   Sentencias:
--     INSERT ... ON CONFLICT ("provider", "model_id") DO NOTHING
--   Filas:         exactamente 1 donde no existe; 0 en reejecuciones.
--                  Verificar después del deploy con
--                    SELECT id, provider, model_id, sdk_type, model_type,
--                           base_url, api_key_ref IS NULL AS sin_clave
--                    FROM ai_engine_configs WHERE provider = 'MiniMax';
--                  Debe devolver 1 fila con sin_clave = t.
--   Reversible:    SÍ —
--                    DELETE FROM ai_engine_configs
--                     WHERE provider = 'MiniMax' AND model_id = 'speech-2.8-hd';
--                  Sin dependientes: esta migración no enlaza ninguna
--                  aplicación, así que la fila nace sin referencias entrantes.
--   Sin UPDATE, sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE.
--
-- Por qué NO se repunta `vexi_voice_tts` a esta config:
--   Cambiar el proveedor de TTS de Vexi es una decisión de costo y de voz de
--   marca, no un default técnico. La migración crea el transporte; el operador
--   elige el enlace desde Super Admin -> AI Engine -> Aplicaciones, que es
--   también donde puede volver a OpenAI si MiniMax le sale caro. Un UPDATE acá
--   tomaría esa decisión en nombre de alguien que no la pidió, y dejaría la
--   vuelta atrás fuera del alcance de la UI.
--
-- Por qué un sdk_type propio y no `openai_compatible`:
--   MiniMax difiere de OpenAI en las tres dimensiones que definen un protocolo.
--   Ruta: `/v1/t2a_v2`, que `toApiRootBaseUrl` no sabe recortar (reconoce nueve
--   sufijos de OpenAI y ninguno es ese). Cuerpo: la voz y el audio viajan en
--   `voice_setting` / `audio_setting` anidados, no planos. Respuesta: JSON con
--   el audio en hex dentro de `data.audio` más un sobre `base_resp` que reporta
--   el fallo con HTTP 200 — leerlo con `response.arrayBuffer()`, que es lo que
--   hace el camino de OpenAI, devuelve los bytes del documento de error como si
--   fueran audio.
--
-- api_key_ref queda en NULL A PROPÓSITO:
--   Una migración nunca lleva secretos: quedaría en git para siempre.
--   `AIEngineService.resolveApiKey()` cae a `AI_MINIMAX_API_KEY` cuando la
--   columna está vacía, así que el operador tiene dos vías: pegar la clave en
--   Super Admin (que escribe `api_key_ref`) o exponer la variable de entorno.
--   Mientras no haya ninguna, el proveedor no se construye y el botón de probar
--   conexión ahora lo dice con esas palabras.
--
-- is_default queda en false:
--   `is_default` es global y NO discrimina por `model_type`; marcar una config
--   de síntesis como default redirigiría todas las aplicaciones de texto a un
--   modelo que no las puede servir. `assertDefaultAllowed` rechaza `speech` con
--   AI_CONFIG_003 y esta migración respeta la misma regla.
--
-- settings vacío:
--   La voz, el formato y la velocidad viven en `metadata.speech` de la
--   aplicación —comportamiento editable por operador, que `resolveParams()` lee
--   de ahí—, no en el transporte. `group_id` y `language_boost` quedan
--   disponibles como campos de operador para las cuentas de MiniMax que los
--   exigen, pero no se pueden defaultear: hay cuentas que los rechazan.

INSERT INTO "ai_engine_configs" (
  "provider",
  "sdk_type",
  "label",
  "model_id",
  "model_type",
  "base_url",
  "api_key_ref",
  "is_default",
  "is_active",
  "settings",
  "created_at",
  "updated_at"
)
VALUES (
  'MiniMax',
  'minimax_t2a',
  'MiniMax — Dictado de voz (T2A)',
  'speech-2.8-hd',
  'speech'::"ai_model_type_enum",
  -- La URL completa a propósito: `MinimaxSpeechProvider` la usa tal cual cuando
  -- ya apunta a `/t2a_v2`, así que un endpoint copiado de la documentación de
  -- MiniMax nunca se reescribe.
  'https://api.minimax.io/v1/t2a_v2',
  NULL,
  false,
  true,
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("provider", "model_id") DO NOTHING;
