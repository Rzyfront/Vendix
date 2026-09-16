-- DATA IMPACT:
-- Tables affected: ai_engine_applications
-- Expected row changes: backfill de ai_feature_category en filas NULL (instalaciones
--   base: 16 filas del seed sin categoria; filas con categoria ya asignada intactas;
--   filas de operador con NULL reciben categoria inferida por contrato de ejecucion)
-- Destructive operations: none
-- FK/cascade risk: none (columna escalar sin FKs; el indice existente sobre
--   ai_feature_category se conserva)
-- Idempotency: todos los UPDATE llevan WHERE "ai_feature_category" IS NULL;
--   SET DEFAULT / SET NOT NULL son re-ejecutables
-- Approval: plan PLAN-ia-engine-centralizacion-planes-tenants.md, paso F1
-- Reversibility: ALTER TABLE "ai_engine_applications" ALTER COLUMN
--   "ai_feature_category" DROP NOT NULL; ALTER COLUMN "ai_feature_category"
--   DROP DEFAULT;

-- 1. Escaneres / OCR por vision (imagen o PDF de entrada, JSON de salida) viajan
-- por las colas de extraccion documentaria -> async_queue.
UPDATE "ai_engine_applications"
SET "ai_feature_category" = 'async_queue', "updated_at" = NOW()
WHERE "ai_feature_category" IS NULL
  AND "key" IN (
    'invoice_ocr',
    'invoice_ocr_ingredient',
    'payment_receipt_ocr',
    'expense_invoice_ocr',
    'inventory_count_ocr',
    'rut_scanner',
    'dian_resolution_scanner',
    'dian_habilitation_scanner',
    'route_sheet_ocr',
    'member_roster_ocr'
  );

-- 2. Generacion puntual de texto (resumenes, prediagnosticos, copy, prompts,
-- landings): una llamada run() por uso -> text_generation.
UPDATE "ai_engine_applications"
SET "ai_feature_category" = 'text_generation', "updated_at" = NOW()
WHERE "ai_feature_category" IS NULL
  AND "key" IN (
    'cash_register_closing_summary',
    'consultation_prediagnosis',
    'customer_history_summary',
    'marketing_ad_prompt_specialist',
    'marketing_ad_post_copywriter',
    'crm_landing_generator'
  );

-- 3. Fallback para filas creadas por operador con categoria NULL: inferir por
-- contrato de ejecucion declarado (output_format / model_type).
UPDATE "ai_engine_applications"
SET "ai_feature_category" = 'async_queue', "updated_at" = NOW()
WHERE "ai_feature_category" IS NULL
  AND ("output_format" = 'image' OR "model_type" = 'image');

UPDATE "ai_engine_applications"
SET "ai_feature_category" = 'realtime_voice', "updated_at" = NOW()
WHERE "ai_feature_category" IS NULL
  AND ("model_type" IN ('speech', 'transcription', 'audio')
    OR "output_format" IN ('speech', 'transcription', 'audio'));

UPDATE "ai_engine_applications"
SET "ai_feature_category" = 'rag_embeddings', "updated_at" = NOW()
WHERE "ai_feature_category" IS NULL
  AND ("model_type" = 'embedding' OR "output_format" = 'embedding');

-- 4. Resto sin clasificar: text_generation. `conversations`, `streaming_chat` y
-- `tool_agents` no son inferibles del contrato y asignarlas a ciegas mentiria
-- sobre el gateo; text_generation al menos hace que el gate mida el consumo en
-- vez de saltarlo (AI_GATE_SKIP). El operador corrige desde el admin de apps.
UPDATE "ai_engine_applications"
SET "ai_feature_category" = 'text_generation', "updated_at" = NOW()
WHERE "ai_feature_category" IS NULL;

-- 5. Cierre: default + NOT NULL. A partir de aqui ninguna app viaja sin
-- categoria valida y el gate nunca hace skip por categoria nula en filas nuevas.
ALTER TABLE "ai_engine_applications"
  ALTER COLUMN "ai_feature_category" SET DEFAULT 'text_generation';

ALTER TABLE "ai_engine_applications"
  ALTER COLUMN "ai_feature_category" SET NOT NULL;
