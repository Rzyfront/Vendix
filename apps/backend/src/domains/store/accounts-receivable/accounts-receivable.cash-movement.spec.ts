import { AccountsReceivableService } from './accounts-receivable.service';

/**
 * B04 — el abono de CxC en efectivo (sin payment_id del POS) deja un cash_in
 * con origen ar_payment dentro de la misma tx; sin sesión el abono se rechaza.
 */
describe('AccountsReceivableService.registerPayment — movimiento de caja (B04)', () => {
  const AR = {
    id: 5,
    store_id: 7,
    source_id: null,
    source_type: 'manual',
    balance: 100000,
    paid_amount: 0,
    original_amount: 100000,
    cancelled_amount: 0,
    status: 'open',
  };

  const setup = (record: jest.Mock) => {
    const tx = {
      accounts_receivable: {
        findFirst: jest.fn().mockResolvedValue(AR),
        update: jest.fn().mockResolvedValue({ id: 5 }),
      },
      ar_payments: { create: jest.fn().mockResolvedValue({ id: 80 }) },
      agreement_installments: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      accounts_receivable: { findFirst: jest.fn().mockResolvedValue(AR) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = new AccountsReceivableService(
      prisma as any,
      { emit: jest.fn() } as any,
      { recordModuleCashMovement: record } as any,
    );
    return { tx, service };
  };

  it('abono en efectivo registra cash_in con referencia y origen', async () => {
    const record = jest.fn().mockResolvedValue({ id: 1 });
    const { tx, service } = setup(record);
    await service.registerPayment(
      5,
      { amount: 50000, payment_method: 'cash' } as any,
      9,
    );
    expect(record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        store_id: 7,
        user_id: 9,
        direction: 'in',
        amount: 50000,
        payment_method: 'cash',
        source_type: 'ar_payment',
        source_id: 80,
        reference: 'Abono CxC #5',
      }),
    );
  });

  it('sin sesión el helper rechaza y la cuenta no se actualiza', async () => {
    const record = jest.fn().mockRejectedValue(new Error('CASH_SESSION_REQUIRED_001'));
    const { tx, service } = setup(record);
    await expect(
      service.registerPayment(5, { amount: 50000, payment_method: 'cash' } as any, 9),
    ).rejects.toThrow('CASH_SESSION_REQUIRED_001');
    expect(tx.accounts_receivable.update).not.toHaveBeenCalled();
  });

  it('abono ligado a un pago del POS (payment_id) no duplica el movimiento', async () => {
    const record = jest.fn();
    const { service } = setup(record);
    await service.registerPayment(
      5,
      { amount: 50000, payment_method: 'cash', payment_id: 3 } as any,
      9,
    );
    expect(record).not.toHaveBeenCalled();
  });
});
