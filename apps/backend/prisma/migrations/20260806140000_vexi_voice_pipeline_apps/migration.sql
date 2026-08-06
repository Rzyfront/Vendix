-- Migration: crea el transporte y las aplicaciones de IA del modo voz por
-- pipeline de Vexi (STT -> agente de chat -> TTS)
--
-- DATA IMPACT:
--   Tablas mutadas:
--     ai_engine_configs       INSERT de 2 filas
--     ai_engine_applications  INSERT de 2 filas + UPDATE guardado de config_id
--   Sentencias:
--     INSERT ... ON CONFLICT (provider, model_id) DO NOTHING   (configs)
--     INSERT ... ON CONFLICT (key) DO NOTHING                  (aplicaciones)
--     UPDATE ... WHERE key IN (...) AND config_id IS NULL      (enlace)
--   Filas:         exactamente 2 + 2 en entornos donde no existen; 0 en
--                  reejecuciones. Verificar después del deploy con
--                    SELECT a.key, a.model_type, c.provider, c.model_id
--                    FROM ai_engine_applications a
--                    LEFT JOIN ai_engine_configs c ON c.id = a.config_id
--                    WHERE a.key IN ('vexi_voice_stt', 'vexi_voice_tts');
--                  Deben devolverse 2 filas, ambas con config enlazada.
--   Reversible:    SÍ —
--                    DELETE FROM ai_engine_applications
--                     WHERE key IN ('vexi_voice_stt', 'vexi_voice_tts');
--                    DELETE FROM ai_engine_configs
--                     WHERE provider = 'OpenAI'
--                       AND model_id IN ('gpt-4o-mini-transcribe',
--                                        'gpt-4o-mini-tts');
--                  Configuración nueva, sin dependientes fuera de estas dos
--                  aplicaciones. El orden importa: primero las aplicaciones,
--                  porque config_id las referencia.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE.
--   El único UPDATE lleva WHERE y solo toca filas cuyo config_id sea NULL, así
--   que jamás sobrescribe un enlace elegido por un operador.
--
-- Por qué las configs y no solo las aplicaciones:
--   `AIEngineService.resolveApplicationExecution()` resuelve el provider como
--   `app.config_id ? providers.get(app.config_id) : getDefaultProvider()`. Ese
--   default es UNA sola config global (`defaultConfigId`) que en la práctica es
--   un modelo de texto. Una aplicación de voz con `config_id` NULL no falla de
--   forma visible: intenta hablar o transcribir contra un modelo de texto y el
--   error aparece lejos de su causa. A diferencia de `vexi_realtime_voice`
--   —que tiene su propio escaneo por `model_type` en
--   `VexiRealtimeService.resolveVoiceSetup()`— estas dos pasan por el camino
--   genérico, así que el enlace es obligatorio, no una comodidad.
--
-- Por qué OpenAI directo y no el gateway de texto ya configurado:
--   El gateway que sirve el chat (OpenRouter) no expone `/audio/speech`. La
--   síntesis y la transcripción necesitan un proveedor que implemente el
--   contrato de audio de OpenAI.
--
-- api_key_ref queda en NULL A PROPÓSITO:
--   `AIEngineService.resolveApiKey()` cae a la variable de entorno
--   `AI_<PROVIDER>_API_KEY` cuando la columna está vacía, así que acá resuelve
--   `AI_OPENAI_API_KEY`. Una migración nunca lleva secretos: el operador pega
--   la clave desde Super Admin -> AI Engine (que escribe `api_key_ref`) o la
--   inyecta por entorno. Mientras no haya ninguna de las dos, el modo voz
--   responde error de proveedor y el modo chat sigue intacto.
--
-- is_default queda en false en ambas:
--   `is_default` es global y NO discrimina por `model_type`. Marcar una de
--   estas como default redirigiría todas las aplicaciones de texto y visión a
--   un modelo que no las puede servir. `AIEngineConfigService` lo rechaza con
--   AI_CONFIG_003, y esta migración respeta la misma regla.
--
-- settings sin `pricing`:
--   `AILoggingService.calculateCost()` espera `pricing.input_per_1k` /
--   `output_per_1k`, un modelo por tokens. El TTS se factura por carácter y
--   `runSpeech()` no devuelve usage, así que una tarifa acá daría un costo
--   falso. Se deja como campo de operador. La latencia sí queda registrada en
--   `ai_engine_logs.latency_ms`, que es lo que necesita la comparación de
--   motores.

