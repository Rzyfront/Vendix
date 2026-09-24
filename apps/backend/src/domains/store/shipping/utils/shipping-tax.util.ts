import { resolveInclusiveClearing } from '../../invoicing/utils/dian-money.util';

/**
 * IMPUESTO OPCIONAL POR TARIFA DE ENVÍO — definición única (pura).
 *
 * Decisiones del dueño (contrato `shipping-rate-tax`):
 * - Cada `shipping_rates` puede llevar una `tax_categories` (null = sin
 *   impuesto, el default).
 * - El impuesto va SIEMPRE INCLUIDO en el precio de la tarifa: se IGNORA el
 *   `is_inclusive` de la categoría. Lo que paga el cliente no cambia: $15.000
 *   con INC 8 % = base 13.888,89 + INC 1.111,11.
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
 * Resuelve la copia del impuesto del envío. Siempre incluido.
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
