import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import type { NoteSourceTaxSnapshot } from './note-source-resolver.util';
import {
  deriveRefundNoteSelection,
  type RefundNoteOrderItem,
  type RefundNoteSnapshot,
  type RefundNoteSourceInvoice,
  type RefundNoteSourceLine,
} from './refund-note-source.util';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const calculator = new InvoiceCalculatorService();

function sourceLine(
  id: number,
  overrides: Partial<RefundNoteSourceLine> = {},
): RefundNoteSourceLine {
  return {
    id,
    invoice_id: 90,
    product_id: 5,
    product_variant_id: null,
    description: 'Coffee beans',
    quantity: decimal(1),
    unit_price: decimal(100),
    discount_amount: decimal(0),
    tax_amount: decimal(0),
    total_amount: decimal(100),
    is_inclusive: false,
    price_unit_quantity: 1,
    unit_code: 'EA',
    account_code: '413595',
    stock_units_consumed: null,
    serial_numbers_snapshot: null,
    aiu_component: null,
    financial_source_line_id: null,
    ...overrides,
  };
}

function sourceInvoice(
  lines: readonly RefundNoteSourceLine[],
  taxes: readonly NoteSourceTaxSnapshot[] = [],
): RefundNoteSourceInvoice {
  const lineTotal = lines.reduce((sum, line) => sum.plus(decimal(line.total_amount)), decimal(0));
  const taxTotal = lines.reduce((sum, line) => sum.plus(decimal(line.tax_amount)), decimal(0));
  return {
    id: 90,
    organization_id: 2,
    store_id: 3,
    accounting_entity_id: 4,
    invoice_items: lines,
    invoice_taxes: taxes,
    subtotal_amount: lineTotal.minus(taxTotal),
    discount_amount: decimal(0),
    tax_amount: taxTotal,
    total_amount: lineTotal,
  };
}

function refund(
  refundItems: RefundNoteSnapshot['refund_items'],
  shipping_refund: RefundNoteSnapshot['shipping_refund'] = 0,
  id = 300,
): RefundNoteSnapshot {
  return { id, order_id: 12, shipping_refund, refund_items: refundItems };
}

function refundItem(overrides: Partial<RefundNoteSnapshot['refund_items'][number]> = {}) {
  return {
    id: 301,
    order_item_id: 100,
    quantity: decimal(1),
    discount_amount: decimal(0),
    tax_amount: decimal(0),
    refund_amount: decimal(30),
    ...overrides,
  };
}

function orderItem(overrides: Partial<RefundNoteOrderItem> = {}): RefundNoteOrderItem {
  return {
    id: 100,
    product_id: 5,
    product_variant_id: null,
    product_name: 'Coffee beans',
    quantity: decimal(1),
    ...overrides,
  };
}

function sourceErrorDetails(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(VendixHttpException);
  expect((error as VendixHttpException).errorCode).toBe(ErrorCodes.INVOICING_NOTE_SOURCE_001.code);
  return (error as { response: { details: Record<string, unknown> } }).response.details;
}

