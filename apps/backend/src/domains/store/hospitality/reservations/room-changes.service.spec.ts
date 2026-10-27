import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { diffStayNights, LodgingRoomChangesService } from './room-changes.service';

const D = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dec = (n: number) => new Prisma.Decimal(n);

const TYPES = [
  { id: 11, name: 'Doble estándar', price: 250000 },
  { id: 12, name: 'Suite', price: 400000 },
];
const UNITS = [
  { id: 1, code: '101', unit_type_id: 11, is_active: true, housekeeping_status: 'clean' },
  { id: 2, code: '102', unit_type_id: 11, is_active: true, housekeeping_status: 'clean' },
  { id: 3, code: '201', unit_type_id: 12, is_active: true, housekeeping_status: 'clean' },
  { id: 4, code: '103', unit_type_id: 11, is_active: true, housekeeping_status: 'out_of_order' },
];

interface Options {
  status?: string;
  unit?: { id: number; code: string } | null;
  /** Night another stay holds on unit `unit_id`. */
  taken?: { unit_id: number; night_date: string };
  /** Most nights sold of a type on one night by other rooms. */
  soldOfType?: Record<number, number>;
  /** Error thrown by the night update (database guard). */
  updateError?: Error;
  /** Room cancelled alone in a multi-room reservation (H1.5). */
  cancelled?: boolean;
  /** H2.1 — rate plan the room was sold with. */
  ratePlanId?: number;
}

/**
 * H2.1 — plan 3 "Con desayuno": Doble $250.000 base, Friday and Saturday
 * $320.000. It does not price the Suite.
 */
const PLAN_PRICES = [
  { rate_plan_id: 3, unit_type_id: 11, day_of_week: null, price: dec(250000) },
  { rate_plan_id: 3, unit_type_id: 11, day_of_week: 5, price: dec(320000) },
  { rate_plan_id: 3, unit_type_id: 11, day_of_week: 6, price: dec(320000) },
];

/**
 * Room 5 of reservation 9: Doble estándar, 10-nov → 13-nov (3 nights at
 * $250.000 = $750.000). `tx` and the scoped client are the same fake.
 */
function createFake(options: Options = {}) {
  const room = {
    id: 5,
    reservation_id: 9,
    unit_type_id: 11,
    arrival_date: D('2026-11-10'),
    departure_date: D('2026-11-13'),
    adults: 2,
    children: 0,
    total_amount: dec(750000),
    unit: options.unit === undefined ? null : options.unit,
    unit_type: { id: 11, name: 'Doble estándar' },
    cancelled_at: options.cancelled ? D('2026-11-01') : null,
    rate_plan_id: options.ratePlanId ?? null,
    reservation: { status: options.status ?? 'confirmed' },
    nights: ['2026-11-10', '2026-11-11', '2026-11-12'].map((d) => ({
      night_date: D(d),
      rate_amount: dec(250000),
    })),
  };
  const client: any = {
    $executeRaw: jest.fn(async () => 1),
    lodging_reservation_rooms: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === room.id && where.store_id === 1 ? room : null,
      ),
      update: jest.fn(async () => room),
      aggregate: jest.fn(async () => ({
        _min: { arrival_date: null },
        _max: { departure_date: null },
        _sum: { total_amount: null },
      })),
    },
    lodging_units: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.store_id === 1 ? (UNITS.find((u) => u.id === where.id) ?? null) : null,
      ),
      count: jest.fn(async ({ where }: any) =>
        UNITS.filter((u) => u.unit_type_id === where.unit_type_id && u.is_active).length,
      ),
    },
    lodging_unit_types: {
      findFirst: jest.fn(async ({ where }: any) => {
        const type = TYPES.find((t) => t.id === where.id);
        return type
          ? {
              id: type.id,
              name: type.name,
              is_active: true,
              max_adults: 2,
              max_children: 1,
              max_occupancy: 3,
              product: { base_price: dec(type.price) },
            }
          : null;
      }),
    },
    lodging_room_nights: {
      groupBy: jest.fn(async ({ where }: any) => {
        const sold = options.soldOfType?.[where.unit_type_id] ?? 0;
        return sold ? [{ night_date: where.night_date.gte, _count: { _all: sold } }] : [];
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const taken = options.taken;
        const hit =
          taken &&
          taken.unit_id === where.unit_id &&
          where.night_date.in.some((d: Date) => d.getTime() === D(taken.night_date).getTime());
        return hit ? { night_date: D(taken!.night_date) } : null;
      }),
      updateMany: jest.fn(async () => {
        if (options.updateError) throw options.updateError;
        return { count: 3 };
      }),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
    },
    lodging_rate_plans: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 3 && where.store_id === 1
          ? { id: 3, name: 'Con desayuno', is_active: true }
          : null,
      ),
    },
    lodging_rate_prices: {
      findMany: jest.fn(async ({ where }: any) =>
        PLAN_PRICES.filter(
          (p) => p.rate_plan_id === where.rate_plan_id && p.unit_type_id === where.unit_type_id,
        ),
      ),
    },
    lodging_allotments: { findMany: jest.fn(async () => []) },
    lodging_reservations: { update: jest.fn(async () => ({})) },
    lodging_reservation_events: { create: jest.fn(async () => ({})) },
  };
  client.$transaction = jest.fn(async (cb: (tx: any) => unknown) => cb(client));
  const service = new LodgingRoomChangesService(
    client,
    new LodgingAvailabilityService(client),
  );
  return { service, client };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VendixHttpException);
    return error as VendixHttpException;
  }
  throw new Error('expected a rejection');
}

