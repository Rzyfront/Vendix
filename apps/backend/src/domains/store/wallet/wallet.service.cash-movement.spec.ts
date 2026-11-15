import { WalletService } from './wallet.service';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * QUI-893 — la recarga de billetera es dinero que entra: exige la caja abierta
 * de quien recarga (antes de la tx) y deja su movimiento en esa caja, en la
 * misma tx que el crédito.
 */
describe('WalletService.topUp — caja (QUI-893)', () => {
  const WALLET = { id: 21, customer_id: 3, store_id: 10, organization_id: 1 };

  const setup = (opts: { gate?: jest.Mock; record?: jest.Mock } = {}) => {
    const tx = { marker: 'tx' };
    const prisma = {
      wallets: { findFirst: jest.fn().mockResolvedValue(WALLET) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const walletBalance = {
      credit: jest.fn(),
      creditInTransaction: jest
        .fn()
        .mockResolvedValue({ transaction: { id: 500 }, balance_after: 50000 }),
    };
    const emitter = { emit: jest.fn() };
    const record = opts.record ?? jest.fn().mockResolvedValue({ id: 1 });
    const gate = opts.gate ?? jest.fn().mockResolvedValue(undefined);
    const service = new WalletService(
      prisma as any,
      walletBalance as any,
      emitter as any,
      { recordModuleCashMovement: record } as any,
      { assertSessionForSales: gate } as any,
    );
    return { tx, prisma, walletBalance, emitter, record, gate, service };
  };

  const STORE_CTX = { store_id: 10 };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(STORE_CTX as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('recarga en efectivo: acredita y registra el ingreso en la caja de quien recarga, en la misma tx', async () => {
    const { tx, walletBalance, record, gate, service } = setup();
    const result = await service.topUp(
      3,
      { amount: 50000, payment_method: 'cash' },
      9,
    );
    expect(gate).toHaveBeenCalledWith(9);
    expect(walletBalance.creditInTransaction).toHaveBeenCalledWith(
      tx,
      21,
      50000,
      expect.objectContaining({ reference_type: 'topup', created_by: 9 }),
    );
    expect(record).toHaveBeenCalledWith(tx, {
      store_id: 10,
      user_id: 9,
      direction: 'in',
      amount: 50000,
      payment_method: 'cash',
      source_type: 'wallet_topup',
      source_id: 500,
      reference: 'Recarga billetera #21',
      notes: undefined,
      include_non_cash: true,
    });
    expect(result).toEqual({ transaction: { id: 500 }, balance_after: 50000 });
  });

  it('recarga con otro método deja el registro con su método real', async () => {
    const { record, service } = setup();
    await service.topUp(
      3,
      { amount: 20000, payment_method: 'bank_transfer', reference: 'TRX-1' },
      9,
    );
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payment_method: 'bank_transfer',
        notes: 'TRX-1',
        include_non_cash: true,
      }),
    );
  });

  it('sin caja abierta se bloquea antes de la tx: no acredita ni emite', async () => {
    const gate = jest
      .fn()
      .mockRejectedValue(new Error('CASH_SESSION_REQUIRED_001'));
    const { prisma, walletBalance, emitter, record, service } = setup({ gate });
    await expect(
      service.topUp(3, { amount: 50000, payment_method: 'cash' }, 9),
    ).rejects.toThrow('CASH_SESSION_REQUIRED_001');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(walletBalance.creditInTransaction).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('si el movimiento falla dentro de la tx, el evento de recarga no se emite', async () => {
    const record = jest
      .fn()
      .mockRejectedValue(new Error('CASH_SESSION_REQUIRED_001'));
    const { emitter, service } = setup({ record });
    await expect(
      service.topUp(3, { amount: 50000, payment_method: 'cash' }, 9),
    ).rejects.toThrow('CASH_SESSION_REQUIRED_001');
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
