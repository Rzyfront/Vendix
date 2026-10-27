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
import { CancelReservationDto, CreateReservationDto } from './dto';
import { canTransition, noShowArrivalCutoff } from './reservation-status';

interface NightRow {
  reservation_room_id: number;
  unit_type_id: number;
  night_date: Date;
  is_active: boolean;
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

/** Lets every other pending async step run, so unlocked work interleaves. */
const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * In-memory store: one room type with `units` active rooms. The advisory lock
 * is a FIFO mutex held until the transaction callback settles, like
 * `pg_advisory_xact_lock`. Reads and writes yield, so without the lock two
 * parallel sales would both see the last room free.
 */
function createFakeStore(units: number) {
  const nights: NightRow[] = [];
  const reservations: {
    id: number;
    reservation_number: string;
    status: string;
    store_id: number;
    arrival_date: Date;
  }[] = [];
  const rooms: { id: number; reservation_id: number }[] = [];
  const events: Record<string, unknown>[] = [];
  let lock: Promise<void> = Promise.resolve();

  const tables = {
    lodging_units: { count: jest.fn(async () => units) },
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
        return [...counts.values()].map((c) => ({ _count: { _all: c } }));
      }),
      createMany: jest.fn(async ({ data }: any) => {
        await yieldTurn();
        nights.push(...data.map((d: any) => ({ ...d, is_active: true })));
        return { count: data.length };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const roomIds = rooms
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
          return r ? { ...r, rooms: [], events: [] } : null;
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
        hit.forEach((r) => (r.status = data.status));
        return { count: hit.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: reservations.length + 1, ...data };
        reservations.push(row);
        return row;
      }),
    },
    lodging_reservation_rooms: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 100 + reservations.length, ...data };
        rooms.push(row);
        return row;
      }),
    },
    lodging_reservation_events: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    ...tables,
    lodging_unit_types: { findFirst: jest.fn(async () => DOUBLE) },
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
  return { prisma, nights, reservations, events };
}

const stay = {
  unit_type_id: 11,
  arrival_date: '2026-11-10',
  departure_date: '2026-11-13',
  adults: 2,
  customer_id: 77,
};

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

  const build = (units: number) => {
    const fake = createFakeStore(units);
    const service = new LodgingReservationsService(
      fake.prisma as any,
      new LodgingAvailabilityService(fake.prisma as any),
    );
    return { ...fake, service };
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

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
          service.create({ ...stay, departure_date }),
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
        (await validate(plainToInstance(CreateReservationDto, { ...stay, ...patch }))).map(
          (e) => e.property,
        );
      expect(await errorsOf({})).toEqual([]);
      expect(await errorsOf({ arrival_date: '2026-02-30' })).toEqual(['arrival_date']);
      expect(await errorsOf({ departure_date: '13/11/2026' })).toEqual(['departure_date']);
      expect(await errorsOf({ adults: 0 })).toEqual(['adults']);
    });
  });

  describe('disponibilidad', () => {
    it('cotiza "2 disponibles · 3 noches · $750.000" con el precio base', async () => {
      const { service } = build(2);
      await expect(service.quote(stay)).resolves.toEqual({
        unit_type: { id: 11, name: 'Doble estándar' },
        available: 2,
        nights: 3,
        nightly_rate: '250000.00',
        total_amount: '750000.00',
      });
    });

    it('una reserva que sale el día que otra llega no le quita cupo', async () => {
      const { service } = build(1);
      await service.create({ ...stay, arrival_date: '2026-11-07', departure_date: '2026-11-10' });
      await expect(service.quote(stay)).resolves.toMatchObject({ available: 1 });
      await expect(
        service.quote({ ...stay, arrival_date: '2026-11-09', departure_date: '2026-11-11' }),
      ).resolves.toMatchObject({ available: 0 });
    });
  });

  describe('crear', () => {
    it('crea H-0001 confirmada con 3 noches a $250.000 y total $750.000', async () => {
      const { service, prisma, nights } = build(2);

      await service.create(stay);

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
      await service.create(stay);
      await service.create(stay);

      const body = await expectCode(service.create(stay), 'LODGING_RESERVATION_AVAILABILITY_001');

      expect(body.message).toBe('Sin disponibilidad de Doble estándar para el 10-nov al 13-nov');
      expect(reservations.map((r) => r.reservation_number)).toEqual(['H-0001', 'H-0002']);
    });

    it('dos ventas en paralelo por la última habitación: una se crea y la otra falla', async () => {
      const { service, reservations, nights } = build(1);

      const results = await Promise.allSettled([service.create(stay), service.create(stay)]);

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
          service.create({ ...stay, ...occupancy }),
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

      await expectCode(service.create(stay), 'LODGING_RESERVATION_CUSTOMER_001');

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: 77, store_users: { some: { store_id: 5 } } },
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un tipo inactivo no se vende', async () => {
      const { service, prisma } = build(2);
      prisma.lodging_unit_types.findFirst.mockResolvedValueOnce({ ...DOUBLE, is_active: false });

      await expectCode(service.create(stay), 'LODGING_RESERVATION_TYPE_001');
    });
  });

  /**
   * H1.2 — cancel and no-show free the nights (is_active=false, never
   * deleted) and leave a history line; invalid changes are rejected.
   */
  describe('cancelación y no-show', () => {
    const activeNightsOf = (nights: NightRow[], roomId: number) =>
      nights.filter((n) => n.reservation_room_id === roomId && n.is_active).length;

    it('crear deja en el historial la línea "Confirmada" con quien la creó', async () => {
      const { service, events } = build(1);
      await service.create(stay);
      expect(events).toEqual([
        { store_id: 5, reservation_id: 1, from_status: null, to_status: 'confirmed', user_id: 9 },
      ]);
    });

    it('tras cancelar con motivo queda "Cancelada", las noches se liberan y la reserva nueva se crea', async () => {
      const { service, nights, reservations, events } = build(1);
      await service.create(stay);
      await expectCode(service.create(stay), 'LODGING_RESERVATION_AVAILABILITY_001');

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

      await service.create(stay);
      expect(reservations[1]).toMatchObject({ reservation_number: 'H-0002', status: 'confirmed' });
    });

    it('cancelar una reserva ya cancelada o no-show es una transición inválida', async () => {
      const { service, reservations, events } = build(2);
      await service.create(stay);
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
        await service.create(stay);

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
      await service.create(stay); // arrives 10-nov
      await service.create({ ...stay, arrival_date: '2026-11-11', departure_date: '2026-11-12' });
      await service.create(stay);
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
      await service.create(stay);

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

  it('numera por tienda H-0001, H-0002… y formatea fechas cortas', () => {
    expect(nextReservationNumber(null)).toBe('H-0001');
    expect(nextReservationNumber('H-0009')).toBe('H-0010');
    expect(nextReservationNumber('H-9999')).toBe('H-10000');
    expect(formatShortDate('2026-11-10')).toBe('10-nov');
  });
});
