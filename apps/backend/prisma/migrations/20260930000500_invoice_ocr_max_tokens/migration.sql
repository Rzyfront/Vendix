-- DATA IMPACT: ai_engine_applications, 2 filas de configuración (invoice_ocr,
-- invoice_ocr_ingredient). Solo sube max_tokens a 16000 si está por debajo.
-- Sin datos de negocio. Idempotente por la guarda max_tokens < 16000.
--
-- Por qué: con 4000 tokens una factura de ~20+ líneas con arreglo `taxes`
-- por línea se corta a mitad del JSON (INV_SCAN_PARSE_FAIL, 422).
UPDATE ai_engine_applications
SET max_tokens = 16000, updated_at = NOW()
WHERE key IN ('invoice_ocr', 'invoice_ocr_ingredient')
  AND (max_tokens IS NULL OR max_tokens < 16000);
