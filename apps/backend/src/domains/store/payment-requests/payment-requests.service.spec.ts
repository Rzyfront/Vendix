import { createHash } from 'crypto';
import { VendixHttpException } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import {
  hashPaymentRequestToken,
  PaymentRequestsService,
} from './payment-requests.service';

describe('PaymentRequestsService', () => {
  let service: PaymentRequestsService;
  let tx: any;
  let prisma: any;
  let foreignLookup: jest.Mock;
  let events: { emit: jest.Mock };
  let runner: { runInStoreContext: jest.Mock };
  let s3: any;
  let paymentLinks: any;
  let response: any;

  beforeEach(() => {
    tx = {
      payment_requests: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    foreignLookup = jest.fn();
    prisma = {
      payment_requests: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
      },
      withoutScope: () => ({ payment_requests: { findFirst: foreignLookup } }),
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    events = { emit: jest.fn() };
    runner = { runInStoreContext: jest.fn((_id: number, cb: () => any) => cb()) };
    s3 = { getPresignedUrl: jest.fn().mockResolvedValue('https://signed') };
    paymentLinks = { deactivate: jest.fn() };
    response = { success: jest.fn((d: any) => ({ success: true, data: d })) };
    service = new PaymentRequestsService(
      prisma,
      events as any,
      runner as any,
      s3,
      paymentLinks,
      response,
    );
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(3);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createInTx', () => {
    it('returns a base64url token and stores only its sha256', async () => {
      const { request, publicToken } = await service.createInTx(tx, {
        purpose: 'service_deposit',
        amount: 400000,
        description: 'Anticipo Cava 3',
        expires_at: new Date('2026-11-05T00:00:00Z'),
      });

      expect(publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const data = tx.payment_requests.create.mock.calls[0][0].data;
      expect(data.public_token_hash).toBe(createHash('sha256').update(publicToken).digest('hex'));
      expect(data.public_token_hash).toBe(hashPaymentRequestToken(publicToken));
      expect(JSON.stringify(data)).not.toContain(publicToken);
      expect(data.store_id).toBe(7);
      expect(request.id).toBe(1);
    });

    it('rejects a non positive amount', async () => {
      await expect(
        service.createInTx(tx, { purpose: 'x', amount: 0, description: 'd' }),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });
  });

  describe('markPaidInTx', () => {
    const row = { id: 5, store_id: 7, purpose: 'service_deposit', amount: { toString: () => '400000' }, paid_at: new Date() };

    it('claims from pending/awaiting_confirmation and returns the event', async () => {
      tx.payment_requests.updateMany.mockResolvedValue({ count: 1 });
      tx.payment_requests.findFirst.mockResolvedValue(row);

      const event = await service.markPaidInTx(tx, 5, { method: 'transfer' });

      expect(tx.payment_requests.updateMany.mock.calls[0][0].where).toEqual({
        id: 5,
        status: { in: ['pending', 'awaiting_confirmation'] },
      });
      expect(event).toMatchObject({
        store_id: 7,
        payment_request_id: 5,
        purpose: 'service_deposit',
        amount: 400000,
        method: 'transfer',
      });
      expect(event!.paid_at).toBeInstanceOf(Date);
    });

    it('is a no-op the second time (claim lost) and emits nothing', async () => {
      tx.payment_requests.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      tx.payment_requests.findFirst.mockResolvedValue(row);

      const first = await service.markPaid(5, { method: 'wompi' });
      const second = await service.markPaid(5, { method: 'wompi' });

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith('payment_request.paid', first);
    });

    it('emits only after the transaction committed', async () => {
      tx.payment_requests.updateMany.mockResolvedValue({ count: 1 });
      tx.payment_requests.findFirst.mockResolvedValue(row);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const out = await fn(tx);
        expect(events.emit).not.toHaveBeenCalled();
        return out;
      });

      await service.markPaid(5, { method: 'transfer' });

      expect(events.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('payment_link.paid listener', () => {
    it('ignores links that belong to no payment request', async () => {
      foreignLookup.mockResolvedValue(null);

      await service.onPaymentLinkPaid({ payment_link_id: 99, store_id: 7 });

      expect(runner.runInStoreContext).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('pays its own request inside the store context and stays idempotent', async () => {
      foreignLookup.mockResolvedValue({ id: 5, store_id: 7 });
      tx.payment_requests.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      tx.payment_requests.findFirst.mockResolvedValue({
        id: 5, store_id: 7, purpose: 'p', amount: { toString: () => '10' }, paid_at: new Date(),
      });

      await service.onPaymentLinkPaid({ payment_link_id: 4, store_id: 7 });
      await service.onPaymentLinkPaid({ payment_link_id: 4, store_id: 7 });

      expect(runner.runInStoreContext).toHaveBeenCalledWith(7, expect.any(Function));
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(tx.payment_requests.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'paid' });
    });

    it('does not touch a request of another store', async () => {
      foreignLookup.mockResolvedValue({ id: 5, store_id: 8 });

      await service.onPaymentLinkPaid({ payment_link_id: 4, store_id: 7 });

      expect(runner.runInStoreContext).not.toHaveBeenCalled();
    });

    it('never throws into the event bus', async () => {
      foreignLookup.mockRejectedValue(new Error('db down'));
      await expect(
        service.onPaymentLinkPaid({ payment_link_id: 4, store_id: 7 }),
      ).resolves.toBeUndefined();
    });
  });

  describe('expireOverdue', () => {
    it('only expires pending requests: awaiting_confirmation never expires (A9)', async () => {
      prisma.payment_requests.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      prisma.payment_requests.updateMany.mockResolvedValue({ count: 2 });

      const ids = await service.expireOverdue(new Date('2026-11-05T00:00:00Z'));

      expect(ids).toEqual([1, 2]);
      const where = prisma.payment_requests.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('pending');
      expect(prisma.payment_requests.updateMany.mock.calls[0][0].where.status).toBe('pending');
    });
  });

  describe('admin decisions', () => {
    it('confirm only works on a request awaiting confirmation', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue({ id: 5, status: 'pending' });
      await expect(service.confirm(5)).rejects.toMatchObject({ errorCode: 'PAYMENT_REQUEST_INVALID_STATE' });
    });

    it('reject needs a reason and sends the request back to pending', async () => {
      await expect(service.reject(5, '  ')).rejects.toMatchObject({ errorCode: 'PAYMENT_REQUEST_REJECT_REASON' });

      prisma.payment_requests.findFirst.mockResolvedValue({ id: 5, status: 'awaiting_confirmation' });
      prisma.payment_requests.updateMany.mockResolvedValue({ count: 1 });
      await service.reject(5, 'Monto incorrecto');

      expect(prisma.payment_requests.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 5, status: 'awaiting_confirmation' },
        data: { status: 'pending', rejection_reason: 'Monto incorrecto' },
      });
    });

    it('cancel refuses a paid request', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue({ id: 5, status: 'paid', payment_link_id: null });
      await expect(service.cancel(5)).rejects.toMatchObject({ errorCode: 'PAYMENT_REQUEST_ALREADY_PAID' });
    });
  });
});
