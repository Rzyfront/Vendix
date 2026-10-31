import { LayawayService } from './layaway.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * B04 — el abono de un separado en efectivo deja un cash_in con su origen
 * dentro de la tx del pago; sin sesión (caja habilitada) el abono se rechaza.
 */
describe('LayawayService.makePayment — movimiento de caja (B04)', () => {
  const PLAN = {
    id: 12,
    plan_number: 'LAY-0012',
    store_id: 10,
    customer_id: 3,
    state: 'active',
    currency: 'COP',
    paid_amount: 0,
    remaining_amount: 100000,
    layaway_installments: [],
  };

  const makeTx = (methodType: string | null) => ({
    layaway_plans: {
      findUnique: jest.fn().mockResolvedValue(PLAN),
      update: jest.fn().mockResolvedValue({}),
    },
    layaway_payments: {
      create: jest.fn().mockResolvedValue({ id: 77 }),
    },
    store_payment_methods: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          methodType ? { system_payment_method: { type: methodType } } : null,
        ),
    },
  });

  const build = (tx: any, recordModuleCashMovement: jest.Mock) => {
    const prisma = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const service = new LayawayService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      { recordModuleCashMovement } as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 10,
      user_id: 9,
      organization_id: 1,
    } as never);
    return service;
  };

  afterEach(() => jest.restoreAllMocks());

  it('abono en efectivo registra cash_in con origen layaway_payment', async () => {
    const tx = makeTx('cash');
    const record = jest.fn().mockResolvedValue({ id: 1 });
    await build(tx, record).makePayment(12, {
      amount: 50000,
      store_payment_method_id: 4,
    } as any);
    expect(record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        store_id: 10,
        user_id: 9,
        direction: 'in',
        amount: 50000,
        payment_method: 'cash',
        source_type: 'layaway_payment',
        source_id: 77,
        reference: 'Abono separado LAY-0012',
      }),
    );
  });

  it('sin sesión abierta el helper rechaza y el abono no se confirma', async () => {
    const tx = makeTx('cash');
    const record = jest
      .fn()
      .mockRejectedValue(new Error('CASH_SESSION_REQUIRED_001'));
    await expect(
      build(tx, record).makePayment(12, {
        amount: 50000,
        store_payment_method_id: 4,
      } as any),
    ).rejects.toThrow('CASH_SESSION_REQUIRED_001');
    // El rechazo ocurre antes de actualizar el plan.
    expect(tx.layaway_plans.update).not.toHaveBeenCalled();
  });

  it('sin método elegido no se asume efectivo', async () => {
    const tx = makeTx(null);
    const record = jest.fn();
    await build(tx, record).makePayment(12, { amount: 50000 } as any);
    expect(record).not.toHaveBeenCalled();
  });
});
