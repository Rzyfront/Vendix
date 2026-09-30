/**
 * Adaptador del contrato OCR v2 de facturas de compra — "la IA transcribe, el
 * código calcula".
 *
 * La IA emite cifras IMPRESAS y clasifica su naturaleza (unidad del descuento,
 * base del precio, tratamiento del impuesto). Este módulo convierte esa forma
 * (v2) a la forma CRUDA v1 que ya entiende `normalizeOcrResponse`, y hace la
 * conversión inversa para mandar el `consolidated_json` a la revalidación.
 *
 * Funciones puras: sin Nest, sin Prisma, sin efectos.
 */

export type InvoiceOcrV2PriceBasis = 'sin_iva' | 'con_iva';
export type InvoiceOcrV2TaxType = 'iva' | 'inc' | 'icui' | 'ibua';
export type InvoiceOcrV2TaxTreatment = 'gravado' | 'exento' | 'excluido';
export type InvoiceOcrV2DiscountKind = 'percent' | 'amount' | 'none';

export interface InvoiceOcrV2LineDiscount {
  kind?: InvoiceOcrV2DiscountKind | null;
  value?: number | null;
  basis?: InvoiceOcrV2PriceBasis | null;
}

export interface InvoiceOcrV2LineTax {
  type?: InvoiceOcrV2TaxType | string | null;
  treatment?: InvoiceOcrV2TaxTreatment | null;
  rate?: number | null;
  fixed_amount_per_unit?: number | null;
  amount?: number | null;
  inclusive?: boolean | null;
}

export interface InvoiceOcrV2Line {
  description?: string | null;
  sku_if_visible?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  price_basis?: InvoiceOcrV2PriceBasis | null;
  discount?: InvoiceOcrV2LineDiscount | null;
  taxes?: InvoiceOcrV2LineTax[] | null;
  is_bonus?: boolean | null;
  printed_line_total?: number | null;
  presentation?: string | null;
  pack_size?: number | null;
  uom_hint?: string | null;
}

export interface InvoiceOcrV2HeaderDiscount {
  kind?: 'percent' | 'amount' | null;
  value?: number | null;
  scope?: 'subtotal' | 'total' | null;
  is_early_payment?: boolean | null;
  label?: string | null;
}

export interface InvoiceOcrV2Raw {
  schema_version?: number | null;
  supplier?: {
    name?: string | null;
    tax_id?: string | null;
    address?: string | null;
    phone?: string | null;
  } | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  currency?: string | null;
  payment_terms?: string | null;
  price_basis?: InvoiceOcrV2PriceBasis | null;
  line_items?: InvoiceOcrV2Line[] | null;
  discounts?: InvoiceOcrV2HeaderDiscount[] | null;
  printed_subtotal?: number | null;
  printed_iva_total?: number | null;
  printed_total?: number | null;
  confidence?: number | null;
}

/** Forma cruda v1 (la que consume `normalizeOcrResponse`); sin tipar a propósito. */
export type InvoiceOcrV1Raw = Record<string, any>;

export interface AdaptInvoiceOcrV2Options {
  /** Decimales de la moneda de la tienda; redondea el dinero derivado de un %. Default 2. */
  decimalPlaces?: number;
}

const isObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** ¿Es una respuesta v2? `schema_version === 2` o alguna línea con `discount` objeto. */
export function isInvoiceOcrV2(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  if (Number(raw.schema_version) === 2) return true;
  return hasV2LineShape(raw);
}

/** Alguna línea trae `discount` como objeto: forma v2 auténtica (no normalizada). */
function hasV2LineShape(raw: Record<string, any>): boolean {
  return (
    Array.isArray(raw.line_items) &&
    raw.line_items.some((li: any) => isObject(li) && isObject(li.discount))
  );
}

