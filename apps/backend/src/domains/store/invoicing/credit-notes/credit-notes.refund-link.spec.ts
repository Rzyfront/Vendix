import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import { deriveRefundNoteSelection, type RefundNoteSourceInvoice } from './refund-note-source.util';
import { recalculateNote } from './recalculate-note.util';

const decimal = (value: number | string) => new Prisma.Decimal(value);

function sourceLine(
  id: number,
  overrides: Partial<RefundNoteSourceInvoice['invoice_items'][number]> = {},
) {
  return {
    id,
    invoice_id: 9,
    product_id: 3,
    product_variant_id: null,
    description: 'Café',
    quantity: decimal(2),
    unit_price: decimal(2500),
    discount_amount: decimal(0),
    tax_amount: decimal(0),
    total_amount: decimal(5000),
    is_inclusive: false,
    price_unit_quantity: 1,
    unit_code: 'NIU',
    account_code: '413595',
    stock_units_consumed: 2,
    serial_numbers_snapshot: null,
    aiu_component: null,
    financial_source_line_id: null,
    ...overrides,
  };
}

function sourceInvoice(
  lines: readonly ReturnType<typeof sourceLine>[],
  invoiceTaxes: RefundNoteSourceInvoice['invoice_taxes'] = [],
): RefundNoteSourceInvoice {
  const lineTotal = lines.reduce((sum, line) => sum.plus(decimal(line.total_amount)), decimal(0));
  const taxTotal = lines.reduce((sum, line) => sum.plus(decimal(line.tax_amount)), decimal(0));
  return {
    id: 9,
    organization_id: 1,
    store_id: 100,
    accounting_entity_id: 3,
    invoice_items: lines,
    invoice_taxes: invoiceTaxes,
    subtotal_amount: lineTotal.minus(taxTotal),
    discount_amount: decimal(0),
    tax_amount: taxTotal,
    total_amount: lineTotal,
  };
}

const refundItem = (overrides: Record<string, unknown> = {}) => ({
  id: 201,
  order_item_id: 11,
  quantity: decimal(2),
  refund_amount: decimal(5000),
  discount_amount: decimal(0),
  tax_amount: decimal(0),
  ...overrides,
});
const refundRow = (overrides: Record<string, unknown> = {}) => ({
  id: 55,
  order_id: 1,
  state: 'completed',
  reason: 'cliente devolvió',
  shipping_refund: decimal(0),
  refund_items: [refundItem()],
  ...overrides,
});
const orderLine = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  product_id: 3,
  product_variant_id: null,
  product_name: 'Café',
  quantity: decimal(2),
  ...overrides,
});

function createService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    refunds: { findFirst: jest.fn().mockResolvedValue(refundRow()) },
    invoices: { findFirst: jest.fn().mockResolvedValue(null) },
    order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
    ...(overrides.prisma as object | undefined),
  };
  const service = new CreditNotesService(
    prisma as never,
    {} as never,
    { emit: jest.fn() } as never,
    { findFiscalAccountingEntityId: jest.fn(async () => 3) } as never,
    { assertAreaActive: jest.fn(async () => undefined) } as never,
    {} as never,
    new InvoiceCalculatorService(),
    { assertCanCreate: jest.fn(async () => undefined), remaining: jest.fn() } as never,
  );
  return { service, prisma };
}

const resolve = (service: CreditNotesService, dto: unknown, type: string, invoice: unknown) =>
  (service as unknown as { resolveRefundLink: (...args: unknown[]) => Promise<unknown> })
    .resolveRefundLink(dto, type, invoice);

const guidedDto = (over: Record<string, unknown> = {}) => ({ refund_id: 55, ...over });
const invoiceOf = (order_id: number | null) => ({ id: 9, order_id });

