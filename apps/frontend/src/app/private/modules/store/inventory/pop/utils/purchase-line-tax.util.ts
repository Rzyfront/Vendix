/**
 * Derivación fiscal de una línea de compra — QUI-855.
 *
 * TODO el cálculo de impuestos vive en el kernel puro `resolvePurchaseLineTaxes`
 * (`apps/backend/src/common/money-kernel/purchase-line-taxes.ts`, el mismo que
 * usa el backend). Este archivo NO tiene matemática de impuestos propia: sólo
 * traduce la línea del carrito (descuento %, `tax_rate` legacy, `taxes[]`) a la
 * entrada del kernel y devuelve su resultado con la forma que ya consumían el
 * carrito, el resumen y el modal del escáner.
 *
 * El backend sigue siendo la única autoridad sobre lo que se persiste; esto es
 * el preview que muestra ESA misma cifra antes de enviarla.
 *
 * Regla de negocio (QUI-661): el descuento comercial se resta del BRUTO antes
 * del split de impuestos (reduce la base gravable).
 */
import { resolvePurchaseLineTaxes } from '@money-kernel/purchase-line-taxes';
import type {
  PurchaseLineTaxInput as KernelTaxInput,
  PurchaseTaxBaseMode,
  PurchaseTaxCalcMode,
  PurchaseTaxType,
  ResolvedPurchaseLine,
} from '@money-kernel/purchase-line-taxes';
import type { PopLineTax } from '../interfaces/pop-cart.interface';

const TAX_TYPES: ReadonlySet<string> = new Set(['iva', 'inc', 'icui', 'ibua']);

/** Línea mínima que la derivación necesita. Compatible con `PopCartItem`, `MatchedLineItem` y el DTO. */
export interface PurchaseLineTaxInput {
  /** Precio unitario BRUTO (antes de descuento y antes del split de impuestos). */
  unit_price?: number | null;
  /** Alias de `unit_price` — el carrito lo llama `unit_cost`. */
  unit_cost?: number | null;
  quantity?: number | null;
  /** PORCENTAJE (19 = 19%), nunca fracción. Par legacy: se vuelve una fila IVA si no hay `taxes`. */
  tax_rate?: number | null;
  /** Clasificación del par legacy (default 'iva'). Un valor fuera del kernel cae a 'iva'. */
  tax_type?: string | null;
  /** Override por línea del modo de cabecera (facturas mixtas). */
  prices_include_tax?: boolean | null;
  /** Descuento propio de la línea en PORCENTAJE. */
  discount_percentage?: number | null;
  /** Descuento propio de la línea en DINERO. Gana sobre el porcentaje. */
  discount_amount?: number | null;
  /** N impuestos de la línea. Cuando tiene elementos REEMPLAZA al par legacy. */
  taxes?: PopLineTax[] | null;
}

/** Un impuesto derivado por línea (montos del kernel). */
export interface PurchaseDerivedTax {
  tax_rate: number;
  tax_type: PurchaseTaxType;
  tax_rate_id: number | null;
  tax_name: string | null;
  calc_mode: PurchaseTaxCalcMode;
  fixed_amount_per_unit: number | null;
  base_mode: PurchaseTaxBaseMode;
  sequence: number;
  is_inclusive: boolean;
  add_to_cost: boolean;
  taxable_amount: number;
  /** Monto que dio la fórmula. */
  computed_amount: number;
  /** Monto final de la línea (override del proveedor si lo hay). */
  tax_amount: number;
  override_delta: number;
}

export interface PurchaseLineTaxResult {
  /** Precio unitario NETO tras descuento y sin impuestos incluidos. */
  unit_price_net: number;
  tax_amount_per_unit: number;
  /** Impuestos totales de la línea. */
  tax_amount: number;
  effective_include: boolean;
  /** Descuento total aplicado a la línea (propio + prorrateo de cabecera), en dinero. */
  discount_total: number;
  /** Bruto de la línea antes de descuento: `unit_price × quantity`. */
  gross_line: number;
  /** Base gravable de la línea. */
  net_line: number;
  /** Total de la línea: base gravable + impuestos. */
  total_line: number;
}

