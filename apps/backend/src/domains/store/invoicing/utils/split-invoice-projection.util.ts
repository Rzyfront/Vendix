import { Prisma, tax_type_enum } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { orderTaxFractionToInvoiceRate } from './invoice-tax-rate.util';
import { projectOrderInvoiceLines } from './order-invoice-lines.util';
import { buildShippingTaxBreakdownRow } from '../../shipping/utils/shipping-tax.util';
import { getCents } from '../../tables/utils/split-allocation.util';
import { allocateFinancialAccountShippingTax } from '../../shipping/utils/financial-account-shipping-tax.util';

interface FinancialTax {
  tax_rate_id: number | null;
  tax_name: string;
  tax_rate: Prisma.Decimal | string;
  tax_type: tax_type_enum | null;
  tax_amount: Prisma.Decimal | string;
  is_inclusive: boolean;
  is_compound: boolean;
}
interface FinancialLine {
  id: number;
  kind: string;
  source_order_item_id: number | null;
  description: string;
  source_snapshot: unknown;
  subtotal_amount: Prisma.Decimal | string;
  discount_amount: Prisma.Decimal | string;
  tax_amount: Prisma.Decimal | string;
  total_amount: Prisma.Decimal | string;
  taxes: FinancialTax[];
}
interface FinancialAccountProjection {
  id: number;
  label: string;
  grand_total: Prisma.Decimal | string;
  subtotal_amount: Prisma.Decimal | string;
  discount_amount: Prisma.Decimal | string;
  tax_amount: Prisma.Decimal | string;
  shipping_cost: Prisma.Decimal | string;
  tip_amount: Prisma.Decimal | string;
  lines: FinancialLine[];
}

/**
 * Copia congelada del impuesto del envío de la orden origen
 * (`orders.shipping_tax_*`) y el flete BRUTO de cada cuenta hermana de la
 * división. La cuenta sólo guarda su parte bruta del envío (`shipping_cost`),
 * nunca el impuesto: se reparte con `allocateFinancialAccountShippingTax`, la
 * misma función que usa el asiento de la cuenta.
 */
export interface FinancialAccountShippingSource {
  source_order: {
    shipping_cost?: unknown;
    shipping_tax_rate_id?: number | null;
    shipping_tax_name?: string | null;
    shipping_tax_type?: string | null;
    shipping_tax_rate?: unknown;
    shipping_tax_amount?: unknown;
  };
  accounts?: ReadonlyArray<{ id: number; shipping_cost: unknown }>;
}

const dec = (value: Prisma.Decimal | string | number) => new Prisma.Decimal(value);
const ZERO = new Prisma.Decimal(0);

/**
 * Parte del impuesto del envío que corresponde a ESTA cuenta.
 *
 * Mismo reparto que el asiento de la cuenta financiera (contrato con
 * contabilidad: factura y libro declaran el mismo impuesto de envío): el
 * impuesto de la orden se reparte en proporción directa al flete bruto de cada
 * cuenta hermana (mayor residuo); si las hermanas no reconcilian con el flete de
 * la orden, contra el flete de la orden. `null` ⇒ la línea Envío sale bruta, sin
 * tributo, como siempre (sin copia, o cuota de envío de la cuenta nula o
 * absorbida por completo en el redondeo — el asiento hace lo mismo).
 *
 * Una copia INCOHERENTE (tipo fuera de IVA/INC, sin tarifa, impuesto ≥ costo)
 * se rechaza, igual que `createFromOrder`: facturar el envío sin tributo
 * declararía menos impuesto del que la orden cobró.
 */
