import { resolveInclusiveClearing } from '../../invoicing/utils/dian-money.util';

/**
 * IMPUESTO OPCIONAL POR TARIFA DE ENVÍO — definición única (pura).
 *
 * Decisiones del dueño (contrato `shipping-rate-tax`):
 * - Cada `shipping_rates` puede llevar una `tax_categories` (null = sin
 *   impuesto, el default).
 * - Cada tarifa declara su MODO (`shipping_rates.tax_is_inclusive`): INCLUIDO
 *   (bruto = precio de tarifa; $15.000 con INC 8 % = base 13.888,89 + INC
 *   1.111,11) o AGREGADO (bruto = base + trunc(base·r); $10.000 con IVA 19 %
 *   = 10.000 + 1.900 = $11.900). Se IGNORA el `is_inclusive` de la categoría:
 *   el modo vive en la tarifa. `resolveShippingCharge` es el punto único
 *   "precio de tarifa → bruto"; si el impuesto no aplica, bruto = precio.
 * - La orden guarda una COPIA congelada (`orders.shipping_tax_*`); editar la
 *   tarifa o la categoría después no toca las órdenes existentes.
 *
 * Elegibilidad de la categoría (misma función al configurar y al vender):
 * - `tax_type` ∈ {iva, inc}. Una categoría SIN tipo es IVA — se resuelve aquí,
 *   en la fila de origen, nunca con `?? 'iva'` al escribir (skill
 *   vendix-tax-typing).
 * - Exactamente UNA tasa > 0. Con varias, elegir una sería inventarla.
 *
 * Pura: sin DB, sin logger. El servicio (`shipping-tax.service.ts`) carga la
 * tarifa, resuelve la responsabilidad del emisor y registra los avisos.
 */

/** Tipos fiscales que puede llevar el envío. */
export type ShippingTaxType = 'iva' | 'inc';

export const SHIPPING_TAX_TYPES: readonly ShippingTaxType[] = ['iva', 'inc'];

/** Copia con impuesto: `shipping_tax_type` es OBLIGATORIO en el tipo. */
export interface AppliedShippingTax {
  shipping_tax_rate_id: number;
  shipping_tax_name: string;
  shipping_tax_type: ShippingTaxType;
  /** Fracción (0.08 = 8 %), misma unidad que `order_item_taxes.tax_rate`. */
  shipping_tax_rate: number;
  /** Impuesto incluido en `shipping_cost`, a centavos. */
  shipping_tax_amount: number;
}

/** Copia vacía: el envío no lleva impuesto. */
export interface EmptyShippingTax {
  shipping_tax_rate_id: null;
  shipping_tax_name: null;
  shipping_tax_type: null;
  shipping_tax_rate: null;
  shipping_tax_amount: 0;
}

/** Bloque `data` listo para `prisma.orders.create/update`. */
export type ShippingTaxSnapshot = AppliedShippingTax | EmptyShippingTax;

/** Copia vacía canónica. Congelada para que nadie la mute por referencia. */
export const EMPTY_SHIPPING_TAX: EmptyShippingTax = Object.freeze({
  shipping_tax_rate_id: null,
  shipping_tax_name: null,
  shipping_tax_type: null,
  shipping_tax_rate: null,
  shipping_tax_amount: 0,
}) as EmptyShippingTax;

/** Lo mínimo que se lee de una categoría y sus tasas. */
export interface ShippingTaxCategoryInput {
  id?: number | null;
  name?: string | null;
  tax_type?: string | null;
  tax_rates?: ReadonlyArray<{
    id: number;
    name?: string | null;
    rate: unknown;
  }> | null;
}

export type ShippingTaxIneligibleReason =
  | 'unsupported_tax_type'
  | 'no_positive_rate'
  | 'multiple_positive_rates'
  | 'rate_out_of_range';

export type ShippingTaxCategoryEvaluation =
  | {
      eligible: true;
      tax_type: ShippingTaxType;
      rate: { id: number; name: string; fraction: number };
      /** Tarifa en porcentaje (8, 19) para mostrar. */
      rate_percent: number;
    }
  | {
      eligible: false;
      reason_code: ShippingTaxIneligibleReason;
      /** Motivo en español, listo para mostrar. */
      reason: string;
      /** Tipo resuelto de la fila (sin tipo ⇒ 'iva'), aunque no sea elegible. */
      tax_type: string;
      /** Porcentaje si la categoría tiene una sola tasa > 0; si no, null. */
      rate_percent: number | null;
    };

