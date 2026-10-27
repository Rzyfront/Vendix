import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import {
  AUTO_NO_SHOW_REASON,
  LodgingReservationsService,
  nextReservationNumber,
} from './reservations.service';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { formatShortDate, stayNights } from './stay-dates';
import { CancelReservationDto, CreateReservationDto, ReservationQueryDto } from './dto';
import { canTransition, noShowArrivalCutoff } from './reservation-status';

interface NightRow {
  reservation_room_id: number;
  unit_type_id: number;
  night_date: Date;
  is_active: boolean;
  rate_amount?: Prisma.Decimal;
}

const DOUBLE = {
  id: 11,
  name: 'Doble estándar',
  is_active: true,
  max_adults: 2,
  max_children: 1,
  max_occupancy: 3,
  product: { base_price: new Prisma.Decimal(250000) },
};

const SUITE = {
  id: 12,
  name: 'Suite',
  is_active: true,
  max_adults: 2,
  max_children: 2,
  max_occupancy: 4,
  product: { base_price: new Prisma.Decimal(400000) },
};

const TYPES: Record<number, typeof DOUBLE> = { 11: DOUBLE, 12: SUITE };

/**
 * H2.1 — store 5 plans: 3 "Con desayuno" prices the Doble at $250.000 with
 * Friday/Saturday at $320.000 (no Suite price); 4 is inactive.
 */
/**
 * H2.4 — "Flexible: gratis hasta 48 h, luego 1 noche" (no-show = 100 %),
 * assigned to plan 5 with a 30 % deposit.
 */
const FLEXIBLE = {
  id: 8,
  name: 'Flexible',
  rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }],
  no_show_penalty: { penalty_type: 'percent', penalty_value: 100 },
};

const RATE_PLANS: Record<string, unknown>[] = [
  { id: 3, store_id: 5, name: 'Con desayuno', is_active: true },
  { id: 4, store_id: 5, name: 'Promo vieja', is_active: false },
  {
    id: 5,
    store_id: 5,
    name: 'Flexible',
    is_active: true,
    deposit_percent: new Prisma.Decimal(30),
    cancellation_policy: { ...FLEXIBLE, is_active: true },
  },
];
const RATE_PRICES = [
  { rate_plan_id: 3, unit_type_id: 11, day_of_week: null, price: new Prisma.Decimal(250000) },
  { rate_plan_id: 3, unit_type_id: 11, day_of_week: 5, price: new Prisma.Decimal(320000) },
  { rate_plan_id: 3, unit_type_id: 11, day_of_week: 6, price: new Prisma.Decimal(320000) },
  { rate_plan_id: 4, unit_type_id: 11, day_of_week: null, price: new Prisma.Decimal(200000) },
  { rate_plan_id: 5, unit_type_id: 11, day_of_week: null, price: new Prisma.Decimal(250000) },
];

/** Lets every other pending async step run, so unlocked work interleaves. */
const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * In-memory store: `units` active rooms of each type (a number for every
 * type, or a count per type id). The advisory lock
 * is a FIFO mutex held until the transaction callback settles, like
 * `pg_advisory_xact_lock`. Reads and writes yield, so without the lock two
 * parallel sales would both see the last room free.
 */
