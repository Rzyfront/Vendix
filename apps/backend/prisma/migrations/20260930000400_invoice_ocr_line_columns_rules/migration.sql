-- =====================================================
-- QUI-855 — Endurece el prompt OCR de facturas de compra con reglas de
-- columnas de linea: descuento vs % de IVA, "Impuesto Saludable" (IBUA/ICUI),
-- bonificaciones a precio 0 y autoverificacion que contempla impuestos no-IVA.
-- =====================================================
-- DATA IMPACT: 3 filas de configuracion en ai_engine_applications (solo texto
-- de system_prompt, sin datos de negocio)
-- - Tabla afectada: ai_engine_applications. SOLO UPDATE de system_prompt (mas
--   updated_at) con WHERE key = ... por statement. El prompt vigente se
--   PRESERVA: el bloque nuevo se APPENDEA con `||`.
-- - Filas: invoice_ocr, invoice_ocr_ingredient, invoice_ocr_revalidate (si una
--   no existe, su statement afecta 0 filas).
-- - Operaciones destructivas: NINGUNA (sin DELETE/TRUNCATE/DROP/CASCADE).
-- - FK/cascade risk: ninguno. Sin cambios de schema ni enums.
-- - Idempotencia: guarda `system_prompt NOT LIKE '%LINE COLUMNS (discount vs tax%'`;
--   re-ejecucion => 0 filas.
-- =====================================================

BEGIN;

