import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { CreateSeasonDto } from './dto';
import { LodgingSeasonsService } from './seasons.service';

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(VendixHttpException);
  const response = (error as VendixHttpException).getResponse() as any;
  return { code: response.error_code, message: response.message };
};

/** In-memory seasons of store 5, filtered like Postgres would. */
function build() {
  const seasons: any[] = [];
  const tables = {
    lodging_seasons: {
      findMany: jest.fn(async () => seasons),
      findFirst: jest.fn(async ({ where }: any) =>
        seasons.find(
          (s) =>
            (where.id === undefined || typeof where.id === 'object'
              ? true
              : s.id === where.id) &&
            (where.id?.not === undefined || s.id !== where.id.not) &&
            (where.store_id === undefined || s.store_id === where.store_id) &&
            (where.is_active === undefined || s.is_active === where.is_active) &&
            (where.priority === undefined || s.priority === where.priority) &&
            (where.from_date === undefined || s.from_date <= where.from_date.lte) &&
            (where.to_date === undefined || s.to_date >= where.to_date.gte),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: seasons.length + 1, color: '#F59E0B', ...data };
        seasons.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = seasons.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  };
  const prisma: any = {
    ...tables,
    $transaction: jest.fn(async (fn: any) => fn({ ...tables, $executeRaw: jest.fn() })),
  };
  return { service: new LodgingSeasonsService(prisma), prisma, seasons };
}

const HIGH = { name: 'Alta', from_date: '2026-12-15', to_date: '2027-01-15' };

describe('LodgingSeasonsService (H2.2)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates "Alta" 15-dic → 15-ene with priority 0 and its calendar color', async () => {
    const { service, seasons } = build();
    await service.create({ ...HIGH, color: '#dc2626' });
    expect(seasons[0]).toMatchObject({
      store_id: 5,
      name: 'Alta',
      from_date: new Date('2026-12-15T00:00:00.000Z'),
      to_date: new Date('2027-01-15T00:00:00.000Z'),
      priority: 0,
      color: '#DC2626',
      is_active: true,
    });
  });

  it('an overlapping season with a higher priority is allowed', async () => {
    const { service, seasons } = build();
    await service.create(HIGH);
    await service.create({ name: 'Fin de año', from_date: '2026-12-30', to_date: '2027-01-01', priority: 10 });
    expect(seasons).toHaveLength(2);
  });

  it('an overlap with the same priority is rejected with a message that explains it', async () => {
    const { service, seasons } = build();
    await service.create(HIGH);
    const { code, message } = await codeOf(
      service.create({ name: 'Fin de año', from_date: '2026-12-30', to_date: '2027-01-01' }),
    );
    expect(code).toBe('LODGING_SEASON_OVERLAP_001');
    expect(message).toContain('Alta');
    expect(message).toContain('prioridad');
    expect(seasons).toHaveLength(1);
  });

  it('touching seasons do not overlap; an inactive one never clashes', async () => {
    const { service, seasons } = build();
    await service.create(HIGH);
    await service.create({ name: 'Enero', from_date: '2027-01-16', to_date: '2027-01-31' });
    await service.create({ name: 'Borrador', from_date: '2026-12-20', to_date: '2026-12-21', is_active: false });
    expect(seasons).toHaveLength(3);
    // Reactivating it with the same priority now clashes with "Alta".
    expect((await codeOf(service.update(3, { is_active: true }))).code).toBe(
      'LODGING_SEASON_OVERLAP_001',
    );
  });

  it('editing a season does not clash with itself', async () => {
    const { service, seasons } = build();
    await service.create(HIGH);
    await service.update(1, { to_date: '2027-01-10' });
    expect(seasons[0].to_date).toEqual(new Date('2027-01-10T00:00:00.000Z'));
  });

  it('rejects a last night before the first one and a duplicate name', async () => {
    const { service, prisma } = build();
    expect(
      (await codeOf(service.create({ name: 'X', from_date: '2026-12-15', to_date: '2026-12-14' }))).code,
    ).toBe('LODGING_SEASON_DATES_001');
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    expect((await codeOf(service.create(HIGH))).code).toBe('LODGING_SEASON_DUP_001');
  });

  it('the DTO accepts civil dates and #RRGGBB colors only', async () => {
    const errorsOf = async (body: Record<string, unknown>) =>
      (await validate(plainToInstance(CreateSeasonDto, { ...HIGH, ...body }))).map((e) => e.property);
    expect(await errorsOf({})).toEqual([]);
    expect(await errorsOf({ from_date: '2026-12-15T10:00:00Z' })).toEqual(['from_date']);
    expect(await errorsOf({ color: 'red' })).toEqual(['color']);
    expect(await errorsOf({ priority: -1 })).toEqual(['priority']);
  });
});
