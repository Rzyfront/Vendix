import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { LodgingRestrictionsService } from './restrictions.service';

/** In-memory `lodging_restrictions` of store 5; type 11 is the store's Doble. */
function build() {
  const rows: any[] = [];
  const table = {
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter((r) => r.date >= where.date.gte && r.date <= where.date.lte),
    ),
    deleteMany: jest.fn(async ({ where }: any) => {
      const keep = rows.filter(
        (r) =>
          !(
            r.store_id === where.store_id &&
            r.unit_type_id === where.unit_type_id &&
            where.date.in.some((d: Date) => d.getTime() === r.date.getTime())
          ),
      );
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
    createMany: jest.fn(async ({ data }: any) => {
      rows.push(...data.map((d: any, i: number) => ({ id: rows.length + i + 1, ...d })));
      return { count: data.length };
    }),
  };
  const prisma = {
    lodging_restrictions: table,
    lodging_unit_types: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === 11 ? { id: 11 } : null)),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ lodging_restrictions: table, $executeRaw: jest.fn() }),
    ),
  };
  return { rows, service: new LodgingRestrictionsService(prisma as any) };
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(VendixHttpException);
  expect((error as VendixHttpException).getResponse()).toMatchObject({ error_code: code });
};

describe('LodgingRestrictionsService (H2.3)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 5 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('fija "Mín. 3 noches" el 7-dic para todos los tipos', async () => {
    const { service } = build();
    const result = await service.set({ from_date: '2026-12-07', min_stay: 3 });
    expect(result).toEqual([
      expect.objectContaining({
        date: '2026-12-07',
        unit_type_id: null,
        min_stay: 3,
        max_stay: null,
        closed_to_arrival: false,
        stop_sell: false,
      }),
    ]);
  });

  it('un rango reemplaza lo de cada noche del alcance y vacío lo quita', async () => {
    const { service, rows } = build();
    await service.set({ from_date: '2026-12-07', to_date: '2026-12-09', closed_to_arrival: true });
    await service.set({ from_date: '2026-12-08', unit_type_id: 11, stop_sell: true });
    await service.set({ from_date: '2026-12-08', stop_sell: true });
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.unit_type_id === null && r.stop_sell)).toHaveLength(1);
    await service.set({ from_date: '2026-12-07', to_date: '2026-12-09' });
    expect(rows.map((r) => r.unit_type_id)).toEqual([11]);
  });

  it('rechaza máxima menor que mínima, fechas al revés y un tipo de otra tienda', async () => {
    const { service, rows } = build();
    await expectCode(
      service.set({ from_date: '2026-12-07', min_stay: 3, max_stay: 2 }),
      'LODGING_RESTRICTION_RANGE_001',
    );
    await expectCode(
      service.set({ from_date: '2026-12-07', to_date: '2026-12-06', stop_sell: true }),
      'LODGING_RESTRICTION_DATES_001',
    );
    await expectCode(
      service.set({ from_date: '2026-12-07', unit_type_id: 99, stop_sell: true }),
      'LODGING_UNIT_TYPE_FIND_001',
    );
    expect(rows).toHaveLength(0);
  });
});
