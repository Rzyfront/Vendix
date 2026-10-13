import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import { createPrismaMock, mockRequestContext } from '../../../../testing/prisma-mock';
import { buildInvoice } from '../../../../testing/money-fixtures';

/** Tax classifications are frozen on source rows; no catalog fallback in note writing. */
describe('CreditNotesService — source tax typing', () => {
  const money = (value: number | string) => new Prisma.Decimal(value);
  const PARENT_ID = 9100;
  const SOURCE_ITEM_ID = 9101;
  const ENTITY_ID = 3;
  const STORE_ID = 100;

  function setup(parentTaxes: Array<Record<string, unknown>>) {
    mockRequestContext({ organization_id: 1, store_id: STORE_ID, user_id: 5 });
    const parent = buildInvoice({
      id: PARENT_ID,
      organization_id: 1,
      store_id: STORE_ID,
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-1',
      status: 'accepted',
      accounting_entity_id: ENTITY_ID,
      currency: 'COP',
      subtotal_amount: money(1000),
      discount_amount: money(0),
      tax_amount: money(80),
      total_amount: money(1080),
      invoice_items: [{
        id: SOURCE_ITEM_ID,
        invoice_id: PARENT_ID,
        product_id: null,
        product_variant_id: null,
        description: 'Bandeja paisa',
        quantity: money(1),
        unit_price: money(1000),
        discount_amount: money(0),
        tax_amount: money(80),
        total_amount: money(1080),
        price_unit_quantity: 1,
        unit_code: 'NIU',
        account_code: '413595',
        stock_units_consumed: null,
        serial_numbers_snapshot: null,
        aiu_component: null,
        financial_source_line_id: null,
        is_inclusive: false,
      }],
      invoice_taxes: parentTaxes.map((tax) => ({ invoice_item_id: SOURCE_ITEM_ID, ...tax })),
    });
    const prisma = createPrismaMock({
      invoices: ['findFirst', 'create'],
      invoice_items: ['createMany', 'findMany'],
      invoice_taxes: ['createMany'],
      dian_document_events: ['findFirst'],
      fiscal_transmissions: ['findFirst'],
      tax_rates: ['findMany'],
    });
    (prisma as unknown as { withoutScope: () => unknown }).withoutScope = () => prisma;
    const persistedTaxes: Array<Record<string, unknown>> = [];
    let createdData: Record<string, unknown> | null = null;
    prisma.invoices.findFirst.mockImplementation(async ({ where }: { where?: { id?: number } }) => {
      if (where?.id === PARENT_ID) return parent;
      return { ...(createdData ?? {}), id: 8001, invoice_items: [], invoice_taxes: persistedTaxes };
    });
    prisma.dian_document_events.findFirst.mockResolvedValue(null);
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 8101, source_invoice_item_id: SOURCE_ITEM_ID }]);
    prisma.invoice_taxes.createMany.mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      persistedTaxes.push(...data);
      return { count: data.length };
    });
    prisma.invoices.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      createdData = data;
      return { id: 8001, ...data };
    });
    const numberGenerator = { generateNextNumber: jest.fn(async () => ({ invoice_number: 'NC1', resolution_id: 40 })) };
    const balance = { assertCanCreate: jest.fn(async () => undefined), remaining: jest.fn() };
    const service = new CreditNotesService(
      prisma as never,
      numberGenerator as never,
      { emit: jest.fn() } as never,
      { findFiscalAccountingEntityId: jest.fn(async () => ENTITY_ID) } as never,
      { assertAreaActive: jest.fn(async () => undefined) } as never,
      {} as never,
      new InvoiceCalculatorService(),
      balance as never,
    );
    return { service, prisma, persistedTaxes, numberGenerator, parent };
  }

  const incSourceTax = (overrides: Record<string, unknown> = {}) => ({
    tax_rate_id: 68,
    tax_name: 'INC 8%',
    tax_rate: money(8),
    taxable_amount: money(1000),
    tax_amount: money(80),
    tax_type: 'inc',
    is_inclusive: false,
    ...overrides,
  });

  const totalNote = (): CreateCreditNoteDto => ({
    related_invoice_id: PARENT_ID,
    reason: 'Anulación',
    issue_date: '2026-10-13',
  });

  it('total trusted reversal preserves an explicitly frozen INC type, without consulting tax catalog', async () => {
    const h = setup([incSourceTax()]);
    await h.service.createCreditNote(totalNote());

    expect(h.persistedTaxes[0]).toMatchObject({ tax_rate_id: 68, tax_name: 'INC 8%', tax_type: 'inc' });
    expect(h.prisma.tax_rates.findMany).not.toHaveBeenCalled();
  });

  it.each([['INC 8%', 'inc'], ['IVA', 'iva']])(
    'an untyped source row named %s is classified from its persisted fiscal name',
    async (taxName, taxType) => {
    const h = setup([incSourceTax({ tax_name: taxName, tax_type: null })]);
    await h.service.createCreditNote(totalNote());

    expect(h.persistedTaxes[0]?.tax_type).toBe(taxType);
    expect(h.prisma.tax_rates.findMany).not.toHaveBeenCalled();
    },
  );

  it('an untyped tax with an ambiguous persisted name fails SOURCE before numbering', async () => {
    const h = setup([incSourceTax({ tax_name: 'Cargo especial', tax_type: null, tax_rate_id: null })]);

    await expect(h.service.createCreditNote(totalNote())).rejects.toMatchObject({
      errorCode: 'INVOICING_NOTE_SOURCE_001',
    });
    expect(h.numberGenerator.generateNextNumber).not.toHaveBeenCalled();
    expect(h.prisma.invoices.create).not.toHaveBeenCalled();
    expect(h.prisma.tax_rates.findMany).not.toHaveBeenCalled();
  });

  it('an explicit source-linked partial uses the persisted typed tax, not a client tax payload', async () => {
    const h = setup([incSourceTax()]);
    const note = await h.service.createCreditNote({
      related_invoice_id: PARENT_ID,
      issue_date: '2026-10-13',
      items: [{ source_invoice_item_id: SOURCE_ITEM_ID, quantity: 1, unit_price: 1000 }],
    });

    expect(note.total_amount).toEqual(money(1080));
    expect(h.persistedTaxes[0]?.tax_type).toBe('inc');
    expect(h.prisma.tax_rates.findMany).not.toHaveBeenCalled();
  });
});