/** v2 → forma cruda v1. */
export function adaptInvoiceOcrV2ToV1(
  raw: InvoiceOcrV2Raw,
  options: AdaptInvoiceOcrV2Options = {},
): InvoiceOcrV1Raw {
  const decimals = options.decimalPlaces ?? 2;
  const invoiceIncl = raw.price_basis === 'con_iva';
  const lines = Array.isArray(raw.line_items) ? raw.line_items : [];

  // Σ(quantity × unit_price − descuento de línea) para bases de descuento de
  // pie cuando el documento no imprime subtotal/total.
  let linesBase = 0;

  const line_items = lines.map((li) => {
    const item: InvoiceOcrV2Line = isObject(li) ? li : {};
    const isBonus = item.is_bonus === true;
    const lineIncl = item.price_basis
      ? item.price_basis === 'con_iva'
      : invoiceIncl;

    const unitPrice = isBonus ? 0 : (num(item.unit_price) ?? 0);
    const quantity = num(item.quantity) ?? 0;

    const dKind = item.discount?.kind ?? 'none';
    const dValue = Math.max(0, num(item.discount?.value) ?? 0);
    let discountAmount = 0;
    let discountPct = 0;
    let discountKind: 'percent' | 'amount' | undefined;
    if (!isBonus && dValue > 0) {
      if (dKind === 'percent') {
        discountPct = Math.min(100, dValue);
        discountKind = 'percent';
      } else if (dKind === 'amount') {
        discountAmount = dValue;
        discountKind = 'amount';
      }
    }

    const gross = unitPrice * quantity;
    const lineDiscount =
      discountAmount > 0 ? discountAmount : gross * (discountPct / 100);
    linesBase += Math.max(0, gross - lineDiscount);

    const rawTaxes = Array.isArray(item.taxes) ? item.taxes : [];
    const taxes = rawTaxes
      .filter((t) => isObject(t))
      .map((t) => {
        const type = String(t.type ?? '')
          .trim()
          .toLowerCase();
        const treatment: InvoiceOcrV2TaxTreatment = t.treatment ?? 'gravado';
        const rate = num(t.rate);
        const isIvaInc = type === 'iva' || type === 'inc';
        return {
          type,
          treatment,
          rate: treatment !== 'gravado' ? 0 : rate,
          fixed_amount_per_unit: num(t.fixed_amount_per_unit),
          amount: treatment !== 'gravado' ? null : num(t.amount),
          inclusive:
            typeof t.inclusive === 'boolean'
              ? t.inclusive
              : isIvaInc
                ? lineIncl
                : false,
        };
      });

    const iva = taxes.find((t) => t.type === 'iva');
    let legacyRate: number | null = null;
    if (iva) {
      legacyRate =
        iva.treatment !== 'gravado'
          ? 0
          : iva.rate === null
            ? null
            : iva.rate / 100;
    }

    const printedTotal = num(item.printed_line_total);

    return {
      description: item.description ?? '',
      sku_if_visible: item.sku_if_visible ?? undefined,
      quantity,
      unit_price: unitPrice,
      total: isBonus ? 0 : (printedTotal ?? 0),
      ...(printedTotal !== null && !isBonus
        ? { printed_line_total: printedTotal }
        : {}),
      discount_amount: discountAmount,
      discount_percentage: discountPct,
      ...(discountKind ? { discount_kind: discountKind } : {}),
      taxes,
      tax_rate: legacyRate,
      ...(iva ? { tax_treatment: iva.treatment } : {}),
      ...(isBonus ? { is_bonus: true } : {}),
      // La normalización aplana a neto con la base de ESTA línea, no la de la factura.
      ...(lineIncl !== invoiceIncl ? { line_prices_include_tax: lineIncl } : {}),
      presentation: item.presentation ?? undefined,
      pack_size: item.pack_size ?? undefined,
      uom_hint: item.uom_hint ?? undefined,
    };
  });

  const printedSubtotal = num(raw.printed_subtotal);
  const printedTotal = num(raw.printed_total);
  const money = (n: number) => roundTo(n, decimals);

  let earlyPayment = 0;
  let commercialAmount = 0;
  const commercialPercents: number[] = [];
  let commercialHasAmount = false;

  for (const d of Array.isArray(raw.discounts) ? raw.discounts : []) {
    if (!isObject(d)) continue;
    const value = Math.max(0, num(d.value) ?? 0);
    if (value <= 0) continue;
    const scope = d.scope === 'total' ? 'total' : 'subtotal';

    if (d.is_early_payment === true) {
      earlyPayment +=
        d.kind === 'percent'
          ? money((value / 100) * (printedTotal ?? printedSubtotal ?? linesBase))
          : value;
      continue;
    }

    if (d.kind === 'percent') {
      const base =
        (scope === 'subtotal' ? printedSubtotal : printedTotal) ?? linesBase;
      commercialAmount += money((value / 100) * base);
      commercialPercents.push(value);
    } else if (d.kind === 'amount') {
      commercialAmount += value;
      commercialHasAmount = true;
    }
  }

  const headerKind: 'percent' | 'amount' | undefined =
    commercialPercents.length === 1 && !commercialHasAmount
      ? 'percent'
      : commercialAmount > 0
        ? 'amount'
        : undefined;

  const supplier = isObject(raw.supplier) ? raw.supplier : null;

  return {
    schema_version: 2,
    supplier: supplier
      ? {
          name: supplier.name ?? undefined,
          tax_id: supplier.tax_id ?? undefined,
          address: supplier.address ?? undefined,
          phone: supplier.phone ?? undefined,
        }
      : supplier,
    invoice_number: raw.invoice_number ?? '',
    invoice_date: raw.invoice_date ?? '',
    currency: raw.currency ?? undefined,
    payment_terms: raw.payment_terms ?? undefined,
    prices_include_tax: invoiceIncl,
    line_items,
    subtotal: printedSubtotal,
    tax_amount: num(raw.printed_iva_total),
    total: printedTotal,
    discount_amount: commercialAmount > 0 ? commercialAmount : undefined,
    ...(headerKind === 'percent'
      ? { header_discount_percentage: commercialPercents[0] }
      : {}),
    ...(headerKind ? { header_discount_kind: headerKind } : {}),
    early_payment_discount: earlyPayment > 0 ? earlyPayment : undefined,
    confidence: num(raw.confidence) ?? 0,
  };
}