UPDATE ai_engine_applications
SET system_prompt = system_prompt || E'\n\n' || $rule$LINE COLUMNS (discount vs tax — read each column by its header):
- Map every number to its column by the column HEADER. Never shift values between columns or rows, and never copy a number from another row into the current line.
- A tax-rate column ("IVA (%)", "% IVA", "Tarifa") holds the tax RATE, NEVER a discount. Set "discount_percentage" only when a DISCOUNT column itself prints a percentage; otherwise it is 0.
- A discount column in money ("Total Descuento", "Vr. Descuento", "Descuento") is the "discount_amount" of THAT line (the line's own money). Do not convert it to a percentage; "discount_percentage" = 0 when no percentage is printed.
- When the line prints IVA 0 %, return the "iva" entry with rate 0 (or no iva entry) and "tax_rate" 0. Do NOT infer the invoice's global IVA rate for a line that prints its own rate.
- "Impuesto Saludable" / "IS$" / "IBUA" (column or description) => taxes entry type "ibua". The printed amount belongs to the WHOLE LINE: report it as "amount" (line money) with "rate" null and "fixed_amount_per_unit" null.
- "IS%" / "(IS20%)" / "ICUI" => taxes entry type "icui" with "rate" = the printed percentage (e.g. 20) and "amount" = the printed line amount.
- IBUA and ICUI are NOT part of the IVA base: the IVA base is the net amount after the line discount, unless the invoice shows otherwise.
- A line with price 0 (bonificación, obsequio, "M/C/D" other than a normal sale) is still included: unit_price 0, total 0, discount_amount 0, discount_percentage 0.
- SELF-CHECK per line (replaces the tax part of rule 15 when non-IVA taxes exist): (quantity x unit_price - discount_amount) x (1 + sum of the percentage tax rates that use the net base, as fractions) + sum of the fixed/"amount" taxes ~= total. If it does not reconcile, a column was misread: re-read that row.
- Also verify: the sum of line totals ~= the invoice total, and the sum of the line discounts ~= the footer "Descuentos" when it exists. In that case the footer is NOT an additional discount (keep invoice-level discount_amount at 0).$rule$,
    updated_at = NOW()
WHERE key = 'invoice_ocr'
  AND system_prompt NOT LIKE '%LINE COLUMNS (discount vs tax%';

UPDATE ai_engine_applications
SET system_prompt = system_prompt || E'\n\n' || $rule$LINE COLUMNS (discount vs tax — read each column by its header):
- Map every number to its column by the column HEADER. Never shift values between columns or rows, and never copy a number from another row into the current line.
- A tax-rate column ("IVA (%)", "% IVA", "Tarifa") holds the tax RATE, NEVER a discount. Set "discount_percentage" only when a DISCOUNT column itself prints a percentage; otherwise it is 0.
- A discount column in money ("Total Descuento", "Vr. Descuento", "Descuento") is the "discount_amount" of THAT line (the line's own money). Do not convert it to a percentage; "discount_percentage" = 0 when no percentage is printed.
- When the line prints IVA 0 %, return the "iva" entry with rate 0 (or no iva entry) and "tax_rate" 0. Do NOT infer the invoice's global IVA rate for a line that prints its own rate.
- "Impuesto Saludable" / "IS$" / "IBUA" (column or description) => taxes entry type "ibua". The printed amount belongs to the WHOLE LINE: report it as "amount" (line money) with "rate" null and "fixed_amount_per_unit" null.
- "IS%" / "(IS20%)" / "ICUI" => taxes entry type "icui" with "rate" = the printed percentage (e.g. 20) and "amount" = the printed line amount.
- IBUA and ICUI are NOT part of the IVA base: the IVA base is the net amount after the line discount, unless the invoice shows otherwise.
- A line with price 0 (bonificación, obsequio, "M/C/D" other than a normal sale) is still included: unit_price 0, total 0, discount_amount 0, discount_percentage 0.
- SELF-CHECK per line (replaces the tax part of rule 15 when non-IVA taxes exist): (quantity x unit_price - discount_amount) x (1 + sum of the percentage tax rates that use the net base, as fractions) + sum of the fixed/"amount" taxes ~= total. If it does not reconcile, a column was misread: re-read that row.
- Also verify: the sum of line totals ~= the invoice total, and the sum of the line discounts ~= the footer "Descuentos" when it exists. In that case the footer is NOT an additional discount (keep invoice-level discount_amount at 0).$rule$,
    updated_at = NOW()
WHERE key = 'invoice_ocr_ingredient'
  AND system_prompt NOT LIKE '%LINE COLUMNS (discount vs tax%';

UPDATE ai_engine_applications
SET system_prompt = system_prompt || E'\n\n' || $rule$LINE COLUMNS (discount vs tax — read each column by its header):
- Map every number to its column by the column HEADER. Never shift values between columns or rows, and never copy a number from another row into the current line.
- A tax-rate column ("IVA (%)", "% IVA", "Tarifa") holds the tax RATE, NEVER a discount. Set "discount_percentage" only when a DISCOUNT column itself prints a percentage; otherwise it is 0.
- A discount column in money ("Total Descuento", "Vr. Descuento", "Descuento") is the "discount_amount" of THAT line (the line's own money). Do not convert it to a percentage; "discount_percentage" = 0 when no percentage is printed.
- When the line prints IVA 0 %, return the "iva" entry with rate 0 (or no iva entry) and "tax_rate" 0. Do NOT infer the invoice's global IVA rate for a line that prints its own rate.
- "Impuesto Saludable" / "IS$" / "IBUA" (column or description) => taxes entry type "ibua". The printed amount belongs to the WHOLE LINE: report it as "amount" (line money) with "rate" null and "fixed_amount_per_unit" null.
- "IS%" / "(IS20%)" / "ICUI" => taxes entry type "icui" with "rate" = the printed percentage (e.g. 20) and "amount" = the printed line amount.
- IBUA and ICUI are NOT part of the IVA base: the IVA base is the net amount after the line discount, unless the invoice shows otherwise.
- A line with price 0 (bonificación, obsequio, "M/C/D" other than a normal sale) is still included: unit_price 0, total 0, discount_amount 0, discount_percentage 0.
- SELF-CHECK per line (replaces the tax part of rule 15 when non-IVA taxes exist): (quantity x unit_price - discount_amount) x (1 + sum of the percentage tax rates that use the net base, as fractions) + sum of the fixed/"amount" taxes ~= total. If it does not reconcile, a column was misread: re-read that row.
- Also verify: the sum of line totals ~= the invoice total, and the sum of the line discounts ~= the footer "Descuentos" when it exists. In that case the footer is NOT an additional discount (keep invoice-level discount_amount at 0).$rule$,
    updated_at = NOW()
WHERE key = 'invoice_ocr_revalidate'
  AND system_prompt NOT LIKE '%LINE COLUMNS (discount vs tax%';

COMMIT;