const messageOf = (error: VendixHttpException) => (error.getResponse() as any).message;
const codeOf = (error: VendixHttpException) => (error.getResponse() as any).error_code;

describe('diffStayNights', () => {
  const sold = ['2026-11-10', '2026-11-11', '2026-11-12'].map((night_date) => ({
    night_date,
    rate_amount: dec(250000),
  }));

  it('lengthening keeps the sold rates and prices only the added night', () => {
    const diff = diffStayNights(
      sold,
      ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'],
      () => dec(300000),
      false,
    );
    expect(diff.added).toEqual(['2026-11-13']);
    expect(diff.removed).toEqual([]);
    expect(diff.total.toFixed(2)).toBe('1050000.00');
  });

  it('shortening drops the last night from the total', () => {
    const diff = diffStayNights(sold, ['2026-11-10', '2026-11-11'], () => dec(250000), false);
    expect(diff.removed).toEqual(['2026-11-12']);
    expect(diff.total.toFixed(2)).toBe('500000.00');
  });

  it('a type change reprices every night', () => {
    const diff = diffStayNights(sold, ['2026-11-10', '2026-11-11', '2026-11-12'], () => dec(400000), true);
    expect(diff.total.toFixed(2)).toBe('1200000.00');
  });
});

describe('LodgingRoomChangesService', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, user_id: 7 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('move with collision', () => {
    it('rejects a drop on an occupied room naming it and the night, writing nothing', async () => {
      const { service, client } = createFake({
        unit: { id: 1, code: '101' },
        taken: { unit_id: 2, night_date: '2026-11-11' },
      });
      const error = await rejection(service.apply(5, { unit_id: 2 }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_ROOM_CONFLICT_001');
      expect(messageOf(error)).toBe('La 102 está ocupada el 11-nov');
      expect(client.lodging_room_nights.updateMany).not.toHaveBeenCalled();
      expect(client.lodging_reservation_events.create).not.toHaveBeenCalled();
    });

    it('the quote shows the same collision before confirming', async () => {
      const { service } = createFake({ taken: { unit_id: 2, night_date: '2026-11-11' } });
      const error = await rejection(service.quote(5, { unit_id: 2 }));
      expect(messageOf(error)).toBe('La 102 está ocupada el 11-nov');
    });

    it('translates the database unique guard (race past the check) to the conflict', async () => {
      const unique = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      const { service } = createFake({ updateError: unique });
      const error = await rejection(service.apply(5, { unit_id: 2 }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_ROOM_CONFLICT_001');
      expect(messageOf(error)).toBe('La 102 está ocupada en esas fechas');
    });

    it('assigns a free room under the sale lock and records the history', async () => {
      const { service, client } = createFake();
      await expect(service.apply(5, { unit_id: 1 })).resolves.toBe(9);
      expect(client.$executeRaw).toHaveBeenCalledTimes(2);
      expect(client.lodging_room_nights.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reservation_room_id: 5, is_active: true },
          data: expect.objectContaining({ unit_id: 1, unit_type_id: 11 }),
        }),
      );
      const event = client.lodging_reservation_events.create.mock.calls[0][0].data;
      expect(event).toMatchObject({
        reservation_id: 9,
        from_status: 'confirmed',
        to_status: 'confirmed',
        reason: 'Habitación: Sin asignar → 101',
        user_id: 7,
      });
    });

    it('a move to another type quotes the price difference', async () => {
      const { service } = createFake({ unit: { id: 1, code: '101' } });
      const quote = await service.quote(5, { unit_id: 3 });
      expect(quote.proposed.unit_type.name).toBe('Suite');
      expect(quote.proposed.total_amount).toBe('1200000.00');
      expect(quote.difference).toBe('450000.00');
    });

    it('rejects a type without a free room even if the physical room is free', async () => {
      const { service } = createFake({ soldOfType: { 12: 1 } });
      const error = await rejection(service.quote(5, { unit_id: 3 }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_AVAILABILITY_001');
    });

    it('rejects an out-of-order room', async () => {
      const { service } = createFake();
      const error = await rejection(service.quote(5, { unit_id: 4 }));
      expect(messageOf(error)).toBe('La 103 no está disponible para asignar');
    });

    it('does not find a room of another store', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 2, user_id: 7 } as any);
      const { service, client } = createFake();
      const error = await rejection(service.apply(5, { unit_id: 1 }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_ROOM_FIND_001');
      expect(client.lodging_room_nights.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('resize with recalculation', () => {
    it('one more night adds it at the type rate, updates totals and history', async () => {
      const { service, client } = createFake({ unit: { id: 1, code: '101' } });
      const quote = await service.quote(5, { departure_date: '2026-11-14' });
      expect(quote.proposed).toMatchObject({ nights: 4, total_amount: '1000000.00' });
      expect(quote.difference).toBe('250000.00');

      await service.apply(5, { departure_date: '2026-11-14' });
      expect(client.lodging_room_nights.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            reservation_room_id: 5,
            unit_id: 1,
            unit_type_id: 11,
            night_date: D('2026-11-13'),
            rate_amount: dec(250000),
          }),
        ],
      });
      expect(client.lodging_reservation_rooms.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          departure_date: D('2026-11-14'),
          total_amount: dec(1000000),
        }),
      });
      expect(client.lodging_reservations.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ total_amount: dec(1000000) }) }),
      );
      expect(client.lodging_reservation_events.create.mock.calls[0][0].data.reason).toBe(
        'Fechas: 10-nov al 13-nov (3 noches) → 10-nov al 14-nov (4 noches)',
      );
    });

    it('a night longer onto an occupied night of the room is rejected', async () => {
      const { service } = createFake({
        unit: { id: 1, code: '101' },
        taken: { unit_id: 1, night_date: '2026-11-13' },
      });
      const error = await rejection(service.apply(5, { departure_date: '2026-11-14' }));
      expect(messageOf(error)).toBe('La 101 está ocupada el 13-nov');
    });

    it('a shorter stay frees the dropped night and lowers the total', async () => {
      const { service, client } = createFake();
      const quote = await service.quote(5, { departure_date: '2026-11-12' });
      expect(quote.difference).toBe('-250000.00');
      await service.apply(5, { departure_date: '2026-11-12' });
      expect(client.lodging_room_nights.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ night_date: { in: [D('2026-11-12')] } }),
          data: expect.objectContaining({ is_active: false }),
        }),
      );
      expect(client.lodging_room_nights.createMany).not.toHaveBeenCalled();
    });

    it('rejects departure on or before arrival', async () => {
      const { service } = createFake();
      const error = await rejection(service.quote(5, { departure_date: '2026-11-10' }));
      expect(messageOf(error)).toBe('La salida debe ser posterior a la llegada');
    });

    it('rejects changes of a cancelled reservation', async () => {
      const { service } = createFake({ status: 'cancelled' });
      const error = await rejection(service.quote(5, { departure_date: '2026-11-14' }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_ROOM_STATUS_001');
    });

    it('rejects changes of a room cancelled alone, and totals count active rooms only', async () => {
      const cancelled = createFake({ cancelled: true });
      const error = await rejection(cancelled.service.quote(5, { departure_date: '2026-11-14' }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_ROOM_CANCELLED_001');

      const { service, client } = createFake();
      await service.apply(5, { departure_date: '2026-11-14' });
      expect(client.lodging_reservation_rooms.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reservation_id: 9, cancelled_at: null } }),
      );
    });

    it('rejects a no-op change', async () => {
      const { service } = createFake({ unit: { id: 1, code: '101' } });
      const error = await rejection(service.quote(5, { unit_id: 1 }));
      expect(codeOf(error)).toBe('LODGING_RESERVATION_ROOM_NOCHANGE_001');
    });
  });

  describe('rate plan of the room (H2.1)', () => {
    it('an added Friday night takes the plan weekday price and is snapshotted', async () => {
      const { service, client } = createFake({ ratePlanId: 3 });
      const quote = await service.quote(5, { departure_date: '2026-11-14' });
      // 10/11/12-nov at the sold $250.000 + Friday 13-nov at $320.000.
      expect(quote.proposed.total_amount).toBe('1070000.00');

      await service.apply(5, { departure_date: '2026-11-14' });
      expect(client.lodging_room_nights.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            night_date: D('2026-11-13'),
            rate_amount: dec(320000),
          }),
        ],
      });
    });

    it('a move to a type the plan does not price is rejected naming both', async () => {
      const { service } = createFake({ ratePlanId: 3 });
      const error = await rejection(service.quote(5, { unit_id: 3 }));
      expect(codeOf(error)).toBe('LODGING_RATE_PLAN_UNPRICED_001');
      expect(messageOf(error)).toBe('El plan Con desayuno no tiene precio para Suite');
    });
  });
});