describe('deriveRefundNoteSelection', () => {
  it('requires an explicit map for repeated SKU/description source lines and maps the chosen candidate', () => {
    const source = sourceInvoice([
      sourceLine(71),
      sourceLine(72),
    ]);
    const orderItems = [orderItem()];
    const refundSnapshot = refund([refundItem()]);

    try {
      deriveRefundNoteSelection(calculator, source, refundSnapshot, orderItems);
      fail('expected a mapping ambiguity');
    } catch (error) {
      const details = sourceErrorDetails(error);
      expect(details.reason).toBe('refund_source_mapping_required');
      expect(details.refund_item_candidates).toEqual([
        {
          refund_item_id: 301,
          description: 'Coffee beans',
          source_candidates: [
            { source_invoice_item_id: 71, description: 'Coffee beans' },
            { source_invoice_item_id: 72, description: 'Coffee beans' },
          ],
        },
      ]);
    }

    const selected = deriveRefundNoteSelection(
      calculator,
      source,
      refundSnapshot,
      orderItems,
      { refund_item_sources: [{ refund_item_id: 301, source_invoice_item_id: 72 }] },
    );
    expect(selected.items.map((item) => item.source_invoice_item_id)).toEqual([72]);
    expect(selected.bridge_rows[0]).toMatchObject({ refund_item_id: 301, covered_qty: 1 });
    expect(selected.bridge_rows[0]?.covered_amount).toEqual(decimal(30));
  });

  it('accepts a mapping only for ambiguous refund rows while resolving a unique row automatically', () => {
    const source = sourceInvoice([
      sourceLine(71),
      sourceLine(72),
      sourceLine(73, {
        product_id: 8,
        description: 'Tea leaves',
        unit_price: decimal(50),
        total_amount: decimal(50),
      }),
    ]);
    const refundSnapshot = refund([
      refundItem({ id: 301, order_item_id: 100, refund_amount: decimal(30) }),
      refundItem({ id: 302, order_item_id: 101, refund_amount: decimal(20) }),
    ]);

    const result = deriveRefundNoteSelection(
      calculator,
      source,
      refundSnapshot,
      [
        orderItem(),
        orderItem({ id: 101, product_id: 8, product_name: 'Tea leaves' }),
      ],
      { refund_item_sources: [{ refund_item_id: 301, source_invoice_item_id: 72 }] },
    );

    expect(result.items.map((item) => item.source_invoice_item_id)).toEqual([72, 73]);
    expect(result.bridge_rows.map((row) => row.refund_item_id)).toEqual([301, 302]);
  });

  it('prefers unique immutable financial provenance when the product description changed', () => {
    const source = sourceInvoice([
      sourceLine(71, {
        description: 'Old captured description',
        financial_source_line: { source_order_item_id: 100, kind: 'order_item' },
      }),
      sourceLine(72, {
        description: 'Coffee beans',
        financial_source_line: { source_order_item_id: 200, kind: 'order_item' },
      }),
    ]);

    const result = deriveRefundNoteSelection(calculator, source, refund([refundItem()]), [orderItem()]);
    expect(result.items[0]?.source_invoice_item_id).toBe(71);
  });

  it('rejects foreign and duplicate explicit source assignments', () => {
    const source = sourceInvoice([sourceLine(71)]);
    const twoRefundItems = refund([
      refundItem({ id: 301 }),
      refundItem({ id: 302, refund_amount: decimal(20) }),
    ]);
    const items = [orderItem()];

    expect(() => deriveRefundNoteSelection(calculator, source, refund([refundItem()]), items, {
      refund_item_sources: [{ refund_item_id: 301, source_invoice_item_id: 999 }],
    })).toThrow(VendixHttpException);
    expect(() => deriveRefundNoteSelection(calculator, source, twoRefundItems, items, {
      refund_item_sources: [
        { refund_item_id: 301, source_invoice_item_id: 71 },
        { refund_item_id: 302, source_invoice_item_id: 71 },
      ],
    })).toThrow(VendixHttpException);
    expect(() => deriveRefundNoteSelection(calculator, source, twoRefundItems, items, {
      refund_item_sources: [{ refund_item_id: 301, source_invoice_item_id: 71 }],
    })).toThrow(VendixHttpException);
  });

  it('reproduces an inclusive partial refund using the frozen source price divisor and derived discount', () => {
    const inclusive = sourceLine(71, {
      quantity: decimal(2),
      unit_price: decimal(119),
      total_amount: decimal(119),
      tax_amount: decimal(19),
      is_inclusive: true,
      price_unit_quantity: 2,
    });
    const source = sourceInvoice([inclusive], [{
      invoice_item_id: 71,
      tax_rate_id: 9,
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      tax_rate: decimal(19),
      taxable_amount: decimal(100),
      tax_amount: decimal(19),
      is_inclusive: true,
    }]);
    const result = deriveRefundNoteSelection(
      calculator,
      source,
      refund([refundItem({ quantity: decimal(1), refund_amount: decimal('47.60'), tax_amount: decimal('7.60') })]),
      [orderItem({ quantity: decimal(2) })],
    );

    expect(result.items[0]).toMatchObject({ source_invoice_item_id: 71, quantity: 1, unit_price: 119, discount_amount: 11.9 });
  });

  it('allocates taxed shipping from frozen rates with fractional cumulative quantity', () => {
    const source = sourceInvoice([
      sourceLine(71, { total_amount: decimal(100), unit_price: decimal(100) }),
      sourceLine(72, {
        product_id: null,
        product_variant_id: null,
        description: 'Envío del pedido',
        quantity: decimal(1),
        unit_price: decimal(119),
        total_amount: decimal(119),
        tax_amount: decimal(19),
        is_inclusive: true,
        financial_source_line: { source_order_item_id: null, kind: 'shipping' },
      }),
    ], [{
      invoice_item_id: 72,
      tax_rate_id: 9,
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      tax_rate: decimal(19),
      taxable_amount: decimal(100),
      tax_amount: decimal(19),
      is_inclusive: true,
    }]);
    const first = deriveRefundNoteSelection(
      calculator,
      source,
      refund([refundItem({ quantity: decimal('0.1'), refund_amount: decimal(10) })], decimal('23.80'), 300),
      [orderItem()],
    );
    const second = deriveRefundNoteSelection(
      calculator,
      source,
      refund([refundItem({ id: 302, quantity: decimal('0.1'), refund_amount: decimal(10) })], decimal('23.80'), 301),
      [orderItem()],
    );

    expect(first.items.find((item) => item.source_invoice_item_id === 72)?.quantity).toBe(0.2);
    expect(second.items.find((item) => item.source_invoice_item_id === 72)?.quantity).toBe(0.2);
    expect(
      decimal(first.items.find((item) => item.source_invoice_item_id === 72)?.quantity ?? 0)
        .plus(decimal(second.items.find((item) => item.source_invoice_item_id === 72)?.quantity ?? 0)),
    ).toEqual(decimal('0.4'));
    expect(first.bridge_rows).toHaveLength(1);
    expect(first.bridge_rows[0]?.covered_amount).toEqual(decimal(10));
  });

  it('does not treat a sellable product named “Transporte” as a shipping source', () => {
    const source = sourceInvoice([
      sourceLine(71, { description: 'Transporte', product_id: 5 }),
    ]);
    const refundSnapshot = refund([], decimal(10));

    try {
      deriveRefundNoteSelection(calculator, source, refundSnapshot, []);
      fail('expected shipping provenance to be unresolved');
    } catch (error) {
      const details = sourceErrorDetails(error);
      expect(details.reason).toBe('refund_source_mapping_required');
      expect(details.shipping_source_candidates).toEqual([]);
    }
  });

  it('rejects refund tax or total snapshots that the source calculator cannot reproduce', () => {
    const inclusive = sourceLine(71, {
      unit_price: decimal(119),
      total_amount: decimal(119),
      tax_amount: decimal(19),
      is_inclusive: true,
    });
    const source = sourceInvoice([inclusive], [{
      invoice_item_id: 71,
      tax_rate_id: 9,
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      tax_rate: decimal(19),
      taxable_amount: decimal(100),
      tax_amount: decimal(19),
      is_inclusive: true,
    }]);

    expect(() => deriveRefundNoteSelection(
      calculator,
      source,
      refund([refundItem({ refund_amount: decimal('59.50'), tax_amount: decimal(8) })]),
      [orderItem()],
    )).toThrow(VendixHttpException);
  });
});
