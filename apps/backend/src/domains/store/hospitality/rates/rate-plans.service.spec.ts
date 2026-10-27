import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { CreateRatePlanDto } from './dto';
import { assertValidPrices, loadPlanPricing, LodgingRatePlansService } from './rate-plans.service';
import { resolveNightRates } from './lodging-rate-resolver';

const codeOf = async (promise: Promise<unknown> | (() => unknown)) => {
  const error = await (typeof promise === 'function'
    ? Promise.resolve().then(promise)
    : promise
  ).catch((e) => e);
  expect(error).toBeInstanceOf(VendixHttpException);
  return ((error as VendixHttpException).getResponse() as any).error_code;
};

/** "Con desayuno": Doble (11) $250.000, Friday and Saturday $320.000. */
const withBreakfast = (): CreateRatePlanDto => ({
  name: 'Con desayuno',
  meal_plan: 'breakfast',
  prices: [
    { unit_type_id: 11, price: 250000 },
    { unit_type_id: 11, day_of_week: 5, price: 320000 },
    { unit_type_id: 11, day_of_week: 6, price: 320000 },
  ],
});

function build({ defaults = 0, types = [11, 12], seasons = [1], policies = [8], inactivePolicies = [] as number[] } = {}) {
  const plans: any[] = [];
  const prices: any[] = [];
  const tables = {
    lodging_rate_plans: {
      count: jest.fn(async () => defaults),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: plans.length + 1, ...data };
        plans.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = plans.find((p) => p.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async () => ({ count: defaults })),
      findFirst: jest.fn(async ({ where }: any) => {
        const row = plans.find((p) => p.id === where.id);
        return row ? { ...row, prices: prices.filter((p) => p.rate_plan_id === row.id) } : null;
      }),
    },
    lodging_rate_prices: {
      createMany: jest.fn(async ({ data }: any) => {
        prices.push(...data);
        return { count: data.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const keep = prices.filter((p) => p.rate_plan_id !== where.rate_plan_id);
        const count = prices.length - keep.length;
        prices.splice(0, prices.length, ...keep);
        return { count };
      }),
    },
    lodging_unit_types: {
      count: jest.fn(async ({ where }: any) =>
        where.id.in.filter((id: number) => types.includes(id)).length,
      ),
    },
    lodging_seasons: {
      count: jest.fn(async ({ where }: any) =>
        where.id.in.filter((id: number) => seasons.includes(id)).length,
      ),
    },
    lodging_cancellation_policies: {
      count: jest.fn(async ({ where }: any) =>
        policies.includes(where.id) || (!where.is_active && inactivePolicies.includes(where.id)) ? 1 : 0,
      ),
    },
  };
  const prisma: any = {
    ...tables,
    $transaction: jest.fn(async (fn: any) => fn({ ...tables, $executeRaw: jest.fn() })),
  };
  return { service: new LodgingRatePlansService(prisma), prisma, plans, prices };
}