/** Fracción ⇒ porcentaje sin polvo float (0.08 ⇒ 8, 0.19 ⇒ 19). */
export function fractionToPercent(fraction: number): number {
  return Math.round(fraction * 100 * 10000) / 10000;
}

/** Tipo fiscal de la fila de origen: sin tipo ⇒ IVA (regla tax-typing). */
export function resolveCategoryTaxType(tax_type: string | null | undefined): string {
  const normalized = String(tax_type ?? '').trim().toLowerCase();
  return normalized === '' ? 'iva' : normalized;
}

function isShippingTaxType(value: string): value is ShippingTaxType {
  return (SHIPPING_TAX_TYPES as readonly string[]).includes(value);
}

/**
 * ¿Puede esta categoría gravar un envío? Única definición: la usan la
 * validación de configuración (400 con el motivo), las opciones del wizard y
 * el resolutor de la copia al vender.
 */
export function evaluateShippingTaxCategory(
  category: ShippingTaxCategoryInput,
): ShippingTaxCategoryEvaluation {
  const tax_type = resolveCategoryTaxType(category.tax_type);
  const positive = (category.tax_rates ?? [])
    .map((r) => ({ id: r.id, name: r.name ?? '', fraction: Number(r.rate) }))
    .filter((r) => Number.isFinite(r.fraction) && r.fraction > 0);
  const single_percent =
    positive.length === 1 ? fractionToPercent(positive[0].fraction) : null;

  if (!isShippingTaxType(tax_type)) {
    return {
      eligible: false,
      reason_code: 'unsupported_tax_type',
      reason:
        'Solo se pueden usar categorías de IVA o INC para el envío. Las retenciones e ICA no aplican.',
      tax_type,
      rate_percent: single_percent,
    };
  }
  if (positive.length === 0) {
    return {
      eligible: false,
      reason_code: 'no_positive_rate',
      reason: 'La categoría no tiene una tarifa mayor a 0 %.',
      tax_type,
      rate_percent: null,
    };
  }
  if (positive.length > 1) {
    return {
      eligible: false,
      reason_code: 'multiple_positive_rates',
      reason:
        'La categoría tiene más de una tarifa. Para el envío debe tener exactamente una.',
      tax_type,
      rate_percent: null,
    };
  }
  const rate = positive[0];
  // `tax_rates.rate` es fracción (Decimal(6,5)). >= 1 sería un 100 % o una
  // tarifa guardada como porcentaje: unidad ambigua, no se inventa.
  if (rate.fraction >= 1) {
    return {
      eligible: false,
      reason_code: 'rate_out_of_range',
      reason: 'La tarifa de la categoría está fuera de rango (debe ser menor a 100 %).',
      tax_type,
      rate_percent: single_percent,
    };
  }
  return {
    eligible: true,
    tax_type,
    rate: {
      id: rate.id,
      name: rate.name || category.name || tax_type.toUpperCase(),
      fraction: rate.fraction,
    },
    rate_percent: fractionToPercent(rate.fraction),
  };
}

export type ShippingTaxSkipReason =
  | 'no_category'
  | 'no_shipping'
  | ShippingTaxIneligibleReason
  | 'vat_not_responsible'
  /**
   * Defensivo: el kernel rechazó la entrada o la cuota trunca a cero (bruto de
   * pocos centavos). NO se usa por brutos que no cierran exacto: esos se
   * gravan con base = bruto − impuesto.
   */
  | 'clearing_unclosed';

export interface ShippingTaxSnapshotInput {
  /** Lo que paga el cliente por el envío (= `orders.shipping_cost`). */
  shipping_cost: unknown;
  /** Categoría de la tarifa con sus tasas; null/undefined ⇒ sin impuesto. */
  category: ShippingTaxCategoryInput | null | undefined;
  /**
   * Responsabilidad de IVA del emisor AL VENDER. Solo se consulta si la
   * categoría es IVA. Omitido ⇒ no se evalúa (el llamador ya lo resolvió).
   */
  vat_responsible?: boolean;
}

export type ShippingTaxResolution =
  | {
      applies: true;
      snapshot: AppliedShippingTax;
      /** Bruto redondeado a centavos. `gross = base + shipping_tax_amount`. */
      gross: number;
      /** Base neta = bruto − impuesto (cierra al centavo por construcción). */
      base: number;
    }
  | {
      applies: false;
      reason: ShippingTaxSkipReason;
      snapshot: EmptyShippingTax;
    };

