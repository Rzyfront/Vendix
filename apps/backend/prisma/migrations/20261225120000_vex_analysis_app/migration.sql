-- =====================================================
-- App IA vex_analysis — Análisis estadístico con código Python en AWS Lambda
-- aislada (Vex Plus F9 / T52 / M12).
-- =====================================================
-- DATA IMPACT: 1 fila insertada en ai_engine_applications
-- - Tabla afectada: ai_engine_applications. SOLO INSERT de la fila
--   key = 'vex_analysis'. Sin UPDATE, sin DELETE, sin DROP, sin TRUNCATE,
--   sin CASCADE. Sin cambios de schema ni de enums.
-- - NO modifica la fila ni el prompt de 'vex_assistant' (mutar filas existentes
--   queda fuera de esta migración).
-- - Paso 1: copia config_id, model_type, rate_limit, retry_config, metadata y
--   ai_feature_category de 'vex_assistant' con temperature = 0,
--   output_format = 'json' e is_active = false (apagada por defecto hasta
--   certificar el aislamiento en T53).
-- - Paso 2 (fallback si 'vex_assistant' no existe): inserta 'vex_analysis' con
--   config_id = NULL, is_active = false y ai_feature_category = 'vex_agent'.
-- - FK/cascade risk: config_id apunta a ai_engine_configs (ON DELETE SET NULL),
--   sin efecto.
-- - Idempotencia: ON CONFLICT (key) DO NOTHING en ambos pasos; re-ejecución
--   inserta 0 filas y nunca sobrescribe una app editada en superadmin.
-- =====================================================

BEGIN;

INSERT INTO ai_engine_applications (
  key, name, description, config_id, system_prompt, prompt_template,
  temperature, max_tokens, output_format, model_type, rate_limit, retry_config,
  is_active, metadata, ai_feature_category, created_at, updated_at
)
SELECT
  'vex_analysis',
  'Vex — Análisis con código (Python aislado)',
  'Aplicación reservada para análisis estadístico con código Python en AWS Lambda aislada (proyecciones, correlaciones y segmentaciones sobre bloques de conversación). Apagada por defecto hasta certificar T53.',
  src.config_id,
  $prompt$VEX ANALYSIS CODE CONTRACT v1
You write short, deterministic Python scripts (pandas as pd, numpy as np, statsmodels.api as sm) that run in an isolated, no-network AWS Lambda over materialized conversation tables.

RULES
1. Read only from `inputs["<name>"]` (pandas DataFrames provided by the host). Never access network, files, environment variables, subprocesses or database connections.
2. Do not plot or render images (no matplotlib/seaborn): the Vendix panel renders charts from structured series.
3. Assign the final output to `result` with only the allowed keys: `tables`, `series` (`chart`: `line` | `bar` | `scatter`), `figures` (`label`, `value`, `unit?`) and `notes` (max 5 short notes).
4. Keep calculations reproducible, handle missing/NaN values cleanly, and respect finite numeric JSON output.
5. Prefer `compute` for simple percentages, margins or variations; use Python only for multi-period projections, regressions, correlations or customer/product segmentations.$prompt$,
  NULL,
  0,
  LEAST(GREATEST(COALESCE(src.max_tokens, 4096), 4096), 8192),
  'json',
  src.model_type,
  src.rate_limit,
  src.retry_config,
  false,
  src.metadata,
  COALESCE(src.ai_feature_category, 'vex_agent'),
  NOW(),
  NOW()
FROM ai_engine_applications src
WHERE src.key = 'vex_assistant'
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_engine_applications (
  key, name, description, config_id, system_prompt, prompt_template,
  temperature, max_tokens, output_format, model_type, rate_limit, retry_config,
  is_active, metadata, ai_feature_category, created_at, updated_at
)
VALUES (
  'vex_analysis',
  'Vex — Análisis con código (Python aislado)',
  'Aplicación reservada para análisis estadístico con código Python en AWS Lambda aislada (proyecciones, correlaciones y segmentaciones sobre bloques de conversación). Apagada por defecto hasta certificar T53.',
  NULL,
  $prompt$VEX ANALYSIS CODE CONTRACT v1
You write short, deterministic Python scripts (pandas as pd, numpy as np, statsmodels.api as sm) that run in an isolated, no-network AWS Lambda over materialized conversation tables.

RULES
1. Read only from `inputs["<name>"]` (pandas DataFrames provided by the host). Never access network, files, environment variables, subprocesses or database connections.
2. Do not plot or render images (no matplotlib/seaborn): the Vendix panel renders charts from structured series.
3. Assign the final output to `result` with only the allowed keys: `tables`, `series` (`chart`: `line` | `bar` | `scatter`), `figures` (`label`, `value`, `unit?`) and `notes` (max 5 short notes).
4. Keep calculations reproducible, handle missing/NaN values cleanly, and respect finite numeric JSON output.
5. Prefer `compute` for simple percentages, margins or variations; use Python only for multi-period projections, regressions, correlations or customer/product segmentations.$prompt$,
  NULL,
  0,
  4096,
  'json',
  'text',
  NULL,
  NULL,
  false,
  NULL,
  'vex_agent',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
