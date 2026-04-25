import { ActiveSubscriptionsService } from './active-subscriptions.service';
import { VendixHttpException } from '../../../../common/errors';

describe('ActiveSubscriptionsService', () => {
  let service: ActiveSubscriptionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      store_subscriptions: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new ActiveSubscriptionsService(prisma as any);
  });

  function subFixture(overrides: Partial<any> = {}) {
    return {
      id: 1,
      store_id: 100,
      plan_id: 5,
      state: 'active',
      ...overrides,
    };
  }

  describe('findAll', () => {
    it('paginates and filters by state', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([subFixture()]);
      prisma.store_subscriptions.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        state: 'active',
      } as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.where.state).toBe('active');
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(2);
    });

    it('filters by organization_id via nested store relation', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({ organization_id: 7 } as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.where.store.organization_id).toBe(7);
    });

    it('includes plan, store, promotional_plan, partner_override relations', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({} as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.include.plan).toBeDefined();
      expect(args.include.store).toBeDefined();
      expect(args.include.promotional_plan).toBeDefined();
      expect(args.include.partner_override).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns subscription with invoices (last 5) and relations', async () => {
      const sub = subFixture({ invoices: [{ id: 1 }] });
      prisma.store_subscriptions.findUnique.mockResolvedValue(sub);

      const result = await service.findOne(1);
      expect(result === sub).toBe(true);
      const args = prisma.store_subscriptions.findUnique.mock.calls[0][0];
      expect(args.include.plan).toBe(true);
      expect(args.include.invoices.take).toBe(5);
      expect(args.include.invoices.orderBy).toEqual({ created_at: 'desc' });
      expect(args.include.partner_override).toBe(true);
    });

    it('throws SUBSCRIPTION_001 when not found', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.findOne(999);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });
});