const skip = (reason: ShippingTaxSkipReason): ShippingTaxResolution => ({
  applies: false,
  reason,
  snapshot: { ...EMPTY_SHIPPING_TAX },
});

/**
 * Resuelve la copia del impuesto del envío a partir del BRUTO. Siempre despeja
 * en modo incluido — también para tarifas agregadas, cuyo bruto ya trae el
 * impuesto sumado por `resolveShippingCharge` (f(B) = B + trunc(B·r) es
 * estrictamente creciente, así que el despeje recupera exactamente B).
 *
 * REGLA (nunca copia vacía por redondeo):
 *   · impuesto = cuota del kernel (`resolveInclusiveClearing`, el mismo de la
 *     factura): truncado DIAN de `bruto × r ÷ (1 + r)`.
 *   · base     = bruto − impuesto, en centavos enteros. Cierra por
 *     construcción: `base + impuesto = bruto` al centavo, siempre.
 *
 * Hay brutos que ninguna base a 2 decimales reproduce exactamente con
 * `base × r` (p. ej. 10.000 al 19 %): el kernel los marca como no cerrados.
 * No se deja de gravar por eso: la diferencia `base × r − impuesto` queda en
 * a lo sumo un centavo, dentro de la holgura de línea DIAN (±2.00, Anexo 1.9
 * §5.2.1.1 — FAX07) y de la tolerancia de un centavo del prevalidador
 * (`checkTaxSubtotals`). Lo que paga el cliente no se mueve.
 */
