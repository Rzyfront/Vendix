-- =====================================================
-- Endurecimiento de precisión del OCR de facturas de compra:
-- porcentaje de descuento, BASE del monto de descuento, definición
-- de "subtotal", retenciones fuera del total y auto-verificación
-- aritmética por línea. Aplica a invoice_ocr e invoice_ocr_ingredient.
-- QUI-661 hotfix — paridad de cifras modal ↔ carrito ↔ orden.
-- =====================================================
-- DATA IMPACT:
-- - Tabla afectada: ai_engine_applications. SOLO UPDATE de las columnas
--   system_prompt y temperature (más updated_at como sello). WHERE
--   key IN ('invoice_ocr', 'invoice_ocr_ingredient') — DOS filas, una por app.
-- - Cambios de filas esperados: 2 UPDATE exactos (uno por app, un statement
--   por key). Re-ejecución → 0 filas, por la guarda
--   `AND system_prompt NOT LIKE '%SELF-CHECK before answering%'`.
-- - Operaciones destructivas: NINGUNA. Sin DELETE, sin TRUNCATE, sin DROP,
--   sin ALTER. Ningún UPDATE sin WHERE. Ninguna columna se vacía ni se
--   reescribe por completo: el prompt vigente se PRESERVA y los bloques
--   nuevos se APPENDEAN con `||`.
-- - max_tokens: NO se toca. El valor vivo en producción (invoice_ocr 50000,
--   invoice_ocr_ingredient 4500) es el que sostiene facturas multipágina; el
--   seed del repo declaraba 4000 y escribir ese número aquí truncaría
--   escaneos reales. La deriva se corrige en el seed (entornos nuevos), no
--   sobre producción.
-- - FK/cascade risk: ninguno. ai_engine_applications no participa en ningún
--   borrado en cascada y esta migración no toca llaves ni relaciones.
-- - Idempotencia: la guarda apunta al marcador textual del bloque nuevo
--   ('SELF-CHECK before answering'). Si el bloque ya está, la fila no entra
--   al UPDATE y por tanto tampoco se evalúa el `replace()` del esquema JSON.
-- - Dry-run: NO se ejecutó contra ninguna base en este cambio. Antes del
--   deploy, correr sobre una copia representativa y verificar que devuelve
--   exactamente 2 filas la primera vez y 0 la segunda.
-- - Approval: hotfix QUI-661 OCR parity, aprobado por el usuario el
--   2026-08-22.
--
-- =====================================================
-- POR QUE
-- =====================================================
-- (a) TEMPERATURA. Extraer números de una factura es una tarea DETERMINISTA:
--     el papel dice 24.990 y la única respuesta correcta es 24990. No hay
--     nada que muestrear. Producción corre hoy `temperature = 0.40` en
--     invoice_ocr (deriva respecto al seed, que declara 0.1): eso es
--     variabilidad regalada sobre una tarea sin grados de libertad — dos
--     escaneos de la MISMA imagen pueden diferir, y el operador que ve una
--     cifra distinta al reintentar pierde la confianza en el escáner. Se
--     fija en 0 en ambas apps.
--
-- (b) EL PROMPT NO PEDÍA EL PORCENTAJE. La regla 9 vigente exige el descuento
--     comercial "as MONEY" y le pide al modelo CONVERTIR un porcentaje
--     impreso a dinero. Esa conversión es justamente donde falla: ante un
--     "-20%" sin monto en la columna, el modelo prefiere el valor seguro y
--     emite `discount_amount: 0` — el descuento visible en el papel
--     desaparece del carrito. El porcentaje es el dato más robusto que la IA
--     puede leer (es invariante a la base: 20% es 20% con IVA o sin IVA), así
--     que ahora se pide EXPLÍCITAMENTE y ADEMÁS del monto.
--
-- (c) EL PROMPT NO DECLARABA LA BASE DEL MONTO. `unit_price` puede venir
--     bruto o neto según `prices_include_tax`, pero nada le decía al modelo
--     en qué base reportar el descuento. Si el modelo aplanaba el descuento
--     por su cuenta mientras el backend lo vuelve a aplanar
--     (invoice-scanner.service.ts → normalizeLineItem), el IVA del descuento
--     se restaba dos veces. Ahora se declara: MISMA base que `unit_price`, y
--     prohibición explícita de que el modelo quite el impuesto él mismo.
--
-- (d) EL PROMPT NO DEFINÍA "subtotal" NI EXCLUÍA LAS RETENCIONES DEL TOTAL.
--     Sin definición, el modelo suma los totales impresos de línea — que en
--     una factura inclusiva ya traen IVA — y devuelve un "subtotal" que no es
--     base gravable. Y una factura a agente retenedor imprime un "neto a
--     pagar" ya con retención descontada: tomarlo como `total` subvalúa la
--     compra, porque la retención es un anticipo de impuesto que se salda al
--     pagar, no una rebaja del precio.
--
-- (e) EL PROMPT NO EXIGÍA AUTO-VERIFICACIÓN ARITMÉTICA POR LÍNEA. Solo pedía
--     comparar la suma de líneas contra el total de pie (regla 2), que no
--     detecta una columna de descuento leída como 0: la línea cuadra igual si
--     el modelo también leyó mal `unit_price`. El SELF-CHECK nuevo obliga a
--     reconciliar cantidad × precio − descuento contra el total DE ESA LÍNEA,
--     que es la identidad que un descuento perdido rompe siempre.
--
-- NOTA — se APPENDEA, no se reescribe. El texto vigente en producción ya está
-- validado en campo y solo difiere del seed en un guion (largo vs. corto)
-- dentro del bloque DECISION PRIORITY. Reescribir el prompt completo desde
-- este archivo arriesgaría pisar ese texto probado por una copia del repo;
-- appendear preserva lo que funciona y agrega lo que falta. Por la misma
-- razón NO se toca la regla 9 ni su DECISION PRIORITY: de ella depende la
-- guarda anti-doble-conteo de la Fase 5 en normalizeOcrResponse.
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- invoice_ocr (perfil retail)
-- -----------------------------------------------------
-- ORDEN DE OPERACIONES: el `replace()` corre sobre el system_prompt VIGENTE y
-- el `||` appendea después. Así el patrón del esquema JSON no puede colisionar
-- con el texto nuevo (que también menciona "discount_amount"). El patrón lleva
-- 6 espacios de indentación a propósito: identifica el campo DENTRO de
-- line_items y nunca el homónimo de nivel documento, que va con 2 espacios.
UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      '      "discount_amount": number,',
      '      "discount_amount": number,' || chr(10) || '      "discount_percentage": number,'
    )
    || chr(10)
    || '9bis. DISCOUNT PERCENTAGE — when the line prints a percentage ("-20%", "Dcto 20%"), report it VERBATIM in "discount_percentage" (0-100, never a fraction) AND the money in "discount_amount". Reporting one and omitting the other loses the figure the operator reads off the paper. A visible discount column or percentage on the line means discount_amount MUST be non-zero — 0 is correct ONLY when nothing is printed.
