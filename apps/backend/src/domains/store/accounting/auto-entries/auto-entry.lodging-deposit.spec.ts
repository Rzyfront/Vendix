import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · depósito de reserva hotelera (H3.5)', () => {
  const CODES: Record<string, string> = {
    'lodging.deposit.cash': '1105',
    'lodging.deposit.bank': '1110',
    'lodging.deposit.customer_advance': '2805',
    'lodging.deposit_retained.customer_advance': '2805',
    'lodging.deposit_retained.penalty_income': '4295',
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

  const base = {
    deposit_id: 41,
    reservation_number: 'H-0001',
    organization_id: 1,
    store_id: 3,
    amount: 225000,
    customer: { id: 9, type: 'customer' as const },
  };

  it('el depósito en efectivo va a 2805 y no a ingresos: DR caja / CR 2805', async () => {
    const { service, create } = build();

    await service.onLodgingDeposit({ ...base, payment_method_type: 'cash' });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('lodging.deposit');
    expect(arg.source_id).toBe(41);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '1105', debit_amount: 225000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '2805', debit_amount: 0, credit_amount: 225000 });
    expect(arg.lines).toHaveLength(2);
    expect(arg.lines.some((l: any) => String(l.account_code).startsWith('4'))).toBe(false);
  });

  it('el link Wompi, la tarjeta o la transferencia entran al banco', async () => {
    const { service, create } = build();

    await service.onLodgingDeposit({ ...base, payment_method_type: 'wompi' });

    expect((create.mock.calls[0][0] as any).lines[0].account_code).toBe('1110');
  });

  it('la penalidad retenida sale de 2805 hacia el ingreso por penalidad', async () => {
    const { service, create } = build();

    await service.onLodgingDepositRetained({ ...base, deposit_id: 42 });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('lodging.deposit_retained');
    expect(arg.source_id).toBe(42);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '2805', debit_amount: 225000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '4295', debit_amount: 0, credit_amount: 225000 });
  });

  it('H6.6 — la penalidad retenida del pago en línea sale de 2805 hacia el ingreso, con su propia fuente', async () => {
    const { service, create } = build();

    await service.onLodgingReservationPaymentRetained({ ...base, reservation_payment_id: 7 });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('lodging.reservation_payment_retained');
    expect(arg.source_id).toBe(7);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '2805', debit_amount: 225000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '4295', debit_amount: 0, credit_amount: 225000 });
  });
});