describe('CreditNotesService — refund provenance/lifecycle and source-backed selection', () => {
  it('returns the refund snapshot and order identity only; no order price or derived tax is used', async () => {
    const { service, prisma } = createService();
    const link = await resolve(service, guidedDto(), 'credit_note', invoiceOf(1)) as {
      refund: { id: number; order_id: number };
      refund_snapshot: { refund_items: Array<{ id: number; refund_amount: Prisma.Decimal }> };
      order_items: Array<Record<string, unknown>>;
      concept_code: string;
      default_reason: string;
    };

    expect(link.refund).toEqual({ id: 55, order_id: 1 });
    expect(link.refund_snapshot.refund_items[0]).toMatchObject({ id: 201, refund_amount: decimal(5000) });
    expect(link.order_items).toEqual([expect.objectContaining({ id: 11, product_name: 'Café', quantity: decimal(2) })]);
    expect(link.order_items[0]).not.toHaveProperty('unit_price');
    expect(link.concept_code).toBe('2');
    expect(link.default_reason).toContain('Reembolso #55 de la orden #1');
    expect(prisma.order_items.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ unit_price: expect.anything() }),
    }));
  });

  it('full refund defaults to concept 2; partial refund defaults to concept 1', async () => {
    const { service } = createService();
    const full = await resolve(service, guidedDto(), 'credit_note', invoiceOf(1)) as { concept_code: string };
    expect(full.concept_code).toBe('2');

    const { service: partial } = createService({
      prisma: {
        refunds: { findFirst: jest.fn().mockResolvedValue(refundRow({ refund_items: [refundItem({ quantity: decimal(1) })] })) },
      },
    });
    const result = await resolve(partial, guidedDto(), 'credit_note', invoiceOf(1)) as { concept_code: string };
    expect(result.concept_code).toBe('1');
  });

  it('maps refund amounts only through immutable source provenance and creates one structural bridge', () => {
    const source = sourceInvoice([sourceLine(71, {
      financial_source_line_id: 90,
      financial_source_line: { source_order_item_id: 11, kind: 'order_item' },
    })]);
    const selected = deriveRefundNoteSelection(
      new InvoiceCalculatorService(),
      source,
      { id: 55, order_id: 1, shipping_refund: 0, refund_items: [refundItem({ quantity: decimal(1), refund_amount: decimal(2500) })] },
      [orderLine()],
    );

    expect(selected.items).toEqual([expect.objectContaining({ source_invoice_item_id: 71, quantity: 1, unit_price: 2500 })]);
    expect(selected.bridge_rows).toEqual([expect.objectContaining({
      refund_item_id: 201,
      covered_qty: 1,
      covered_amount: decimal(2500),
    })]);
  });

  it('shipping-only refund resolves from the frozen shipping source and has no refund-item bridge', () => {
    const shipping = sourceLine(72, {
      product_id: null,
      product_variant_id: null,
      description: 'Envío del pedido',
      quantity: decimal(1),
      unit_price: decimal(119),
      tax_amount: decimal(19),
      total_amount: decimal(119),
      is_inclusive: true,
      financial_source_line_id: 91,
      financial_source_line: { source_order_item_id: null, kind: 'shipping' },
    });
    const source = sourceInvoice([shipping], [{
      invoice_item_id: 72,
      tax_rate_id: 9,
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      tax_rate: decimal(19),
      taxable_amount: decimal(100),
      tax_amount: decimal(19),
      is_inclusive: true,
    }]);
    const selected = deriveRefundNoteSelection(
      new InvoiceCalculatorService(),
      source,
      { id: 55, order_id: 1, shipping_refund: decimal('23.80'), refund_items: [] },
      [],
    );

    expect(selected.items).toEqual([expect.objectContaining({
      source_invoice_item_id: 72,
      quantity: 0.2,
      unit_price: 119,
      discount_amount: 0,
      unit_code: 'NIU',
    })]);
    expect(selected.bridge_rows).toEqual([]);
  });

  it('refund lines plus shipping include the shipping line but bridge only the refund item', () => {
    const product = sourceLine(71, {
      quantity: decimal(2),
      unit_price: decimal(2500),
      total_amount: decimal(5000),
      financial_source_line: { source_order_item_id: 11, kind: 'order_item' },
    });
    const shipping = sourceLine(72, {
      product_id: null,
      description: 'Envío del pedido',
      quantity: decimal(1),
      unit_price: decimal(3000),
      total_amount: decimal(3000),
      financial_source_line: { source_order_item_id: null, kind: 'shipping' },
    });
    const selected = deriveRefundNoteSelection(
      new InvoiceCalculatorService(),
      sourceInvoice([product, shipping]),
      { id: 55, order_id: 1, shipping_refund: decimal(3000), refund_items: [refundItem({ quantity: decimal(2), refund_amount: decimal(5000) })] },
      [orderLine()],
    );

    expect(selected.items.map((item) => item.source_invoice_item_id)).toEqual([71, 72]);
    expect(selected.bridge_rows).toEqual([expect.objectContaining({ refund_item_id: 201, covered_qty: 2, covered_amount: decimal(5000) })]);
  });

  it('untaxed shipping remains a single source-linked line with zero taxes and no bridge', () => {
    const shipping = sourceLine(72, {
      product_id: null,
      description: 'Envío del pedido',
      quantity: decimal(1),
      unit_price: decimal(3000),
      total_amount: decimal(3000),
      financial_source_line: { source_order_item_id: null, kind: 'shipping' },
    });
    const selected = deriveRefundNoteSelection(
      new InvoiceCalculatorService(),
      sourceInvoice([shipping]),
      { id: 55, order_id: 1, shipping_refund: decimal(3000), refund_items: [] },
      [],
    );
    expect(selected.items).toEqual([expect.objectContaining({ source_invoice_item_id: 72, quantity: 1, unit_price: 3000 })]);
    expect(selected.bridge_rows).toEqual([]);
  });

  it('two fractional taxed-shipping refunds add by source quantity while each keeps its own bridge', () => {
    const product = sourceLine(71, {
      quantity: decimal(1),
      unit_price: decimal(100),
      total_amount: decimal(100),
      financial_source_line: { source_order_item_id: 11, kind: 'order_item' },
    });
    const shipping = sourceLine(72, {
      product_id: null,
      description: 'Envío gravado',
      quantity: decimal(1),
      unit_price: decimal(119),
      total_amount: decimal(119),
      tax_amount: decimal(19),
      is_inclusive: true,
      financial_source_line: { source_order_item_id: null, kind: 'shipping' },
    });
    const source = sourceInvoice([product, shipping], [{
      invoice_item_id: 72,
      tax_rate_id: 9,
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      tax_rate: decimal(19),
      taxable_amount: decimal(100),
      tax_amount: decimal(19),
      is_inclusive: true,
    }]);
    const calculator = new InvoiceCalculatorService();
    const selected = [300, 301].map((id) => deriveRefundNoteSelection(
      calculator,
      source,
      {
        id,
        order_id: 1,
        shipping_refund: decimal('23.80'),
        refund_items: [refundItem({ id: id + 1, quantity: decimal('0.1'), refund_amount: decimal(10) })],
      },
      [orderLine({ quantity: decimal(1) })],
    ));
    const shippingQuantities = selected.map((result) => result.items.find((item) => item.source_invoice_item_id === 72)?.quantity ?? 0);
    expect(shippingQuantities).toEqual([0.2, 0.2]);
    expect(decimal(shippingQuantities[0] ?? 0).plus(decimal(shippingQuantities[1] ?? 0))).toEqual(decimal('0.4'));
    expect(selected.map((result) => result.bridge_rows[0]?.covered_amount)).toEqual([decimal(10), decimal(10)]);
    expect(selected.map((result) => result.items.find((item) => item.source_invoice_item_id === 72)?.discount_amount)).toEqual([0, 0]);
  });

  it('recalculates a mixed IVA-product and INC-shipping refund to the exact frozen 115000 total', () => {
    const product = sourceLine(71, {
      quantity: decimal(1),
      unit_price: decimal('84033.62'),
      tax_amount: decimal('15966.38'),
      total_amount: decimal(100000),
      is_inclusive: false,
      financial_source_line_id: 90,
      financial_source_line: { source_order_item_id: 11, kind: 'order_item' },
    });
    const shipping = sourceLine(72, {
      product_id: null,
      description: 'Envío del pedido',
      quantity: decimal(1),
      unit_price: decimal(15000),
      tax_amount: decimal('1111.11'),
      total_amount: decimal(15000),
      is_inclusive: true,
      financial_source_line_id: 91,
      financial_source_line: { source_order_item_id: null, kind: 'shipping' },
    });
    const source = sourceInvoice([product, shipping], [
      {
        invoice_item_id: 71,
        tax_rate_id: 8,
        tax_name: 'IVA 19%',
        tax_type: 'iva',
        tax_rate: decimal(19),
        taxable_amount: decimal('84033.62'),
        tax_amount: decimal('15966.38'),
        is_inclusive: false,
      },
      {
        invoice_item_id: 72,
        tax_rate_id: 9,
        tax_name: 'INC 8%',
        tax_type: 'inc',
        tax_rate: decimal(8),
        taxable_amount: decimal('13888.89'),
        tax_amount: decimal('1111.11'),
        is_inclusive: true,
      },
    ]);
    const calculator = new InvoiceCalculatorService();
    const selected = deriveRefundNoteSelection(
      calculator,
      source,
      {
        id: 55,
        order_id: 1,
        shipping_refund: decimal(15000),
        refund_items: [refundItem({ quantity: decimal(1), refund_amount: decimal(100000), tax_amount: decimal('15966.38') })],
      },
      [orderLine({ quantity: decimal(1) })],
    );
    const result = recalculateNote(calculator, source, selected.items);

    expect(result.total_amount).toEqual(decimal(115000));
    expect(result.tax_amount).toEqual(decimal('17077.49'));
    expect(result.items.map((item) => item.source_invoice_item_id)).toEqual([71, 72]);
    expect(result.calculated.header_taxes.map((tax) => [tax.tax_type, tax.tax_amount])).toEqual([
      ['iva', '15966.38'],
      ['inc', '1111.11'],
    ]);
    expect(selected.bridge_rows).toEqual([expect.objectContaining({
      refund_item_id: 201,
      covered_qty: 1,
      covered_amount: decimal(100000),
    })]);
  });

  it('fails closed when a refund order item has no source-invoice mapping', () => {
    const source = sourceInvoice([sourceLine(71, {
      financial_source_line_id: 90,
      financial_source_line: { source_order_item_id: 999, kind: 'order_item' },
    })]);
    expect(() => deriveRefundNoteSelection(
      new InvoiceCalculatorService(),
      source,
      { id: 55, order_id: 1, shipping_refund: 0, refund_items: [refundItem()] },
      [orderLine()],
    )).toThrow(expect.objectContaining({ errorCode: 'INVOICING_NOTE_SOURCE_001' }));
  });

  it('no refund id returns null and does not query refunds', async () => {
    const { service, prisma } = createService();
    await expect(resolve(service, {}, 'credit_note', invoiceOf(1))).resolves.toBeNull();
    expect(prisma.refunds.findFirst).not.toHaveBeenCalled();
  });

  it('debit + refund, refund + explicit items, missing refund, missing order, and cross-order all reject', async () => {
    const { service } = createService();
    await expect(resolve(service, guidedDto(), 'debit_note', invoiceOf(1))).rejects.toMatchObject({ errorCode: 'FISCAL_DOCUMENT_UNSUPPORTED' });
    await expect(resolve(service, guidedDto({ items: [{ source_invoice_item_id: 71, quantity: 1, unit_price: 1 }] }), 'credit_note', invoiceOf(1)))
      .rejects.toMatchObject({ errorCode: 'INVOICING_NOTE_SOURCE_001' });

    const missing = createService({ prisma: { refunds: { findFirst: jest.fn().mockResolvedValue(null) } } });
    await expect(resolve(missing.service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({ errorCode: 'INVOICING_FIND_001' });
    await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(null))).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(2))).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
  });

  it('refund failed/cancelled, live/reserved uncertain link, and P2002 race remain blocked', async () => {
    const failed = createService({ prisma: { refunds: { findFirst: jest.fn().mockResolvedValue(refundRow({ state: 'failed' })) } } });
    await expect(resolve(failed.service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    const cancelled = createService({ prisma: { refunds: { findFirst: jest.fn().mockResolvedValue(refundRow({ state: 'cancelled' })) } } });
    await expect(resolve(cancelled.service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });

    const live = createService({ prisma: { invoices: { findFirst: jest.fn().mockResolvedValue({ id: 12, invoice_number: 'NC-1', status: 'draft' }) } } });
    await expect(resolve(live.service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    expect(live.prisma.invoices.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        refund_id: 55,
        invoice_type: 'credit_note',
        OR: expect.arrayContaining([
          expect.objectContaining({ credit_limit_reserved_at: { not: null } }),
          expect.objectContaining({ transmission_status: expect.objectContaining({ in: expect.arrayContaining(['submitted', 'retrying']) }) }),
        ]),
      }),
    }));

    const { service, prisma } = createService();
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    const link = { refund: { id: 55, order_id: 1 } };
    prisma.invoices.findFirst.mockResolvedValue({ id: 12, invoice_number: 'NC-1', status: 'draft' });
    await expect((service as unknown as { throwIfDuplicateRefundLink: (...args: unknown[]) => Promise<never> }).throwIfDuplicateRefundLink(p2002, link))
      .rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    prisma.invoices.findFirst.mockResolvedValue(null);
    await expect((service as unknown as { throwIfDuplicateRefundLink: (...args: unknown[]) => Promise<never> }).throwIfDuplicateRefundLink(p2002, link)).rejects.toBe(p2002);
    const otherError = new Error('db failure');
    await expect((service as unknown as { throwIfDuplicateRefundLink: (...args: unknown[]) => Promise<never> }).throwIfDuplicateRefundLink(otherError, link)).rejects.toBe(otherError);
    await expect((service as unknown as { throwIfDuplicateRefundLink: (...args: unknown[]) => Promise<never> }).throwIfDuplicateRefundLink(p2002, null)).rejects.toBe(p2002);
  });

  it('empty refund cannot fall back to total note; the source mapper rejects it', () => {
    const source = sourceInvoice([sourceLine(71, { financial_source_line: { source_order_item_id: 11, kind: 'order_item' } })]);
    expect(() => deriveRefundNoteSelection(
      new InvoiceCalculatorService(),
      source,
      { id: 55, order_id: 1, shipping_refund: 0, refund_items: [] },
      [orderLine()],
    )).toThrow(expect.objectContaining({ errorCode: 'INVOICING_NOTE_SOURCE_001' }));
  });
});
