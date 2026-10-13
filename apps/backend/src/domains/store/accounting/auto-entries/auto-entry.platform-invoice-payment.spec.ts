import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · cobro de factura de plataforma', () => {
  const CODES: Record<string, string> = {
    'payment.received.cash': '1105',
    'payment.received.bank': '1110',
    'payment.received.accounts_receivable': '1305',
  };

  const build = (existing: any = null) => {
    const unscoped = {
      accounting_entries: { findFirst: jest.fn().mockResolvedValue(existing) },
    };
    const prisma = { withoutScope: jest.fn().mockReturnValue(unscoped) };
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) =>
        CODES[key] ? { account_code: CODES[key], source: 'default' } : null,
      ),
    };
    const service = new AutoEntryService(
      prisma as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 777 } as any);
    return { service, create, unscoped };
  };

  const payload = (over: any = {}) => ({
    organization_id: 1,
    accounting_entity_id: 5,
    evidence_id: 42,
    transmission_id: 9,
    document_number: 'VNDS3',
    amount: 119000,
    payment_method: 'bank_transfer',
    paid_at: '2026-10-12',
    reference: 'TRX-1',
    ...over,
  });

  it('crea asiento balanceado DR banco / CR 1305', async () => {
    const { service, create } = build();
    await service.onPlatformInvoicePaymentReceived(payload());
    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('platform_invoice.payment_received');
    expect(arg.source_id).toBe(42);
    expect(arg.accounting_entity_id).toBe(5);
    expect(arg.store_id).toBeUndefined();
    expect(arg.description).toBe('Cobro factura VNDS3 (TRX-1)');
    expect(arg.entry_date.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '1110', debit_amount: 119000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '1305', debit_amount: 0, credit_amount: 119000 });
  });

  it('efectivo usa caja', async () => {
    const { service, create } = build();
    await service.onPlatformInvoicePaymentReceived(
      payload({ payment_method: 'cash', reference: null }),
    );
    const arg = create.mock.calls[0][0] as any;
    expect(arg.lines[0].account_code).toBe('1105');
    expect(arg.description).toBe('Cobro factura VNDS3');
  });

  it('segunda emisión con el mismo evidence_id no duplica', async () => {
    const { service, create } = build({ id: 500 });
    const res = await service.onPlatformInvoicePaymentReceived(payload());
    expect(res).toEqual({ id: 500 });
    expect(create).not.toHaveBeenCalled();
  });
});
