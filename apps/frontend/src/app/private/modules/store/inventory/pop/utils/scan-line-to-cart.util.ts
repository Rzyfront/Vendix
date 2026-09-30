/**
 * Mapeo puro de una línea del escáner de facturas a los campos del carrito POP
 * — QUI-855.
 *
 * Dos caminos, y el que se toma lo decide la línea:
 *
 *  - MULTI-IMPUESTO (`taxes.length > 0`): la línea se trabaja en BRUTO. El
 *    carrito recibe el precio impreso (`unit_price_gross`), el descuento
 *    impreso (`discount_amount_printed`, o el %), el modo de precios de la
 *    factura aplicado A LA LÍNEA y las filas de impuestos tal cual, sin forzar
 *    'iva'. El kernel `purchase-line-taxes` deriva el neto.
 *  - LEGACY (sin `taxes`): el payload ya viene aplanado a NETO sólo por IVA
 *    (`unit_price`, `tax_rate` fracción). Se mantiene EXACTAMENTE el mapeo
 *    anterior: modo adicional, tasa ×100, descuento como porcentaje entero.
 */
import type {
  ExtractedLineItem,
  InvoiceScanResult,
  ScanLineTax,
} from '../interfaces/invoice-scanner.interface';
import type {
  PopLineTax,
  PopScanAttachment,
} from '../interfaces/pop-cart.interface';

export interface ScanLineCartFields {
  unit_cost: number;
  /** Descuento en PORCENTAJE. */
  discount: number;
  /** Descuento en DINERO (bruto impreso). Gana sobre `discount` en el carrito. */
  discount_amount?: number;
  /** PORCENTAJE (19), no fracción. */
  tax_rate?: number;
  tax_type?: string;
  prices_include_tax: boolean;
  taxes?: PopLineTax[];
}

/** ¿La línea trae el camino multi-impuesto? */
export function scanLineHasTaxes(
  item: Pick<ExtractedLineItem, 'taxes'>,
): boolean {
  return (item.taxes?.length ?? 0) > 0;
}

/**
 * ¿La línea lleva algún impuesto? Enciende el maestro «¿Esta compra tiene
 * IVA?» del carrito, que gatea TODAS las filas de impuestos.
 */
export function scanLineHasVat(
  item: Pick<ExtractedLineItem, 'taxes' | 'tax_rate'>,
): boolean {
  if (scanLineHasTaxes(item)) return true;
  return item.tax_rate != null && Number(item.tax_rate) > 0;
}

/** Filas del backend (`tax_rate` en PORCENTAJE) → filas del carrito. */
export function mapScanTaxesToPopLineTaxes(
  taxes: readonly ScanLineTax[],
): PopLineTax[] {
  return taxes.slice(0, 4).map((t) => {
    const isFixed = t.calc_mode === 'fixed_per_unit' || t.tax_type === 'ibua';
    const row: PopLineTax = {
      tax_type: t.tax_type,
      calc_mode: isFixed ? 'fixed_per_unit' : 'percent',
      tax_rate: isFixed ? null : Number(t.tax_rate) || 0,
      fixed_amount_per_unit: isFixed
        ? Number(t.fixed_amount_per_unit) || 0
        : null,
      is_inclusive: t.is_inclusive,
      // INC/ICUI/IBUA capitalizan siempre (el kernel lo fuerza); el IVA se
      // descuenta salvo que el operador lo mande al costo (editor del modal).
      add_to_cost: t.tax_type === 'iva' ? !!t.add_to_cost : true,
    };
    if (t.base_mode) row.base_mode = t.base_mode;
    if (t.amount_override != null) {
      row.amount_override = Number(t.amount_override);
    }
    return row;
  });
}

