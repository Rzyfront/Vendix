import { DunningService } from './dunning.service';

describe('DunningService', () => {
  let service: DunningService;
  let prisma: any;
  let stateService: any;
  let notifications: any;

  beforeEach(() => {
    prisma = {
      store_subscriptions: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      subscription_events: {
        create: jest.fn(),
      },
    };
    stateService = { transition: jest.fn() };
    notifications = { createAndBroadcast: jest.fn() };
    service = new DunningService(prisma as any, stateService, notifications);
  });

  describe('findAll', () => {
    it('restricts to grace_soft/grace_hard/suspended/blocked states by default', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10 } as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.where.state).toEqual({
        in: ['grace_soft', 'grace_hard', 'suspended', 'blocked'],
      });
    });

    it('narrows to specific dunning state when provided', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({ state: 'grace_hard' } as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.where.state).toBe('grace_hard');
    });

    it('includes overdue/draft invoices for oldest-due first', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({} as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.include.invoices.where.state).toEqual({ in: ['overdue', 'draft'] });
      expect(args.include.invoices.orderBy).toEqual({ due_at: 'asc' });
      expect(args.include.invoices.take).toBe(1);
    });
  });

  describe('getStats', () => {
    it('aggregates counts per dunning state and computes total', async () => {
      prisma.store_subscriptions.count
        .mockResolvedValueOnce(3) // grace_soft
        .mockResolvedValueOnce(2) // grace_hard
        .mockResolvedValueOnce(1) // suspended
        .mockResolvedValueOnce(4); // blocked

      const stats = await service.getStats();

      expect(stats).toEqual({
        grace_soft: 3,
        grace_hard: 2,
        suspended: 1,
        blocked: 4,
        total: 10,
      });
      expect(prisma.store_subscriptions.count).toHaveBeenCalledTimes(4);
    });

    it('returns zeros when no dunning rows exist', async () => {
      prisma.store_subscriptions.count.mockResolvedValue(0);
      const stats = await service.getStats();
      expect(stats.total).toBe(0);
    });
  });
});
