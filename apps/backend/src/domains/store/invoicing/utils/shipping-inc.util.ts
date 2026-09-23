import type { InvoiceTaxRowInput } from '../invoicing.service';
import { orderTaxFractionToInvoiceRate } from './invoice-tax-rate.util';
import { resolveInclusiveClearing } from './dian-money.util';

/**
 * EL DOMICILIO DE UN RESTAURANTE LLEVA EL INC DEL SERVICIO PRINCIPAL, INCLUIDO.
 *
 * Doctrina DIAN (Oficio 904106/2022, art. 512-9 E.T.): en el expendio de
 * comidas el domicilio hace parte de la base gravable del impuesto nacional al
 * consumo. Decisión del dueño: el INC va INCLUIDO en lo que ya paga el cliente
 * — $15.000 de domicilio = base 13.888,89 + INC 1.111,11 —, así que ni
 * `orders.grand_total` ni `invoices.total_amount` cambian.
 *
 * El desglose NO se persiste en la orden: `orders.shipping_cost` sigue siendo
 * «lo que paga el cliente» y se proyecta sólo al facturar (`createFromOrder`)
 * y al contabilizar la venta sin factura (`payments.service`). Ambos llaman a
 * esta función, que es la definición única.
 *
 * Aplica sólo si se cumplen las CUATRO condiciones:
 *   P1 `shipping_cost > 0`.
 *   P2 el emisor es responsable de INC (`isIncResponsible`, código O-33),
 *      leído con el MISMO alcance fiscal que arma el `PartyTaxScheme` del XML.
 *   P3 la tienda es un restaurante (`storeIsRestaurant`): la doctrina es de
 *      expendio de comidas; un concesionario con INC de vehículos no entra.
 *   P4 la orden cobra INC en sus líneas activas (fila `order_item_taxes`
 *      `tax_type='inc'` con cuota > 0): el envío es accesorio y sigue al
 *      servicio principal. Sin servicio gravado no hay base accesoria.
 *
 * La TARIFA se toma de las filas INC de la propia orden —lo que realmente se
 * cobró—, nunca del catálogo de categorías de la tienda. Más de una tarifa
 * distinta ⇒ no se grava (`ambiguous_inc_rate`): elegir una sería inventarla.
 *
 * Pura: sin DB, sin logger. El llamador resuelve P2/P3 y registra el motivo.
 */

/** Lo mínimo que se lee de cada línea activa de la orden. */
export interface ShippingIncOrderLine {
  total_price?: unknown;
  order_item_taxes?: Array<{
    tax_rate_id?: unknown;
    tax_name?: unknown;
    tax_rate?: unknown;
    tax_amount?: unknown;
    tax_type?: unknown;
    is_inclusive?: unknown;
  }> | null;
}

export interface ShippingIncInput {
  shipping_cost: unknown;
  inc_responsible: boolean;
  is_restaurant: boolean;
  /** Líneas ACTIVAS (`cancelled_at: null`) con sus `order_item_taxes`. */
  order_items: ShippingIncOrderLine[] | null | undefined;
}

export type ShippingIncSkipReason =
  | 'no_shipping'
  | 'not_inc_responsible'
  | 'not_restaurant'
  | 'no_inc_lines'
  | 'ambiguous_inc_rate'
  /** Defensivo: el despeje no cerró al centavo contra el bruto. */
  | 'clearing_unclosed';

export type ShippingIncResult =
  | { applies: false; reason: ShippingIncSkipReason }
  | {
      applies: true;
      /** Lo que paga el cliente por el domicilio (= `orders.shipping_cost`). */
      gross: number;
      /** Base neta despejada (2 decimales). `gross = base + inc_amount`. */
      base: number;
      /** INC incluido en el domicilio (2 decimales). */
      inc_amount: number;
      /** Tarifa como FRACCIÓN (0.08), la unidad de `order_item_taxes`. */
      rate_fraction: number;
      /**
       * Fila de tributo lista para `invoice_taxes` (tarifa en PORCENTAJE,
       * base = `base`). `is_inclusive` copia el de la fila INC de origen para
       * caer en el mismo cubo de `aggregateOrderTaxes`; el llamador lo aplana
       * a `false` al persistir (forma base).
       */
      tax_row: InvoiceTaxRowInput;
    };

interface IncRowSource {
  fraction: number;
  fraction_key: string;
  tax_rate_id: number | null;
  tax_name: string;
  is_inclusive: boolean;
  line_base: number;
}

