-- =====================================================
-- Refuerzo de la regla de decisión del descuento en
-- invoice_ocr y invoice_ocr_ingredient (QUI-661 Fase 5).
-- =====================================================
-- DATA IMPACT:
-- - Tabla afectada: ai_engine_applications (SOLO UPDATE de la columna
--   system_prompt). WHERE key IN ('invoice_ocr', 'invoice_ocr_ingredient')
--   — DOS filas, una por app.
-- - Cambios de filas esperados: 2 UPDATE exactos (uno por app). Re-ejecución
--   → 0 filas (guarda `AND system_prompt NOT LIKE '%DECISION PRIORITY%'`).
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / ALTER.
--   No hay UPDATE sin WHERE.
-- - FK/cascade risk: ninguno.
-- - Idempotencia: la guarda es específica al nuevo bullet. Si ya está, el
--   `replace()` no encuentra el patrón y la fila no se toca.
-- - Approval: QUI-661 Fase 5.
--
-- =====================================================
-- POR QUE
-- =====================================================
-- El prompt vigente distingue per-line vs. invoice-level, pero NO establece
-- la prioridad CUANDO ambos vienen populated. La frase "Never report the
-- same discount in both places" prohíbe el caso, pero no le dice al modelo
-- qué dejar cuando por error lo emite igual. Frente al caso, el modelo puede
-- elegir arbitrariamente: vaciar el de cabecera, vaciar el de línea,
-- sumarlos, etc. Cualquier elección distinta a "vaciar el de cabecera"
-- hace que `deriveLineTax` (purchase-orders.service.ts L175-182) sume el
-- descuento propio al prorrateado del header y rebaje la base gravable
-- DOS VECES → IVA descontable subvaluado ante la DIAN y costo de inventario
-- capitalizado por debajo de lo pagado.
--
-- El backend (invoice-scanner.service.ts → normalizeOcrResponse, Fase 5)
-- ya implementa la guarda anti-doble-conteo como última línea de defensa,
-- pero la ambigüedad del prompt hace que el caso se presente con más
-- frecuencia de la necesaria. Este refuerzo reduce la probabilidad de que
-- la guarda tenga que disparar.
-- =====================================================

BEGIN;

-- invoice_ocr
UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      'Never report the same discount in both places.',
      'Never report the same discount in both places. DECISION PRIORITY — if the document shows discount in BOTH places (some per line and one at the footer), the per-line figure is canonical: it is what reaches the FIFO cost layer and the IVA descontable line by line. A header total that summarizes the per-line breakdown represents the SAME money — reporting it in the header too would let the backend prorate it on top of the per-line amount and effectively discount the line twice (taxable base undervalued, deductible VAT too low). Pick the per-line figure and leave the invoice-level discount_amount at 0.'
    ),
    updated_at = NOW()
WHERE key = 'invoice_ocr'
  AND system_prompt LIKE '%Never report the same discount in both places.%'
  AND system_prompt NOT LIKE '%DECISION PRIORITY%';

-- invoice_ocr_ingredient
UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      'Never report the same discount in both places.',
      'Never report the same discount in both places. DECISION PRIORITY — if the document shows discount in BOTH places (some per line and one at the footer), the per-line figure is canonical: it is what reaches the FIFO cost layer and the IVA descontable line by line. A header total that summarizes the per-line breakdown represents the SAME money — reporting it in the header too would let the backend prorate it on top of the per-line amount and effectively discount the line twice (taxable base undervalued, deductible VAT too low). Pick the per-line figure and leave the invoice-level discount_amount at 0.'
    ),
    updated_at = NOW()
WHERE key = 'invoice_ocr_ingredient'
  AND system_prompt LIKE '%Never report the same discount in both places.%'
  AND system_prompt NOT LIKE '%DECISION PRIORITY%';

COMMIT;
