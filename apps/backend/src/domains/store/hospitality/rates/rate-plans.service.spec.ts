import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { CreateRatePlanDto } from './dto';
import { assertValidPrices, LodgingRatePlansService } from './rate-plans.service';

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

function build({ defaults = 0, types = [11, 12] } = {}) {
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
