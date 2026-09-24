import { Prisma } from '@prisma/client';

/**
 * F-212 (CP-pos-exclusive-tax-double-charge) — desambiguador de magnitud para
 * `invoice_taxes.tax_rate`.
 *
 * LAS DOS MAGNITUDES, A PROPÓSITO DISTINTAS:
 *   · `invoice_taxes.tax_rate`      `Decimal(5,2)` → PORCENTAJE (19 = 19 %)
 *   · `order_item_taxes.tax_rate`   `Decimal(6,5)` → FRACCIÓN   (0.19 = 19 %)
 *   · `order_items` / `quotation_items`              → FRACCIÓN
 *
 * Una fracción colada en la columna de porcentaje sale impresa como «0.19 %».
 * Pasa cuando `tax_rate_id` no resuelve contra el catálogo de la tienda (curl,
 * importaciones, herramientas externas): no hay fila de `tax_rates.rate` que
 * escalar, el número del llamador viaja tal cual, y `CreateInvoiceTaxDto` lo
 * deja pasar porque `0.19` es un porcentaje válido según sus propias cotas
 * (`0 ≤ tax_rate ≤ 100`).
 *
 * EL CRITERIO MIRA EL TIPO FISCAL ANTES QUE LA MAGNITUD. Sólo IVA: en Colombia
 * el IVA tiene tres tarifas cerradas — 0 %, 5 %, 19 % — y ninguna cae entre 0 y
 * 1, así que ahí `0 < rate < 1` es inequívocamente una fracción sin escalar.
 * Deliberadamente NO se extiende a ICA/INC/retenciones: el ICA municipal tiene
 * tarifas legítimas por debajo de 1 % (por mil de 2 a 14 ⇒ 0,2 %–1,4 %; ver
 * `orderTaxFractionToInvoiceRate`, que documenta que el ICA ni siquiera
 * comparte la unidad) y algunos conceptos de retefuente también son sub-1 %
 * reales. Escalarlos corrompería una tarifa correcta en vez de arreglar un
 * error.
 *
 * VIVE EN UN UTIL, NO EN `InvoicingService`, porque lo necesitan tres sitios de
 * dos capas distintas y uno de ellos —`fiscal-document-print.mapper.ts`— es una
 * función pura sin DI que no puede arrastrar el grafo del servicio:
 *   · escritor de facturas   `invoicing.service.ts` → `buildInvoiceTaxCreateInput`
 *   · escritor de notas      `credit-notes.service.ts` (copista puro)
 *   · lector de impresión    `fiscal-document-print.mapper.ts`
 *
 * El lector lo necesita porque las filas ya escritas NO se corrigen: decisión
 * del dueño del producto (ADR-15 §7, «lo que se pudrió podrido queda»). Sin
 * tolerancia en lectura, la factura 67 y la nota 170 seguirían imprimiendo
 * «0.19 %» para siempre.
 */
export function normalizeInvoiceTaxRate(
  tax_rate: number | string | Prisma.Decimal,
  tax_type: string | null | undefined,
): Prisma.Decimal {
  const rate = new Prisma.Decimal(tax_rate as Prisma.Decimal.Value);
  const effective_type = (tax_type ?? 'iva').toString().trim().toLowerCase();
  if (effective_type === 'iva' && rate.greaterThan(0) && rate.lessThan(1)) {
    return rate.times(100);
  }
  return rate;
}

/**
 * Misma regla, en espacio `number`, para los lectores de impresión: el modelo
 * de impresión transporta números, no `Decimal`.
 */
export function normalizeInvoiceTaxRateNumber(
  tax_rate: unknown,
  tax_type: string | null | undefined,
): number {
  const raw = Number(tax_rate || 0);
  if (!Number.isFinite(raw)) return 0;
  return normalizeInvoiceTaxRate(raw, tax_type).toNumber();
}

/** Order fractions become invoice percentages, except ICA/reteICA stored per mille. */
export function orderTaxFractionToInvoiceRate(
  fraction: number,
  tax_type: string | null | undefined,
): number {
  const normalized = (tax_type ?? '').trim().toLowerCase();
  const factor =
    normalized === 'ica' || normalized === 'reteica' ? 1000 : 100;
  return Math.round(fraction * factor * 100) / 100;
}
