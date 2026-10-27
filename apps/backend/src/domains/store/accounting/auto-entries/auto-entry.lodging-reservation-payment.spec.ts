import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService · pago en línea de una reserva hotelera (H6.6)', () => {
  const CODES: Record<string, string> = {
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
    return { service, create, mapping };
  };

  it('el pago Wompi de la reserva es pago directo: DR banco / CR 2805, nunca ingreso ni cuentas del depósito', async () => {
    const { service, create, mapping } = build();

    await service.onLodgingReservationPayment({
      reservation_payment_id: 12,
      reservation_number: 'H-0040',
      organization_id: 1,
      store_id: 3,
      amount: 225000,
      customer: { id: 272, type: 'customer' },
    });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('lodging.reservation_payment');
    expect(arg.source_id).toBe(12);
    const [dr, cr] = arg.lines;
    expect(dr).toMatchObject({ account_code: '1110', debit_amount: 225000, credit_amount: 0 });
    expect(cr).toMatchObject({ account_code: '2805', debit_amount: 0, credit_amount: 225000 });
    expect(arg.lines).toHaveLength(2);
    expect(mapping.getMapping.mock.calls.map((call) => call[1])).toEqual([
      'lodging.folio_payment.bank',
      'lodging.folio_payment.customer_advance',
    ]);
  });
});