describe('LodgingRatePlansService (H2.1)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates the plan with its prices; the first plan of the store is the default', async () => {
    const { service, prices } = build();
    const plan = await service.create(withBreakfast());
    expect(plan).toMatchObject({ name: 'Con desayuno', meal_plan: 'breakfast', is_default: true });
    expect(prices).toEqual([
      expect.objectContaining({ store_id: 5, unit_type_id: 11, day_of_week: null, price: new Prisma.Decimal(250000) }),
      expect.objectContaining({ unit_type_id: 11, day_of_week: 5, price: new Prisma.Decimal(320000) }),
      expect.objectContaining({ unit_type_id: 11, day_of_week: 6, price: new Prisma.Decimal(320000) }),
    ]);
  });

  it('a new default plan takes the flag from the previous one', async () => {
    const { service, prisma } = build({ defaults: 1 });
    const second = await service.create({ ...withBreakfast(), name: 'Solo alojamiento' });
    expect(second.is_default).toBe(false);
    expect(prisma.lodging_rate_plans.updateMany).not.toHaveBeenCalled();

    await service.create({ ...withBreakfast(), name: 'Todo incluido', is_default: true });
    expect(prisma.lodging_rate_plans.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 5, is_default: true } }),
    );
  });

  it('editing replaces the prices and an inactive plan stops being the default', async () => {
    const { service, prices } = build();
    const plan = await service.create(withBreakfast());
    const edited = await service.update(plan.id, {
      is_active: false,
      prices: [{ unit_type_id: 12, price: 400000 }],
    });
    expect(edited).toMatchObject({ is_active: false, is_default: false });
    expect(prices).toEqual([expect.objectContaining({ unit_type_id: 12, day_of_week: null })]);
  });

  it('rejects prices of a room type of another store', async () => {
    const { service, prisma } = build({ types: [12] });
    expect(await codeOf(service.create(withBreakfast()))).toBe('LODGING_UNIT_TYPE_FIND_001');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('H2.4 — saves the cancellation policy and the deposit percent of the plan', async () => {
    const { service } = build();
    const plan = await service.create({
      ...withBreakfast(),
      cancellation_policy_id: 8,
      deposit_percent: 30,
    });
    expect(plan).toMatchObject({
      cancellation_policy_id: 8,
      deposit_percent: new Prisma.Decimal(30),
    });
    const cleared = await service.update(plan.id, { cancellation_policy_id: null });
    expect(cleared).toMatchObject({ cancellation_policy_id: null, deposit_percent: new Prisma.Decimal(30) });
  });

  it('H2.4 — rejects a policy of another store and a deposit above 100 %', async () => {
    const { service, prisma } = build({ policies: [] });
    expect(await codeOf(service.create({ ...withBreakfast(), cancellation_policy_id: 8 }))).toBe(
      'LODGING_CANCEL_POLICY_FIND_001',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const errors = await validate(
      plainToInstance(CreateRatePlanDto, { ...withBreakfast(), deposit_percent: 101 }),
    );
    expect(errors.map((e) => e.property)).toEqual(['deposit_percent']);
  });

  it('H2.4 — rejects assigning an inactive policy, but a plan may keep the one it has', async () => {
    const { service, plans } = build({ inactivePolicies: [9] });
    expect(await codeOf(service.create({ ...withBreakfast(), cancellation_policy_id: 9 }))).toBe(
      'LODGING_CANCEL_POLICY_FIND_001',
    );
    const plan = await service.create(withBreakfast());
    expect(await codeOf(service.update(plan.id, { cancellation_policy_id: 9 }))).toBe(
      'LODGING_CANCEL_POLICY_FIND_001',
    );
    plans[0].cancellation_policy_id = 9;
    await expect(
      service.update(plan.id, { name: 'Desayuno incluido', cancellation_policy_id: 9 }),
    ).resolves.toMatchObject({ name: 'Desayuno incluido', cancellation_policy_id: 9 });
  });

  it('a duplicate name is a 409', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    expect(await codeOf(service.create(withBreakfast()))).toBe('LODGING_RATE_PLAN_DUP_001');
  });

  it('each priced type needs a base price and one price per weekday', async () => {
    expect(() => assertValidPrices(withBreakfast().prices)).not.toThrow();
    expect(
      await codeOf(() => assertValidPrices([{ unit_type_id: 11, day_of_week: 5, price: 1 }])),
    ).toBe('LODGING_RATE_PLAN_PRICES_001');
    expect(
      await codeOf(() =>
        assertValidPrices([
          { unit_type_id: 11, price: 1 },
          { unit_type_id: 11, price: 2 },
        ]),
      ),
    ).toBe('LODGING_RATE_PLAN_PRICES_001');
  });

  it('the DTO rejects weekdays outside 0-6 and negative prices', async () => {
    const errorsOf = async (price: Record<string, unknown>) =>
      (await validate(plainToInstance(CreateRatePlanDto, { name: 'X', prices: [price] }))).map(
        (e) => e.property,
      );
    expect(await errorsOf({ unit_type_id: 11, price: 250000 })).toEqual([]);
    expect(await errorsOf({ unit_type_id: 11, day_of_week: 7, price: 1 })).toEqual(['prices']);
    expect(await errorsOf({ unit_type_id: 11, price: -1 })).toEqual(['prices']);
  });
});

