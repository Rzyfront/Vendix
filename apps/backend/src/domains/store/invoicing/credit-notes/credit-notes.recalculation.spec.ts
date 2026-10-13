import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import { CreditNotesService } from './credit-notes.service';
import { createPrismaMock, mockRequestContext } from '../../../../testing/prisma-mock';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

const decimal = (value: number | string) => new Prisma.Decimal(value);

function sourceInvoice() {
  return {
    id: 7100,
    organization_id: 1,
    store_id: 100,
    accounting_entity_id: 3,
    invoice_type: 'sales_invoice',
    invoice_number: 'FV-7100',
    status: 'accepted',
    customer_id: 4,
    customer_name: 'Cliente',
    customer_tax_id: '900123456',
    customer_address: { city: 'Bogotá' },
    customer_document_type: '31',
    customer_verification_digit: '7',
    customer_email: 'cliente@example.test',
    customer_phone: '3000000000',
    customer_tax_regime: '48',
    customer_fiscal_responsibilities: ['R-99-PN'],
    customer_person_type: 'JURIDICA',
    order_id: 12,
    currency: 'COP',
    foreign_currency: null,
    foreign_total_amount: null,
    exchange_rate: null,
    exchange_rate_date: null,
    operation_type: null,
    aiu_contract_object: null,
    aiu_regime: null,
    aiu_minimum_percent: null,
    aiu_taxable_matrix: null,
    profile_id: null,
    profile_version: null,
    xml_document: '<accepted-xml-is-not-used-with-valid-source-units/>',
    subtotal_amount: decimal(200),
    discount_amount: decimal(0),
    tax_amount: decimal(54),
    total_amount: decimal(254),
    invoice_items: [{
      id: 501,
      invoice_id: 7100,
      product_id: 20,
      product_variant_id: 21,
      description: 'Servicio fuente',
      quantity: decimal(2),
      unit_price: decimal(100),
      discount_amount: decimal(0),
      tax_amount: decimal(54),
      total_amount: decimal(254),
      is_inclusive: false,
      price_unit_quantity: 1,
      unit_code: 'NIU',
      account_code: '413595',
      stock_units_consumed: 2,
      serial_numbers_snapshot: null,
      aiu_component: null,
      financial_source_line_id: null,
      financial_source_line: null,
      applied_price_tier_name: null,
    }],
    invoice_taxes: [
      {
        invoice_item_id: 501,
        tax_rate_id: 1,
        tax_name: 'IVA 19%',
        tax_type: 'iva',
        tax_rate: decimal(19),
        taxable_amount: decimal(200),
        tax_amount: decimal(38),
        is_inclusive: false,
      },
      {
        invoice_item_id: 501,
        tax_rate_id: 2,
        tax_name: 'INC 8%',
        tax_type: 'inc',
        tax_rate: decimal(8),
        taxable_amount: decimal(200),
        tax_amount: decimal(16),
        is_inclusive: false,
      },
    ],
    profile_snapshot: null,
  };
}

function setup(parent: Record<string, unknown> = sourceInvoice()) {
  mockRequestContext({ organization_id: 1, store_id: 100, user_id: 9 });
  const prisma = createPrismaMock({
    invoices: ['findFirst', 'findMany', 'create'],
    invoice_items: ['createMany', 'findMany'],
    invoice_taxes: ['createMany'],
    dian_document_events: ['findFirst'],
    fiscal_transmissions: ['findFirst'],
    refunds: ['findFirst'],
    order_items: ['findMany'],
    credit_note_refund_items: ['createMany'],
    store_settings: ['findFirst'],
  });
  (prisma as unknown as { withoutScope: () => unknown }).withoutScope = () => prisma;
  const generated: Array<Record<string, unknown>> = [];
  const persistedTaxes: Array<Record<string, unknown>> = [];
  let lastCreatedData: Record<string, unknown> | null = null;
  let nextItemId = 9001;
  prisma.invoices.findFirst.mockImplementation(async ({ where }: { where?: { id?: number } }) => {
    if ('refund_id' in (where ?? {})) return null;
    if (where?.id === parent.id) return parent;
    return {
      ...(lastCreatedData ?? {}),
      id: 9000,
      invoice_number: 'NC-1',
      invoice_type: 'credit_note',
      status: 'draft',
      invoice_items: [],
      invoice_taxes: persistedTaxes,
    };
  });
  prisma.dian_document_events.findFirst.mockResolvedValue(null);
  prisma.refunds.findFirst.mockResolvedValue(null);
  prisma.order_items.findMany.mockResolvedValue([]);
  prisma.invoice_items.findMany.mockImplementation(async () => [
    { id: nextItemId, source_invoice_item_id: 501 },
  ]);
  prisma.invoice_taxes.createMany.mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) => {
    persistedTaxes.push(...data);
    return { count: data.length };
  });
  prisma.invoices.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    generated.push(data);
    lastCreatedData = data;
    return { id: 9000, ...data };
  });
  const numberGenerator = {
    generateNextNumber: jest.fn(async () => ({ invoice_number: 'NC-1', resolution_id: 40 })),
  };
  const eventEmitter = { emit: jest.fn() };
  const fiscalScope = {
    resolveAccountingEntityForFiscal: jest.fn(async () => ({ id: 3 })),
    findFiscalAccountingEntityId: jest.fn(async () => 3),
  };
  const balance = {
    assertCanCreate: jest.fn(async () => undefined),
    remaining: jest.fn(async () => ({
      remaining_total: decimal(254),
      lines: new Map([[501, {
        remaining_quantity: decimal(2),
        remaining_base: decimal(200),
        remaining_total: decimal(254),
      }]]),
    })),
  };
  const service = new CreditNotesService(
    prisma as never,
    numberGenerator as never,
    eventEmitter as never,
    fiscalScope as never,
    { assertAreaActive: jest.fn(async () => undefined) } as never,
    {} as never,
    new InvoiceCalculatorService(),
    balance as never,
  );
  return { service, prisma, parent, generated, persistedTaxes, numberGenerator, balance, eventEmitter, fiscalScope };
}

