import { Prisma } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { buildOrder, buildOrderItem } from 'src/testing/money-fixtures';
import { RefundCalculationService } from './refund-calculation.service';
import { projectOrderInvoiceLines } from '../../../invoicing/utils/order-invoice-lines.util';
import { InvoiceCalculatorService } from '../../../invoicing/services/invoice-calculator.service';
import { deriveRefundNoteSelection } from '../../../invoicing/credit-notes/refund-note-source.util';

/**
 * F2 — devolución de una venta con promoción. Antes el neto salía de un ratio
 * uniforme `discount_amount / subtotal_amount` sobre la base de cada línea:
 * en ecommerce (contrato legado, descuento BRUTO en la cabecera) el cliente
 * recibía 104.839 de 107.100 y la nota crédito dejaba 2.261 sin anular; en POS
 * con la promoción ya repartida por línea (F1) el ratio uniforme también
 * rompía. Ahora neto e impuesto salen de la MISMA proyección que la factura.
 */
const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const IVA = (amount: number, id = 1) => ({
  id,
  tax_rate_id: 1,
  tax_name: 'IVA 19%',
  tax_type: 'iva',
  tax_rate: d(0.19),
  tax_amount: d(amount),
  is_inclusive: true,
  is_compound: false,
});

describe('RefundCalculationService — devoluciones con promoción (F2)', () => {
  const prisma = {
    orders: { findFirst: jest.fn() },
    accounts_receivable: { findMany: jest.fn() },
  };
  const service = new RefundCalculationService(prisma as unknown as StorePrismaService);
  const calculator = new InvoiceCalculatorService();

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.accounts_receivable.findMany.mockResolvedValue([]);
  });

  const paidOrder = (over: Record<string, unknown>) => {
    const grand = (over.grand_total as Prisma.Decimal) ?? d(0);
    return buildOrder({
      state: 'finished',
      payments: [{ id: 1, amount: grand }],
      refunds: [],
      ...over,
    });
  };

  /**
   * Factura que sale de la orden (mismo armado que `invoicing.service`: línea
   * en BASE, `is_inclusive=false`, descuento = proyectado) para probar que la
   * NC que nace del reembolso la reproduce sin descuadre.
   */
  const invoiceOf = (order: any) => {
    const projection = projectOrderInvoiceLines(order.order_items, order.discount_amount);
    expect(projection.error).toBeUndefined();
    const items = order.order_items.map((item: any, i: number) => {
      const line = projection.lines[i];
      return {
        id: 700 + i,
        invoice_id: 90,
        product_id: item.product_id,
        product_variant_id: null,
        description: item.product_name,
        quantity: d(item.quantity),
        unit_price: d(item.unit_price),
        discount_amount: line.discount,
        tax_amount: line.tax_total,
        total_amount: line.base.plus(line.tax_total),
        is_inclusive: false,
        price_unit_quantity: 1,
        unit_code: 'EA',
        account_code: '413595',
        stock_units_consumed: null,
        serial_numbers_snapshot: null,
        aiu_component: null,
        financial_source_line_id: null,
        financial_source_line: { source_order_item_id: item.id, kind: 'product' },
      };
    });
    const taxes = order.order_items.flatMap((item: any, i: number) =>
      (item.order_item_taxes ?? []).map((row: any, k: number) => ({
        invoice_item_id: 700 + i,
        tax_rate_id: row.tax_rate_id,
        tax_name: row.tax_name,
        tax_type: row.tax_type,
        tax_rate: d(row.tax_rate).times(100),
        taxable_amount: projection.lines[i].base,
        tax_amount: projection.lines[i].tax_amounts[k],
        is_inclusive: false,
      })),
    );
    const sum = (f: (x: any) => Prisma.Decimal) =>
      items.reduce((s: Prisma.Decimal, x: any) => s.plus(f(x)), d(0));
    return {
      id: 90,
      organization_id: 2,
      store_id: 3,
      accounting_entity_id: 4,
      invoice_items: items,
      invoice_taxes: taxes,
      subtotal_amount: sum((x) => x.total_amount.minus(x.tax_amount)),
      discount_amount: d(0),
      tax_amount: sum((x) => x.tax_amount),
      total_amount: sum((x) => x.total_amount),
    } as any;
  };

  /** Arma la NC desde el reembolso calculado; lanza si no cuadra. */
  const creditNoteOf = (order: any, calc: any) =>
    deriveRefundNoteSelection(
      calculator,
      invoiceOf(order),
      {
        id: 300,
        order_id: order.id,
        shipping_refund: 0,
        refund_items: calc.items.map((it: any, k: number) => ({
          id: 301 + k,
          order_item_id: it.order_item_id,
          quantity: d(it.quantity),
          discount_amount: d(it.discount_amount),
          tax_amount: d(it.tax_amount),
          refund_amount: d(it.refund_amount),
        })),
      },
      order.order_items.map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        product_variant_id: null,
        product_name: it.product_name,
        quantity: d(it.quantity),
      })),
    );

  describe('ecommerce, orden LEGADA (descuento bruto en la cabecera)', () => {
    // 1 × 119.000 IVA 19 % incluido, promo 10 %: subtotal 100.000, IVA
    // pre-descuento 19.000, descuento 11.900, cobrado 107.100.
    const order = (qty = 1) =>
      paidOrder({
        channel: 'ecommerce',
        subtotal_amount: d(100000 * qty),
        tax_amount: d(19000 * qty),
        discount_amount: d(11900 * qty),
        grand_total: d(107100 * qty),
        order_items: [
          buildOrderItem({
            id: 1,
            product_name: 'A',
            quantity: qty,
            unit_price: d(100000),
            total_price: d(100000 * qty),
            discount_amount: null,
            tax_rate: d(0.19),
            tax_amount_item: d(19000),
            order_item_taxes: [IVA(19000 * qty)],
          }),
        ],
      });

    it('devolución total: reembolsa 107.100 (antes 104.839) y la NC anula la factura completa', async () => {
      const o = order();
      prisma.orders.findFirst.mockResolvedValue(o);
      const r = await service.calculate({
        order_id: 9001,
        items: [{ order_item_id: 1, quantity: 1, inventory_action: 'no_return' }],
        include_shipping: false,
      });
      expect(r.total_refund).toBe(107100);
      expect(r.subtotal_refund).toBe(90000);
      expect(r.tax_refund).toBe(17100);
      expect(r.is_full_refund).toBe(true);
      const nc = creditNoteOf(o, r);
      expect(nc.bridge_rows[0].covered_amount).toEqual(d(107100));
    });

    it('devolución parcial 1 de 3 y luego 2 de 3: 107.100 + 214.200 = 321.300 cobrados; cada NC cuadra', async () => {
      const o = order(3);
      prisma.orders.findFirst.mockResolvedValue(o);
      const first = await service.calculate({
        order_id: 9001,
        items: [{ order_item_id: 1, quantity: 1, inventory_action: 'no_return' }],
        include_shipping: false,
      });
      expect(first.total_refund).toBe(107100);
      expect(() => creditNoteOf(o, first)).not.toThrow();

      prisma.orders.findFirst.mockResolvedValue({
        ...o,
        refunds: [
          {
            amount: d(first.total_refund),
            state: 'completed',
            refund_items: [{ order_item_id: 1, quantity: 1, refund_amount: d(first.total_refund) }],
          },
        ],
      });
      const rest = await service.calculate({
        order_id: 9001,
        items: [{ order_item_id: 1, quantity: 2, inventory_action: 'no_return' }],
        include_shipping: false,
      });
      expect(rest.total_refund).toBe(214200);
      expect(first.total_refund + rest.total_refund).toBe(321300);
      expect(rest.is_full_refund).toBe(true);
      expect(() => creditNoteOf(o, rest)).not.toThrow();
    });
  });

  describe('ecommerce, orden NUEVA (descuento de base por línea, F1)', () => {
    it('devolución total de 107.100 reembolsa 107.100', async () => {
      const o = paidOrder({
        channel: 'ecommerce',
        subtotal_amount: d(100000),
        tax_amount: d(17100),
        discount_amount: d(10000),
        grand_total: d(107100),
        order_items: [
          buildOrderItem({
            id: 1,
            product_name: 'A',
            unit_price: d(100000),
            total_price: d(100000),
            discount_amount: d(10000),
            tax_rate: d(0.19),
            tax_amount_item: d(17100),
            order_item_taxes: [IVA(17100)],
          }),
        ],
      });
      prisma.orders.findFirst.mockResolvedValue(o);
      const r = await service.calculate({
        order_id: 9001,
        items: [{ order_item_id: 1, quantity: 1, inventory_action: 'no_return' }],
        include_shipping: false,
      });
      expect(r.total_refund).toBe(107100);
      expect(() => creditNoteOf(o, r)).not.toThrow();
    });
  });

  describe('POS con promo de producto y tarifas mezcladas (escenario A tras F1)', () => {
    // A: base 100.000, descuento 10.000, IVA 17.100 · B: excluido 100.000.
    const pos = () =>
      paidOrder({
        channel: 'pos',
        subtotal_amount: d(200000),
        tax_amount: d(17100),
        discount_amount: d(10000),
        grand_total: d(207100),
        order_items: [
          buildOrderItem({
            id: 1,
            product_id: 1,
            product_name: 'A',
            unit_price: d(100000),
            total_price: d(100000),
            discount_amount: d(10000),
            tax_rate: d(0.19),
            tax_amount_item: d(17100),
            order_item_taxes: [IVA(17100)],
          }),
          buildOrderItem({
            id: 2,
            product_id: 2,
            product_name: 'B',
            unit_price: d(100000),
            total_price: d(100000),
            discount_amount: d(0),
            tax_rate: d(0),
            tax_amount_item: d(0),
            order_item_taxes: [],
          }),
        ],
      });

    it('devolución total: 207.100 (A 107.100 + B 100.000) y la NC cuadra', async () => {
      const o = pos();
      prisma.orders.findFirst.mockResolvedValue(o);
      const r = await service.calculate({
        order_id: 9001,
        items: [
          { order_item_id: 1, quantity: 1, inventory_action: 'no_return' },
          { order_item_id: 2, quantity: 1, inventory_action: 'no_return' },
        ],
        include_shipping: false,
      });
      expect(r.items.map((i) => [i.net_amount, i.tax_amount, i.refund_amount])).toEqual([
        [90000, 17100, 107100],
        [100000, 0, 100000],
      ]);
      expect(r.total_refund).toBe(207100);
      expect(r.tax_refund).toBe(17100);
      expect(() => creditNoteOf(o, r)).not.toThrow();
    });

    it('devolución parcial sólo de B: 100.000 (antes, con ratio uniforme, 95.000)', async () => {
      const o = pos();
      prisma.orders.findFirst.mockResolvedValue(o);
      const r = await service.calculate({
        order_id: 9001,
        items: [{ order_item_id: 2, quantity: 1, inventory_action: 'no_return' }],
        include_shipping: false,
      });
      expect(r.total_refund).toBe(100000);
      expect(r.tax_refund).toBe(0);
      expect(() => creditNoteOf(o, r)).not.toThrow();
    });

    it('devolución parcial sólo de A: 107.100', async () => {
      const o = pos();
      prisma.orders.findFirst.mockResolvedValue(o);
      const r = await service.calculate({
        order_id: 9001,
        items: [{ order_item_id: 1, quantity: 1, inventory_action: 'no_return' }],
        include_shipping: false,
      });
      expect(r.total_refund).toBe(107100);
      expect(() => creditNoteOf(o, r)).not.toThrow();
    });
  });

  it('parcial con base que no divide exacto: el impuesto es el que recalcula la NC (no dispara refund_snapshot_amount_mismatch)', async () => {
    // 3 unidades de base 84.033,61 (IVA 19 %) con promo: base 226.890,75 ·
    // IVA 43.109,24. Con el impuesto por proporción (43.109,24 / 3 =
    // 14.369,75) la NC recalcula 14.369,74 y rechazaba la devolución.
    const o = paidOrder({
      channel: 'pos',
      subtotal_amount: d(252100.83),
      tax_amount: d(43109.24),
      discount_amount: d(25210.08),
      grand_total: d(269999.99),
      order_items: [
        buildOrderItem({
          id: 1,
          product_name: 'A',
          quantity: 3,
          unit_price: d(84033.61),
          total_price: d(252100.83),
          discount_amount: d(25210.08),
          tax_rate: d(0.19),
          tax_amount_item: d(14369.75),
          order_item_taxes: [IVA(43109.24)],
        }),
      ],
    });
    prisma.orders.findFirst.mockResolvedValue(o);
    const r = await service.calculate({
      order_id: 9001,
      items: [{ order_item_id: 1, quantity: 1, inventory_action: 'no_return' }],
      include_shipping: false,
    });
    // neto 226.890,75 / 3 = 75.630,25; IVA trunc(75.630,25 × 19 %) = 14.369,74.
    expect(r.items[0].net_amount).toBe(75630.25);
    expect(r.items[0].tax_amount).toBe(14369.74);
    expect(() => creditNoteOf(o, r)).not.toThrow();
  });

  it('con envío: la devolución total de una venta con promoción devuelve el envío completo', async () => {
    const o = paidOrder({
      channel: 'ecommerce',
      subtotal_amount: d(100000),
      tax_amount: d(19000),
      discount_amount: d(11900),
      shipping_cost: d(10000),
      grand_total: d(117100),
      order_items: [
        buildOrderItem({
          id: 1,
          product_name: 'A',
          unit_price: d(100000),
          total_price: d(100000),
          discount_amount: null,
          tax_rate: d(0.19),
          tax_amount_item: d(19000),
          order_item_taxes: [IVA(19000)],
        }),
      ],
    });
    prisma.orders.findFirst.mockResolvedValue(o);
    const r = await service.calculate({
      order_id: 9001,
      items: [{ order_item_id: 1, quantity: 1, inventory_action: 'no_return' }],
      include_shipping: true,
    });
    expect(r.shipping_refund).toBe(10000);
    expect(r.total_refund).toBe(117100);
  });
});
