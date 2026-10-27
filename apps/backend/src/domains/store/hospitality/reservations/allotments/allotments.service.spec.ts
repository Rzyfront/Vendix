import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { LodgingAllotmentsService } from './allotments.service';

const ROW = {
  id: 1,
  customer_id: 90,
  unit_type_id: 11,
  from_date: new Date('2026-12-01T00:00:00.000Z'),
  to_date: new Date('2026-12-31T00:00:00.000Z'),
  rooms: 3,
  release_days: 7,
  notes: null,
  is_active: true,
  created_at: new Date(),
  customer: {
    id: 90,
    first_name: 'Viajes',
    last_name: 'X',
    email: 'viajes@x.co',
  },
  unit_type: { id: 11, name: 'Doble estándar' },
};

/** H2.5 — "Viajes X", 3 Dobles in December, released 7 days before. */
function build(free: number, clash: unknown = null) {
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    lodging_allotments: {
      findFirst: jest.fn(async (): Promise<unknown> => clash),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = {
    lodging_unit_types: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 11 ? { id: 11, name: 'Doble estándar' } : null,
      ),
    },
    users: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 90 ? { id: 90 } : null,
      ),
    },
    lodging_allotments: {
      findFirst: jest.fn(async () => ROW),
      findMany: jest.fn(async () => [ROW]),
    },
    store_settings: {
      findFirst: jest.fn(async () => ({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      })),
    },
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  };
  const availability = {
    allotmentCapacity: jest.fn(async () => ({ night: '2026-12-20', free })),
  };
  const service = new LodgingAllotmentsService(
    prisma as any,
    availability as any,
  );
  return { service, prisma, tx, availability };
}

const dto = {
  customer_id: 90,
  unit_type_id: 11,
  from_date: '2026-12-01',
  to_date: '2026-12-31',
  rooms: 3,
};

describe('LodgingAllotmentsService (H2.5)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
    jest.useFakeTimers({ now: new Date('2026-11-20T15:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('crea el cupo de diciembre con liberación por defecto de 7 días, bajo el lock de ventas', async () => {
    const { service, tx, availability } = build(5);

    const result = await service.create(dto);

    expect(tx.$executeRaw).toHaveBeenCalled();
    const nights = (
      availability.allotmentCapacity.mock.calls[0] as unknown[]
    )[1] as string[];
    expect(nights).toHaveLength(31);
    expect(nights[0]).toBe('2026-12-01');
    expect(nights[30]).toBe('2026-12-31');
    expect(tx.lodging_allotments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 5,
        customer_id: 90,
        rooms: 3,
        release_days: 7,
      }),
    });
    // 20-nov + 7 days: the 1-dic night is still held, released on 24-nov.
    expect(result).toMatchObject({
      from_date: '2026-12-01',
      next_release_date: '2026-11-24',
    });
  });

  it('rechaza el cupo si no quedan habitaciones libres suficientes', async () => {
    const { service, tx } = build(2);

    const error = await service.create(dto).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getResponse()).toMatchObject({
      error_code: 'LODGING_ALLOTMENT_AVAILABILITY_001',
      message: 'Solo quedan 2 Doble estándar libres el 20-dic para el cupo',
    });
    expect(tx.lodging_allotments.create).not.toHaveBeenCalled();
  });

  it('rechaza fechas invertidas y clientes de otra tienda', async () => {
    const { service } = build(5);
    await expect(
      service.create({ ...dto, to_date: '2026-11-30' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error_code: 'LODGING_ALLOTMENT_DATES_001',
      }),
    });
    await expect(
      service.create({ ...dto, customer_id: 1 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error_code: 'LODGING_RESERVATION_CUSTOMER_001',
      }),
    });
  });

  it('rechaza un segundo cupo de la misma agencia y tipo que se solapa', async () => {
    const { service, tx } = build(5, {
      from_date: new Date('2026-12-15T00:00:00.000Z'),
      to_date: new Date('2027-01-15T00:00:00.000Z'),
    });

    const error = await service.create(dto).catch((e) => e);

    expect(error.getResponse()).toMatchObject({
      error_code: 'LODGING_ALLOTMENT_OVERLAP_001',
      message:
        'Ya tiene un cupo de este tipo del 15-dic al 15-ene: edítalo en vez de crear otro',
    });
    expect(tx.lodging_allotments.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store_id: 5,
          customer_id: 90,
          unit_type_id: 11,
          is_active: true,
        }),
      }),
    );
    expect(tx.lodging_allotments.create).not.toHaveBeenCalled();
  });

  it('desactivar libera el cupo sin revisar disponibilidad', async () => {
    const { service, tx, availability } = build(0);

    await service.update(1, { is_active: false });

    expect(availability.allotmentCapacity).not.toHaveBeenCalled();
    expect(tx.lodging_allotments.updateMany).toHaveBeenCalledWith({
      where: { id: 1, store_id: 5 },
      data: expect.objectContaining({ is_active: false }),
    });
  });
});