describe('CreditNotesService calculator-backed writer and note context', () => {
  it('recalculates a partial multi-tax note and persists only linked calculator rows atomically', async () => {
    const h = setup();
    const note = await h.service.createCreditNote(plainToInstance(CreateCreditNoteDto, {
      related_invoice_id: 7100,
      issue_date: '2026-10-13',
      items: [{ source_invoice_item_id: 501, quantity: 1, unit_price: 100 }],
    }));

    expect(note.total_amount).toEqual(decimal(127));
    expect(h.generated[0]).toMatchObject({
      subtotal_amount: decimal(100),
      tax_amount: decimal(27),
      total_amount: decimal(127),
      currency: 'COP',
      foreign_currency: null,
      exchange_rate: null,
    });
    expect(h.prisma.invoice_items.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        source_invoice_item_id: 501,
        product_id: 20,
        quantity: decimal(1),
        total_amount: decimal(127),
      })],
    });
    expect(h.persistedTaxes).toHaveLength(2);
    expect(h.persistedTaxes.map((tax) => tax.invoice_item_id)).toEqual([9001, 9001]);
    expect(h.persistedTaxes.map((tax) => tax.tax_type)).toEqual(['iva', 'inc']);
    expect(h.prisma.credit_note_refund_items.createMany).not.toHaveBeenCalled();
    expect(h.balance.assertCanCreate).toHaveBeenCalledTimes(1);
    expect(h.numberGenerator.generateNextNumber).toHaveBeenCalledTimes(1);
    expect(h.prisma.products).toBeUndefined();
    expect(h.prisma.tax_rates).toBeUndefined();
  });

  it('rejects client fiscal fields, foreign lines, and currency changes before numbering', async () => {
    const h = setup();
    await expect(h.service.createCreditNote({
      related_invoice_id: 7100,
      taxes: [],
    } as never)).rejects.toMatchObject({ errorCode: 'INVOICING_NOTE_SOURCE_001' });
    await expect(h.service.createCreditNote({
      related_invoice_id: 7100,
      currency: 'USD',
      items: [{ source_invoice_item_id: 501, quantity: 1, unit_price: 100 }],
    })).rejects.toMatchObject({ errorCode: 'INVOICING_NOTE_SOURCE_001' });
    await expect(h.service.createCreditNote({
      related_invoice_id: 7100,
      items: [{ source_invoice_item_id: 999, quantity: 1, unit_price: 100 }],
    })).rejects.toMatchObject({ errorCode: 'INVOICING_NOTE_SOURCE_001' });
    expect(h.numberGenerator.generateNextNumber).not.toHaveBeenCalled();
    expect(h.prisma.invoices.create).not.toHaveBeenCalled();
  });

  it('serves explicit source-linked defaults and remaining credit without writes', async () => {
    const h = setup();
    const context = await h.service.getNoteContext(7100, 'credit_note');

    expect(context).toMatchObject({
      invoice_id: 7100,
      note_type: 'credit_note',
      items: [expect.objectContaining({
        source_invoice_item_id: 501,
        quantity: '2',
        unit_price: '100',
        remaining_quantity: '2',
        remaining_base: '200',
      })],
    });
    expect(context.items[0]?.taxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ tax_type: 'iva', tax_rate: '19.00' }),
      expect.objectContaining({ tax_type: 'inc', tax_rate: '8.00' }),
    ]));
    expect(h.balance.remaining).toHaveBeenCalledWith(7100);
    expect(h.fiscalScope.findFiscalAccountingEntityId).toHaveBeenCalledWith({ organization_id: 1, store_id: 100 });
    expect(h.fiscalScope.resolveAccountingEntityForFiscal).not.toHaveBeenCalled();
    expect(h.numberGenerator.generateNextNumber).not.toHaveBeenCalled();
    expect(h.prisma.invoices.create).not.toHaveBeenCalled();
    expect(h.prisma.invoice_items.createMany).not.toHaveBeenCalled();
    expect(h.prisma.invoice_taxes.createMany).not.toHaveBeenCalled();
  });

  it('derives partial foreign total from the frozen exchange rate, not the parent foreign total', async () => {
    const base = sourceInvoice();
    const parent = {
      ...base,
      invoice_items: [{
        ...base.invoice_items[0],
        quantity: decimal(2),
        unit_price: decimal(10000),
        tax_amount: decimal(0),
        total_amount: decimal(20000),
      }],
      invoice_taxes: [],
      subtotal_amount: decimal(20000),
      tax_amount: decimal(0),
      total_amount: decimal(20000),
      foreign_currency: 'USD',
      foreign_total_amount: decimal(25),
      exchange_rate: decimal(4000),
      exchange_rate_date: new Date('2026-10-01T00:00:00.000Z'),
    };
    const h = setup(parent);
    await h.service.createCreditNote({
      related_invoice_id: 7100,
      issue_date: '2026-10-13',
      items: [{ source_invoice_item_id: 501, quantity: 1, unit_price: 10000 }],
    });

    expect(h.generated[0]).toMatchObject({
      total_amount: decimal(10000),
      foreign_currency: 'USD',
      exchange_rate: decimal(4000),
      foreign_total_amount: decimal('2.50'),
    });
  });

  it.each([['missing', null], ['zero', decimal(0)]])(
    'rejects partial foreign notes with a %s frozen exchange rate before numbering',
    async (_label, rate) => {
      const parent = { ...sourceInvoice(), foreign_currency: 'USD', exchange_rate: rate };
      const h = setup(parent);
      await expect(h.service.createCreditNote({
        related_invoice_id: 7100,
        items: [{ source_invoice_item_id: 501, quantity: 1, unit_price: 100 }],
      })).rejects.toMatchObject({ errorCode: 'INVOICING_NOTE_SOURCE_001' });
      expect(h.numberGenerator.generateNextNumber).not.toHaveBeenCalled();
    },
  );

  it('preserves the source foreign total verbatim for an exact total reversal', async () => {
    const parent = {
      ...sourceInvoice(),
      foreign_currency: 'USD',
      foreign_total_amount: decimal(25),
      exchange_rate: decimal(4000),
    };
    const h = setup(parent);
    await h.service.createCreditNote({ related_invoice_id: 7100, issue_date: '2026-10-13' });

    expect(h.generated[0]).toMatchObject({
      total_amount: decimal(254),
      foreign_currency: 'USD',
      exchange_rate: decimal(4000),
      foreign_total_amount: decimal(25),
    });
  });

  it('derives refund note values from refund snapshots, source provenance, and atomically bridges coverage', async () => {
    const base = sourceInvoice();
    const parent = {
      ...base,
      invoice_items: [{
        ...base.invoice_items[0],
        financial_source_line_id: 88,
        financial_source_line: { source_order_item_id: 777, kind: 'product' },
      }],
    };
    const h = setup(parent);
    h.prisma.refunds.findFirst.mockResolvedValue({
      id: 66,
      order_id: 12,
      state: 'completed',
      reason: 'Devolución',
      shipping_refund: decimal(0),
      refund_items: [{
        id: 55,
        order_item_id: 777,
        quantity: decimal(1),
        discount_amount: decimal(0),
        tax_amount: decimal(27),
        refund_amount: decimal(127),
      }],
    });
    h.prisma.order_items.findMany.mockResolvedValue([{
      id: 777,
      product_id: 20,
      product_variant_id: 21,
      product_name: 'Servicio fuente',
      quantity: decimal(2),
    }]);

    const note = await h.service.createCreditNote({ related_invoice_id: 7100, refund_id: 66 });

    expect(note.total_amount).toEqual(decimal(127));
    expect(h.prisma.credit_note_refund_items.createMany).toHaveBeenCalledWith({
      skipDuplicates: false,
      data: [{
        credit_note_id: 9000,
        refund_item_id: 55,
        covered_qty: 1,
        covered_amount: decimal(127),
      }],
    });
    expect(h.prisma.order_items.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ unit_price: expect.anything() }),
    }));
  });

  it('bubbles refund bridge persistence failure from the same transaction without emitting success', async () => {
    const base = sourceInvoice();
    const parent = {
      ...base,
      invoice_items: [{
        ...base.invoice_items[0],
        financial_source_line_id: 88,
        financial_source_line: { source_order_item_id: 777, kind: 'product' },
      }],
    };
    const h = setup(parent);
    h.prisma.refunds.findFirst.mockResolvedValue({
      id: 66,
      order_id: 12,
      state: 'completed',
      reason: null,
      shipping_refund: decimal(0),
      refund_items: [{ id: 55, order_item_id: 777, quantity: decimal(1), discount_amount: decimal(0), tax_amount: decimal(27), refund_amount: decimal(127) }],
    });
    h.prisma.order_items.findMany.mockResolvedValue([{
      id: 777, product_id: 20, product_variant_id: 21, product_name: 'Servicio fuente', quantity: decimal(2),
    }]);
    h.prisma.credit_note_refund_items.createMany.mockRejectedValue(new Error('bridge failure'));

    await expect(h.service.createCreditNote({ related_invoice_id: 7100, refund_id: 66 })).rejects.toThrow('bridge failure');
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.eventEmitter.emit).not.toHaveBeenCalled();
  });
});