function createFakeStore(
  units: number | Record<number, number>,
  overbooking_allowance = 0,
  restrictions: Record<string, unknown>[] = [],
  allotments: Record<string, any>[] = [],
) {
  const nights: NightRow[] = [];
  const reservations: {
    id: number;
    reservation_number: string;
    status: string;
    store_id: number;
    arrival_date: Date;
    customer_id?: number;
    total_amount?: Prisma.Decimal;
  }[] = [];
  const rooms: {
    id: number;
    reservation_id: number;
    unit_type_id: number;
    arrival_date: Date;
    departure_date: Date;
    total_amount: Prisma.Decimal;
    cancelled_at?: Date | null;
  }[] = [];
  const events: Record<string, unknown>[] = [];
  let lock: Promise<void> = Promise.resolve();

  const tables = {
    lodging_unit_types: {
      findFirst: jest.fn(async ({ where }: any) =>
        TYPES[where.id] ? { ...TYPES[where.id], overbooking_allowance } : null,
      ),
    },
    lodging_units: {
      count: jest.fn(async ({ where }: any) =>
        typeof units === 'number' ? units : (units[where.unit_type_id] ?? 0),
      ),
    },
    lodging_room_nights: {
      groupBy: jest.fn(async ({ where }: any) => {
        await yieldTurn();
        const counts = new Map<string, number>();
        for (const n of nights) {
          if (
            n.unit_type_id === where.unit_type_id &&
            n.is_active &&
            n.night_date >= where.night_date.gte &&
            n.night_date < where.night_date.lt
          ) {
            const key = n.night_date.toISOString();
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        return [...counts.entries()].map(([key, c]) => ({
          night_date: new Date(key),
          _count: { _all: c },
        }));
      }),
      // H2.5 — nights an allotment customer already booked.
      findMany: jest.fn(async ({ where }: any) =>
        nights
          .filter(
            (n) =>
              where.unit_type_id.in.includes(n.unit_type_id) &&
              n.is_active &&
              n.night_date >= where.night_date.gte &&
              n.night_date <= where.night_date.lte,
          )
          .map((n) => {
            const room = rooms.find((r) => r.id === n.reservation_room_id)!;
            const reservation = reservations.find((r) => r.id === room.reservation_id)!;
            return {
              unit_type_id: n.unit_type_id,
              night_date: n.night_date,
              reservation_room: { reservation: { customer_id: reservation.customer_id } },
            };
          })
          .filter((n) =>
            where.reservation_room.reservation.customer_id.in.includes(
              n.reservation_room.reservation.customer_id,
            ),
          ),
      ),
      createMany: jest.fn(async ({ data }: any) => {
        await yieldTurn();
        nights.push(...data.map((d: any) => ({ ...d, is_active: true })));
        return { count: data.length };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const roomIds = where.reservation_room_id
          ? [where.reservation_room_id]
          : rooms
              .filter((r) => r.reservation_id === where.reservation_room.reservation_id)
              .map((r) => r.id);
        const hit = nights.filter(
          (n) => roomIds.includes(n.reservation_room_id) && n.is_active === where.is_active,
        );
        hit.forEach((n) => (n.is_active = data.is_active));
        return { count: hit.length };
      }),
    },
    lodging_reservations: {
      findFirst: jest.fn(async (args: any) => {
        if (args?.where?.id !== undefined) {
          const r = reservations.find(
            (x) =>
              x.id === args.where.id &&
              (!args.where.status?.in || args.where.status.in.includes(x.status)),
          );
          if (!r) return null;
          const active = rooms
            .filter((x) => x.reservation_id === r.id && !x.cancelled_at)
            .map((x) => ({
              ...x,
              unit_type: { name: TYPES[x.unit_type_id].name },
              unit: null,
              nights: nights
                .filter((n) => n.reservation_room_id === x.id && n.is_active)
                .sort((a, b) => a.night_date.getTime() - b.night_date.getTime()),
            }));
          return { ...r, rooms: active, events: [] };
        }
        return reservations[reservations.length - 1] ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        reservations.filter(
          (r) => r.status === where.status && r.arrival_date < where.arrival_date.lt,
        ),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        await yieldTurn();
        const hit = reservations.filter((r) => r.id === where.id && r.status === where.status);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: reservations.length + 1, ...data };
        reservations.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = reservations.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    lodging_reservation_rooms: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 101 + rooms.length, ...data };
        rooms.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => rooms.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rooms.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      aggregate: jest.fn(async ({ where }: any) => {
        const hit = rooms.filter(
          (r) => r.reservation_id === where.reservation_id && !r.cancelled_at,
        );
        return {
          _min: { arrival_date: hit[0]?.arrival_date ?? null },
          _max: { departure_date: hit[0]?.departure_date ?? null },
          _sum: {
            total_amount: hit.length
              ? hit.reduce((sum, r) => sum.add(r.total_amount), new Prisma.Decimal(0))
              : null,
          },
        };
      }),
    },
    lodging_reservation_events: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
    lodging_inventory_blocks: { findMany: jest.fn(async () => []) },
    lodging_allotments: {
      findMany: jest.fn(async ({ where }: any) =>
        allotments.filter(
          (a) =>
            where.unit_type_id.in.includes(a.unit_type_id) &&
            a.from_date <= where.from_date.lte &&
            a.to_date >= where.to_date.gte &&
            a.customer_id !== where.customer_id?.not,
        ),
      ),
    },
    lodging_rate_plans: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          RATE_PLANS.find((p) => p.id === where.id && p.store_id === where.store_id) ?? null,
      ),
    },
    lodging_restrictions: {
      findMany: jest.fn(async ({ where }: any) =>
        restrictions.filter(
          (r: any) => r.date >= where.date.gte && r.date <= where.date.lte,
        ),
      ),
    },
    lodging_rate_prices: {
      findMany: jest.fn(async ({ where }: any) =>
        RATE_PRICES.filter(
          (p) => p.rate_plan_id === where.rate_plan_id && p.unit_type_id === where.unit_type_id,
        ),
      ),
    },
  };

  const prisma = {
    ...tables,
    users: { findFirst: jest.fn(async () => ({ id: 77 })) },
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      let release = () => {};
      const tx = {
        ...tables,
        $executeRaw: jest.fn(async () => {
          const previous = lock;
          lock = new Promise<void>((resolve) => (release = resolve));
          await previous;
        }),
      };
      try {
        return await fn(tx);
      } finally {
        release();
      }
    }),
  };
  return { prisma, nights, reservations, rooms, events };
}

const stay = {
  unit_type_id: 11,
  arrival_date: '2026-11-10',
  departure_date: '2026-11-13',
  adults: 2,
  customer_id: 77,
};

type Stay = typeof stay & { children?: number };

/** One-room stay → create payload (H1.5: a reservation holds `rooms`). */
const sale = ({ unit_type_id, adults, children, ...rest }: Stay): CreateReservationDto => ({
  ...rest,
  rooms: [{ unit_type_id, adults, children }],
});

/**
 * H1.1 — nightly reservation of one room. Each sold night is a row of the
 * type; the last room cannot be sold twice and the departure night is free.
 */
