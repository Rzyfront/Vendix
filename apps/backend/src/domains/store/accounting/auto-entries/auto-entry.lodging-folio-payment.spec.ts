import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · pago de folio hotelero (H3.4)', () => {
  const CODES: Record<string, string> = {
    'lodging.folio_payment.cash': '1105',
    'lodging.folio_payment.bank': '1110',
    'lodging.folio_payment.customer_advance': '2805',
  };

  const build = () => {
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) =>
        CODES[key] ? { account_code: CODES[key], source: 'default' } : null,
      ),
    };
    const service = new AutoEntryService(
      {} as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 1 } as any);
    return { service, create };
  };

  const payload = (over: Record<string, unknown> = {}) => ({
    payment_id: 1088,
    order_number: 'F-H-0001',
    organization_id: 1,
    store_id: 3,
    amount: 100000,
    payment_method_type: 'cash',
    customer: { id: 9, type: 'customer' },
    ...over,
  });

  it('el pago en efectivo es un anticipo: DR caja / CR 2805, nunca ingreso', async () => {
    const { service, create } = build();

    await service.onLodgingFolioPayment(payload());

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('lodging.folio_payment');
    expect(arg.source_id).toBe(1088);
    expect(arg.store_id).toBe(3);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '1105', debit_amount: 100000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '2805', debit_amount: 0, credit_amount: 100000 });
    expect(dr.third_party).toEqual({ id: 9, type: 'customer' });
    expect(arg.lines).toHaveLength(2);
  });

  it('tarjeta o transferencia van al banco', async () => {
    const { service, create } = build();

    await service.onLodgingFolioPayment(payload({ payment_method_type: 'card' }));

    expect((create.mock.calls[0][0] as any).lines[0].account_code).toBe('1110');
  });
});
