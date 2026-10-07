/**
 * Funciones puras de la revalidación con IA del escáner de facturas — QUI-855
 * paso 8b.
 *
 *  - `buildRevalidateConsolidated`: estado EDITADO del modal → forma
 *    `InvoiceScanResult` (sin `scan_attachment`) que espera el backend.
 *  - `mergeRevalidatedLines`: aplica lo revalidado sobre las líneas del modal,
 *    por ÍNDICE, conservando todo el match de producto.
 */
import type {
  ExtractedLineItem,
  InvoiceScanResult,
  MatchedLineItem,
  ScanLineTax,
} from '../interfaces/invoice-scanner.interface';
import {
  mapScanTaxesToPopLineTaxes,
  popLineTaxesToScanTaxes,
  scanLineHasTaxes,
} from './scan-line-to-cart.util';
import { editedHeaderDiscountFields } from './scan-header-discount.util';

export type RevalidateConsolidated = Omit<InvoiceScanResult, 'scan_attachment'>;

export interface BuildRevalidateConsolidatedInput {
  /** Escaneo original: aporta proveedor, condiciones, pronto pago y confianza. */
  scan: InvoiceScanResult;
  /** Líneas EDITADas que se envían (las no descartadas). */
  items: readonly MatchedLineItem[];
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  /** Descuento de pie EDITADO (en la unidad indicada por `headerDiscountGross`). */
  headerDiscount: number;
  /** true ⇒ `headerDiscount` está en BRUTO impreso; false/omitido ⇒ neto. */
  headerDiscountGross?: boolean;
  /** Totales derivados (`derivePurchaseTotals`); sin ellos se usa el escaneo. */
  totals?: { subtotal: number; tax_amount: number; total: number };
  /** Total derivado de cada línea enviada (paralelo a `items`). */
  lineTotals?: readonly number[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Línea editada → línea `ExtractedLineItem`.
 *
 * Línea multi-impuesto (bruto): `unit_price_gross` es el precio EDITADO y no
 * existe un neto pre-descuento almacenado, así que `unit_price` viaja igual al
 * bruto (el neto real lo deriva el kernel al persistir). El modo de precios
 * viaja por línea (`prices_include_tax`). Línea legacy: `unit_price` ya es el
 * neto editado y `tax_rate` la fracción.
 */
function buildLine(
  item: MatchedLineItem,
  headerIncludesTax: boolean,
  lineTotal: number | undefined,
): ExtractedLineItem {
  const gross = scanLineHasTaxes(item);
  const qty = num(item.quantity);
  const pct = Math.min(100, Math.max(0, num(item.discount_percentage)));
  const out: ExtractedLineItem = {
    description: item.description,
    quantity: qty,
    unit_price: 0,
    total: lineTotal ?? num(item.total),
    discount_percentage: pct,
  };
  if (item.sku_if_visible) out.sku_if_visible = item.sku_if_visible;

  if (gross) {
    const price = num(item.unit_price_gross ?? item.unit_price);
    const printed = num(item.discount_amount_printed);
    out.unit_price = price;
    out.unit_price_gross = price;
    out.tax_rate = null;
    out.taxes = popLineTaxesToScanTaxes(
      mapScanTaxesToPopLineTaxes(item.taxes ?? []),
    );
    out.prices_include_tax = item.prices_include_tax ?? headerIncludesTax;
    out.discount_amount_printed = printed > 0 ? printed : null;
    out.discount_amount = printed > 0 ? printed : round2(price * qty * (pct / 100)) || null;
    const iva = out.taxes.find((t) => t.tax_type === 'iva');
    if (iva) out.tax_rate = num(iva.tax_rate) / 100;
  } else {
    const price = num(item.unit_price);
    const money = num(item.discount_amount);
    out.unit_price = price;
    out.unit_price_gross = item.unit_price_gross ?? null;
    out.tax_rate = item.tax_rate ?? null;
    out.discount_amount =
      money > 0 ? money : round2(price * qty * (pct / 100)) || null;
    out.discount_amount_printed = null;
  }
  return out;
}

export function buildRevalidateConsolidated(
  input: BuildRevalidateConsolidatedInput,
): RevalidateConsolidated {
  const { scan, items } = input;
  const headerIncludesTax = scan.prices_include_tax === true;
  const headerDiscount = Math.max(0, num(input.headerDiscount));
  const untouchedDiscount =
    round2(headerDiscount) === round2(num(scan.discount_amount));
  const out: RevalidateConsolidated = {
    supplier: scan.supplier,
    invoice_number: input.invoiceNumber ?? scan.invoice_number ?? '',
    invoice_date: input.invoiceDate ?? scan.invoice_date ?? '',
    prices_include_tax: headerIncludesTax,
    line_items: items.map((it, i) =>
      buildLine(it, headerIncludesTax, input.lineTotals?.[i]),
    ),
    subtotal: input.totals?.subtotal ?? scan.subtotal,
    tax_amount: input.totals?.tax_amount ?? scan.tax_amount,
    ...(input.headerDiscountGross
      ? editedHeaderDiscountFields(scan, headerDiscount, true)
      : {
          discount_amount: headerDiscount,
          discount_amount_printed: untouchedDiscount
            ? (scan.discount_amount_printed ?? null)
            : null,
        }),
    early_payment_discount: scan.early_payment_discount ?? null,
    total: input.totals?.total ?? scan.total,
    confidence: scan.confidence,
  };
  if (scan.payment_terms) out.payment_terms = scan.payment_terms;
  return out;
}

// ============================================================================
// Merge por índice
// ============================================================================

export interface MergeRevalidatedResult {
  items: MatchedLineItem[];
  /** Cuántas líneas existentes cambiaron algún valor. */
  changed: number;
  /** Líneas agregadas al final (no estaban en la precarga). */
  added: number;
  /** Líneas del usuario que la revalidación no encontró. */
  missing: number;
}

/** Firma de los campos que la revalidación puede sobrescribir. */
function numericSignature(l: Partial<MatchedLineItem>): string {
  const r = (v: unknown): number | null =>
    v == null || v === '' ? null : Math.round(Number(v) * 10000) / 10000;
  return JSON.stringify([
    r(l.quantity),
    r(l.unit_price),
    r(l.unit_price_gross),
    r(l.total),
    r(l.tax_rate),
    (l.taxes ?? []).map((t) => [
      t.tax_type,
      t.calc_mode,
      r(t.tax_rate),
      r(t.fixed_amount_per_unit),
      r(t.amount_override),
      t.is_inclusive ?? null,
      t.add_to_cost ?? null,
      t.base_mode ?? null,
    ]),
    r(l.discount_amount),
    r(l.discount_amount_printed),
    r(l.discount_percentage),
    l.prices_include_tax ?? null,
  ]);
}

/**
 * Porcentaje de descuento con la MISMA regla que el modal al recibir un
 * escaneo (una sola fuente de verdad en pantalla): el % impreso gana; si sólo
 * hay monto se deriva contra el bruto de la línea.
 */
function revalidatedDiscountPercent(
  rev: ExtractedLineItem,
  gross: boolean,
): number {
  const printedPct = num(rev.discount_percentage);
  if (printedPct > 0) return Math.min(100, printedPct);
  const money = gross ? num(rev.discount_amount_printed) : num(rev.discount_amount);
  const price = gross ? num(rev.unit_price_gross ?? rev.unit_price) : num(rev.unit_price);
  const base = num(rev.quantity) * price;
  return money > 0 && base > 0 ? Math.min(100, (money / base) * 100) : 0;
}

/**
 * Convierte una línea revalidada en los campos numéricos/fiscales del modal.
 * `invoiceIncludesTax` es el modo de la cabecera revalidada.
 */
function revalidatedNumericFields(
  rev: ExtractedLineItem,
  invoiceIncludesTax: boolean | undefined,
): Partial<MatchedLineItem> {
  const taxes: ScanLineTax[] | null = (rev.taxes?.length ?? 0) > 0 ? rev.taxes! : null;
  const gross = taxes !== null;
  const printed = num(rev.discount_amount_printed);
  return {
    quantity: num(rev.quantity),
    unit_price: num(rev.unit_price),
    unit_price_gross: rev.unit_price_gross ?? (gross ? num(rev.unit_price) : null),
    total: num(rev.total),
    tax_rate: rev.tax_rate ?? null,
    taxes,
    // El monto no se conserva: el modal lo normaliza a % al recibir un escaneo
    // (si viviera ganaría por precedencia sobre el % que el operador edita).
    discount_amount: null,
    discount_amount_printed: gross && printed > 0 ? printed : null,
    discount_percentage: revalidatedDiscountPercent(rev, gross),
    // Sólo la línea multi-impuesto lleva su propio modo de precios; la legacy
    // ya viene aplanada a neto y el modal lo ignora.
    prices_include_tax: gross
      ? (rev.prices_include_tax ?? invoiceIncludesTax)
      : undefined,
  };
}

/**
 * Aplica las líneas revalidadas sobre las del modal, por ÍNDICE.
 *
 *  - i existe en ambas: conserva TODO el match de producto y la descripción, y
 *    sobrescribe sólo cantidad/precios/total/impuestos/descuentos/modo de
 *    precios. Se marca `changed` sólo si algún valor cambió.
 *  - Revalidada con líneas extra: se agregan al final SIN producto
 *    (`candidates: []`), marcadas `new`.
 *  - Revalidada con menos líneas: NO se borra nada; las sobrantes se marcan
 *    `missing`.
 */
export function mergeRevalidatedLines(
  current: readonly MatchedLineItem[],
  revalidated: readonly ExtractedLineItem[],
  invoiceIncludesTax?: boolean,
): MergeRevalidatedResult {
  let changed = 0;
  let missing = 0;
  const items: MatchedLineItem[] = current.map((item, i) => {
    const rev = revalidated[i];
    if (!rev) {
      missing++;
      return { ...item, revalidation: 'missing' as const };
    }
    const next: MatchedLineItem = {
      ...item,
      ...revalidatedNumericFields(rev, invoiceIncludesTax),
    };
    // Una línea encontrada ya no está «no encontrada».
    if (next.revalidation === 'missing') delete next.revalidation;
    if (numericSignature(item) !== numericSignature(next)) {
      changed++;
      next.revalidation = 'changed';
    }
    return next;
  });

  const extras = revalidated.slice(current.length);
  for (const rev of extras) {
    items.push({
      ...rev,
      ...revalidatedNumericFields(rev, invoiceIncludesTax),
      match_status: 'new',
      candidates: [],
      selected_product_id: undefined,
      revalidation: 'new',
    });
  }
  return { items, changed, added: extras.length, missing };
}
