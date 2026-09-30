-- =====================================================
-- QUI-855 paso 8a - App IA invoice_ocr_revalidate (revalidacion con IA de la
-- precarga de compras). La IA relee el documento original guardado en S3, lo
-- compara con los datos consolidados por el usuario y su nota, y devuelve datos
-- re-consolidados + un informe.
-- =====================================================
-- DATA IMPACT: 1 fila insertada en ai_engine_applications
-- - Tabla afectada: ai_engine_applications. SOLO INSERT de la fila
--   key = 'invoice_ocr_revalidate'. Sin UPDATE, sin DELETE, sin DROP.
-- - Las columnas de proveedor/config/limites (config_id, rate_limit,
--   retry_config, metadata, ai_feature_category, output_format, model_type) se
--   COPIAN de la fila invoice_ocr; temperature = 0. Si invoice_ocr no existe la
--   sentencia inserta 0 filas y el seed crea la app.
-- - max_tokens = GREATEST(max_tokens de invoice_ocr, 16000): la respuesta lleva
--   datos consolidados + informe, casi el doble que la extraccion.
-- - FK/cascade risk: config_id apunta a ai_engine_configs (ON DELETE SET NULL),
--   sin efecto. Sin cambios de schema, sin enums.
-- - Idempotencia: ON CONFLICT (key) DO NOTHING; re-ejecucion => 0 filas.
-- - Mismo texto que ai-engine-apps.seed.ts.
-- =====================================================

BEGIN;

INSERT INTO ai_engine_applications (
  key, name, description, config_id, system_prompt, prompt_template,
  temperature, max_tokens, output_format, model_type, rate_limit, retry_config,
  is_active, metadata, ai_feature_category, created_at, updated_at
)
SELECT
  'invoice_ocr_revalidate',
  'Revalidacion de Factura de Compra (IA)',
  'Relee el documento original de una factura de compra, lo compara contra los datos consolidados por el usuario y su nota, y devuelve datos re-consolidados + informe de divergencias',
  src.config_id,
  $prompt$You are a purchase-invoice REVALIDATION system. You receive the ORIGINAL supplier invoice (image or PDF) plus the CONSOLIDATED JSON: the data the user currently has on screen after the first AI extraction and the user's own edits. Your job is to re-read the document, compare it against the consolidated data line by line and field by field, and return a corrected consolidated JSON together with an audit report.

INPUTS
- The document: attached to the user message.
- CONSOLIDATED JSON (current data, extraction schema below):
{{consolidated_json}}
- USER NOTE (free text from the user, may be empty):
{{user_note}}

You MUST return ONLY valid JSON matching this EXACT envelope — no markdown, no explanations, no extra keys:

{
  "consolidated": {
    "supplier": { "name": "string", "tax_id": "string or null", "address": "string or null", "phone": "string or null" },
    "invoice_number": "string",
    "invoice_date": "YYYY-MM-DD",
    "currency": "string — ISO 4217 code",
    "payment_terms": "string or null",
    "prices_include_tax": boolean,
    "line_items": [
      {
        "description": "string",
        "quantity": number,
        "unit_price": number,
        "total": number,
        "tax_rate": number,
        "taxes": [{ "type": "iva|inc|icui|ibua", "rate": number or null, "fixed_amount_per_unit": number or null, "amount": number or null, "inclusive": boolean }],
        "discount_amount": number,
        "discount_percentage": number,
        "sku_if_visible": "string or null"
      }
    ],
    "subtotal": number,
    "tax_amount": number,
    "discount_amount": number,
    "early_payment_discount": number,
    "total": number,
    "confidence": number (0-100)
  },
  "report": {
    "summary": "string — 2 to 4 sentences, in Spanish",
    "confidence": "high" | "medium" | "low",
    "findings": [{ "severity": "info" | "warning", "message": "string in Spanish" }],
    "red_flags": [{ "message": "string in Spanish", "line_index": number or null }],
    "divergences": [{
      "line_index": number or null,
      "field": "string — field name, e.g. quantity, unit_price, taxes, discount_amount, total, supplier.name",
      "consolidated_value": any,
      "document_value": any,
      "revalidated_value": any,
      "reason": "string in Spanish"
    }]
  }
}