-- ── Transporte ─────────────────────────────────────────────────────────────

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
VALUES
  (
    'OpenAI',
    'openai_compatible',
    'OpenAI — Transcripción de voz (STT)',
    'gpt-4o-mini-transcribe',
    'transcription'::"ai_model_type_enum",
    'https://api.openai.com/v1',
    NULL,
    false,
    true,
    -- `language` acá sería un default silencioso; el servicio de voz lo pasa
    -- explícito en cada llamada para que el idioma sea legible en el código que
    -- lo decide.
    '{}'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'OpenAI',
    'openai_compatible',
    'OpenAI — Dictado de voz (TTS)',
    'gpt-4o-mini-tts',
    'speech'::"ai_model_type_enum",
    'https://api.openai.com/v1',
    NULL,
    false,
    true,
    -- La voz, el formato y la velocidad viven en `metadata.speech` de la
    -- aplicación, no acá: son comportamiento editable por operador y
    -- `buildSpeechOptions()` los lee de la aplicación.
    '{}'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("provider", "model_id") DO NOTHING;

-- ── Aplicaciones ───────────────────────────────────────────────────────────

INSERT INTO "ai_engine_applications" (
  "key",
  "name",
  "description",
  "output_format",
  "model_type",
  "is_active",
  "ai_feature_category",
  "config_id",
  "system_prompt",
  "prompt_template",
  "metadata",
  "created_at",
  "updated_at"
)
VALUES
  (
    'vexi_voice_stt',
    'Vexi — Voz: transcripción (STT)',
    'Convierte el turno hablado del usuario en texto para que lo procese el agente de chat',
    'text',
    'transcription'::"ai_model_type_enum",
    true,
    'realtime_voice',
    (
      SELECT "id" FROM "ai_engine_configs"
      WHERE "provider" = 'OpenAI' AND "model_id" = 'gpt-4o-mini-transcribe'
    ),
    -- `runTranscription()` no arma prompt: el audio viaja en las opciones de la
    -- petición. Un prompt acá no influiría en nada y daría la impresión
    -- contraria.
    NULL,
    NULL,
    NULL,
    NOW(),
    NOW()
  ),
  (
    'vexi_voice_tts',
    'Vexi — Voz: dictado (TTS)',
    'Sintetiza en audio cada segmento de la respuesta de Vexi para el modo voz',
    'text',
    'speech'::"ai_model_type_enum",
    true,
    'realtime_voice',
    (
      SELECT "id" FROM "ai_engine_configs"
      WHERE "provider" = 'OpenAI' AND "model_id" = 'gpt-4o-mini-tts'
    ),
    -- system_prompt DEBE quedar NULL. `runSpeech()` arma el texto a hablar con
    -- `buildApplicationPrompt()`, que concatena system_prompt y
    -- prompt_template: cualquier cosa en system_prompt se leería en voz alta
    -- antes de la respuesta. La persona hablada de Vexi vive en el prompt de
    -- `chat_assistant`; esta aplicación solo dicta lo que el agente ya produjo.
    NULL,
    -- El único vehículo del texto a sintetizar. Sin esta plantilla
    -- `buildApplicationPrompt()` cae a `JSON.stringify(variables)` y el modelo
    -- leería las llaves del objeto en voz alta.
    '{{text}}',
    -- Leído por `buildSpeechOptions()`, que mira `metadata.speech`. Editable
    -- desde Super Admin -> AI Engine -> Aplicaciones sin deploy.
    '{"speech": {"voice": "shimmer", "response_format": "mp3", "speed": 1}}'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("key") DO NOTHING;

-- Enlaza el transporte cuando la aplicación ya existía sin config. Reconcilia
-- solo lo que está sin elegir: el `AND "config_id" IS NULL` es lo que impide
-- pisar una decisión de operador tomada desde el panel.
UPDATE "ai_engine_applications"
SET "config_id" = (
      SELECT "id" FROM "ai_engine_configs"
      WHERE "provider" = 'OpenAI' AND "model_id" = 'gpt-4o-mini-transcribe'
    ),
    "updated_at" = NOW()
WHERE "key" = 'vexi_voice_stt' AND "config_id" IS NULL;

UPDATE "ai_engine_applications"
SET "config_id" = (
      SELECT "id" FROM "ai_engine_configs"
      WHERE "provider" = 'OpenAI' AND "model_id" = 'gpt-4o-mini-tts'
    ),
    "updated_at" = NOW()
WHERE "key" = 'vexi_voice_tts' AND "config_id" IS NULL;
