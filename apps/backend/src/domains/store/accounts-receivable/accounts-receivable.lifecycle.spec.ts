import { BadRequestException } from '@nestjs/common';
import { AccountsReceivableService } from './accounts-receivable.service';
import { lockOrderLifecycle } from '../orders/order-flow/order-lifecycle-lock.util';

jest.mock('../orders/order-flow/order-lifecycle-lock.util', () => ({
  lockOrderLifecycle: jest.fn(),
}));

const lifecycleLock = lockOrderLifecycle as jest.Mock;
const creditEvent = { order_id: 42, store_id: 7, total_amount: 100 };
const order = {
  id: 42,
  store_id: 7,
  customer_id: 9,
  order_number: 'POS-42',
  stores: { organization_id: 3 },
};
const creditAr = {
  id: 55,
  store_id: 7,
  source_id: 42,
  source_type: 'credit_sale',
  original_amount: 100,
  paid_amount: 0,
  cancelled_amount: 0,
  balance: 100,
  status: 'open',
};

function setup() {
  const tx = {
    accounts_receivable: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 55 }),
      update: jest.fn().mockResolvedValue({ id: 55 }),
    },
    orders: { findFirst: jest.fn().mockResolvedValue(order) },
    order_installments: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    agreement_installments: { findFirst: jest.fn().mockResolvedValue(null) },
    ar_payments: { create: jest.fn().mockResolvedValue({ id: 80 }) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  };
  const prisma = {
    orders: { findFirst: jest.fn().mockResolvedValue({ id: 42, store_id: 7 }) },
    accounts_receivable: { findFirst: jest.fn().mockResolvedValue(creditAr) },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new AccountsReceivableService(prisma as any, { emit: jest.fn() } as any);
  return { tx, prisma, service };
}

describe('AccountsReceivableService order lifecycle serialization', () => {
  beforeEach(() => jest.resetAllMocks());

  it('does not create collectible credit AR when cancellation wins the order lock', async () => {
    const { service, tx, prisma } = setup();
    lifecycleLock.mockResolvedValue({ id: 42, state: 'cancelled' });
    expect(await service.createCreditSaleFromEvent(creditEvent)).toBeNull();
    expect(lifecycleLock).toHaveBeenCalledWith(tx, 42, 7);
    expect(prisma.orders.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42, store_id: 7 },
    }));
    expect(tx.accounts_receivable.create).not.toHaveBeenCalled();
  });

  it('waits for a competing cancellation before deciding whether to insert', async () => {
    const { service, tx } = setup();
    let releaseCancellation!: () => void;
    const cancellationCommit = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    let waitingOnLock!: () => void;
    const reachedLock = new Promise<void>((resolve) => { waitingOnLock = resolve; });
    lifecycleLock.mockImplementation(async () => {
      waitingOnLock();
      await cancellationCommit;
      return { id: 42, state: 'cancelled' };
    });

    const pending = service.createCreditSaleFromEvent(creditEvent);
    await reachedLock;
    expect(tx.accounts_receivable.create).not.toHaveBeenCalled();
    releaseCancellation();
    expect(await pending).toBeNull();
    expect(tx.accounts_receivable.create).not.toHaveBeenCalled();
  });

  it('locks before checking an existing source AR and is idempotent on event retry', async () => {
    const { service, tx } = setup();
    lifecycleLock.mockResolvedValue({ id: 42, state: 'processing' });
    tx.accounts_receivable.findFirst.mockResolvedValue(creditAr);
    expect(await service.createCreditSaleFromEvent(creditEvent)).toEqual(creditAr);
    expect(tx.accounts_receivable.findFirst).toHaveBeenCalledWith({
      where: { store_id: 7, source_id: 42, source_type: { in: ['credit_sale', 'order'] } },
    });
    expect(tx.accounts_receivable.create).not.toHaveBeenCalled();
    expect(lifecycleLock.mock.invocationCallOrder[0]).toBeLessThan(tx.accounts_receivable.findFirst.mock.invocationCallOrder[0]);
  });

  it('creates only from the locked order tenant/customer, not event identity', async () => {
    const { service, tx } = setup();
    lifecycleLock.mockResolvedValue({ id: 42, state: 'processing' });
    await service.createCreditSaleFromEvent(creditEvent);
    expect(tx.accounts_receivable.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      store_id: 7, organization_id: 3, customer_id: 9,
      source_type: 'credit_sale', source_id: 42, balance: 100,
    }) });
  });

  it('rejects a late abono after cancellation acquires the lifecycle lock first', async () => {
    const { service, tx } = setup();
    lifecycleLock.mockResolvedValue({ id: 42, state: 'cancelled' });
    await expect(service.registerPayment(55, { amount: 20 }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.ar_payments.create).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('rechecks AR after the locks instead of using a stale pre-transaction balance', async () => {
    const { service, tx } = setup();
    lifecycleLock.mockResolvedValue({ id: 42, state: 'processing' });
    tx.accounts_receivable.findFirst.mockResolvedValue({ ...creditAr, balance: 10, paid_amount: 90 });
    await expect(service.registerPayment(55, { amount: 20 }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.ar_payments.create).not.toHaveBeenCalled();
    expect(lifecycleLock.mock.invocationCallOrder[0]).toBeLessThan(tx.$executeRawUnsafe.mock.invocationCallOrder[0]);
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(tx.accounts_receivable.findFirst.mock.invocationCallOrder[0]);
  });

  it('rejects cancelled AR even when its order remains active', async () => {
    const { service, tx } = setup();
    lifecycleLock.mockResolvedValue({ id: 42, state: 'processing' });
    tx.accounts_receivable.findFirst.mockResolvedValue({ ...creditAr, status: 'cancelled' });
    await expect(service.registerPayment(55, { amount: 20 }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.ar_payments.create).not.toHaveBeenCalled();
  });

  it('preserves payment registration for unrelated AR sources without an order lock', async () => {
    const { service, tx, prisma } = setup();
    const other = { ...creditAr, source_type: 'dispatch_route', source_id: 73 };
    prisma.accounts_receivable.findFirst.mockResolvedValue(other);
    tx.accounts_receivable.findFirst.mockResolvedValue(other);
    await service.registerPayment(55, { amount: 20 }, 1);
    expect(lifecycleLock).not.toHaveBeenCalled();
    expect(tx.ar_payments.create).toHaveBeenCalledTimes(1);
    expect(tx.accounts_receivable.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paid_amount: 20, balance: 80, status: 'partial' }),
    }));
  });
});