export interface PurchaseLineTaxesResult extends PurchaseLineTaxResult {
  taxes: PurchaseDerivedTax[];
  capitalized_per_unit: number;
  deductible_per_unit: number;
  /** Σ impuestos que capitalizan al costo. */
  capitalized_tax_total: number;
  /** Costo capitalizable de la línea: neto + impuestos al costo. */
  cost_total: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Entrada de impuestos del kernel a partir de la línea: las filas `taxes[]` si
 * las hay; si no, UNA fila IVA armada con el `tax_rate` legacy. Tasas negativas
 * o no finitas se sanean a 0 (el kernel las rechazaría con throw).
 */
export function toKernelTaxes(item: PurchaseLineTaxInput): KernelTaxInput[] {
  if (item.taxes && item.taxes.length > 0) {
    return item.taxes.map((t) => {
      const fixed = t.fixed_amount_per_unit;
      return {
        tax_type: t.tax_type,
        tax_rate_id: t.tax_rate_id ?? null,
        tax_name: t.tax_name ?? null,
        calc_mode: t.calc_mode,
        rate: Math.max(0, num(t.tax_rate)),
        fixed_amount_per_unit:
          fixed === null || fixed === undefined ? null : Math.max(0, num(fixed)),
        base_mode: t.base_mode,
        sequence: t.sequence,
        is_inclusive: t.is_inclusive,
        add_to_cost: t.add_to_cost,
        amount_override:
          t.amount_override === null || t.amount_override === undefined
            ? null
            : Math.max(0, num(t.amount_override)),
      };
    });
  }
  const legacyType: PurchaseTaxType = TAX_TYPES.has(item.tax_type ?? '')
    ? (item.tax_type as PurchaseTaxType)
    : 'iva';
  return [{ tax_type: legacyType, rate: Math.max(0, num(item.tax_rate)) }];
}

const EMPTY_KERNEL_LINE = (
  gross: number,
  quantity: number,
): ResolvedPurchaseLine => ({
  gross_line: gross,
  net_total: gross,
  net_unit: quantity > 0 ? gross / quantity : 0,
  taxes: [],
  tax_total: 0,
  capitalized_tax_total: 0,
  non_capitalized_tax_total: 0,
  inclusive_tax_total: 0,
  exclusive_tax_total: 0,
  line_total: gross,
  cost_total: gross,
  iva: null,
});

/**
 * Resuelve la línea con el kernel. Cantidad <= 0 o una combinación que el
 * kernel rechaza (p. ej. IBUA incluido mayor que el bruto) devuelve la línea
 * SIN impuestos en vez de romper el render del carrito: es un preview y el
 * backend valida de nuevo al persistir.
 */
function resolveWithKernel(
  item: PurchaseLineTaxInput,
  effectiveInclude: boolean,
  unitPrice: number,
  quantity: number,
  discountTotal: number,
): ResolvedPurchaseLine {
  const rawGross = round2(unitPrice * quantity);
  if (!(quantity > 0)) return EMPTY_KERNEL_LINE(0, 0);
  try {
    return resolvePurchaseLineTaxes({
      unit_price: unitPrice,
      quantity,
      discount_amount: discountTotal,
      prices_include_tax: effectiveInclude,
      taxes: toKernelTaxes(item),
    });
  } catch {
    return EMPTY_KERNEL_LINE(
      Math.max(0, round2(rawGross - discountTotal)),
      quantity,
    );
  }
}

/**
 * Deriva una línea (descuento → kernel). `proratedHeaderDiscount` viaja como
 * argumento explícito para que ningún llamador lo cuente dos veces dejándolo
 * también dentro de `discount_amount`.
 */
export function deriveLineTaxes(
  item: PurchaseLineTaxInput,
  header: { prices_include_tax?: boolean | null },
  proratedHeaderDiscount = 0,
): PurchaseLineTaxesResult {
  const unitPrice = num(item.unit_price ?? item.unit_cost);
  const quantity = num(item.quantity);
  const effective_include =
    item.prices_include_tax ?? header.prices_include_tax ?? false;
  const rawGross = round2(unitPrice * quantity);

  // `discount_amount` gana sobre `discount_percentage`: la cifra en dinero es la
  // que se persiste y la que lee la contabilidad.
  const ownDiscount =
    item.discount_amount != null && num(item.discount_amount) > 0
      ? num(item.discount_amount)
      : round2(rawGross * (num(item.discount_percentage) / 100));

  // Un descuento nunca puede volver la línea negativa (costo negativo
  // envenena la capa FIFO): se topa al bruto.
  const discount_total = quantity > 0
    ? Math.min(rawGross, Math.max(0, ownDiscount + num(proratedHeaderDiscount)))
    : 0;

  const r = resolveWithKernel(
    item,
    effective_include,
    unitPrice,
    quantity,
    discount_total,
  );

  const taxes: PurchaseDerivedTax[] = r.taxes.map((t) => ({
    tax_rate: t.rate ?? 0,
    tax_type: t.tax_type,
    tax_rate_id: t.tax_rate_id,
    tax_name: t.tax_name,
    calc_mode: t.calc_mode,
    fixed_amount_per_unit: t.fixed_amount_per_unit,
    base_mode: t.base_mode,
    sequence: t.sequence,
    is_inclusive: t.is_inclusive,
    add_to_cost: t.add_to_cost,
    taxable_amount: t.taxable_amount,
    computed_amount: t.computed_amount,
    tax_amount: t.tax_amount,
    override_delta: t.override_delta,
  }));

  const perUnit = (n: number): number => (quantity > 0 ? n / quantity : 0);
  return {
    unit_price_net: quantity > 0 ? r.net_unit : unitPrice,
    tax_amount_per_unit: perUnit(r.tax_total),
    tax_amount: r.tax_total,
    effective_include,
    discount_total: quantity > 0 ? round2(discount_total) : 0,
    gross_line: rawGross,
    net_line: r.net_total,
    total_line: r.line_total,
    taxes,
    capitalized_per_unit: perUnit(r.capitalized_tax_total),
    deductible_per_unit: perUnit(r.non_capitalized_tax_total),
    capitalized_tax_total: r.capitalized_tax_total,
    cost_total: r.cost_total,
  };
}

/**
 * Deriva una línea con el par legacy o con `taxes[]` (misma ruta: el kernel).
 * Se conserva con este nombre para los consumidores que sólo necesitan el
 * resultado base (escáner de facturas, carrito).
 */
export function deriveLineTax(
  item: PurchaseLineTaxInput,
  header: { prices_include_tax?: boolean | null },
  proratedHeaderDiscount = 0,
): PurchaseLineTaxResult {
  return deriveLineTaxes(item, header, proratedHeaderDiscount);
}

/**
 * Espejo de `PurchaseOrdersService.prorateHeaderDiscount`.
 *
 * El descuento de cabecera no puede quedarse en la cabecera: las capas de costo
 * FIFO se escriben por línea, así que una cifra que sólo vive en
 * `purchase_orders.discount_amount` no tiene forma física de llegar al costo del
 * producto.
 *
 * El residuo de redondeo cae en la ÚLTIMA línea CON BRUTO > 0 para que
 * `Σ prorrateado === headerDiscount` exacto y el total de la orden no derive un
 * centavo contra lo que facturó el proveedor (QUI-855: una bonificación de
 * precio 0 nunca absorbe residuo).
 */
export function prorateHeaderDiscount(
  items: Array<Pick<PurchaseLineTaxInput, 'unit_price' | 'unit_cost' | 'quantity'>>,
  headerDiscount: number,
): number[] {
  const shares = new Array(items.length).fill(0);
  const discount = Number(headerDiscount || 0);
  if (!(discount > 0) || items.length === 0) return shares;

  const grossPerLine = items.map(
    (i) => (Number(i.unit_price ?? i.unit_cost ?? 0) || 0) * (Number(i.quantity ?? 0) || 0),
  );
  const grossTotal = grossPerLine.reduce((s, v) => s + v, 0);
  // Un descuento sobre una orden de valor cero no tiene a qué agarrarse;
  // descartarlo es más seguro que dividir por cero y emitir NaN al motor de costo.
  if (!(grossTotal > 0)) return shares;

  // Nunca descontar más de lo que vale la orden.
  const effective = Math.min(discount, grossTotal);

  // QUI-855 (regalo): el residuo va a la última línea con bruto > 0, nunca
  // a una bonificación (precio 0). Espejo del backend.
  let lastPaying = items.length - 1;
  while (lastPaying > 0 && !(grossPerLine[lastPaying] > 0)) lastPaying--;
  let assigned = 0;
  for (let i = 0; i < items.length; i++) {
    if (i === lastPaying) continue;
    shares[i] = round2((grossPerLine[i] / grossTotal) * effective);
    assigned += shares[i];
  }
  shares[lastPaying] = round2(effective - assigned);
  return shares;
}

export interface PurchaseTotals {
  /** Σ bruto antes de cualquier descuento. */
  gross_subtotal: number;
  /** Σ descuentos propios de línea. */
  line_discount: number;
  /** Descuento de cabecera efectivamente aplicado (topado al bruto). */
  header_discount: number;
  /** Σ descuentos (línea + cabecera). */
  discount_amount: number;
  /** Base gravable tras descuentos. */
  subtotal: number;
  tax_amount: number;
  shipping_cost: number;
  total: number;
}

/**
 * Totales de un conjunto de líneas, con el descuento de cabecera prorrateado
 * exactamente como lo hará el backend al persistir.
 *
 * Es el único punto donde se suman líneas. Cualquier vista —modal del escáner,
 * carrito, resumen— consume esto en vez de sumar por su cuenta, que es como el
 * pie del modal terminó contradiciendo a sus propias filas.
 */
export function derivePurchaseTotals(
  items: PurchaseLineTaxInput[],
  header: { prices_include_tax?: boolean | null },
  headerDiscount = 0,
  shippingCost = 0,
): PurchaseTotals {
  const shares = prorateHeaderDiscount(items, headerDiscount);

  let gross_subtotal = 0;
  let subtotal = 0;
  let tax_amount = 0;
  let discount_amount = 0;

  items.forEach((item, i) => {
    const d = deriveLineTaxes(item, header, shares[i]);
    gross_subtotal += d.gross_line;
    subtotal += d.net_line;
    tax_amount += d.tax_amount;
    discount_amount += d.discount_total;
  });

  const header_discount = shares.reduce((s, v) => s + v, 0);
  const shipping = Number(shippingCost) || 0;

  return {
    gross_subtotal: round2(gross_subtotal),
    line_discount: round2(discount_amount - header_discount),
    header_discount: round2(header_discount),
    discount_amount: round2(discount_amount),
    subtotal: round2(subtotal),
    tax_amount: round2(tax_amount),
    shipping_cost: shipping,
    total: round2(round2(subtotal) + round2(tax_amount) + shipping),
  };
}