describe('LodgingRatePlansService seasons (H2.2)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  /** "Con desayuno" Doble $250.000, "Alta" (season 1) $400.000. */
  const withHighSeason = (): CreateRatePlanDto => ({
    name: 'Con desayuno',
    prices: [
      { unit_type_id: 11, price: 250000 },
      { unit_type_id: 11, season_id: 1, price: 400000 },
    ],
  });

  it('saves the season price next to the regular one', async () => {
    const { service, prices } = build();
    await service.create(withHighSeason());
    expect(prices).toEqual([
      expect.objectContaining({ unit_type_id: 11, season_id: null, day_of_week: null, price: new Prisma.Decimal(250000) }),
      expect.objectContaining({ unit_type_id: 11, season_id: 1, day_of_week: null, price: new Prisma.Decimal(400000) }),
    ]);
  });

  it('rejects a season of another store', async () => {
    const { service, prisma } = build({ seasons: [2] });
    expect(await codeOf(service.create(withHighSeason()))).toBe('LODGING_SEASON_FIND_001');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a season price needs the regular base price and its own base price', async () => {
    expect(() => assertValidPrices(withHighSeason().prices)).not.toThrow();
    // Season price without a regular price for the type.
    expect(
      await codeOf(() => assertValidPrices([{ unit_type_id: 11, season_id: 1, price: 400000 }])),
    ).toBe('LODGING_RATE_PLAN_PRICES_001');
    // Season weekday price without the season base price.
    expect(
      await codeOf(() =>
        assertValidPrices([
          { unit_type_id: 11, price: 250000 },
          { unit_type_id: 11, season_id: 1, day_of_week: 6, price: 450000 },
        ]),
      ),
    ).toBe('LODGING_RATE_PLAN_PRICES_001');
    // Two base prices for the same season.
    expect(
      await codeOf(() =>
        assertValidPrices([
          ...withHighSeason().prices,
          { unit_type_id: 11, season_id: 1, price: 1 },
        ]),
      ),
    ).toBe('LODGING_RATE_PLAN_PRICES_001');
  });

  it('H2.4 — loadPlanPricing sells without an inactive policy (nothing to snapshot)', async () => {
    const policy = { id: 8, name: 'Flexible', rules: [], no_show_penalty: null };
    const client = (is_active: boolean): any => ({
      lodging_rate_plans: {
        findFirst: jest.fn(async () => ({
          id: 3,
          name: 'Con desayuno',
          is_active: true,
          deposit_percent: null,
          cancellation_policy: { ...policy, is_active },
        })),
      },
      lodging_rate_prices: {
        findMany: jest.fn(async () => [
          { day_of_week: null, price: new Prisma.Decimal(250000), season: null },
        ]),
      },
    });
    const active = await loadPlanPricing(client(true), 5, 3, { id: 11, name: 'Doble' });
    expect(active.terms.policy).toMatchObject({ id: 8, name: 'Flexible' });
    const inactive = await loadPlanPricing(client(false), 5, 3, { id: 11, name: 'Doble' });
    expect(inactive.terms.policy).toBeNull();
  });

  it('loadPlanPricing only reads active seasons and prices 14-dic regular, 15-dic in season', async () => {
    const findMany = jest.fn(async () => [
      { day_of_week: null, price: new Prisma.Decimal(250000), season: null },
      {
        day_of_week: null,
        price: new Prisma.Decimal(400000),
        season: { id: 1, from_date: new Date('2026-12-15'), to_date: new Date('2027-01-15'), priority: 0 },
      },
    ]);
    const client: any = {
      lodging_rate_plans: {
        findFirst: jest.fn(async () => ({ id: 3, name: 'Con desayuno', is_active: true })),
      },
      lodging_rate_prices: { findMany },
    };
    const { prices } = await loadPlanPricing(client, 5, 3, { id: 11, name: 'Doble' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store_id: 5,
          OR: [{ season_id: null }, { season: { is_active: true } }],
        }),
      }),
    );
    const nights = resolveNightRates(['2026-12-14', '2026-12-15'], prices)!;
    expect(nights.map((n) => [n.night_date, n.rate_amount.toFixed(2)])).toEqual([
      ['2026-12-14', '250000.00'],
      ['2026-12-15', '400000.00'],
    ]);
  });
});
