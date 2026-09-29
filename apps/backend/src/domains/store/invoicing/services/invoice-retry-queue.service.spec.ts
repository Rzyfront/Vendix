import { InvoiceRetryQueueService } from './invoice-retry-queue.service';

describe('InvoiceRetryQueueService', () => {
  const createService = (row: any) => {
    const prisma = {
      invoice_retry_queue: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(undefined),
      },
      invoices: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new InvoiceRetryQueueService(prisma as any);
    const declare = jest.spyOn(service, 'declareContingency');
    return { service, prisma, declare };
  };

  it('leaves the row failed and never declares contingency when attempts are exhausted', async () => {
    const { service, prisma, declare } = createService({
      id: 1,
      invoice_id: 99,
      attempts: 4,
      max_attempts: 5,
    });

    await service.markFailed(1, 'ETIMEDOUT DIAN', true);

    expect(prisma.invoice_retry_queue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          status: 'failed',
          attempts: 5,
          last_error: 'ETIMEDOUT DIAN',
        }),
      }),
    );
    expect(declare).not.toHaveBeenCalled();
    expect(prisma.invoices.update).not.toHaveBeenCalled();
  });

  it('keeps retrying (pending) while attempts remain, even if contingency_eligible', async () => {
    const { service, prisma } = createService({
      id: 1,
      invoice_id: 99,
      attempts: 1,
      max_attempts: 5,
    });

    await service.markFailed(1, 'timeout', true);

    expect(prisma.invoice_retry_queue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', attempts: 2 }),
      }),
    );
  });

  it('reschedule does not touch attempts', async () => {
    const { service, prisma } = createService(null);

    await service.reschedule(7, 120000);

    const call = prisma.invoice_retry_queue.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 7 });
    expect(call.data.status).toBe('pending');
    expect(call.data).not.toHaveProperty('attempts');
    expect(call.data.next_retry_at.getTime()).toBeGreaterThan(Date.now());
  });
});
