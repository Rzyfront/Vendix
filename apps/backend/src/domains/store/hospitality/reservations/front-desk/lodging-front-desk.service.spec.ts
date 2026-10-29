import { RequestContextService } from '@common/context/request-context.service';
import { buildFrontDesk, LodgingFrontDeskService } from './lodging-front-desk.service';

interface Row {
  id: number;
  status: string;
  arrival: string;
  departure: string;
  unit?: string | null;
  folio?: { grand_total: string; total_paid: string } | null;
  keys_out?: number;
  registered?: number;
}

function reservation(row: Row) {
  return {
    id: row.id,
    reservation_number: `H-${String(row.id).padStart(4, '0')}`,
    status: row.status,
    arrival_date: new Date(`${row.arrival}T00:00:00.000Z`),
    departure_date: new Date(`${row.departure}T00:00:00.000Z`),
    customer: { first_name: 'Juan', last_name: 'Pérez' },
    rooms: [
      {
        adults: 2,
        children: 1,
        unit_type: { name: 'Doble' },
        unit: row.unit === null ? null : { code: row.unit ?? '101' },
      },
    ],
    folio: row.folio
      ? { id: 70 + row.id, status: 'open', order: { id: 500 + row.id, ...row.folio } }
      : null,
    _count: { key_handovers: row.keys_out ?? 0, guests: row.registered ?? 0 },
  } as any;
}

function build(rows: Row[], timezone = 'America/Bogota') {
  const prisma = {
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone } })),
    },
    lodging_reservations: { findMany: jest.fn(async () => rows.map(reservation)) },
  };
  return { service: new LodgingFrontDeskService(prisma as any), prisma };
}

describe('LodgingFrontDeskService (H3.3)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3 } as any);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses the store business day, not the UTC date', async () => {
    // 10-nov 03:00 UTC is still 9-nov 22:00 in Bogotá.
    jest.setSystemTime(new Date('2026-11-10T03:00:00Z'));
    const { service, prisma } = build([
      { id: 1, status: 'confirmed', arrival: '2026-11-09', departure: '2026-11-11' },
      { id: 2, status: 'confirmed', arrival: '2026-11-10', departure: '2026-11-12' },
    ]);

    const board = await service.board();

    expect(board.business_date).toBe('2026-11-09');
    expect(prisma.lodging_reservations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { status: 'confirmed', arrival_date: { lte: new Date('2026-11-09T00:00:00.000Z') } },
            { status: 'checked_in' },
          ],
        },
      }),
    );
    // Tomorrow's arrival (store time) is not on today's board.
    expect(board.arrivals.map((r) => r.reservation_number)).toEqual(['H-0001']);
  });

  it('rolls over to the next business day at store midnight', async () => {
    // 10-nov 05:30 UTC = 10-nov 00:30 in Bogotá.
    jest.setSystemTime(new Date('2026-11-10T05:30:00Z'));
    const { service } = build([
      { id: 2, status: 'confirmed', arrival: '2026-11-10', departure: '2026-11-12' },
    ]);

    const board = await service.board();

    expect(board.business_date).toBe('2026-11-10');
    expect(board.arrivals.map((r) => r.id)).toEqual([2]);
  });

  it('rejects without a store context', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({} as any);
    const { service } = build([]);
    await expect(service.board()).rejects.toMatchObject({ errorCode: 'STORE_CONTEXT_001' });
  });
});

describe('buildFrontDesk (H3.3)', () => {
  const today = '2026-11-10';

  it('splits arrivals, departures and in house with their counts', () => {
    const board = buildFrontDesk(
      [
        { id: 1, status: 'confirmed', arrival: '2026-11-10', departure: '2026-11-12', unit: null },
        { id: 2, status: 'confirmed', arrival: '2026-11-09', departure: '2026-11-11' },
        {
          id: 3,
          status: 'checked_in',
          arrival: '2026-11-08',
          departure: '2026-11-10',
          folio: { grand_total: '250000.00', total_paid: '100000.00' },
        },
        {
          id: 4,
          status: 'checked_in',
          arrival: '2026-11-09',
          departure: '2026-11-12',
          folio: { grand_total: '0.00', total_paid: '0.00' },
        },
      ].map(reservation),
      today,
    );

    // A late arrival from yesterday still waits for its check-in.
    expect(board.arrivals.map((r) => r.id)).toEqual([1, 2]);
    expect(board.departures.map((r) => r.id)).toEqual([3]);
    // Guests leaving today are still in house until they check out.
    expect(board.in_house.map((r) => r.id)).toEqual([3, 4]);
  });

  it('shows the pending folio balance of a departure', () => {
    const board = buildFrontDesk(
      [
        reservation({
          id: 3,
          status: 'checked_in',
          arrival: '2026-11-08',
          departure: '2026-11-10',
          folio: { grand_total: '250000.00', total_paid: '100000.00' },
        }),
      ],
      today,
    );

    expect(board.departures[0]).toMatchObject({
      reservation_number: 'H-0003',
      guest_name: 'Juan Pérez',
      rooms: '101 · Doble',
      adults: 2,
      children: 1,
      folio_id: 73,
      balance: '150000.00',
      unassigned_rooms: 0,
    });
  });

  it('H8.4 — counts the keys the guests still have', () => {
    const board = buildFrontDesk(
      [
        reservation({ id: 4, status: 'checked_in', arrival: '2026-11-08', departure: '2026-11-10', keys_out: 2 }),
        reservation({ id: 5, status: 'confirmed', arrival: '2026-11-10', departure: '2026-11-12' }),
      ],
      today,
    );

    expect(board.in_house[0].keys_out).toBe(2);
    expect(board.arrivals[0].keys_out).toBe(0);
  });

  it('H8.1 — tells the desk how many arriving guests are already registered', () => {
    const board = buildFrontDesk(
      [reservation({ id: 5, status: 'confirmed', arrival: '2026-11-10', departure: '2026-11-12', registered: 1 })],
      today,
    );

    expect(board.arrivals[0]).toMatchObject({ registered_guests: 1, adults: 2, children: 1 });
  });

  it('marks unassigned rooms and arrivals without a folio', () => {
    const board = buildFrontDesk(
      [reservation({ id: 1, status: 'confirmed', arrival: today, departure: '2026-11-12', unit: null })],
      today,
    );

    expect(board.arrivals[0]).toMatchObject({
      rooms: 'Sin asignar · Doble',
      unassigned_rooms: 1,
      folio_id: null,
      balance: null,
    });
  });
});