/**
 * Conversión inversa: datos NORMALIZADOS del escaneo (o crudos v1) → v2, para
 * el `consolidated_json` de la revalidación. Idempotente sobre un v2 auténtico
 * (líneas con `discount` objeto). El descuento de pie viaja como monto: la base
 * de un % (subtotal/total) ya no se conoce tras normalizar.
 */
export function toInvoiceOcrV2Shape(
  input: Record<string, any>,
): InvoiceOcrV2Raw {
  const src = isObject(input) ? input : {};
  if (hasV2LineShape(src)) return src as InvoiceOcrV2Raw;

  const invoiceIncl = src.prices_include_tax === true;
  const lines = Array.isArray(src.line_items) ? src.line_items : [];

  const line_items: InvoiceOcrV2Line[] = lines.map((li: any) => {
    const item = isObject(li) ? li : {};

    const printedPrice = num(item.unit_price_gross) ?? num(item.unit_price) ?? 0;
    const amountPrinted =
      num(item.discount_amount_printed) ?? num(item.discount_amount) ?? 0;
    const pct = num(item.discount_percentage) ?? 0;

    let kind: InvoiceOcrV2DiscountKind = 'none';
    if (item.discount_kind === 'percent' && pct > 0) kind = 'percent';
    else if (item.discount_kind === 'amount' && amountPrinted > 0)
      kind = 'amount';
    else if (amountPrinted > 0) kind = 'amount';
    else if (pct > 0) kind = 'percent';
    const value =
      kind === 'percent' ? pct : kind === 'amount' ? amountPrinted : 0;

    const rawTaxes: any[] = Array.isArray(item.taxes) ? item.taxes : [];
    let taxes: InvoiceOcrV2LineTax[] = rawTaxes
      .filter((t) => isObject(t))
      .map((t) => {
        const type = String(t.tax_type ?? t.type ?? '').toLowerCase();
        const rate = num(t.tax_rate ?? t.rate);
        const inclusive =
          typeof t.is_inclusive === 'boolean'
            ? t.is_inclusive
            : typeof t.inclusive === 'boolean'
              ? t.inclusive
              : null;
        let treatment: InvoiceOcrV2TaxTreatment = 'gravado';
        if (type === 'iva') {
          treatment =
            item.tax_treatment === 'exento' || item.tax_treatment === 'excluido'
              ? item.tax_treatment
              : rate === 0
                ? 'exento'
                : 'gravado';
        }
        return {
          type: type as InvoiceOcrV2TaxType,
          treatment,
          rate,
          fixed_amount_per_unit: num(t.fixed_amount_per_unit),
          amount: num(t.amount_override ?? t.amount),
          inclusive,
        };
      });

    if (taxes.length === 0) {
      const legacy = num(item.tax_rate);
      if (legacy !== null) {
        const pctRate = legacy > 0 && legacy <= 1 ? legacy * 100 : legacy;
        taxes = [
          {
            type: 'iva',
            treatment:
              item.tax_treatment === 'excluido'
                ? 'excluido'
                : pctRate === 0
                  ? 'exento'
                  : 'gravado',
            rate: pctRate,
            fixed_amount_per_unit: null,
            amount: null,
            inclusive: null,
          },
        ];
      }
    }

    // Base propia de la línea: solo si algún IVA/INC declara una base distinta de la factura.
    const pctTaxes = taxes.filter(
      (t) => (t.type === 'iva' || t.type === 'inc') && t.inclusive !== null,
    );
    const lineIncl =
      pctTaxes.length > 0 && pctTaxes.every((t) => t.inclusive === true)
        ? true
        : pctTaxes.length > 0 && pctTaxes.every((t) => t.inclusive === false)
          ? false
          : invoiceIncl;
    const lineBasis: InvoiceOcrV2PriceBasis | null =
      lineIncl !== invoiceIncl
        ? lineIncl
          ? 'con_iva'
          : 'sin_iva'
        : null;

    const printedTotal = num(item.printed_line_total) ?? num(item.total);

    return {
      description: item.description ?? '',
      sku_if_visible: item.sku_if_visible ?? null,
      quantity: num(item.quantity) ?? 0,
      unit_price: printedPrice,
      price_basis: lineBasis,
      discount: { kind, value, basis: null },
      taxes,
      is_bonus: item.is_bonus === true,
      printed_line_total:
        printedTotal !== null && printedTotal > 0 ? printedTotal : null,
      presentation: item.presentation ?? null,
      pack_size: num(item.pack_size),
      uom_hint: item.uom_hint ?? null,
    };
  });

  const discounts: InvoiceOcrV2HeaderDiscount[] = [];
  const headerMoney =
    num(src.discount_amount_printed) ?? num(src.discount_amount) ?? 0;
  if (headerMoney > 0) {
    const pct = num(src.header_discount_percentage);
    discounts.push({
      kind: 'amount',
      value: headerMoney,
      scope: 'total',
      is_early_payment: false,
      label:
        src.header_discount_kind === 'percent' && pct !== null
          ? `${pct} %`
          : null,
    });
  }
  const early = num(src.early_payment_discount) ?? 0;
  if (early > 0) {
    discounts.push({
      kind: 'amount',
      value: early,
      scope: 'total',
      is_early_payment: true,
      label: null,
    });
  }

  const supplier = isObject(src.supplier) ? src.supplier : {};

  return {
    schema_version: 2,
    supplier: {
      name: supplier.name ?? '',
      tax_id: supplier.tax_id ?? null,
      address: supplier.address ?? null,
      phone: supplier.phone ?? null,
    },
    invoice_number: src.invoice_number ?? '',
    invoice_date: src.invoice_date ?? '',
    currency: src.currency ?? undefined,
    payment_terms: src.payment_terms ?? null,
    price_basis: invoiceIncl ? 'con_iva' : 'sin_iva',
    line_items,
    discounts,
    printed_subtotal: num(src.subtotal),
    printed_iva_total: num(src.tax_amount),
    printed_total: num(src.total),
    confidence: num(src.confidence) ?? 0,
  };
}