/** Filas del editor (`tax_rate` en PORCENTAJE) → filas del escaneo. */
export function popLineTaxesToScanTaxes(
  rows: readonly PopLineTax[],
): ScanLineTax[] {
  return rows.slice(0, 4).map((t) => {
    const isFixed = t.calc_mode === 'fixed_per_unit' || t.tax_type === 'ibua';
    const out: ScanLineTax = {
      tax_type: t.tax_type,
      calc_mode: isFixed ? 'fixed_per_unit' : 'percent',
      tax_rate: isFixed ? null : Number(t.tax_rate) || 0,
      fixed_amount_per_unit: isFixed ? Number(t.fixed_amount_per_unit) || 0 : null,
      amount_override: t.amount_override ?? null,
      is_inclusive: t.is_inclusive,
      add_to_cost: t.tax_type === 'iva' ? !!t.add_to_cost : true,
    };
    if (t.base_mode) out.base_mode = t.base_mode;
    return out;
  });
}

const clampPct = (v: unknown): number =>
  Math.min(100, Math.max(0, Number(v) || 0));

/**
 * @param invoiceIncludesTax `prices_include_tax` de la cabecera del escaneo:
 *   se aplica a la LÍNEA multi-impuesto (el carrito la modela por línea) salvo
 *   que la línea traiga su propio modo.
 */
export function scanLineToCartFields(
  item: ExtractedLineItem,
  invoiceIncludesTax: boolean,
): ScanLineCartFields {
  if (scanLineHasTaxes(item)) {
    const taxes = mapScanTaxesToPopLineTaxes(item.taxes!);
    const iva = taxes.find((t) => t.tax_type === 'iva');
    const printedAmount = Number(item.discount_amount_printed) || 0;
    return {
      unit_cost: Number(item.unit_price_gross ?? item.unit_price) || 0,
      // Sólo una de las dos cifras viaja con valor: el monto impreso gana en el
      // carrito y en el backend, así que si existe el % queda en 0.
      discount: printedAmount > 0 ? 0 : clampPct(item.discount_percentage),
      ...(printedAmount > 0 ? { discount_amount: printedAmount } : {}),
      // Espejo legacy de la fila IVA; sin IVA es 0 (nunca `null`, que pediría
      // «Confirma el impuesto» sobre una línea que ya trae sus filas).
      tax_rate: iva ? Number(iva.tax_rate) || 0 : 0,
      prices_include_tax: item.prices_include_tax ?? invoiceIncludesTax,
      taxes,
    };
  }

  return {
    unit_cost: item.unit_price,
    discount: Math.min(
      100,
      Math.max(0, Math.round(Number(item.discount_percentage) || 0)),
    ),
    tax_rate: item.tax_rate != null ? Number(item.tax_rate) * 100 : undefined,
    tax_type: 'iva',
    // SIEMPRE modo adicional en el camino legacy: `unit_price` ya viene neto.
    prices_include_tax: false,
  };
}

/**
 * Adjunto de la OC a partir de lo que el modal confirma. Sin `scan_attachment`
 * en el escaneo (el backend no pudo subir la factura) ⇒ null: la OC se crea sin
 * adjunto en vez de mandar una llave inventada. Los datos de cabecera son los
 * REVISADOS por el operador (número/fecha editados) y el total del escaneo.
 */
export function buildScanAttachment(data: {
  scanResult: Pick<InvoiceScanResult, 'scan_attachment' | 'total'> | null;
  invoiceNumber?: string;
  invoiceDate?: string;
}): PopScanAttachment | null {
  const att = data.scanResult?.scan_attachment;
  if (!att?.key) return null;
  const out: PopScanAttachment = {
    key: att.key,
    file_name: att.file_name,
    file_type: att.file_type,
    file_size: att.file_size,
  };
  if (data.invoiceNumber) out.supplier_invoice_number = data.invoiceNumber;
  if (data.invoiceDate && !Number.isNaN(new Date(data.invoiceDate).getTime())) {
    out.supplier_invoice_date = data.invoiceDate;
  }
  const total = Number(data.scanResult?.total);
  if (Number.isFinite(total) && total > 0) out.supplier_invoice_amount = total;
  return out;
}
