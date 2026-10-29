import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { LodgingCheckInService } from './check-in.service';
import { CheckInDto } from './check-in.dto';

interface Options {
  status?: string;
  arrival?: string;
  holders?: number;
  unit_id?: number | null;
  housekeeping?: string;
  folio?: boolean;
  /** Rows the conditional status update moves (0 = another click won). */
  moved?: number;
}

/** H3.2 — reservation H-0001 of one Doble room, arriving `arrival`, store in Bogotá. */
function build(options: Options = {}) {
  const tx = {
    lodging_reservations: { updateMany: jest.fn(async () => ({ count: options.moved ?? 1 })) },
    orders: { create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })) },
    lodging_folios: { create: jest.fn(async ({ data }: any) => ({ id: 70, ...data })) },
    lodging_reservation_events: { create: jest.fn(async () => ({ id: 1 })) },
  };
  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async () => ({
        id: 1,
        status: options.status ?? 'confirmed',
        arrival_date: new Date(`${options.arrival ?? '2026-11-10'}T00:00:00.000Z`),
        customer_id: 9,
        reservation_number: 'H-0001',
        folio: options.folio ? { id: 70 } : null,
        rooms: [
          {
            id: 11,
            unit_type: { name: 'Doble' },
            unit: options.unit_id === undefined ? { id: 101 } : options.unit_id ? { id: options.unit_id } : null,
          },
        ],
      })),
    },
    lodging_guests: { count: jest.fn(async () => options.holders ?? 1) },
    lodging_units: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in.map((id: number) => ({
          id,
          code: String(id),
          is_active: true,
          housekeeping_status: options.housekeeping ?? 'clean',
        })),
      ),
    },
    store_settings: {
      findFirst: jest.fn(async () => ({
        settings: { general: { currency: 'COP' } },
        stores: { timezone: 'America/Bogota' },
      })),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const reservations = {
    findOne: jest.fn(async () => ({ id: 1, status: 'checked_in' })),
  };
  const roomChanges = { apply: jest.fn(async () => 1) };
  const eventEmitter = { emit: jest.fn() };
  const service = new LodgingCheckInService(prisma as any, reservations as any, roomChanges as any, eventEmitter as any);
  return { service, prisma, tx, reservations, roomChanges, eventEmitter };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the check-in to fail');
}

describe('LodgingCheckInService (H3.2)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3, user_id: 42 } as any);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    // 10-nov 10:00 in Bogotá: arrival day of H-0001.
    jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('checks in, assigns the picked room and opens the folio as a $0 draft POS order of the holder', async () => {
    const { service, tx, roomChanges, eventEmitter } = build({ unit_id: null });
    const dto: CheckInDto = { rooms: [{ room_id: 11, unit_id: 101 }] };

    const result = await service.checkIn(1, dto);

    expect(roomChanges.apply).toHaveBeenCalledWith(11, { unit_id: 101 });
    expect(tx.lodging_reservations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, status: 'confirmed' },
        data: expect.objectContaining({ status: 'checked_in' }),
      }),
    );
    expect(tx.orders.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 3,
        customer_id: 9,
        created_by_user_id: 42,
        order_number: 'F-H-0001',
        state: 'draft',
        channel: 'pos',
        currency: 'COP',
        grand_total: 0,
        remaining_balance: 0,
      }),
    });
    expect(tx.lodging_folios.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ store_id: 3, reservation_id: 1, order_id: 500 }),
    });
    expect(tx.lodging_reservation_events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ from_status: 'confirmed', to_status: 'checked_in', user_id: 42 }),
    });
    // H4.1 — the TRA report of the arrival starts after commit, once.
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith('lodging.reservation.checked_in', {
      store_id: 3,
      reservation_id: 1,
    });
    expect(result.status).toBe('checked_in');
  });

  it('a second click after the first one does not open another folio', async () => {
    const { service, prisma, tx } = build({ status: 'checked_in', folio: true });

    const result = await service.checkIn(1, {});

    expect(result.status).toBe('checked_in');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.orders.create).not.toHaveBeenCalled();
  });

  it('two simultaneous clicks: the one whose status update moves no row creates no order', async () => {
    const { service, tx, eventEmitter } = build({ moved: 0 });

    const result = await service.checkIn(1, {});

    expect(result.status).toBe('checked_in');
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(tx.orders.create).not.toHaveBeenCalled();
    expect(tx.lodging_folios.create).not.toHaveBeenCalled();
  });

  it('rejects the check-in without a registered holder: "Registra al menos al titular"', async () => {
    const { service, tx } = build({ holders: 0 });

    const error = await errorOf(service.checkIn(1, {}));

    expect(error.errorCode).toBe(ErrorCodes.LODGING_CHECKIN_GUESTS_001.code);
    expect(error.message).toBe('Registra al menos al titular');
    expect(tx.orders.create).not.toHaveBeenCalled();
  });

  it('asks to confirm a dirty room and checks in once confirmed', async () => {
    const { service, tx } = build({ housekeeping: 'dirty' });

    const error = await errorOf(service.checkIn(1, {}));
    expect(error.errorCode).toBe(ErrorCodes.LODGING_CHECKIN_DIRTY_001.code);
    expect(error.message).toBe('La 101 está sucia. ¿Hacer check-in de todos modos?');
    expect(tx.orders.create).not.toHaveBeenCalled();

    await service.checkIn(1, { confirm_dirty: true });
    expect(tx.orders.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an early check-in before the arrival date', async () => {
    const { service, tx } = build({ arrival: '2026-11-11' });

    const error = await errorOf(service.checkIn(1, {}));

    expect(error.errorCode).toBe(ErrorCodes.LODGING_CHECKIN_EARLY_001.code);
    expect(error.message).toBe('La llegada es el 11-nov: no se puede hacer check-in antes');
    expect(tx.orders.create).not.toHaveBeenCalled();
  });

  it('uses the store day, not UTC: an 11-nov arrival is still early at 10-nov 21:00 in Bogotá', async () => {
    jest.setSystemTime(new Date('2026-11-11T02:00:00Z'));
    const { service, tx } = build({ arrival: '2026-11-11' });

    const error = await errorOf(service.checkIn(1, {}));

    expect(error.errorCode).toBe(ErrorCodes.LODGING_CHECKIN_EARLY_001.code);
    expect(tx.orders.create).not.toHaveBeenCalled();
  });

  it('asks for a room when the reservation room is unassigned', async () => {
    const { service } = build({ unit_id: null });

    const error = await errorOf(service.checkIn(1, {}));

    expect(error.errorCode).toBe(ErrorCodes.LODGING_CHECKIN_UNIT_001.code);
    expect(error.message).toBe('Asigna una habitación (Doble) antes del check-in');
  });

  it('only a confirmed reservation checks in', async () => {
    const { service } = build({ status: 'tentative' });

    const error = await errorOf(service.checkIn(1, {}));

    expect(error.errorCode).toBe(ErrorCodes.LODGING_RESERVATION_TRANSITION_001.code);
  });
});
