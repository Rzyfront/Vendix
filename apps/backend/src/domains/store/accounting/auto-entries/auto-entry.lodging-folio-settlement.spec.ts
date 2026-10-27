import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · cruce de anticipos de la factura del folio (H3.7)', () => {
  const CODES: Record<string, string> = {
    'lodging.folio_settlement.customer_advance': '2805',
    'lodging.folio_settlement.receivable': '1305',
  };

  const build = (
    opts: {
      folio?: boolean;
      paid?: number;
      invoice?: boolean;
      payers?: Array<{ customer_id: number | null; amount: number }>;
      crossed?: boolean;
    } = {},
  ) => {
    const payers = opts.payers ?? [{ customer_id: 9, amount: opts.paid ?? 0 }];
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
        groupBy: jest.fn(async () =>
          payers.map((p) => ({ customer_id: p.customer_id, _sum: { amount: p.amount } })),
        ),
      },
      accounting_entries: {
        findFirst: jest.fn(async () => (opts.crossed ? { id: 77 } : null)),
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

    expect(db.payments.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['customer_id'],
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

  it('facturado a empresa: debita 2805 por el huésped que pagó y acredita 1305 a la empresa', async () => {
    const { service, create } = build({
      payers: [
        { customer_id: 9, amount: 200000 },
        { customer_id: 15, amount: 100000 },
      ],
    });

    await service.onLodgingFolioInvoiced(payload({ customer: { id: 50, type: 'customer' } }));

    const lines = (create.mock.calls[0][0] as any).lines;
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ account_code: '2805', debit_amount: 200000, third_party: expect.objectContaining({ id: 9 }) });
    expect(lines[1]).toMatchObject({ account_code: '2805', debit_amount: 100000, third_party: expect.objectContaining({ id: 15 }) });
    expect(lines[2]).toMatchObject({ account_code: '1305', credit_amount: 300000, third_party: expect.objectContaining({ id: 50 }) });
  });

  it('si el check-out sin FE ya cruzó el anticipo, la factura posterior no lo cruza otra vez', async () => {
    const { service, create } = build({ paid: 400000, crossed: true });
    expect(await service.onLodgingFolioInvoiced(payload())).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AutoEntryService · venta de folio sin facturación electrónica (decisión 3)', () => {
  const build = (paid: number) => {
    const db = {
      payments: {
        groupBy: jest.fn(async () => [{ customer_id: 9, _sum: { amount: paid } }]),
      },
    };
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) => {
        const codes: Record<string, string> = {
          'lodging.folio_settlement.customer_advance': '2805',
          'lodging.folio_settlement.receivable': '1305',
        };
        return codes[key] ? { account_code: codes[key], source: 'default' } : null;
      }),
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
    const sale = jest.spyOn(service, 'onCreditSaleCreated').mockResolvedValue({ id: 2 } as any);
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 3 } as any);
    return { service, sale, create };
  };

  const payload = {
    order_id: 500,
    organization_id: 1,
    store_id: 3,
    order_number: 'F-H-0001',
    subtotal_amount: 500000,
    tax_amount: 95000,
    total_amount: 595000,
    customer: { id: 9, name: 'Ana' },
  };

  it('reconoce la venta con el asiento de venta POS (ingreso + impuestos) y cruza el 2805, por order_id', async () => {
    const { service, sale, create } = build(595000);

    await service.onLodgingFolioSale(payload);

    expect(sale).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 500, source_type: 'lodging.folio_sale', total_amount: 595000 }),
    );
    const cross = create.mock.calls[0][0] as any;
    expect(cross.source_type).toBe('lodging.folio_sale_settlement');
    expect(cross.source_id).toBe(500);
    expect(cross.lines[0]).toMatchObject({ account_code: '2805', debit_amount: 595000 });
    expect(cross.lines[1]).toMatchObject({ account_code: '1305', credit_amount: 595000 });
  });

  it('sin pagos (todo a crédito) solo reconoce la venta; 1305 queda por cobrar', async () => {
    const { service, sale, create } = build(0);

    const result = await service.onLodgingFolioSale(payload);

    expect(sale).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(result.cross).toBeNull();
  });
});