function resolveAccountShippingTax(
  account: FinancialAccountProjection,
  shipping: FinancialAccountShippingSource | undefined,
) {
  const order = shipping?.source_order;
  if (!order || getCents(dec(String(account.shipping_cost ?? 0)).toFixed(2)) <= 0n) return null;
  if (!dec(Number(order.shipping_tax_amount ?? 0) || 0).greaterThan(0)) return null;
  const coherent = buildShippingTaxBreakdownRow(order);
  const gross = dec(Number(order.shipping_cost ?? 0) || 0);
  if (!coherent || !(coherent.tax_rate > 0) || !gross.greaterThan(dec(Number(order.shipping_tax_amount)))) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_006,
      `La orden de la cuenta ${account.label} tiene una copia del impuesto del envío incoherente: ` +
        'no se puede facturar sin inventar la tarifa ni omitir un impuesto que la orden ya cobró. ' +
        'No se creó la factura ni se usó ningún número. Revisa el envío de la orden y factura de nuevo.',
      { financial_account_id: account.id, detail: 'shipping_tax:incoherent' },
    );
  }
  // Mismo reparto que el asiento de la cuenta (definición única).
  const allocated = allocateFinancialAccountShippingTax({
    id: account.id,
    shipping_cost: account.shipping_cost,
    split: { source_order: order, accounts: shipping?.accounts ?? [] },
  });
  if (!allocated) return null;
  const tax_amount = dec(allocated.amount.toString()).dividedBy(100);
  const accountGross = dec(account.shipping_cost);
  return {
    gross: accountGross,
    base: accountGross.minus(tax_amount),
    tax_amount,
    row: {
      tax_rate_id: order.shipping_tax_rate_id ?? null,
      tax_name: order.shipping_tax_name || allocated.row.tax_type.toUpperCase(),
      tax_rate: new Prisma.Decimal(orderTaxFractionToInvoiceRate(allocated.row.tax_rate, allocated.row.tax_type)),
      tax_type: allocated.row.tax_type as tax_type_enum,
    },
  };
}

/** One unit is a financial participation, NEVER a fractional stock/catalog unit.
 * All source lines, cents and tax types are immutable ledger snapshots. Taxes
 * remain line-bound (also for a single tax) so inclusive/compound bases cannot
 * be reconstructed incorrectly from the original physical quantity.
 *
 * DESCUENTO DE ORDEN (art. 454 ET). El reparto de la división
 * (`allocateFinancialSplit`) entrega cada línea con su parte del descuento de
 * orden JUNTO al impuesto PRE-descuento (el POS resta el descuento después del
 * impuesto). Declarar ese impuesto sobre una base ya descontada es el mismo
 * defecto que tenía `createFromOrder`. Con descuento en la cuenta, sus líneas
 * de producto pasan por la MISMA proyección que la factura de la orden entera
 * (`projectOrderInvoiceLines`: cada línea con cantidad 1 y su participación como
 * `total_price`), que es también la que usa el asiento de la cuenta
 * (`projectOrderDiscountedTaxes`): factura y libro declaran el mismo impuesto.
 * Cada factura parcial cierra EXACTO al `grand_total` de su cuenta
 * (Σ base + Σ cuota = Σ bruto − descuento), así que Σ facturas parciales =
 * total de la orden. Sin descuento, la factura es idéntica a la histórica.
 *
 * CABECERA. `subtotal` es la Σ de bases NETAS de línea (Σ LineExtensionAmount,
 * FAU02), `discount` la Σ de descuentos de línea, `tax` la Σ de cuotas y
 * `total = subtotal + tax` — el mismo contrato de cabecera que `createFromOrder`.
 */
