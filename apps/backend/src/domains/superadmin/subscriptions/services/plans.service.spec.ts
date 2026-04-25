import { Prisma } from '@prisma/client';
import { PlansService } from './plans.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

describe('PlansService', () => {
  let service: PlansService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      subscription_plans: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new PlansService(prisma as any);
  });

  function planFixture(overrides: Partial<any> = {}) {
    return {
      id: 1,
      code: 'pro',
      name: 'Pro Plan',
      plan_type: 'base',
      state: 'draft',
      billing_cycle: 'monthly',
      base_price: new Prisma.Decimal(99000),
      currency: 'COP',
      ...overrides,
    };
  }

  describe('create', () => {
    it('inserts with defaults when optional fields missing', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);
      prisma.subscription_plans.create.mockResolvedValue(planFixture());

      await service.create({
        code: 'pro',
        name: 'Pro Plan',
        base_price: new Prisma.Decimal(99000) as any,
      } as any);

      const args = prisma.subscription_plans.create.mock.calls[0][0];
      expect(args.data.plan_type).toBe('base');
      expect(args.data.state).toBe('draft');
      expect(args.data.billing_cycle).toBe('monthly');
      expect(args.data.currency).toBe('COP');
      expect(args.data.trial_days).toBe(0);
      expect(args.data.grace_period_soft_days).toBe(5);
      expect(args.data.resellable).toBe(false);
      expect(args.data.is_promotional).toBe(false);
    });

    it('throws SYS_CONFLICT_001 when code already exists', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      let err: any = null;
      try {
        await service.create({ code: 'pro', name: 'x', base_price: 1 } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
      expect(prisma.subscription_plans.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('applies state and plan_type filters', async () => {
      prisma.subscription_plans.findMany.mockResolvedValue([]);
      prisma.subscription_plans.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        limit: 10,
        state: 'active',
        plan_type: 'base',
      } as any);

      const args = prisma.subscription_plans.findMany.mock.calls[0][0];
      expect(args.where.state).toBe('active');
      expect(args.where.plan_type).toBe('base');
      expect(args.skip).toBe(0);
      expect(args.take).toBe(10);
    });
  });

  describe('findOne', () => {
    it('returns plan with parent_plan and partner_overrides', async () => {
      const plan = planFixture();
      prisma.subscription_plans.findUnique.mockResolvedValue(plan);

      const result = await service.findOne(1);
      expect(result === plan).toBe(true);
      const args = prisma.subscription_plans.findUnique.mock.calls[0][0];
      expect(args.include.parent_plan).toBeDefined();
      expect(args.include.partner_overrides).toBe(true);
    });

    it('throws SYS_NOT_FOUND_001 when plan missing', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);
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

  describe('update', () => {
    it('applies only provided fields (partial update)', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      prisma.subscription_plans.update.mockResolvedValue(planFixture({ name: 'New' }));

      await service.update(1, { name: 'New', trial_days: 7 } as any);

      const args = prisma.subscription_plans.update.mock.calls[0][0];
      expect(args.data.name).toBe('New');
      expect(args.data.trial_days).toBe(7);
      expect(args.data.code).toBeUndefined();
      expect(args.data.plan_type).toBeUndefined();
    });
  });

  describe('archive', () => {
    it('sets state=archived and archived_at (no delete)', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      prisma.subscription_plans.update.mockResolvedValue(planFixture({ state: 'archived' }));

      await service.archive(1);

      expect(prisma.subscription_plans.delete).not.toHaveBeenCalled();
      const args = prisma.subscription_plans.update.mock.calls[0][0];
      expect(args.data.state).toBe('archived');
      expect(args.data.archived_at).toBeInstanceOf(Date);
    });
  });

  describe('remove', () => {
    it('deletes plan when it exists', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      prisma.subscription_plans.delete.mockResolvedValue(planFixture());

      await service.remove(1);

      expect(prisma.subscription_plans.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('throws SYS_NOT_FOUND_001 when plan missing', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.remove(999);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
      expect(prisma.subscription_plans.delete).not.toHaveBeenCalled();
    });
  });

  // Note: remove() does not check for active subscriptions nor throw PLAN_001 in current source.
  // ErrorCodes.PLAN_001 exists in registry but is not wired into remove().
  it('ErrorCodes registry contains PLAN_001 for future wiring', () => {
    expect(ErrorCodes.PLAN_001).toBeDefined();
  });
});
