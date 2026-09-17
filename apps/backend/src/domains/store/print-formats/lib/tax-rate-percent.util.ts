/**
 * Tarifa de columna-FRACCIÓN → porcentaje imprimible.
 *
 * C.7 (CP-pos-exclusive-tax-double-charge) — el compositor concatena literal
 * `${item.tax_rate}%` y `(${tax.rate}%)`. Varias columnas de la base guardan
 * la tarifa como FRACCIÓN por contrato —`order_items.tax_rate` y
 * `order_item_taxes.tax_rate` son `Decimal(6,5)`, `quotation_items.tax_rate`
 * igual, y `withholding_calculations.withholding_rate` /
 * `withholding_concepts.rate` son `Decimal(_,4)`—, así que pasarlas crudas
 * imprime «IVA: 0.19%» o «Retención 2.5% (0.025%)»: el papel afirma una
 * tarifa cien veces menor que la que se cobró. Ya se corrigió dos veces en
 * sitio (`f746730b0` para el tiquete POS, F-212 para la nota de crédito);
 * esta es la definición única para que no haya una tercera.
 *
 * El ×10000/100 redondea a dos decimales de PORCENTAJE sin arrastrar ruido de
 * punto flotante (`0.19 * 100 = 18.999999999999996`). `0.0097` ⇒ `0.97`.
 *
 * NO aplica a `invoice_taxes.tax_rate`, que es `Decimal(5,2)` y cuyo contrato
 * YA es porcentaje: ese caso lo cubre `normalizeInvoiceTaxRateNumber`, que
 * además tolera las filas históricas contaminadas con la fracción.
 */
export function fractionalRateToPercent(
  rate: unknown,
): number | undefined {
  if (rate === null || rate === undefined) return undefined;
  const n = Number(rate);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 10000) / 100;
}