describe('LodgingReservationsService', () => {
  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    const body = (error as VendixHttpException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ error_code: code });
    return body;
  };

  const build = (
    units: number | Record<number, number>,
    overbooking_allowance = 0,
    restrictions: Record<string, unknown>[] = [],
    allotments: Record<string, any>[] = [],
  ) => {
    const fake = createFakeStore(units, overbooking_allowance, restrictions, allotments);
    const deposits = {
      retainInTx: jest.fn(async (): Promise<unknown> => null),
      announceRetained: jest.fn(),
      quoteSettlement: jest.fn(async () => ({})),
      cancelPendingLinksInTx: jest.fn(async (): Promise<number[]> => []),
      deactivateLinks: jest.fn(async () => undefined),
    };
    const service = new LodgingReservationsService(
      fake.prisma as any,
      new LodgingAvailabilityService(fake.prisma as any),
      // H3.5 — no deposit held unless a test says so (deposits.service.spec).
      deposits as any,
    );
    return { ...fake, service, deposits };
  };

  beforeEach(() => {
    // Stays in the specs start on 10-nov or later: today is 1-nov (Bogotá).
    jest.useFakeTimers({ now: new Date('2026-11-01T17:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('filtros de la lista', () => {
    it('una fecha imposible en el filtro se rechaza en el DTO (no llega a Prisma)', async () => {
      const bad = await validate(plainToInstance(ReservationQueryDto, { date_from: '2026-13-45', date_to: '2026-02-30' }));
      expect(bad.map((e) => e.property).sort()).toEqual(['date_from', 'date_to']);
      const ok = await validate(plainToInstance(ReservationQueryDto, { date_from: '2026-11-10', date_to: '2026-11-13' }));
      expect(ok).toEqual([]);
    });
  });

  describe('noches de la estadía', () => {
    it('del 10 al 13 son 3 noches: la noche de salida no cuenta', () => {
      expect(stayNights('2026-11-10', '2026-11-13')).toEqual([
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
      ]);
      expect(stayNights('2026-12-31', '2027-01-02')).toEqual(['2026-12-31', '2027-01-01']);
    });

    it('salida igual o anterior a la llegada muestra "La salida debe ser posterior a la llegada"', async () => {
      const { service } = build(2);
      for (const departure_date of ['2026-11-10', '2026-11-09']) {
        const body = await expectCode(
          service.create(sale({ ...stay, departure_date })),
          'LODGING_RESERVATION_DATES_001',
        );
        expect(body.message).toBe('La salida debe ser posterior a la llegada');
      }
    });

    it('rechaza estadías de más de 365 noches', () => {
      expect(() => stayNights('2026-01-01', '2027-01-02')).toThrow(VendixHttpException);
    });

    it('el DTO solo acepta fechas reales YYYY-MM-DD y al menos un adulto', async () => {
      const errorsOf = async (patch: Record<string, unknown>) =>
        (await validate(plainToInstance(CreateReservationDto, { ...sale(stay), ...patch }))).map(
          (e) => e.property,
        );
      expect(await errorsOf({})).toEqual([]);
      expect(await errorsOf({ arrival_date: '2026-02-30' })).toEqual(['arrival_date']);
      expect(await errorsOf({ departure_date: '13/11/2026' })).toEqual(['departure_date']);
      expect(await errorsOf({ rooms: [{ unit_type_id: 11, adults: 0 }] })).toEqual(['rooms']);
      expect(await errorsOf({ rooms: [] })).toEqual(['rooms']);
    });
  });

  describe('disponibilidad', () => {
    it('cotiza "2 disponibles · 3 noches · $750.000" con el precio base', async () => {
      const { service } = build(2);
      await expect(service.quote(stay)).resolves.toEqual({
        unit_type: { id: 11, name: 'Doble estándar' },
        available: 2,
        units: 2,
        sold: 0,
        held: 0,
        overbooking_allowance: 0,
        nights: 3,
        rate_plan: null,
        cancellation_policy: null,
        deposit_percent: '0',
        night_rates: [
          { night_date: '2026-11-10', rate_amount: '250000.00' },
          { night_date: '2026-11-11', rate_amount: '250000.00' },
          { night_date: '2026-11-12', rate_amount: '250000.00' },
        ],
        total_amount: '750000.00',
        restrictions: [],
      });
    });

    it('una reserva que sale el día que otra llega no le quita cupo', async () => {
      const { service } = build(1);
      await service.create(sale({ ...stay, arrival_date: '2026-11-07', departure_date: '2026-11-10' }));
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 1 });
      await expect(
        service.quote({ ...stay, arrival_date: '2026-11-09', departure_date: '2026-11-11' }),
      ).resolves.toMatchObject({ available: 0 });
    });
  });

  describe('crear', () => {
    it('rechaza una llegada anterior al día hotelero sin crear nada', async () => {
      jest.setSystemTime(new Date('2026-11-11T17:00:00Z')); // 11-nov 12:00 Bogotá
      const { service, prisma } = build(2);
      const body = await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_DATES_003');
      expect(body.message).toBe('La llegada no puede ser anterior a hoy');
      expect(prisma.lodging_reservations.create).not.toHaveBeenCalled();
    });

    it('antes del cierre del día (01:00) la llegada de ayer aún se acepta', async () => {
      jest.setSystemTime(new Date('2026-11-11T06:00:00Z')); // 11-nov 01:00 Bogotá
      const { service, prisma } = build(2);
      await service.create(sale(stay));
      expect(prisma.lodging_reservations.create).toHaveBeenCalled();
    });

    it('crea H-0001 confirmada con 3 noches a $250.000 y total $750.000', async () => {
      const { service, prisma, nights } = build(2);

      await service.create(sale(stay));

      expect(prisma.lodging_reservations.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          store_id: 5,
          reservation_number: 'H-0001',
          status: 'confirmed',
          customer_id: 77,
          created_by_user_id: 9,
          total_amount: new Prisma.Decimal(750000),
        }),
      });
      expect(prisma.lodging_reservation_rooms.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unit_type_id: 11, adults: 2, children: 0 }),
      });
      expect(nights.map((n) => n.night_date.toISOString().slice(0, 10))).toEqual([
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
      ]);
      expect(nights.every((n: any) => n.rate_amount.equals(250000) && n.store_id === 5)).toBe(true);
    });

    it('la tercera reserva con 2 habitaciones muestra "Sin disponibilidad de Doble estándar para el 10-nov al 13-nov"', async () => {
      const { service, reservations } = build(2);
      await service.create(sale(stay));
      await service.create(sale(stay));

      const body = await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_AVAILABILITY_001');

      expect(body.message).toBe('Sin disponibilidad de Doble estándar para el 10-nov al 13-nov');
      expect(reservations.map((r) => r.reservation_number)).toEqual(['H-0001', 'H-0002']);
    });

    it('dos ventas en paralelo por la última habitación: una se crea y la otra falla', async () => {
      const { service, reservations, nights } = build(1);

      const results = await Promise.allSettled([service.create(sale(stay)), service.create(sale(stay))]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as VendixHttpException).getResponse()).toMatchObject({
        error_code: 'LODGING_RESERVATION_AVAILABILITY_001',
      });
      expect(reservations).toHaveLength(1);
      expect(nights).toHaveLength(3);
    });

    it('3 adultos en un tipo de máximo 2 muestran "Excede la capacidad del tipo"', async () => {
      const { service, prisma } = build(2);
      for (const occupancy of [{ adults: 3 }, { adults: 2, children: 2 }]) {
        const body = await expectCode(
          service.create(sale({ ...stay, ...occupancy })),
          'LODGING_RESERVATION_CAPACITY_001',
        );
        expect(body.message).toBe('Excede la capacidad del tipo');
      }
      await expectCode(service.quote({ ...stay, adults: 3 }), 'LODGING_RESERVATION_CAPACITY_001');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un cliente que no es de la tienda no puede ser titular', async () => {
      const { service, prisma } = build(2);
      prisma.users.findFirst.mockResolvedValueOnce(null as any);

      await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_CUSTOMER_001');

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: 77, store_users: { some: { store_id: 5 } } },
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un tipo inactivo no se vende', async () => {
      const { service, prisma } = build(2);
      prisma.lodging_unit_types.findFirst.mockResolvedValueOnce({ ...DOUBLE, is_active: false, overbooking_allowance: 0 });

      await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_TYPE_001');
    });
  });

  /**
   * H2.1 — a rate plan prices each night by its weekday and the price is
   * snapshotted per night; plans without a price for the type are refused.
   */
  describe('planes tarifarios', () => {
    // Thursday 12-nov → Saturday 14-nov: Thursday and Friday nights.
    const weekend = { ...stay, arrival_date: '2026-11-12', departure_date: '2026-11-14' };

    it('cotiza el desglose "jue $250.000 · vie $320.000 = $570.000"', async () => {
      const { service } = build(2);
      await expect(service.quote({ ...weekend, rate_plan_id: 3 })).resolves.toMatchObject({
        rate_plan: { id: 3, name: 'Con desayuno' },
        night_rates: [
          { night_date: '2026-11-12', rate_amount: '250000.00' },
          { night_date: '2026-11-13', rate_amount: '320000.00' },
        ],
        total_amount: '570000.00',
      });
    });

    it('la reserva guarda el plan y el precio de cada noche (snapshot)', async () => {
      const { service, prisma, nights, reservations } = build(2);
      const { unit_type_id, adults, ...rest } = weekend;
      await service.create({ ...rest, rooms: [{ unit_type_id, adults, rate_plan_id: 3 }] });

      expect(prisma.lodging_reservation_rooms.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rate_plan_id: 3,
          total_amount: new Prisma.Decimal(570000),
        }),
      });
      expect(
        nights.map((n: any) => [n.night_date.toISOString().slice(0, 10), n.rate_amount.toFixed(2)]),
      ).toEqual([
        ['2026-11-12', '250000.00'],
        ['2026-11-13', '320000.00'],
      ]);
      expect(reservations[0].total_amount?.toFixed(2)).toBe('570000.00');
    });

    it('sin plan la reserva sigue al precio base del tipo y sin plan guardado', async () => {
      const { service, prisma } = build(2);
      await service.create(sale(weekend));
      expect(prisma.lodging_reservation_rooms.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rate_plan_id: null,
          total_amount: new Prisma.Decimal(500000),
        }),
      });
    });

    it('un plan sin precio para el tipo no se puede usar con ese tipo', async () => {
      const { service, prisma } = build(2);
      const body = await expectCode(
        service.quote({ ...weekend, unit_type_id: 12, rate_plan_id: 3 }),
        'LODGING_RATE_PLAN_UNPRICED_001',
      );
      expect(body.message).toBe('El plan Con desayuno no tiene precio para Suite');
      const { unit_type_id, adults, ...rest } = weekend;
      await expectCode(
        service.create({ ...rest, rooms: [{ unit_type_id: 12, adults, rate_plan_id: 3 }] }),
        'LODGING_RATE_PLAN_UNPRICED_001',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un plan inactivo o de otra tienda no se vende', async () => {
      const { service } = build(2);
      await expectCode(service.quote({ ...weekend, rate_plan_id: 4 }), 'LODGING_RATE_PLAN_INACTIVE_001');
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 6, user_id: 9 } as any);
      await expectCode(service.quote({ ...weekend, rate_plan_id: 3 }), 'LODGING_RATE_PLAN_FIND_001');
    });
  });

  /**
   * H1.2 — cancel and no-show free the nights (is_active=false, never
   * deleted) and leave a history line; invalid changes are rejected.
   */
  describe('sobreventa controlada (H1.6)', () => {
    it('con 2 habitaciones y sobreventa 1 la tercera se crea y la cuarta se rechaza', async () => {
      const { service, reservations } = build(2, 1);
      await service.create(sale(stay));
      await service.create(sale(stay));

      await expect(service.quote(stay)).resolves.toMatchObject({
        available: 1,
        units: 2,
        sold: 2,
        overbooking_allowance: 1,
      });
      await service.create(sale(stay));
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 0, sold: 3 });

      const body = await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_AVAILABILITY_001');
      expect(body.message).toBe('Sin disponibilidad de Doble estándar para el 10-nov al 13-nov');
      expect(reservations.map((r) => r.reservation_number)).toEqual(['H-0001', 'H-0002', 'H-0003']);
    });

    it('dos ventas en paralelo por el último cupo de sobreventa: una se crea y la otra falla', async () => {
      const { service, reservations } = build(1, 1);
      await service.create(sale(stay));

      const results = await Promise.allSettled([service.create(sale(stay)), service.create(sale(stay))]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(reservations).toHaveLength(2);
    });
  });

  describe('cupos para agencias y empresas (H2.5)', () => {
    // "Viajes X" (customer 90) holds 3 Dobles in November, released 7 days
    // before each night. The stay 10-13 nov is released from 3, 4 and 5 nov.
    const VIAJES_X = {
      store_id: 5,
      customer_id: 90,
      unit_type_id: 11,
      from_date: new Date('2026-11-01T00:00:00.000Z'),
      to_date: new Date('2026-11-30T00:00:00.000Z'),
      rooms: 3,
      release_days: 7,
    };
    const agency = { ...stay, customer_id: 90 };
    const at = (iso: string) =>
      jest.useFakeTimers({ now: new Date(iso), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });

    afterEach(() => jest.useRealTimers());

    it('el público ve 3 Dobles menos y no puede vender el cupo', async () => {
      at('2026-11-01T15:00:00.000Z');
      const { service } = build(5, 0, [], [VIAJES_X]);

      await expect(service.quote(stay)).resolves.toMatchObject({ available: 2, held: 3, units: 5 });
      await service.create(sale(stay));
      await service.create(sale(stay));
      await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_AVAILABILITY_001');
    });

    it('al reservar para Viajes X se consume el cupo, no la disponibilidad pública', async () => {
      at('2026-11-01T15:00:00.000Z');
      const { service } = build(5, 0, [], [VIAJES_X]);

      await expect(service.quote({ ...stay, customer_id: 90 })).resolves.toMatchObject({
        available: 5,
        held: 0,
      });
      await service.create(sale(agency));
      // 5 rooms - 1 sold to Viajes X - 2 still held for it.
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 2, held: 2, sold: 1 });
      await service.create(sale(stay));
      await service.create(sale(stay));
      await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_AVAILABILITY_001');
      // The agency still has its 2 held rooms.
      await service.create(sale(agency));
      await service.create(sale(agency));
      await expectCode(service.create(sale(agency)), 'LODGING_RESERVATION_AVAILABILITY_001');
    });

    it('7 días antes de cada noche el cupo no usado vuelve al público', async () => {
      // 4-nov: nights 10 and 11 are released, the 12th is still held.
      at('2026-11-04T15:00:00.000Z');
      const { service } = build(5, 0, [], [VIAJES_X]);
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 2, held: 3 });

      // 5-nov (store time zone): the last night is released too.
      at('2026-11-05T15:00:00.000Z');
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 5, held: 0 });
      // 4-nov 23:30 in Bogotá is already 5-nov in UTC: still held.
      at('2026-11-05T04:30:00.000Z');
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 2, held: 3 });
    });
  });

  describe('cancelación y no-show', () => {
    const activeNightsOf = (nights: NightRow[], roomId: number) =>
      nights.filter((n) => n.reservation_room_id === roomId && n.is_active).length;

    it('crear deja en el historial la línea "Confirmada" con quien la creó', async () => {
      const { service, events } = build(1);
      await service.create(sale(stay));
      expect(events).toEqual([
        { store_id: 5, reservation_id: 1, from_status: null, to_status: 'confirmed', user_id: 9 },
      ]);
    });

    it('tras cancelar con motivo queda "Cancelada", las noches se liberan y la reserva nueva se crea', async () => {
      const { service, nights, reservations, events } = build(1);
      await service.create(sale(stay));
      await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_AVAILABILITY_001');

      await service.cancel(1, 'El huésped cambió de planes');

      expect(reservations[0].status).toBe('cancelled');
      expect(nights).toHaveLength(3); // nothing deleted
      expect(activeNightsOf(nights, 101)).toBe(0);
      expect(events[1]).toEqual({
        store_id: 5,
        reservation_id: 1,
        from_status: 'confirmed',
        to_status: 'cancelled',
        reason: 'El huésped cambió de planes',
        user_id: 9,
      });

      await service.create(sale(stay));
      expect(reservations[1]).toMatchObject({ reservation_number: 'H-0002', status: 'confirmed' });
    });

    it('cancelar una reserva ya cancelada o no-show es una transición inválida', async () => {
      const { service, reservations, events } = build(2);
      await service.create(sale(stay));
      await service.cancel(1, 'Motivo');

      const body = await expectCode(service.cancel(1, 'Otra vez'), 'LODGING_RESERVATION_TRANSITION_001');
      expect(body.message).toBe('No se puede pasar una reserva cancelada a cancelada');
      await expectCode(service.markNoShow(1), 'LODGING_RESERVATION_TRANSITION_001');
      expect(reservations[0].status).toBe('cancelled');
      expect(events).toHaveLength(2);
    });

    it('máquina de estados: válidas e inválidas', () => {
      expect(canTransition('confirmed', 'cancelled')).toBe(true);
      expect(canTransition('confirmed', 'no_show')).toBe(true);
      expect(canTransition('tentative', 'cancelled')).toBe(true);
      expect(canTransition('tentative', 'no_show')).toBe(false);
      expect(canTransition('checked_in', 'cancelled')).toBe(false);
      expect(canTransition('checked_out', 'checked_in')).toBe(false);
      expect(canTransition('no_show', 'confirmed')).toBe(false);
    });

    it('no-show manual solo desde el día de llegada (zona de la tienda)', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const { service, reservations } = build(1);
        await service.create(sale(stay));

        // 9-nov 23:00 in Bogotá is already 10-nov in UTC: still before arrival.
        jest.setSystemTime(new Date('2026-11-10T04:00:00Z'));
        const body = await expectCode(service.markNoShow(1), 'LODGING_RESERVATION_NO_SHOW_001');
        expect(body.message).toBe('Solo se puede marcar no-show desde el día de llegada');

        jest.setSystemTime(new Date('2026-11-10T23:00:00Z'));
        await service.markNoShow(1);
        expect(reservations[0].status).toBe('no_show');
      } finally {
        jest.useRealTimers();
      }
    });

    it('el no-show automático mueve solo las llegadas vencidas y libera sus noches', async () => {
      const { service, nights, reservations, events } = build(3);
      await service.create(sale(stay)); // arrives 10-nov
      await service.create(sale({ ...stay, arrival_date: '2026-11-11', departure_date: '2026-11-12' }));
      await service.create(sale(stay));
      await service.cancel(3, 'Motivo');

      expect(await service.autoNoShow('2026-11-11')).toBe(1);

      expect(reservations.map((r) => r.status)).toEqual(['no_show', 'confirmed', 'cancelled']);
      expect(activeNightsOf(nights, 101)).toBe(0);
      expect(activeNightsOf(nights, 102)).toBe(1);
      expect(events[events.length - 1]).toEqual({
        store_id: 5,
        reservation_id: 1,
        from_status: 'confirmed',
        to_status: 'no_show',
        reason: AUTO_NO_SHOW_REASON,
        user_id: null,
      });
    });

    it('cancelación y job a la vez: solo uno cambia el estado y el otro lo informa', async () => {
      const { service, reservations, events } = build(1);
      await service.create(sale(stay));

      const [cancel, auto] = await Promise.allSettled([
        service.cancel(1, 'Motivo'),
        service.autoNoShow('2026-11-11'),
      ]);

      expect(events.filter((e) => e.from_status === 'confirmed')).toHaveLength(1);
      if (reservations[0].status === 'no_show') {
        expect(cancel.status).toBe('rejected');
        expect((cancel as PromiseRejectedResult).reason.getResponse().message).toBe(
          'La reserva ya está no-show',
        );
      } else {
        expect(reservations[0].status).toBe('cancelled');
        expect(auto).toEqual({ status: 'fulfilled', value: 0 });
      }
    });

    it('el motivo de la cancelación es obligatorio', async () => {
      const errorsOf = async (reason: unknown) =>
        (await validate(plainToInstance(CancelReservationDto, { reason }))).map((e) => e.property);
      expect(await errorsOf('   ')).toEqual(['reason']);
      expect(await errorsOf(undefined)).toEqual(['reason']);
      expect(await errorsOf('Cambio de planes')).toEqual([]);
    });

    it('hora límite: el día siguiente a la llegada a la hora configurada', () => {
      // 11-nov 05:59 with limit 06:00: only arrivals before 10-nov are overdue.
      expect(noShowArrivalCutoff('2026-11-11', '05:59', '06:00')).toBe('2026-11-10');
      // 11-nov 06:00: the 10-nov arrival is overdue too.
      expect(noShowArrivalCutoff('2026-11-11', '06:00', '06:00')).toBe('2026-11-11');
      expect(noShowArrivalCutoff('2026-03-01', '00:00')).toBe('2026-02-28');
    });
  });

  /**
   * H1.5 — one reservation with several rooms of different types: sold all or
   * nothing in one transaction; one room can be cancelled alone.
   */
  describe('multi-habitación y grupos', () => {
    const group: CreateReservationDto = {
      arrival_date: '2026-11-10',
      departure_date: '2026-11-13',
      customer_id: 77,
      rooms: [
        { unit_type_id: 11, adults: 2 },
        { unit_type_id: 12, adults: 2, children: 1 },
        { unit_type_id: 11, adults: 1 },
      ],
    };
    const activeNights = (nights: NightRow[], roomId: number) =>
      nights.filter((n) => n.reservation_room_id === roomId && n.is_active).length;

    it('2 Dobles + 1 Suite: una reserva con 3 habitaciones y total consolidado', async () => {
      const { service, reservations, rooms, nights, events } = build({ 11: 2, 12: 1 });

      await service.create(group);

      expect(reservations).toHaveLength(1);
      // 2 × 3 noches × $250.000 + 3 noches × $400.000
      expect(reservations[0].total_amount!.equals(2_700_000)).toBe(true);
      expect(rooms.map((r) => r.unit_type_id)).toEqual([11, 12, 11]);
      expect(rooms.every((r) => r.reservation_id === 1)).toBe(true);
      expect(rooms.map((r) => r.total_amount.toFixed(0))).toEqual(['750000', '1200000', '750000']);
      expect(nights).toHaveLength(9);
      expect(nights.filter((n: any) => n.unit_type_id === 12 && n.rate_amount.equals(400000))).toHaveLength(3);
      expect(events).toHaveLength(1);
    });

    it('si un tipo no tiene cupo no se crea ninguna habitación y el mensaje nombra el tipo', async () => {
      const { service, reservations, rooms, nights } = build({ 11: 2, 12: 0 });

      const body = await expectCode(service.create(group), 'LODGING_RESERVATION_AVAILABILITY_001');

      expect(body.message).toBe('Sin disponibilidad de Suite para el 10-nov al 13-nov');
      expect(reservations).toHaveLength(0);
      expect(rooms).toHaveLength(0);
      expect(nights).toHaveLength(0);
    });

    it('pedir 2 Dobles con 1 libre falla entero e indica cuántas quedan', async () => {
      const { service, reservations, nights } = build({ 11: 1, 12: 1 });

      const body = await expectCode(service.create(group), 'LODGING_RESERVATION_AVAILABILITY_001');

      expect(body.message).toBe('Sin disponibilidad de Doble estándar para el 10-nov al 13-nov (quedan 1)');
      expect(reservations).toHaveLength(0);
      expect(nights).toHaveLength(0);
    });

    it('la capacidad se valida por habitación antes de vender', async () => {
      const { service, prisma } = build({ 11: 2, 12: 1 });
      const tooMany = { ...group, rooms: [...group.rooms, { unit_type_id: 12, adults: 3 }] };

      await expectCode(service.create(tooMany), 'LODGING_RESERVATION_CAPACITY_001');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cancelar una sola habitación deja las otras activas y recalcula el total', async () => {
      const { service, reservations, rooms, nights, events } = build({ 11: 2, 12: 1 });
      await service.create(group);

      await service.cancelRoom(101, 'Llega una persona menos');

      expect(reservations[0].status).toBe('confirmed');
      expect(rooms[0].cancelled_at).toBeInstanceOf(Date);
      expect(activeNights(nights, 101)).toBe(0);
      expect(activeNights(nights, 102)).toBe(3);
      expect(activeNights(nights, 103)).toBe(3);
      expect(nights).toHaveLength(9); // nothing deleted
      expect(reservations[0].total_amount!.equals(1_950_000)).toBe(true);
      expect(events[1]).toEqual({
        store_id: 5,
        reservation_id: 1,
        from_status: 'confirmed',
        to_status: 'confirmed',
        reason: 'Habitación cancelada: Doble estándar — Llega una persona menos',
        user_id: 9,
      });
      // The freed Doble sells again.
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 1 });
    });

    it('no cancela la única habitación activa, una ya cancelada ni la de una reserva cancelada', async () => {
      const { service, rooms } = build({ 11: 2, 12: 1 });
      await service.create({ ...group, rooms: group.rooms.slice(0, 2) });
      await service.cancelRoom(101, 'Motivo');

      await expectCode(service.cancelRoom(101, 'Otra vez'), 'LODGING_RESERVATION_ROOM_CANCELLED_001');
      const body = await expectCode(service.cancelRoom(102, 'Motivo'), 'LODGING_RESERVATION_ROOM_LAST_001');
      expect(body.message).toBe(
        'Es la única habitación activa de la reserva: cancela la reserva completa',
      );
      expect(rooms[1].cancelled_at).toBeUndefined();

      await service.cancel(1, 'Motivo');
      await expectCode(service.cancelRoom(102, 'Motivo'), 'LODGING_RESERVATION_ROOM_STATUS_001');
      await expectCode(service.cancelRoom(999, 'Motivo'), 'LODGING_RESERVATION_ROOM_FIND_001');
    });
  });

  describe('restricciones (H2.3)', () => {
    /** 7-dic "Mín. 3 noches" and 8-dic "Cerrado a la llegada", every type. */
    const row = (date: string, patch: Record<string, unknown>) => ({
      date: new Date(`${date}T00:00:00.000Z`),
      unit_type_id: null,
      min_stay: null,
      max_stay: null,
      closed_to_arrival: false,
      closed_to_departure: false,
      stop_sell: false,
      ...patch,
    });
    const DECEMBER = [
      row('2026-12-07', { min_stay: 3 }),
      row('2026-12-08', { closed_to_arrival: true }),
    ];
    const dec = (arrival_date: string, departure_date: string) => ({
      ...stay,
      arrival_date,
      departure_date,
    });

    it('la cotización muestra "Estancia mínima de 3 noches para llegar el 7-dic"', async () => {
      const { service } = build(2, 0, DECEMBER);
      const quote = await service.quote(dec('2026-12-07', '2026-12-08'));
      expect(quote.restrictions).toEqual(['Estancia mínima de 3 noches para llegar el 7-dic']);
      const ok = await service.quote(dec('2026-12-07', '2026-12-10'));
      expect(ok.restrictions).toEqual([]);
    });

    it('crear con llegada el 8-dic falla con "No se admiten llegadas el 8-dic" y no vende noches', async () => {
      const { service, nights, reservations } = build(2, 0, DECEMBER);
      const body = await expectCode(
        service.create(sale(dec('2026-12-08', '2026-12-09'))),
        'LODGING_RESTRICTION_STAY_001',
      );
      expect(body.message).toBe('No se admiten llegadas el 8-dic');
      expect(nights).toHaveLength(0);
      expect(reservations).toHaveLength(0);
    });

    it('con rates:write y motivo se fuerza la reserva y el motivo queda en el historial', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 5, user_id: 9, permissions: ['store:lodging:rates:write'] } as any);
      const { service, events, nights } = build(2, 0, DECEMBER);
      await service.create({
        ...sale(dec('2026-12-07', '2026-12-08')),
        restriction_override_reason: 'Cliente frecuente',
      });
      expect(nights).toHaveLength(1);
      expect(events[0]).toMatchObject({
        to_status: 'confirmed',
        user_id: 9,
        reason:
          'Restricciones forzadas: Estancia mínima de 3 noches para llegar el 7-dic — Cliente frecuente',
      });
    });

    it('sin rates:write el motivo no basta para forzar', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 5, user_id: 9, permissions: ['store:lodging:reservations:write'] } as any);
      const { service, nights } = build(2, 0, DECEMBER);
      await expectCode(
        service.create({
          ...sale(dec('2026-12-08', '2026-12-09')),
          restriction_override_reason: 'Cliente frecuente',
        }),
        'LODGING_RESTRICTION_OVERRIDE_001',
      );
      expect(nights).toHaveLength(0);
    });

    it('una estadía sin restricciones no guarda motivo en el historial', async () => {
      const { service, events } = build(2, 0, DECEMBER);
      await service.create(sale(dec('2026-12-10', '2026-12-12')));
      expect(events[0]).toMatchObject({ to_status: 'confirmed' });
      expect(events[0]).not.toHaveProperty('reason');
    });
  });

  describe('política de cancelación y depósito (H2.4)', () => {
    // 7 to 10-dic with plan "Flexible"; check-in 15:00 Bogotá = 20:00 UTC.
    const flexible: CreateReservationDto = {
      arrival_date: '2026-12-07',
      departure_date: '2026-12-10',
      customer_id: 77,
      rooms: [{ unit_type_id: 11, adults: 2, rate_plan_id: 5 }],
    };
    const at = (iso: string) => jest.setSystemTime(new Date(iso));

    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());

    it('la habitación guarda la política y el depósito; se ve "Depósito pendiente: 30 %"', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, rooms } = build(2);
      const created = await service.create(flexible);
      expect(rooms[0]).toMatchObject({
        cancellation_policy_snapshot: FLEXIBLE,
        deposit_percent: new Prisma.Decimal(30),
      });
      expect(created.deposit).toEqual({ percent: '30', amount: '225000.00' });
      await expect(service.quote({ ...stay, ...flexible, unit_type_id: 11, adults: 2, rate_plan_id: 5 }))
        .resolves.toMatchObject({ cancellation_policy: FLEXIBLE, deposit_percent: '30' });
    });

    it('sin plan no hay política ni depósito', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, rooms } = build(2);
      const created = await service.create(sale(stay));
      expect(rooms[0]).toMatchObject({ deposit_percent: new Prisma.Decimal(0) });
      expect(created.deposit).toEqual({ percent: null, amount: '0.00' });
    });

    it('cancelar 24 h antes muestra "Penalidad: $250.000 (1 noche)" y la guarda', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, reservations } = build(2);
      await service.create(flexible);

      at('2026-12-06T20:00:00Z');
      await expect(service.cancellationQuote(1)).resolves.toEqual({
        penalty_amount: '250000.00',
        penalty_detail: '1 noche',
      });
      await service.cancel(1, 'Cambio de planes');
      expect(reservations[0]).toMatchObject({
        status: 'cancelled',
        cancellation_penalty_amount: new Prisma.Decimal(250000),
        cancellation_penalty_detail: '1 noche',
      });
    });

    it('H3.5 — la penalidad se cubre con el depósito y se anuncia tras el commit', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, deposits, prisma } = build(2);
      await service.create(flexible);
      const retained = { store_id: 5, deposit_id: 41, reservation_number: 'H-0001', amount: 225000 };
      deposits.retainInTx.mockResolvedValueOnce(retained);

      at('2026-12-06T20:00:00Z');
      await service.cancel(1, 'Cambio de planes');

      expect(deposits.retainInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reservation_id: 1, penalty: new Prisma.Decimal(250000), user_id: 9 }),
      );
      expect(deposits.announceRetained).toHaveBeenCalledWith(retained);
      expect(deposits.announceRetained.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.$transaction.mock.invocationCallOrder.at(-1)!,
      );
    });

    it('H3.5 — cancelar anula los links Wompi pendientes y los desactiva tras el commit', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, deposits, prisma } = build(2);
      await service.create(flexible);
      deposits.cancelPendingLinksInTx.mockResolvedValueOnce([77]);

      await service.cancel(1, 'Cambio de planes');

      expect(deposits.cancelPendingLinksInTx).toHaveBeenCalledWith(expect.anything(), 1);
      expect(deposits.deactivateLinks).toHaveBeenCalledWith([77]);
      expect(deposits.deactivateLinks.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.$transaction.mock.invocationCallOrder.at(-1)!,
      );
    });

    it('cancelar 72 h antes es gratis', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, reservations } = build(2);
      await service.create(flexible);

      at('2026-12-04T20:00:00Z');
      await expect(service.cancellationQuote(1)).resolves.toEqual({
        penalty_amount: null,
        penalty_detail: null,
      });
      await service.cancel(1, 'Cambio de planes');
      expect(reservations[0].status).toBe('cancelled');
      expect(reservations[0]).not.toHaveProperty('cancellation_penalty_amount');
    });

    it('editar la política después no cambia la reserva (snapshot)', async () => {
      at('2026-11-01T12:00:00Z');
      const { service } = build(2);
      await service.create(flexible);
      const plan = RATE_PLANS.find((p) => p.id === 5)!;
      const original = plan.cancellation_policy;
      plan.cancellation_policy = {
        ...FLEXIBLE,
        rules: [{ hours_before: 720, penalty_type: 'percent', penalty_value: 100 }],
      };
      try {
        at('2026-12-04T20:00:00Z');
        await expect(service.cancellationQuote(1)).resolves.toEqual({
          penalty_amount: null,
          penalty_detail: null,
        });
      } finally {
        plan.cancellation_policy = original;
      }
    });

    it('el no-show toma la penalidad de no-show de la política', async () => {
      at('2026-11-01T12:00:00Z');
      const { service, reservations } = build(2);
      await service.create(flexible);

      at('2026-12-07T23:00:00Z');
      await service.markNoShow(1);
      expect(reservations[0]).toMatchObject({
        status: 'no_show',
        cancellation_penalty_amount: new Prisma.Decimal(750000),
        cancellation_penalty_detail: '100 %',
      });
    });
  });

  it('numera por tienda H-0001, H-0002… y formatea fechas cortas', () => {
    expect(nextReservationNumber(null)).toBe('H-0001');
    expect(nextReservationNumber('H-0009')).toBe('H-0010');
    expect(nextReservationNumber('H-9999')).toBe('H-10000');
    expect(formatShortDate('2026-11-10')).toBe('10-nov');
  });

  describe('reserva web (H6.6)', () => {
    const expires_at = new Date('2026-11-01T15:15:00.000Z');
    const hold = { expires_at, reason: 'Reserva web: pendiente de pago en línea' };
    const activeNights = (nights: NightRow[]) => nights.filter((n) => n.is_active).length;

    it('el hold crea la reserva tentativa con sus noches, el vencimiento y sin usuario del staff', async () => {
      const { service, reservations, nights, events } = build(1);
      await service.create(sale(stay), hold);
      expect(reservations[0]).toMatchObject({
        status: 'tentative',
        hold_expires_at: expires_at,
        created_by_user_id: null,
      });
      expect(activeNights(nights)).toBe(3);
      expect(events).toEqual([
        {
          store_id: 5,
          reservation_id: 1,
          from_status: null,
          to_status: 'tentative',
          reason: 'Reserva web: pendiente de pago en línea',
          user_id: null,
        },
      ]);
      // The held room is not for sale while the hold lives.
      await expectCode(service.create(sale(stay)), 'LODGING_RESERVATION_AVAILABILITY_001');
    });

    it('liberar el hold vencido lo cancela, libera las noches y no calcula penalidad', async () => {
      const { service, reservations, nights, deposits, events } = build(1);
      await service.create(sale(stay), hold);
      expect(await service.releaseHold(1, 'Reserva web vencida sin pago')).toBe(true);
      expect(reservations[0]).toMatchObject({ status: 'cancelled', hold_expires_at: null });
      expect(activeNights(nights)).toBe(0);
      expect(deposits.retainInTx).not.toHaveBeenCalled();
      expect(events[1]).toMatchObject({
        from_status: 'tentative',
        to_status: 'cancelled',
        reason: 'Reserva web vencida sin pago',
        user_id: null,
      });
      // The room is for sale again.
      await service.create(sale(stay));
    });

    it('el pago confirma el hold una sola vez y una reserva confirmada no se libera como hold', async () => {
      const { service, reservations, nights } = build(1);
      await service.create(sale(stay), hold);
      expect(await service.confirmHold(1, 'Pago en línea recibido $225.000 (Wompi)')).toBe(true);
      expect(reservations[0]).toMatchObject({ status: 'confirmed', hold_expires_at: null });
      expect(await service.confirmHold(1, 'otra vez')).toBe(false);
      expect(await service.releaseHold(1, 'Reserva web vencida sin pago')).toBe(false);
      expect(reservations[0].status).toBe('confirmed');
      expect(activeNights(nights)).toBe(3);
    });
  });
});