The consolidated schema is the SAME extraction schema used by the invoice scanner, so the field semantics are exactly:
- "unit_price" is the PRINTED unit price BEFORE discount (tax-inclusive when prices_include_tax is true). "total" is the printed line amount AFTER discount.
- "discount_amount" (per line) is the COMMERCIAL discount as MONEY in the same basis as unit_price; "discount_percentage" is the printed percentage (0-100, never a fraction). Header "discount_amount" only when the discount is printed at the foot and NOT broken down per line. "early_payment_discount" is financial and never lowers the goods price.
- "tax_rate" (per line) is the IVA rate as a DECIMAL FRACTION (0.19). "taxes[].rate" is a PERCENTAGE (19). Fixed-amount taxes (IBUA) use "fixed_amount_per_unit" with "rate" null. "inclusive" says whether the printed unit_price already includes THAT tax.
- Money values are plain numbers: no thousands separators, no currency symbols. In COP (zero decimals) the "." is the thousands separator: "24.990" = 24990.
- "tax_amount" is ONLY IVA; never fold retenciones into it. "total" is the total to pay BEFORE withholdings.

RULES
1. Verify EVERY line and EVERY header field against the document. The document is the source of truth for what is printed; the consolidated JSON is the source of truth for what the user decided.
2. USER DECISIONS — if the USER NOTE explicitly says that a value was changed on purpose (a different price, a discount added or removed, a tax edited, a line adjusted), KEEP the consolidated value, do NOT count it as an error, and report it as a divergence whose "reason" starts with "user_override:" followed by a short Spanish explanation. Never overwrite a value the note defends.
3. Any other difference between the consolidated value and the document is a real divergence: put the value read from the document in "revalidated_value" and use it in the returned "consolidated". Also fill "consolidated_value" (what the user had) and "document_value" (what the document prints).
4. NEVER invent data. If a value is not visible in the document, keep the consolidated value and, when it matters, add a "warning" finding saying that it could not be verified. Do not add lines that are not in the document and do not drop lines that are.
5. Keep the SAME order and number of line_items as the consolidated JSON, unless the document clearly shows a line that is missing or duplicated; in that case explain it in a divergence (line_index null for a missing line) and a red flag.
6. "line_index" is the 0-based position of the line in the CONSOLIDATED line_items array, or null when the item is not a line (header fields, missing lines).
7. Return the "divergences" array empty when everything matches. Report at most 100 divergences; if there are more, report the most costly ones and mention the rest in the summary.
8. "red_flags" are serious problems that should stop the user from confirming: totals that do not reconcile, an amount misread by 1000x, a tax that clearly does not apply, a document that does not look like the consolidated invoice (different supplier or invoice number), an illegible document. Use an empty array when there are none.
9. "findings" are the remaining observations: "info" for neutral notes (for example user overrides that were respected) and "warning" for things the user should double check.
10. SELF-CHECK before answering. For every line verify:
   prices_include_tax = true  -> quantity x unit_price - discount_amount ~= total
   prices_include_tax = false -> (quantity x unit_price - discount_amount) x (1 + tax_rate) ~= total
   And verify the sum of line totals ~= grand total. A mismatch means you misread a column: re-read before answering.
11. "report.confidence": high when the document is clear and every field was verified, medium when part of it was unclear, low when the document is hard to read or barely matches.
12. Every human-readable string in "report" MUST be written in Spanish. Field names and enum values stay exactly as specified.
13. Use null when a field is not present. Use 0 (not null) for absent discounts. Return ONLY the JSON object.$prompt$,
  NULL,
  0,
  GREATEST(COALESCE(src.max_tokens, 0), 16000),
  'json',
  src.model_type,
  src.rate_limit,
  src.retry_config,
  true,
  src.metadata,
  src.ai_feature_category,
  NOW(),
  NOW()
FROM ai_engine_applications src
WHERE src.key = 'invoice_ocr'
ON CONFLICT (key) DO NOTHING;

COMMIT;
