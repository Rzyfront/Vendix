import { Prisma } from '@prisma/client';
import { PromotionalService } from './promotional.service';
import { VendixHttpException } from '../../../../common/errors';

describe('PromotionalService', () => {
  let service: PromotionalService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      subscription_plans: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new PromotionalService(prisma);
  });

  function promoFixture(overrides: Partial<any> = {}) {
    return {
      id: 1,
      code: 'black-friday',
      name: 'Black Friday',
      plan_type: 'promotional',
      is_promotional: true,
      state: 'draft',
      base_price: new Prisma.Decimal(49000),
      ...overrides,
    };
  }

  describe('create', () => {
    it('forces plan_type=promotional and is_promotional=true', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);
      prisma.subscription_plans.create.mockResolvedValue(promoFixture());

      await service.create({
        code: 'black-friday',
        name: 'Black Friday',
        base_price: new Prisma.Decimal(49000) as any,
      } as any);

      const args = prisma.subscription_plans.create.mock.calls[0][0];
      expect(args.data.plan_type).toBe('promotional');
      expect(args.data.is_promotional).toBe(true);
      expect(args.data.resellable).toBe(false);
      expect(args.data.state).toBe('draft');
    });

    it('throws SYS_CONFLICT_001 when code already exists', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(promoFixture());
      let err: any = null;
      try {
        await service.create({
          code: 'black-friday',
          name: 'x',
          base_price: 1,
        } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });

  describe('findAll', () => {
    it('filters by is_promotional=true and supports sort by promo_priority', async () => {
      prisma.subscription_plans.findMany.mockResolvedValue([]);
      prisma.subscription_plans.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        limit: 10,
        sort_by: 'promo_priority',
        sort_order: 'desc',
      } as any);

      const args = prisma.subscription_plans.findMany.mock.calls[0][0];
      expect(args.where.is_promotional).toBe(true);
      expect(args.orderBy).toEqual({ promo_priority: 'desc' });
    });
  });

  describe('update', () => {
    it('ignores is_promotional field in update payload (never flips flag)', async () => {
      prisma.subscription_plans.findFirst.mockResolvedValue(promoFixture());
      prisma.subscription_plans.update.mockResolvedValue(promoFixture());

      await service.update(1, {
        name: 'Renamed',
        is_promotional: false,
      } as any);

      const args = prisma.subscription_plans.update.mock.calls[0][0];
      expect(args.data.name).toBe('Renamed');
      expect(args.data.is_promotional).toBeUndefined();
    });

    it('throws SYS_NOT_FOUND_001 when plan not a promo', async () => {
      prisma.subscription_plans.findFirst.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.update(99, { name: 'x' } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });

  describe('remove', () => {
    it('deletes promo plan after verifying it is promotional', async () => {
      prisma.subscription_plans.findFirst.mockResolvedValue(promoFixture());
      prisma.subscription_plans.delete.mockResolvedValue(promoFixture());

      await service.remove(1);

      const findArgs = prisma.subscription_plans.findFirst.mock.calls[0][0];
      expect(findArgs.where.is_promotional).toBe(true);
      expect(prisma.subscription_plans.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('throws SYS_NOT_FOUND_001 when promo plan does not exist', async () => {
      prisma.subscription_plans.findFirst.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.remove(999);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });
});