9ter. DISCOUNT BASIS — every discount money figure is in the SAME basis as "unit_price". If prices_include_tax = true the printed discount is tax-inclusive; report it as printed and do NOT strip the tax yourself.
13. "subtotal" = the sum of line taxable bases AFTER commercial discounts and BEFORE IVA. Not the sum of printed line totals when those already carry tax.
14. WITHHOLDINGS — never subtract retefuente / reteica / reteiva from "total". "total" is the invoice''s "Total a pagar" BEFORE withholdings; they are settled at payment.
15. SELF-CHECK before answering. For every line verify:
   prices_include_tax = true  -> quantity x unit_price - discount_amount ~= total
   prices_include_tax = false -> (quantity x unit_price - discount_amount) x (1 + tax_rate) ~= total
   And verify the sum of line totals ~= grand total. If a line does not reconcile, re-read its columns before answering — a mismatch means you misread a column, not that the invoice is wrong.',
    temperature = 0,
    updated_at = NOW()
WHERE key = 'invoice_ocr'
  AND system_prompt NOT LIKE '%SELF-CHECK before answering%';

-- -----------------------------------------------------
-- invoice_ocr_ingredient (perfil insumos / UoM)
-- -----------------------------------------------------
UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      '      "discount_amount": number,',
      '      "discount_amount": number,' || chr(10) || '      "discount_percentage": number,'
    )
    || chr(10)
    || '11bis. DISCOUNT PERCENTAGE — when the line prints a percentage ("-20%", "Dcto 20%"), report it VERBATIM in "discount_percentage" (0-100, never a fraction) AND the money in "discount_amount". Reporting one and omitting the other loses the figure the operator reads off the paper. A visible discount column or percentage on the line means discount_amount MUST be non-zero — 0 is correct ONLY when nothing is printed.
11ter. DISCOUNT BASIS — every discount money figure is in the SAME basis as "unit_price". If prices_include_tax = true the printed discount is tax-inclusive; report it as printed and do NOT strip the tax yourself.
15. "subtotal" = the sum of line taxable bases AFTER commercial discounts and BEFORE IVA. Not the sum of printed line totals when those already carry tax.
16. WITHHOLDINGS — never subtract retefuente / reteica / reteiva from "total". "total" is the invoice''s "Total a pagar" BEFORE withholdings; they are settled at payment.
17. SELF-CHECK before answering. For every line verify:
   prices_include_tax = true  -> quantity x unit_price - discount_amount ~= total
   prices_include_tax = false -> (quantity x unit_price - discount_amount) x (1 + tax_rate) ~= total
   And verify the sum of line totals ~= grand total. If a line does not reconcile, re-read its columns before answering — a mismatch means you misread a column, not that the invoice is wrong.',
    temperature = 0,
    updated_at = NOW()
WHERE key = 'invoice_ocr_ingredient'
  AND system_prompt NOT LIKE '%SELF-CHECK before answering%';

COMMIT;
