import { EventsService } from './events.service';
import { VendixHttpException } from '../../../../common/errors';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      store_subscriptions: {
        findUnique: jest.fn(),
      },
      subscription_events: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new EventsService(prisma as any);
  });

  describe('findAll', () => {
    it('paginates events and applies type filter', async () => {
      prisma.subscription_events.findMany.mockResolvedValue([]);
      prisma.subscription_events.count.mockResolvedValue(0);

      await service.findAll({
        page: 2,
        limit: 20,
        type: 'payment_failed',
      } as any);

      const args = prisma.subscription_events.findMany.mock.calls[0][0];
      expect(args.where.type).toBe('payment_failed');
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
    });

    it('omits type filter when not provided', async () => {
      prisma.subscription_events.findMany.mockResolvedValue([]);
      prisma.subscription_events.count.mockResolvedValue(0);

      await service.findAll({} as any);

      const args = prisma.subscription_events.findMany.mock.calls[0][0];
      expect(args.where.type).toBeUndefined();
    });
  });

  describe('findBySubscription', () => {
    it('filters by subscription_id ordered by created_at desc by default', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue({ id: 42 });
      prisma.subscription_events.findMany.mockResolvedValue([]);
      prisma.subscription_events.count.mockResolvedValue(0);

      await service.findBySubscription(42, { page: 1, limit: 10 } as any);

      const args = prisma.subscription_events.findMany.mock.calls[0][0];
      expect(args.where.store_subscription_id).toBe(42);
      expect(args.orderBy).toEqual({ created_at: 'desc' });
    });

    it('throws SUBSCRIPTION_001 when subscription does not exist', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.findBySubscription(999, {} as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
      expect(prisma.subscription_events.findMany).not.toHaveBeenCalled();
    });

    it('combines subscription scope and type filter', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue({ id: 42 });
      prisma.subscription_events.findMany.mockResolvedValue([]);
      prisma.subscription_events.count.mockResolvedValue(0);

      await service.findBySubscription(42, { type: 'state_changed' } as any);

      const args = prisma.subscription_events.findMany.mock.calls[0][0];
      expect(args.where.store_subscription_id).toBe(42);
      expect(args.where.type).toBe('state_changed');
    });
  });
});
