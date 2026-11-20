-- =====================================================
-- App IA vex_title_generator — título corto de las conversaciones de Vex
-- =====================================================
-- DATA IMPACT: 0 o 1 fila insertada en ai_engine_applications
-- - Tabla afectada: ai_engine_applications. SOLO INSERT de la fila
--   key = 'vex_title_generator'. Sin UPDATE, sin DELETE, sin DROP, sin
--   TRUNCATE. No toca vex_assistant ni ninguna otra app.
-- - Conteo esperado: 1 fila insertada (0 si la clave ya existe).
-- - config_id = NULL: usa la config por defecto de la plataforma; el
--   superadmin puede asignarle un modelo económico desde el panel de IA sin
--   deploy. Sin app activa el servidor usa el primer mensaje recortado.
-- - FK/cascade risk: ninguno (config_id NULL). Sin cambios de schema ni enums.
-- - Idempotencia: ON CONFLICT (key) DO NOTHING; re-ejecución => 0 filas y
--   nunca pisa una app editada a mano en el panel.
-- - Mismos valores que prisma/seeds/ai-engine-apps.seed.ts.
-- - Reversibilidad: DELETE FROM ai_engine_applications
--   WHERE key = 'vex_title_generator';
-- =====================================================

BEGIN;

INSERT INTO ai_engine_applications (
  key, name, description, config_id, system_prompt, prompt_template,
  temperature, max_tokens, output_format, model_type,
  is_active, metadata, ai_feature_category, created_at, updated_at
)
VALUES (
  'vex_title_generator',
  'Vex — Generador de títulos de conversación',
  'Redacta un título corto y descriptivo para una conversación de Vex a partir de su primer mensaje',
  NULL,
  $vextitle$Eres un redactor de títulos para una lista de conversaciones de un asistente de negocios.
Recibes el primer mensaje de la persona y devuelves un título corto que describa el tema.

REGLAS:
- Idioma: español.
- Máximo 60 caracteres, idealmente de 3 a 7 palabras.
- Describe el tema o la tarea, no copies el mensaje.
- Sin comillas, sin punto final, sin emojis y sin prefijos como «Título:».
- Responde SOLO con el título, en una sola línea.$vextitle$,
  $vextitletpl$Primer mensaje de la persona:
{{first_message}}$vextitletpl$,
  0.3,
  40,
  'text',
  'text'::"ai_model_type_enum",
  true,
  NULL,
  'conversations',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