const isIncRow = (tax: { tax_type?: unknown; tax_amount?: unknown }) =>
  String(tax.tax_type ?? '').trim().toLowerCase() === 'inc' &&
  Number(tax.tax_amount || 0) > 0;

/** P4: ¿alguna línea activa cobra INC con cuota > 0? */
export function orderHasIncLines(
  order_items: ShippingIncOrderLine[] | null | undefined,
): boolean {
  return (order_items || []).some((item) =>
    (item.order_item_taxes || []).some(isIncRow),
  );
}

function collectIncRows(
  order_items: ShippingIncOrderLine[] | null | undefined,
): IncRowSource[] {
  const rows: IncRowSource[] = [];
  for (const item of order_items || []) {
    for (const tax of item.order_item_taxes || []) {
      if (!isIncRow(tax)) continue;
      const fraction = Number(tax.tax_rate || 0);
      if (!Number.isFinite(fraction) || fraction <= 0) continue;
      const rawId = tax.tax_rate_id;
      rows.push({
        fraction,
        // `Decimal(6,5)`: 5 decimales distinguen cualquier tarifa real y
        // matan el polvo float de `Number(Decimal)`.
        fraction_key: fraction.toFixed(5),
        tax_rate_id:
          rawId === null || rawId === undefined || rawId === ''
            ? null
            : Number(rawId),
        tax_name: String(tax.tax_name ?? 'INC'),
        is_inclusive: tax.is_inclusive === true,
        line_base: Number(item.total_price || 0),
      });
    }
  }
  return rows;
}

/**
 * Elige la fila representativa de la tarifa única: la de mayor Σ base
 * (`total_price`) por `tax_rate_id`; empate ⇒ el `tax_rate_id` menor (null al
 * final).
 */
function pickRepresentative(rows: IncRowSource[]): IncRowSource {
  const byId = new Map<string, { row: IncRowSource; base: number }>();
  for (const row of rows) {
    const key = row.tax_rate_id === null ? 'null' : String(row.tax_rate_id);
    const acc = byId.get(key);
    if (acc) acc.base += row.line_base;
    else byId.set(key, { row, base: row.line_base });
  }
  const ranked = Array.from(byId.values()).sort((a, b) => {
    if (b.base !== a.base) return b.base - a.base;
    const ia = a.row.tax_rate_id ?? Number.POSITIVE_INFINITY;
    const ib = b.row.tax_rate_id ?? Number.POSITIVE_INFINITY;
    return ia - ib;
  });
  return ranked[0].row;
}

export function resolveShippingInc(input: ShippingIncInput): ShippingIncResult {
  const gross = Math.round(Number(input.shipping_cost || 0) * 100) / 100;
  if (!Number.isFinite(gross) || gross <= 0) {
    return { applies: false, reason: 'no_shipping' };
  }
  if (!input.inc_responsible) {
    return { applies: false, reason: 'not_inc_responsible' };
  }
  if (!input.is_restaurant) {
    return { applies: false, reason: 'not_restaurant' };
  }

  const rows = collectIncRows(input.order_items);
  if (rows.length === 0) {
    return { applies: false, reason: 'no_inc_lines' };
  }
  const distinct = new Set(rows.map((row) => row.fraction_key));
  if (distinct.size > 1) {
    return { applies: false, reason: 'ambiguous_inc_rate' };
  }

  const representative = pickRepresentative(rows);
  const clearing = resolveInclusiveClearing(gross, [
    {
      rate: representative.fraction,
      rate_basis: 'fraction',
      is_inclusive: true,
    },
  ]);
  const base = clearing.base.toNumber();
  const inc_amount = clearing.rates[0]?.amount.toNumber() ?? 0;
  // El kernel cierra al centavo por construcción; si no cerrara, gravar
  // movería lo que paga el cliente — se prefiere no gravar.
  if (
    clearing.unclosed_residual_cents !== 0 ||
    Math.round((base + inc_amount) * 100) !== Math.round(gross * 100) ||
    inc_amount <= 0
  ) {
    return { applies: false, reason: 'clearing_unclosed' };
  }

  return {
    applies: true,
    gross,
    base,
    inc_amount,
    rate_fraction: representative.fraction,
    tax_row: {
      tax_rate_id: representative.tax_rate_id,
      tax_name: representative.tax_name,
      tax_rate: orderTaxFractionToInvoiceRate(representative.fraction, 'inc'),
      taxable_amount: base,
      tax_amount: inc_amount,
      tax_type: 'inc',
      is_inclusive: representative.is_inclusive,
    },
  };
}
