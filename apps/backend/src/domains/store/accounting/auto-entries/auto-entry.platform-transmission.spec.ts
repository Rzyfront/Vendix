import { ForbiddenException } from '@nestjs/common';

import { AutoEntryService } from './auto-entry.service';

/**
 * Platform documents (Vendix as DIAN issuer) reach accounting through
 * `invoice.accepted` with `invoice_id` = `fiscal_transmissions.id`, never an
 * `invoices` row, and without store context. The entry must post against the
 * platform entity, link back to the transmission, and never touch the
 * store-scoped `invoices` table (it threw "store context required" and rolled
 * the whole entry back).
 */
describe('AutoEntryService · platform transmissions', () => {
  const CODES: Record<string, string> = {
    'invoice.validated.accounts_receivable': '1305',
    'invoice.validated.revenue': '4135',
    'invoice.validated.vat_payable': '2408',
    'credit_note.accepted.sales_returns': '4175',
    'credit_note.accepted.vat_payable': '2408',
    'credit_note.accepted.accounts_receivable': '1305',
  };

  const storeScopedInvoices = () =>
    jest.fn(async () => {
      throw new ForbiddenException('Access denied - store context required');
    });

  const buildHandlers = () => {
    const unscoped = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      accounting_entries: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      payments: { findMany: jest.fn().mockResolvedValue([]) },
      refunds: { findMany: jest.fn().mockResolvedValue([]) },
      return_orders: { findMany: jest.fn().mockResolvedValue([]) },
      invoice_data_requests: { findMany: jest.fn().mockResolvedValue([]) },
      invoice_items: { findMany: jest.fn().mockResolvedValue([]) },
      chart_of_accounts: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const service = new AutoEntryService(
      {
        chart_of_accounts: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
        withoutScope: jest.fn().mockReturnValue(unscoped),
      } as any,
      {
        getMapping: jest.fn(async (_org: number, key: string) =>
          CODES[key] ? { account_code: CODES[key], source: 'default' } : null,
        ),
      } as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const createAutoEntry = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 999 } as any);
    return { service, createAutoEntry, unscoped };
  };

  const platformInvoice = {
    invoice_id: 2137,
    organization_id: 1,
    accounting_entity_id: 95,
    subtotal: 218487.4,
    tax_amount: 41512.6,
    total: 260000,
    platform_transmission: true,
  };

  it('invoice: posts the sale linked to the transmission without reading invoices', async () => {
    const { service, createAutoEntry, unscoped } = buildHandlers();

    await service.onInvoiceValidated(platformInvoice);

    expect(unscoped.invoices.findFirst).not.toHaveBeenCalled();
    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const data = createAutoEntry.mock.calls[0][0];
    expect(data).toMatchObject({
      source_type: 'invoice.validated',
      source_id: 2137,
      accounting_entity_id: 95,
      platform_transmission_id: 2137,
    });
    const lines = data.lines.filter(Boolean) as any[];
    const debit = lines.reduce((s, l) => s + Number(l.debit_amount), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit_amount), 0);
    expect(debit).toBeCloseTo(260000, 2);
    expect(credit).toBeCloseTo(260000, 2);
  });

  it('credit note: reverses without POS/reissue lookups on invoices', async () => {
    const { service, createAutoEntry, unscoped } = buildHandlers();

    await service.onCreditNoteAccepted({
      ...platformInvoice,
      invoice_id: 2200,
    });

    expect(unscoped.invoices.findFirst).not.toHaveBeenCalled();
    expect(unscoped.invoices.findMany).not.toHaveBeenCalled();
    expect(createAutoEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'credit_note.accepted',
        source_id: 2200,
        platform_transmission_id: 2200,
      }),
    );
  });

  it('store invoice keeps the previous behavior (sale-recognition lookup runs)', async () => {
    const { service, createAutoEntry, unscoped } = buildHandlers();

    await service.onInvoiceValidated({
      invoice_id: 55,
      organization_id: 1,
      store_id: 2,
      subtotal: 100,
      tax_amount: 19,
      total: 119,
    });

    expect(unscoped.invoices.findFirst).toHaveBeenCalled();
    expect(createAutoEntry.mock.calls[0][0]).not.toHaveProperty(
      'platform_transmission_id',
    );
  });

  describe('postAutoEntry back-link', () => {
    const buildTx = () => ({
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue({
          id: 95,
          scope: 'ORGANIZATION',
          store_id: null,
          organization_id: 1,
        }),
      },
      fiscal_periods: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 8, status: 'open' }),
      },
      chart_of_accounts: {
        findMany: jest.fn().mockResolvedValue(
          ['1305', '4135', '2408'].map((code, i) => ({
            id: i + 1,
            code,
            accounting_entity_id: 95,
            accepts_entries: true,
          })),
        ),
      },
      accounting_entries: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 5001 }),
      },
      accounting_entry_lines: { createMany: jest.fn() },
      invoices: { updateMany: storeScopedInvoices() },
      fiscal_transmissions: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    });

    const buildPoster = () => {
      const service = new AutoEntryService(
        { withoutScope: jest.fn() } as any,
        { getMapping: jest.fn() } as any,
        { resolveAccountingEntityForFiscal: jest.fn() } as any,
        {
          isAreaEnabled: jest.fn().mockResolvedValue(true),
          isSubflowEnabled: jest.fn().mockResolvedValue(true),
        } as any,
        { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
      );
      jest
        .spyOn(service as any, 'resolveEntryDate')
        .mockResolvedValue(new Date('2026-11-12T05:00:00.000Z'));
      return service;
    };

    const entry = (extra: Record<string, unknown> = {}) => ({
      source_type: 'invoice.validated',
      source_id: 2137,
      organization_id: 1,
      accounting_entity_id: 95,
      description: 'Invoice validated #2137',
      lines: [
        { account_code: '1305', description: 'AR', debit_amount: 260000, credit_amount: 0 },
        { account_code: '4135', description: 'Revenue', debit_amount: 0, credit_amount: 218487.4 },
        { account_code: '2408', description: 'VAT', debit_amount: 0, credit_amount: 41512.6 },
      ],
      ...extra,
    });

    it('platform: marks the transmission posted and never touches invoices', async () => {
      const tx = buildTx();
      const result = await buildPoster().postAutoEntry(
        entry({ platform_transmission_id: 2137 }) as any,
        tx as any,
      );

      expect(result).toMatchObject({ id: 5001 });
      expect(tx.invoices.updateMany).not.toHaveBeenCalled();
      expect(tx.fiscal_transmissions.updateMany).toHaveBeenCalledWith({
        where: { id: 2137, accounting_entity_id: 95 },
        data: { accounting_status: 'posted' },
      });
    });

    it('store invoice: still links the invoices row (previous behavior)', async () => {
      const tx = buildTx();
      tx.invoices.updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await buildPoster().postAutoEntry(entry({ store_id: 2 }) as any, tx as any);

      expect(tx.invoices.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 2137 }) }),
      );
      expect(tx.fiscal_transmissions.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ source_type: 'invoice', source_id: 2137 }),
        }),
      );
    });
  });
});
