import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · anticipo consumible de estaciones', () => {
  const CODES: Record<string, string> = {
    'service_deposit.cash': '1105',
    'service_deposit.bank': '1110',
    'service_deposit.customer_advance': '2805',
    'service_deposit.refund_cash': '1105',
    'service_deposit.refund_bank': '1110',
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
    return { service, create, mapping };
  };

  const base = {
    deposit_id: 51,
    organization_id: 1,
    store_id: 3,
    amount: 400000,
    booking_id: 70,
    session_id: null,
    customer: { id: 9, type: 'customer' as const },
  };

  it('recibir el anticipo en efectivo va a 2805 y no a ingresos: DR caja / CR 2805', async () => {
    const { service, create } = build();

    await service.onServiceDepositReceived({ ...base, payment_method_type: 'cash' });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('service_deposit.received');
    expect(arg.source_id).toBe(51);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '1105', debit_amount: 400000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '2805', debit_amount: 0, credit_amount: 400000 });
    expect(arg.lines).toHaveLength(2);
    const debits = arg.lines.reduce((s: number, l: any) => s + l.debit_amount, 0);
    const credits = arg.lines.reduce((s: number, l: any) => s + l.credit_amount, 0);
    expect(debits).toBe(credits);
  });

  it('Wompi, tarjeta o transferencia entran al banco', async () => {
    const { service, create } = build();

    await service.onServiceDepositReceived({ ...base, payment_method_type: 'wompi' });

    expect((create.mock.calls[0][0] as any).lines[0].account_code).toBe('1110');
  });

  it('el anticipo de una sesión se describe con la sesión', async () => {
    const { service, create } = build();

    await service.onServiceDepositReceived({ ...base, booking_id: null, session_id: 8, payment_method_type: 'cash' });

    expect((create.mock.calls[0][0] as any).description).toContain('sesión 8');
  });

  it('devolver el anticipo en efectivo es el asiento inverso: DR 2805 / CR caja, con su propia fuente', async () => {
    const { service, create } = build();

    await service.onServiceDepositRefunded({ ...base, deposit_id: 52, payment_method_type: 'cash' });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('service_deposit.refunded');
    expect(arg.source_id).toBe(52);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '2805', debit_amount: 400000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '1105', debit_amount: 0, credit_amount: 400000 });
  });

  it('devolver por transferencia sale del banco', async () => {
    const { service, create } = build();

    await service.onServiceDepositRefunded({ ...base, payment_method_type: 'bank_transfer' });

    expect((create.mock.calls[0][0] as any).lines[1].account_code).toBe('1110');
  });
});
