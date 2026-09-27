import { WalletBalanceService } from './wallet-balance.service';
import { Prisma } from '@prisma/client';

describe('WalletBalanceService.debit payment retry', () => {
  it('locks the wallet and reuses one ledger debit for a reserved payment', async () => {
    const wallet = { id: 9, store_id: 3, customer_id: 5, is_active: true,
      balance: 20000, held_balance: 0 };
    let ledger: any = null;
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 12, state: 'pending_payment' }]),
      payments: {
        findUnique: jest.fn().mockResolvedValue({ order_id: 12 }),
        findFirst: jest.fn().mockResolvedValue({ state: 'pending', amount: new Prisma.Decimal(11900),
          orders: { store_id: 3, customer_id: 5 } }),
      },
      wallets: {
        findUnique: jest.fn(async () => wallet),
        update: jest.fn(async ({ data }) => { wallet.balance = data.balance; }),
      },
      wallet_transactions: {
        findFirst: jest.fn(async () => ledger),
        create: jest.fn(async ({ data }) => {
          ledger = { id: 40, ...data };
          return ledger;
        }),
      },
    };
    const service = new WalletBalanceService({ $transaction: (fn) => fn(tx) } as any);
    const params = { reference_type: 'payment', reference_id: 77,
      expected_store_id: 3, expected_customer_id: 5 };

    const first = await service.debit(9, 11900, params);
    const retry = await service.debit(9, 11900, params);

    expect(first.transaction.id).toBe(40);
    expect(retry.transaction.id).toBe(40);
    expect(tx.wallets.update).toHaveBeenCalledTimes(1);
    expect(tx.wallet_transactions.create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it('rejects a wallet belonging to a different customer before debiting', async () => {
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([{ id: 12, state: 'pending_payment' }]),
      payments: { findUnique: jest.fn().mockResolvedValue({ order_id: 12 }),
        findFirst: jest.fn().mockResolvedValue({ state: 'pending', amount: new Prisma.Decimal(11900),
          orders: { store_id: 3, customer_id: 5 } }) }, wallets: {
      findUnique: jest.fn().mockResolvedValue({ id: 9, store_id: 3,
        customer_id: 6, is_active: true, balance: 20000, held_balance: 0 }),
      update: jest.fn(),
    } };
    const service = new WalletBalanceService({ $transaction: (fn) => fn(tx) } as any);
    await expect(service.debit(9, 11900, { reference_type: 'payment', reference_id: 77,
      expected_store_id: 3, expected_customer_id: 5 })).rejects.toThrow();
    expect(tx.wallets.update).not.toHaveBeenCalled();
  });
});