export function projectFinancialAccountInvoice(
  account: FinancialAccountProjection,
  orderNumber: string,
  shipping?: FinancialAccountShippingSource,
) {
  for (const line of account.lines) {
    const base = dec(line.subtotal_amount);
    const discount = dec(line.discount_amount);
    const tax = dec(line.tax_amount);
    const total = dec(line.total_amount);
    if (!base.minus(discount).plus(tax).equals(total)) throw new Error('Financial line snapshot does not balance');
    const taxSum = line.taxes.reduce((sum, row) => sum.plus(row.tax_amount), new Prisma.Decimal(0));
    if (!taxSum.equals(tax)) throw new Error('Financial line tax snapshot does not balance');
  }

  const itemLines = account.lines.filter((line) => line.kind === 'item');
  const accountDiscount = dec(account.discount_amount);
  const projection = accountDiscount.greaterThan(0)
    ? projectOrderInvoiceLines(
        itemLines.map((line) => ({
          quantity: 1,
          total_price: line.subtotal_amount,
          tax_amount_item: line.tax_amount,
          order_item_taxes: line.taxes,
        })),
        account.discount_amount,
      )
    : null;
  if (projection?.error) {
    const unclosed = projection.error.code === 'unclosed';
    throw new VendixHttpException(
      unclosed ? ErrorCodes.INVOICING_CALC_005 : ErrorCodes.INVOICING_CALC_006,
      `El descuento de la cuenta ${account.label} no se puede repartir entre sus productos ` +
        'sin alterar el valor cobrado ni inventar un impuesto. ' +
        'No se creó la factura ni se usó ningún número. Revisa las tarifas de impuesto de la orden.',
      { financial_account_id: account.id, detail: `order_discount:${projection.error.code}` },
    );
  }
  const shippingTax = resolveAccountShippingTax(account, shipping);

  const items = account.lines.map((line) => {
    const itemIndex = itemLines.indexOf(line);
    const projected = projection && itemIndex >= 0 ? projection.lines[itemIndex] : null;
    const shippingLine = line.kind === 'shipping' && shippingTax ? shippingTax : null;
    const unit_price = shippingLine ? shippingLine.base : dec(line.subtotal_amount);
    const discount = projected
      ? projected.discount
      : shippingLine
        ? ZERO
        : dec(line.discount_amount);
    const net = unit_price.minus(discount);
    const taxAmounts = projected
      ? projected.tax_amounts
      : line.taxes.map((row) => dec(row.tax_amount));
    const tax = shippingLine
      ? shippingLine.tax_amount
      : taxAmounts.reduce((sum, amount) => sum.plus(amount), ZERO);
    const snapshot = (line.source_snapshot ?? {}) as { quantity?: number; product_name?: string };
    const provenance = line.kind === 'item'
      ? ` · origen #${line.source_order_item_id}${snapshot.quantity ? ` (${snapshot.quantity} unidades originales)` : ''}`
      : '';
    return {
      data: {
        financial_source_line_id: line.id,
        product_id: null,
        product_variant_id: null,
        description: `Participación ${account.label} · orden ${orderNumber} · ${line.description}${provenance}`.slice(0, 500),
        quantity: new Prisma.Decimal(1),
        unit_price,
        discount_amount: discount,
        tax_amount: tax,
        total_amount: net.plus(tax),
        is_inclusive: false,
        unit_code: 'EA',
        // No stock quantity/serial claims: those belong to the original sale.
        stock_units_consumed: null,
      },
      taxes: shippingLine
        ? [{
            ...shippingLine.row,
            taxable_amount: net,
            tax_amount: shippingLine.tax_amount,
            is_inclusive: false,
          }]
        : line.taxes.map((row, index) => ({
            tax_rate_id: row.tax_rate_id,
            tax_name: row.tax_name,
            tax_rate: new Prisma.Decimal(orderTaxFractionToInvoiceRate(Number(row.tax_rate), row.tax_type)),
            tax_type: row.tax_type,
            // La proyección rechaza filas compuestas; sin descuento se conserva
            // la base compuesta histórica.
            taxable_amount: net.plus(row.is_compound ? taxAmounts.slice(0, index).reduce((sum, prior) => sum.plus(prior), ZERO) : 0),
            tax_amount: taxAmounts[index],
            // The participation is expressed as a net base; source inclusiveness
            // is still auditable on the immutable financial tax snapshot.
            is_inclusive: false,
          })),
    };
  });
  const sum = (field: 'unit_price' | 'discount_amount' | 'tax_amount' | 'total_amount') =>
    items.reduce((n, item) => n.plus(item.data[field]), new Prisma.Decimal(0));
  const gross = sum('unit_price');
  const discount = sum('discount_amount');
  const tax = sum('tax_amount');
  const total = sum('total_amount');
  const subtotal = gross.minus(discount);
  const shippingTaxAmount = shippingTax?.tax_amount ?? ZERO;
  if (
    !total.equals(account.grand_total) ||
    !subtotal.plus(tax).equals(total) ||
    !gross.plus(shippingTaxAmount).equals(dec(account.subtotal_amount).plus(account.shipping_cost).plus(account.tip_amount)) ||
    (!projection && (!discount.equals(account.discount_amount) || !tax.equals(dec(account.tax_amount).plus(shippingTaxAmount))))
  ) {
    throw new Error('Financial account snapshot does not balance');
  }
  return { items, subtotal, discount, tax, total };
}
