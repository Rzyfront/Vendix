import {
  getCents,
  proportional,
} from '../../tables/utils/split-allocation.util';
import {
  buildShippingTaxBreakdownRow,
  ShippingTaxBreakdownRow,
  ShippingTaxOrderInput,
} from './shipping-tax.util';

/**
 * Cuenta financiera (división de la cuenta de una orden) tal como la leen el
 * asiento y la factura: su flete BRUTO, la copia congelada del impuesto del
 * envío de la orden origen y el flete bruto de cada cuenta hermana.
 */
export interface FinancialAccountShippingTaxInput {
  id: number;
  shipping_cost?: unknown;
  split?: {
    source_order?: ShippingTaxOrderInput | null;
    accounts?: ReadonlyArray<{ id: number; shipping_cost?: unknown }> | null;
  } | null;
}

export interface FinancialAccountShippingTax {
  /** Impuesto del envío de ESTA cuenta, en centavos. */
  amount: bigint;
  /** Fila de la copia de la orden (tipo y tarifa en fracción). */
  row: ShippingTaxBreakdownRow;
}

/**
 * Impuesto del envío que corresponde a UNA cuenta financiera — definición
 * única que comparten el asiento de la cuenta (`AutoEntryService`) y su
 * factura (`projectFinancialAccountInvoice`): factura y libro declaran el mismo
 * impuesto de envío al centavo.
 *
 * La cuenta guarda sólo su parte BRUTA del flete (`shipping_cost`); la copia
 * congelada (`orders.shipping_tax_*`) vive en la orden. El impuesto de la
 * orden se reparte entre las cuentas de la división por su flete (mayor
 * residuo): Σ cuentas = impuesto de la orden al centavo. Si las cuentas no
 * suman el flete de la orden, proporción directa contra el flete de la orden.
 * Base del envío de la cuenta = su flete − este impuesto.
 *
 * `null` sin copia (o copia ilegible), sin flete en la cuenta, o cuando la
 * cuota de la cuenta sale nula o se come el flete entero: el envío de la cuenta
 * va bruto, sin tributo.
 */
export function allocateFinancialAccountShippingTax(
  account: FinancialAccountShippingTaxInput | null | undefined,
): FinancialAccountShippingTax | null {
  const order = account?.split?.source_order;
  const row = buildShippingTaxBreakdownRow(order);
  const accountShipping = getCents((account?.shipping_cost ?? 0) as any);
  if (!order || !row || accountShipping <= 0n) return null;
  const orderShipping = getCents((order.shipping_cost ?? 0) as any);
  const orderTax = getCents((order.shipping_tax_amount ?? 0) as any);
  if (orderShipping <= 0n || orderTax <= 0n || orderTax >= orderShipping)
    return null;
  const siblings = account!.split?.accounts ?? [];
  const weights = siblings.map((sibling) =>
    getCents((sibling.shipping_cost ?? 0) as any),
  );
  const index = siblings.findIndex((sibling) => sibling.id === account!.id);
  const amount =
    index >= 0 &&
    weights.every((weight) => weight >= 0n) &&
    weights.reduce((a, b) => a + b, 0n) === orderShipping
      ? proportional(orderTax, weights)[index]
      : proportional(orderTax, [
          accountShipping,
          orderShipping > accountShipping ? orderShipping - accountShipping : 0n,
        ])[0];
  if (amount <= 0n || amount >= accountShipping) return null;
  return { amount, row };
}
