import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · cruce de anticipos de la factura del folio (H3.7)', () => {
  const CODES: Record<string, string> = {
    'lodging.folio_settlement.customer_advance': '2805',
    'lodging.folio_settlement.receivable': '1305',
  };

  const build = (opts: { folio?: boolean; paid?: number; invoice?: boolean } = {}) => {
    const db = {
      invoices: {
        findFirst: jest.fn(async () =>
          opts.invoice === false ? null : { order_id: 500, store_id: 3, invoice_number: 'FE-120' },
        ),
      },
      lodging_folios: {
        findFirst: jest.fn(async () => (opts.folio === false ? null : { id: 40 })),
      },
      payments: {
        aggregate: jest.fn(async () => ({ _sum: { amount: opts.paid ?? 0 } })),
      },
    };
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) =>
        CODES[key] ? { account_code: CODES[key], source: 'default' } : null,
      ),
    };
    const service = new AutoEntryService(
      { withoutScope: () => db } as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 1 } as any);
    return { service, create, db };
  };

  const payload = (over: Record<string, unknown> = {}) => ({
    invoice_id: 120,
    organization_id: 1,
    store_id: 3,
    accounting_entity_id: 7,
    total: 595000,
    customer: { id: 9, type: 'customer' },
    ...over,
  });

  it('cruza lo pagado en el folio: DR 2805 / CR 1305, una vez por factura', async () => {
    const { service, create, db } = build({ paid: 400000 });

    await service.onLodgingFolioInvoiced(payload());

    expect(db.payments.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order_id: 500, state: { in: ['succeeded', 'captured'] } },
      }),
    );
    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('lodging.folio_settlement');
    expect(arg.source_id).toBe(120);
    expect(arg.accounting_entity_id).toBe(7);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '2805', debit_amount: 400000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '1305', debit_amount: 0, credit_amount: 400000 });
    expect(arg.lines).toHaveLength(2);
  });

  it('nunca cruza más que el total de la factura', async () => {
    const { service, create } = build({ paid: 700000 });

    await service.onLodgingFolioInvoiced(payload());

    expect((create.mock.calls[0][0] as any).lines[0].debit_amount).toBe(595000);
  });

  it('una factura que no es de un folio, o sin pagos, no crea asiento', async () => {
    const notFolio = build({ folio: false, paid: 100 });
    expect(await notFolio.service.onLodgingFolioInvoiced(payload())).toBeNull();
    expect(notFolio.create).not.toHaveBeenCalled();

    const unpaid = build({ paid: 0 });
    expect(await unpaid.service.onLodgingFolioInvoiced(payload())).toBeNull();
    expect(unpaid.create).not.toHaveBeenCalled();

    const creditNote = build({ invoice: false });
    expect(await creditNote.service.onLodgingFolioInvoiced(payload())).toBeNull();
    expect(creditNote.create).not.toHaveBeenCalled();
  });
});
