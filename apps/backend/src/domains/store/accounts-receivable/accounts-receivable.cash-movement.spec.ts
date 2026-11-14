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

  const setup = (
    record: jest.Mock,
    assertSessionForSales: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) => {
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
      { assertSessionForSales } as any,
    );
    return { tx, prisma, service };
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

  describe('QUI-893 — gate de caja antes de la tx', () => {
    it('abono manual sin caja abierta (cualquier método) se bloquea sin abrir la tx', async () => {
      const record = jest.fn();
      const gate = jest
        .fn()
        .mockRejectedValue(new Error('CASH_SESSION_REQUIRED_001'));
      const { prisma, service } = setup(record, gate);
      await expect(
        service.registerPayment(
          5,
          { amount: 50000, payment_method: 'bank_transfer' } as any,
          9,
        ),
      ).rejects.toThrow('CASH_SESSION_REQUIRED_001');
      expect(gate).toHaveBeenCalledWith(9);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('abono ligado a un cobro POS (payment_id) no se re-gatea', async () => {
      const gate = jest.fn();
      const { service } = setup(jest.fn(), gate);
      await service.registerPayment(
        5,
        { amount: 50000, payment_method: 'cash', payment_id: 3 } as any,
        9,
      );
      expect(gate).not.toHaveBeenCalled();
    });
  });
});
