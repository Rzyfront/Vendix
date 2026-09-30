-- =====================================================
-- QUI-855 — Precarga IA multi-impuesto en el escaner de facturas de compra.
-- Agrega `taxes[]` por linea (iva / inc / icui / ibua) al esquema y una regla
-- de extraccion en invoice_ocr e invoice_ocr_ingredient. `tax_rate` legacy
-- (fraccion) se mantiene.
-- =====================================================
-- DATA IMPACT: 2 rows ai_engine_applications (prompt text only)
-- - Tabla afectada: ai_engine_applications. SOLO UPDATE de system_prompt
--   (mas updated_at). WHERE key = ... por statement (una fila por app).
-- - Operaciones destructivas: NINGUNA. El prompt vigente se PRESERVA: se
--   inserta el campo `taxes` tras `tax_rate` en el esquema y se APPENDEA la
--   regla nueva con `||` (mismo criterio que 20260822150000).
-- - FK/cascade risk: ninguno.
-- - Idempotencia: guarda `system_prompt NOT LIKE '%TAXES ARRAY (per line%'`;
--   re-ejecucion => 0 filas.
-- - Sin cambios de schema, sin enums. Mismo texto que ai-engine-apps.seed.ts.
-- =====================================================

BEGIN;

UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      '      "tax_rate": number,',
      '      "tax_rate": number,' || chr(10) || '      "taxes": [{ "type": "iva|inc|icui|ibua", "rate": number or null, "fixed_amount_per_unit": number or null, "amount": number or null, "inclusive": boolean }],'
    )
    || chr(10)
    || '16. TAXES ARRAY (per line, "taxes") — list EVERY tax printed for THAT line, one entry per tax, max 4 entries and at most one per type:
   - "type": "iva" (IVA), "inc" (impuesto al consumo / impoconsumo), "icui" (impuesto a productos comestibles ultraprocesados), "ibua" (impuesto a bebidas azucaradas, charged per unit / per volume).
   - "rate": the tax rate as a PERCENTAGE, e.g. 19 for 19%, 8 for 8%, 20 for 20% — NOT a fraction (this differs from the legacy "tax_rate", which stays a fraction). null when the tax is a fixed amount per unit (typical of ibua).
   - "fixed_amount_per_unit": money per unit when the tax is a fixed amount per unit (e.g. IBUA 68 per unit), otherwise null.
   - "amount": the tax money printed for that line, if the document prints it, otherwise null.
   - "inclusive": true if the printed unit_price already includes THAT tax, false if it is added on top.
   - Do NOT invent taxes that are not printed. If the document only shows a single IVA total, return exactly one "iva" entry. Use an empty array when the line is exempt / excluded / carries no tax.
   - Keep the legacy "tax_rate" exactly as defined in the "tax_rate" rule (IVA rate as a DECIMAL FRACTION); "taxes" is additive and does not replace it. tax_amount stays the IVA total only.',
    updated_at = NOW()
WHERE key = 'invoice_ocr'
  AND system_prompt NOT LIKE '%TAXES ARRAY (per line%';

UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      '      "tax_rate": number,',
      '      "tax_rate": number,' || chr(10) || '      "taxes": [{ "type": "iva|inc|icui|ibua", "rate": number or null, "fixed_amount_per_unit": number or null, "amount": number or null, "inclusive": boolean }],'
    )
    || chr(10)
    || '18. TAXES ARRAY (per line, "taxes") — list EVERY tax printed for THAT line, one entry per tax, max 4 entries and at most one per type:
   - "type": "iva" (IVA), "inc" (impuesto al consumo / impoconsumo), "icui" (impuesto a productos comestibles ultraprocesados), "ibua" (impuesto a bebidas azucaradas, charged per unit / per volume).
   - "rate": the tax rate as a PERCENTAGE, e.g. 19 for 19%, 8 for 8%, 20 for 20% — NOT a fraction (this differs from the legacy "tax_rate", which stays a fraction). null when the tax is a fixed amount per unit (typical of ibua).
   - "fixed_amount_per_unit": money per unit when the tax is a fixed amount per unit (e.g. IBUA 68 per unit), otherwise null.
   - "amount": the tax money printed for that line, if the document prints it, otherwise null.
   - "inclusive": true if the printed unit_price already includes THAT tax, false if it is added on top.
   - Do NOT invent taxes that are not printed. If the document only shows a single IVA total, return exactly one "iva" entry. Use an empty array when the line is exempt / excluded / carries no tax.
   - Keep the legacy "tax_rate" exactly as defined in the "tax_rate" rule (IVA rate as a DECIMAL FRACTION); "taxes" is additive and does not replace it. tax_amount stays the IVA total only.',
    updated_at = NOW()
WHERE key = 'invoice_ocr_ingredient'
  AND system_prompt NOT LIKE '%TAXES ARRAY (per line%';

COMMIT;
