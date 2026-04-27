import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { SubscriptionPaymentRetryJob } from './subscription-payment-retry.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';

describe('SubscriptionPaymentRetryJob', () => {
  let processor: SubscriptionPaymentRetryJob;
  let prisma: { subscription_invoices: { findUnique: jest.Mock } };
  let payment: { chargeInvoice: jest.Mock };
  let emitter: { emit: jest.Mock };

  const baseInvoice = { id: 100, state: 'pending', store_id: 5 };

  function makeJob(
    overrides: Partial<Job<any>> = {},
    data: any = { invoiceId: 100, subscriptionId: 10, storeId: 5, attempt: 1 },
  ): Job<any> {
    return {
      id: 'job-1',
      data,
      attemptsMade: 0,
      ...overrides,
    } as unknown as Job<any>;
  }

  beforeEach(async () => {
    prisma = {
      subscription_invoices: {
        findUnique: jest.fn().mockResolvedValue(baseInvoice),
      },
    };
    payment = { chargeInvoice: jest.fn() };
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionPaymentRetryJob,
        { provide: GlobalPrismaService, useValue: prisma },
        { provide: SubscriptionPaymentService, useValue: payment },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    processor = module.get(SubscriptionPaymentRetryJob);
  });

  it('chargeInvoice succeeded: returns paymentId, does NOT throw', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 42, state: 'succeeded' });

    const result = await processor.process(makeJob());

    expect(payment.chargeInvoice).toHaveBeenCalledWith(100);
    expect(result).toEqual({ paymentId: 42, state: 'succeeded' });
  });

  it('chargeInvoice returns state=failed: throws (BullMQ will retry)', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 43, state: 'failed' });

    await expect(processor.process(makeJob())).rejects.toThrow(
      /state=failed/,
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      'subscription.payment.retry.failed',
      expect.objectContaining({ invoiceId: 100, paymentId: 43, attempt: 1 }),
    );
  });

  it('chargeInvoice throws: re-throws so BullMQ retries', async () => {
    payment.chargeInvoice.mockRejectedValue(new Error('gateway 500'));

    await expect(processor.process(makeJob())).rejects.toThrow('gateway 500');
  });

  it('non-terminal state (pending): throws so BullMQ retries', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 44, state: 'pending' });

    await expect(processor.process(makeJob())).rejects.toThrow(
      /non-terminal state 'pending'/,
    );
  });

  it('invoice already paid: skip (no charge)', async () => {
    prisma.subscription_invoices.findUnique.mockResolvedValue({
      ...baseInvoice,
      state: 'paid',
    });

    const result = await processor.process(makeJob());

    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, reason: 'already_resolved' });
  });

  it('invoice voided: skip', async () => {
    prisma.subscription_invoices.findUnique.mockResolvedValue({
      ...baseInvoice,
      state: 'void',
    });

    const result = await processor.process(makeJob());

    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, reason: 'already_resolved' });
  });

  it('invoice not found: skip with reason', async () => {
    prisma.subscription_invoices.findUnique.mockResolvedValue(null);

    const result = await processor.process(makeJob());

    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, reason: 'invoice_not_found' });
  });

  it('attempt counter reflects BullMQ attemptsMade + 1', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 45, state: 'failed' });

    await expect(
      processor.process(makeJob({ attemptsMade: 2 })),
    ).rejects.toThrow(/attempt 3/);

    expect(emitter.emit).toHaveBeenCalledWith(
      'subscription.payment.retry.failed',
      expect.objectContaining({ attempt: 3 }),
    );
  });
});
