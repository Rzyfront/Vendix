import { ServiceSessionEmailReconciliationJob } from './service-session-email-reconciliation.job';

describe('ServiceSessionEmailReconciliationJob', () => {
  function buildJob(rows: any[] = [{
    id: 17,
    store_id: 4,
    session_id: 91,
    status: 'sending',
    updated_at: new Date(Date.now() - 20 * 60_000),
  }]) {
    const deliveryModel = {
      findMany: jest.fn().mockResolvedValue(rows),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { withoutScope: jest.fn(() => ({ service_session_email_deliveries: deliveryModel })) } as any;
    const notifications = { createAndBroadcast: jest.fn().mockResolvedValue({ id: 1 }) } as any;
    const job = new ServiceSessionEmailReconciliationJob(prisma, notifications);
    return { job, prisma, deliveryModel, notifications };
  }

  it('marks a stale sending delivery failed with CAS and alerts the store without recipient or token', async () => {
    const { job, deliveryModel, notifications } = buildJob();
    const updatedAt = new Date(Date.now() - 20 * 60_000);

    // Reuse the exact fetched timestamp because the conditional update is the concurrency guard.
    deliveryModel.findMany.mockResolvedValueOnce([{ id: 17, store_id: 4, session_id: 91, status: 'sending', updated_at: updatedAt }]);
    await job.reconcileStaleDeliveries();

    expect(deliveryModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['sending', 'pending'] }, updated_at: { lt: expect.any(Date) } },
      take: 500,
    }));
    expect(deliveryModel.updateMany).toHaveBeenCalledWith({
      where: { id: 17, store_id: 4, status: 'sending', updated_at: updatedAt },
      data: expect.objectContaining({ status: 'failed', updated_at: expect.any(Date) }),
    });
    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
      4,
      'service_session_email_failed',
      expect.any(String),
      expect.stringContaining('91'),
      { session_id: 91, route: '/admin/reservations' },
    );
    const notificationPayload = JSON.stringify(notifications.createAndBroadcast.mock.calls[0]);
    expect(notificationPayload).not.toMatch(/recipient|token/i);
  });

  it('also reconciles a stale pending delivery, using its own status in the CAS', async () => {
    const { job, deliveryModel, notifications } = buildJob();
    const updatedAt = new Date(Date.now() - 20 * 60_000);
    deliveryModel.findMany.mockResolvedValueOnce([{ id: 18, store_id: 4, session_id: 92, status: 'pending', updated_at: updatedAt }]);

    await job.reconcileStaleDeliveries();

    expect(deliveryModel.updateMany).toHaveBeenCalledWith({
      where: { id: 18, store_id: 4, status: 'pending', updated_at: updatedAt },
      data: expect.objectContaining({ status: 'failed' }),
    });
    expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
  });

  it('does not alert when another worker has already changed the delivery', async () => {
    const { job, deliveryModel, notifications } = buildJob();
    deliveryModel.updateMany.mockResolvedValueOnce({ count: 0 });

    await job.reconcileStaleDeliveries();

    expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('handles an empty scan without writes', async () => {
    const { job, deliveryModel, notifications } = buildJob([]);

    await job.reconcileStaleDeliveries();

    expect(deliveryModel.updateMany).not.toHaveBeenCalled();
    expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
  });
});