export function resolveShippingTaxSnapshot(
  input: ShippingTaxSnapshotInput,
): ShippingTaxResolution {
  if (!input.category) return skip('no_category');

  const raw = Number(input.shipping_cost ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return skip('no_shipping');
  const gross_cents = Math.round(raw * 100);
  if (gross_cents <= 0) return skip('no_shipping');
  const gross = gross_cents / 100;

  const evaluation = evaluateShippingTaxCategory(input.category);
  if (!evaluation.eligible) return skip(evaluation.reason_code);

  if (evaluation.tax_type === 'iva' && input.vat_responsible === false) {
    return skip('vat_not_responsible');
  }

  const clearing = resolveInclusiveClearing(gross, [
    {
      rate: evaluation.rate.fraction,
      rate_basis: 'fraction',
      is_inclusive: true,
    },
  ]);
  const amount_cents = Math.round(
    (clearing.rates[0]?.amount.toNumber() ?? 0) * 100,
  );
  const base_cents = gross_cents - amount_cents;
  // Defensivo: entrada que el kernel rechaza, o bruto tan chico que la cuota
  // trunca a cero (o se come toda la base). Gravar ahí no tiene sentido.
  if (
    clearing.invalid_inputs.length > 0 ||
    amount_cents <= 0 ||
    base_cents <= 0
  ) {
    return skip('clearing_unclosed');
  }
  const amount = amount_cents / 100;
  const base = base_cents / 100;

  return {
    applies: true,
    gross,
    base,
    snapshot: {
      shipping_tax_rate_id: evaluation.rate.id,
      shipping_tax_name: evaluation.rate.name,
      shipping_tax_type: evaluation.tax_type,
      shipping_tax_rate: evaluation.rate.fraction,
      shipping_tax_amount: amount,
    },
  };
}

/**
 * Precio configurado de una tarifa (`shipping_rates.price`), en unidades
 * comerciales. En modo INCLUIDO es el bruto que paga el cliente; en modo
 * AGREGADO es la base sobre la que se liquida el impuesto. Tipo separado de
 * `ChargedShippingCost` para que ningún productor confunda el precio
 * configurado con lo que paga el cliente.
 */
export type RatePrice = number;

export type ShippingChargeSkipReason =
  | 'no_category'
  | 'no_price'
  | ShippingTaxIneligibleReason
  | 'vat_not_responsible'
  | 'inc_not_responsible'
  | 'clearing_unclosed';

/** Modo de la tarifa que produjo el cobro cuando el impuesto aplica. */
export type ShippingChargeMode = 'inclusive' | 'exclusive';

export interface ResolveShippingChargeInput {
  /** Precio de la tarifa (`RatePrice`); en agregado es la base, en incluido el bruto. */
  rate_price: unknown;
  /** Categoría de la tarifa con sus tasas; null/undefined ⇒ sin impuesto. */
  category: ShippingTaxCategoryInput | null | undefined;
  /** Modo de la tarifa (`shipping_rates.tax_is_inclusive`). */
  tax_is_inclusive: boolean;
  /**
   * Responsabilidad de IVA del emisor AL VENDER. Solo se consulta si la
   * categoría es IVA. Omitida ⇒ no se evalúa (el llamador ya la resolvió).
   */
  vat_responsible?: boolean;
  /**
   * Responsabilidad de INC del emisor AL VENDER. Solo se consulta si la
   * categoría es INC. Omitida ⇒ no se evalúa (el llamador ya la resolvió).
   */
  inc_responsible?: boolean;
}

/**
 * Costo de envío cobrado al cliente (= `orders.shipping_cost`, siempre el
 * BRUTO). Cuando el impuesto no aplica, bruto = precio de tarifa: nunca hay
 * recargo sin impuesto registrado.
 */
export type ChargedShippingCost =
  | {
      applies: true;
      /** Lo que paga el cliente por el envío. */
      gross: number;
      /** Base neta = bruto − impuesto. */
      base: number;
      /** Impuesto a registrar en la copia. */
      tax: number;
      reason: ShippingChargeMode;
    }
  | {
      applies: false;
      gross: number;
      base: number;
      tax: 0;
      reason: ShippingChargeSkipReason;
    };

const noCharge = (
  reason: ShippingChargeSkipReason,
  price: number,
): ChargedShippingCost => ({
  applies: false,
  gross: price,
  base: price,
  tax: 0,
  reason,
});

/**
 * Cálculo único "precio de tarifa → bruto". Punto único donde el costo SALE
 * de la tarifa; lo consumen cotización, checkout/WhatsApp, POS,
 * `assignShipping`, `shipOrder` y el editor para cobrar todos lo mismo.
 *
 * REGLA:
 *   · incluido ⇒ bruto = precio de tarifa (el impuesto se despeja del bruto
 *     con `resolveShippingTaxSnapshot`, el mismo de la factura).
 *   · agregado ⇒ bruto = base + trunc(base·r) con
 *     `resolveInclusiveClearing(is_inclusive:false)`, el mismo kernel de las
 *     líneas exclusivas de producto.
 *   · si el impuesto no aplica (emisor sin O-48/O-33 según el tipo, categoría
 *     no elegible, sin categoría o sin precio) ⇒ bruto = precio de tarifa.
 */
export function resolveShippingCharge(
  input: ResolveShippingChargeInput,
): ChargedShippingCost {
  const raw = Number(input.rate_price ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { applies: false, gross: 0, base: 0, tax: 0, reason: 'no_price' };
  }
  const price_cents = Math.round(raw * 100);
  if (price_cents <= 0) {
    return { applies: false, gross: 0, base: 0, tax: 0, reason: 'no_price' };
  }
  const price = price_cents / 100;

  if (!input.category) return noCharge('no_category', price);

  const evaluation = evaluateShippingTaxCategory(input.category);
  if (!evaluation.eligible) return noCharge(evaluation.reason_code, price);

  if (evaluation.tax_type === 'iva' && input.vat_responsible === false) {
    return noCharge('vat_not_responsible', price);
  }
  if (evaluation.tax_type === 'inc' && input.inc_responsible === false) {
    return noCharge('inc_not_responsible', price);
  }

  if (input.tax_is_inclusive !== false) {
    const resolution = resolveShippingTaxSnapshot({
      shipping_cost: price,
      category: input.category,
      vat_responsible: input.vat_responsible,
    });
    if (resolution.applies) {
      return {
        applies: true,
        gross: resolution.gross,
        base: resolution.base,
        tax: resolution.snapshot.shipping_tax_amount,
        reason: 'inclusive',
      };
    }
    // `no_shipping` es inalcanzable con precio > 0 ya validado, pero el tipo
    // de la resolución lo permite: se mapea al motivo de este camino.
    const reason =
      resolution.reason === 'no_shipping' ? 'no_price' : resolution.reason;
    return noCharge(reason, price);
  }

  const clearing = resolveInclusiveClearing(price, [
    {
      rate: evaluation.rate.fraction,
      rate_basis: 'fraction',
      is_inclusive: false,
    },
  ]);
  const tax_cents = Math.round(
    (clearing.rates[0]?.amount.toNumber() ?? 0) * 100,
  );
  // Defensivo: entrada que el kernel rechaza, o base tan chica que la cuota
  // trunca a cero. Sin impuesto registrado no hay recargo.
  if (clearing.invalid_inputs.length > 0 || tax_cents <= 0) {
    return noCharge('clearing_unclosed', price);
  }
  return {
    applies: true,
    gross: (price_cents + tax_cents) / 100,
    base: price,
    tax: tax_cents / 100,
    reason: 'exclusive',
  };
}

/** Lo mínimo que se lee de una orden para derivar la fila de desglose. */
export interface ShippingTaxOrderInput {
  shipping_cost?: unknown;
  shipping_tax_type?: string | null;
  shipping_tax_rate?: unknown;
  shipping_tax_amount?: unknown;
}

/** Fila de desglose del envío (forma de `TaxBreakdownItem`, tarifa en fracción). */
export interface ShippingTaxBreakdownRow {
  tax_type: ShippingTaxType;
  tax_amount: number;
  /** Fracción (0.08), nunca porcentaje (F-111). */
  tax_rate: number;
  /** Base neta del envío = `shipping_cost - shipping_tax_amount`. */
  taxable_amount: number;
}

const toCents = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Fila del desglose de impuestos (contabilidad / compuerta F-111) a partir de
 * la COPIA de la orden, nunca de la tarifa. Sin copia ⇒ null. Para que los
 * productores de asientos (POS, crédito, webhook, devolución) la sumen al
 * `tax_breakdown` de productos sin reimplementar la regla.
 */
export function buildShippingTaxBreakdownRow(
  order: ShippingTaxOrderInput | null | undefined,
): ShippingTaxBreakdownRow | null {
  if (!order) return null;
  const amount_cents = toCents(order.shipping_tax_amount);
  if (amount_cents <= 0) return null;
  const tax_type = resolveCategoryTaxType(order.shipping_tax_type);
  if (!isShippingTaxType(tax_type)) return null;
  const rate = Number(order.shipping_tax_rate ?? 0);
  const base_cents = toCents(order.shipping_cost) - amount_cents;
  return {
    tax_type,
    tax_amount: amount_cents / 100,
    tax_rate: Number.isFinite(rate) ? rate : 0,
    taxable_amount: Math.max(0, base_cents) / 100,
  };
}

/** Base neta del envío a partir de la copia (= `shipping_cost - shipping_tax_amount`). */
export function shippingNetBase(order: ShippingTaxOrderInput): number {
  return Math.max(0, toCents(order.shipping_cost) - toCents(order.shipping_tax_amount)) / 100;
}

/**
 * Cuota proporcional del impuesto del envío para un bruto devuelto, en
 * centavos enteros. ÚNICA definición: la usan el prorrateo de devoluciones
 * (`refund-calculation.service.ts`) y la reconstrucción fiscal de la
 * devolución manual (`manual-refund-accounting.util.ts`).
 */
export function proportionalShippingTaxCents(
  shippingCostCents: number,
  shippingTaxCents: number,
  grossRefundCents: number,
): number {
  if (shippingCostCents <= 0) return 0;
  return Math.round((shippingTaxCents * grossRefundCents) / shippingCostCents);
}

/**
 * Impuesto del envío a devolver por la devolución actual, en centavos
 * enteros. ÚNICA definición del prorrateo: proporcional al bruto devuelto,
 * y la devolución que completa el envío cierra al centavo contra
 * `shipping_tax_amount`.
 *
 * Lo ya devuelto del impuesto no está persistido: se reconstruye con la
 * MISMA proporción sobre cada bruto previo (determinista). Sin ese cierre,
 * cada parcial arrastraría ±1 ¢ de redondeo.
 *
 * Todo en centavos enteros; con bruto, impuesto o devolución actual ≤ 0
 * devuelve 0.
 */
export function prorateShippingTaxRefundCents(
  shippingCostCents: number,
  shippingTaxCents: number,
  priorRefundCents: readonly number[],
  currentRefundCents: number,
): number {
  if (currentRefundCents <= 0 || shippingCostCents <= 0 || shippingTaxCents <= 0) {
    return 0;
  }
  const priorShippingCents = priorRefundCents.reduce((sum, gross) => sum + gross, 0);
  const priorTaxCents = priorRefundCents.reduce(
    (sum, gross) =>
      sum + proportionalShippingTaxCents(shippingCostCents, shippingTaxCents, gross),
    0,
  );
  const remainingTaxCents = Math.max(0, shippingTaxCents - priorTaxCents);
  if (priorShippingCents + currentRefundCents >= shippingCostCents) {
    return remainingTaxCents;
  }
  return Math.min(
    remainingTaxCents,
    proportionalShippingTaxCents(shippingCostCents, shippingTaxCents, currentRefundCents),
  );
}
