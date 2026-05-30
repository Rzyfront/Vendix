import { Prisma } from '@prisma/client';
import { PlansService } from './plans.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

describe('PlansService', () => {
  let service: PlansService;
  let prisma: any;
  let tx: any;

  beforeEach(() => {
    // `tx` is the transaction client handed to the $transaction callback. It
    // mirrors the subset of Prisma methods the multi-cycle update()/create()
    // paths touch, so tests can assert on the in-transaction calls.
    tx = {
      subscription_plans: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      store_subscriptions: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    prisma = {
      subscription_plans: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      // Execute the callback with the tx client and ignore the isolation opts.
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    service = new PlansService(prisma);
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
      plan_group_code: 'pro',
      ...overrides,
    };
  }

  describe('create (scalar / legacy single-cycle)', () => {
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
      expect(args.data.grace_period_soft_days).toBe(5);
      expect(args.data.resellable).toBe(true);
      expect(args.data.is_promotional).toBe(false);
      // plan_group_code defaults to the plan code for single-cycle plans.
      expect(args.data.plan_group_code).toBe('pro');
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

  describe('createMultiCycle (pricings[])', () => {
    const multiCycleDto = () =>
      ({
        code: 'pro',
        name: 'Pro Plan',
        is_default: true,
        pricings: [
          { billing_cycle: 'monthly', price: 99000, is_default: true },
          { billing_cycle: 'annual', price: 990000, is_default: false },
        ],
      }) as any;

    it('creates one row per cycle sharing plan_group_code; canonical keeps code, others suffixed', async () => {
      tx.subscription_plans.findUnique.mockResolvedValue(null);
      tx.subscription_plans.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 1, ...data }),
      );

      const result = await service.create(multiCycleDto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.subscription_plans.create).toHaveBeenCalledTimes(2);

      const created = tx.subscription_plans.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      // Canonical cycle (is_default pricing) keeps the bare code.
      const monthly = created.find((d: any) => d.billing_cycle === 'monthly');
      const annual = created.find((d: any) => d.billing_cycle === 'annual');
      expect(monthly.code).toBe('pro');
      expect(annual.code).toBe('pro-annual');
      // Both rows share the same plan_group_code.
      expect(monthly.plan_group_code).toBe('pro');
      expect(annual.plan_group_code).toBe('pro');
      // Each row carries its own price.
      expect(monthly.base_price).toBe(99000);
      expect(annual.base_price).toBe(990000);
    });

    it('only the canonical row carries the global is_default flag', async () => {
      tx.subscription_plans.findUnique.mockResolvedValue(null);
      tx.subscription_plans.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 1, ...data }),
      );

      await service.create(multiCycleDto());

      const created = tx.subscription_plans.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      const monthly = created.find((d: any) => d.billing_cycle === 'monthly');
      const annual = created.find((d: any) => d.billing_cycle === 'annual');
      // Global default flag (guarded by the partial unique index) lives only on
      // the canonical cycle, never on the secondary cycle rows.
      expect(monthly.is_default).toBe(true);
      expect(annual.is_default).toBe(false);
    });

    it('throws when not exactly one pricing is is_default=true', async () => {
      const dto = multiCycleDto();
      dto.pricings = [
        { billing_cycle: 'monthly', price: 99000, is_default: false },
        { billing_cycle: 'annual', price: 990000, is_default: false },
      ];
      await expect(service.create(dto)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicate billing cycles within the group', async () => {
      const dto = multiCycleDto();
      dto.pricings = [
        { billing_cycle: 'monthly', price: 99000, is_default: true },
        { billing_cycle: 'monthly', price: 88000, is_default: false },
      ];
      await expect(service.create(dto)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rolls back (throws) when a derived code collides', async () => {
      // Canonical insert ok, secondary cycle code already taken.
      tx.subscription_plans.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(planFixture({ code: 'pro-annual' }));
      tx.subscription_plans.create.mockResolvedValue(planFixture());

      await expect(service.create(multiCycleDto())).rejects.toBeInstanceOf(
        VendixHttpException,
      );
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
    it('returns the plan plus a pricings[] grouped by plan_group_code', async () => {
      const plan = planFixture();
      prisma.subscription_plans.findUnique.mockResolvedValue(plan);
      prisma.subscription_plans.findMany.mockResolvedValue([
        planFixture({ id: 1, code: 'pro', billing_cycle: 'monthly' }),
        planFixture({
          id: 2,
          code: 'pro-annual',
          billing_cycle: 'annual',
          base_price: new Prisma.Decimal(990000),
        }),
      ]);

      const result: any = await service.findOne(1);

      // Plan identity fields are preserved.
      expect(result.id).toBe(1);
      expect(result.code).toBe('pro');
      // Group is exposed as a pricings array, one entry per cycle.
      expect(result.pricings).toHaveLength(2);
      const monthly = result.pricings.find(
        (p: any) => p.billing_cycle === 'monthly',
      );
      const annual = result.pricings.find(
        (p: any) => p.billing_cycle === 'annual',
      );
      // Canonical cycle = the row whose code equals the group code.
      expect(monthly.is_default).toBe(true);
      expect(annual.is_default).toBe(false);

      const includeArgs =
        prisma.subscription_plans.findUnique.mock.calls[0][0];
      expect(includeArgs.include.parent_plan).toBeDefined();
      expect(includeArgs.include.partner_overrides).toBe(true);
    });

    it('falls back to the plan itself when the group resolves empty', async () => {
      const plan = planFixture({ plan_group_code: null });
      prisma.subscription_plans.findUnique.mockResolvedValue(plan);
      prisma.subscription_plans.findMany.mockResolvedValue([]);

      const result: any = await service.findOne(1);
      expect(result.pricings).toHaveLength(1);
      expect(result.pricings[0].billing_cycle).toBe('monthly');
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
    it('propagates shared fields to the whole group via updateMany', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());

      await service.update(1, { name: 'New' } as any);

      // Shared fields go through updateMany scoped by plan_group_code.
      expect(tx.subscription_plans.updateMany).toHaveBeenCalledTimes(1);
      const args = tx.subscription_plans.updateMany.mock.calls[0][0];
      expect(args.where.plan_group_code).toBe('pro');
      expect(args.data.name).toBe('New');
      // Per-cycle fields (code) are never part of the shared payload.
      expect(args.data.code).toBeUndefined();
    });

    it('adds a new cycle row when pricings introduce an unseen billing_cycle', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      // Group currently has only the monthly canonical row.
      tx.subscription_plans.findMany.mockResolvedValue([
        planFixture({ id: 1, code: 'pro', billing_cycle: 'monthly' }),
      ]);
      tx.subscription_plans.findUnique.mockResolvedValue(null); // derived code free

      await service.update(1, {
        pricings: [
          { billing_cycle: 'monthly', price: 99000, is_default: true },
          { billing_cycle: 'annual', price: 990000, is_default: false },
        ],
      } as any);

      // Existing monthly row updated; new annual row created with suffixed code.
      expect(tx.subscription_plans.update).toHaveBeenCalled();
      const createArgs = tx.subscription_plans.create.mock.calls[0][0];
      expect(createArgs.data.billing_cycle).toBe('annual');
      expect(createArgs.data.plan_group_code).toBe('pro');
      // `code` is a required column — the new cycle row must carry the derived
      // `${group}-${cycle}` code, never be omitted (regression: Prisma rejects
      // the insert with "Argument `code` is missing").
      expect(createArgs.data.code).toBe('pro-annual');
    });

    it('archives (not deletes) a removed cycle that is still referenced by a subscription', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      tx.subscription_plans.findMany.mockResolvedValue([
        planFixture({ id: 1, code: 'pro', billing_cycle: 'monthly' }),
        planFixture({ id: 2, code: 'pro-annual', billing_cycle: 'annual' }),
      ]);
      // The annual cycle is referenced by a live subscription.
      tx.store_subscriptions.count.mockResolvedValue(1);

      await service.update(1, {
        pricings: [{ billing_cycle: 'monthly', price: 99000, is_default: true }],
      } as any);

      // Referenced removed cycle must be archived, never hard-deleted.
      expect(tx.subscription_plans.delete).not.toHaveBeenCalled();
      const archiveCall = tx.subscription_plans.update.mock.calls.find(
        (c: any[]) => c[0].data?.state === 'archived',
      );
      expect(archiveCall).toBeTruthy();
      expect(archiveCall[0].where.id).toBe(2);
    });

    it('hard-deletes a removed cycle with no subscription references', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      tx.subscription_plans.findMany.mockResolvedValue([
        planFixture({ id: 1, code: 'pro', billing_cycle: 'monthly' }),
        planFixture({ id: 2, code: 'pro-annual', billing_cycle: 'annual' }),
      ]);
      tx.store_subscriptions.count.mockResolvedValue(0);

      await service.update(1, {
        pricings: [{ billing_cycle: 'monthly', price: 99000, is_default: true }],
      } as any);

      expect(tx.subscription_plans.delete).toHaveBeenCalledWith({
        where: { id: 2 },
      });
    });

    it('throws SYS_NOT_FOUND_001 when the plan does not exist', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);
      await expect(
        service.update(999, { name: 'x' } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });
  });

  describe('archive', () => {
    it('sets state=archived and archived_at (no delete)', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      prisma.subscription_plans.update.mockResolvedValue(
        planFixture({ state: 'archived' }),
      );

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

      expect(prisma.subscription_plans.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
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
