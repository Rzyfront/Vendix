import {
  BookingSchedulingSource,
  SchedulingBookingRow,
  bookingStatusesForGroups,
  buildBookingWhere,
  normalizeBooking,
} from './booking-scheduling.source';

const TZ = 'America/Bogota';

function row(overrides: Partial<SchedulingBookingRow> = {}): SchedulingBookingRow {
  return {
    id: 5,
    booking_number: 'RES-0005',
    date: new Date('2026-11-23T00:00:00.000Z'),
    end_date: null,
    start_time: '09:00',
    end_time: '10:30',
    status: 'confirmed',
    order_id: null,
    customer: { id: 9, first_name: 'María', last_name: 'Gómez' },
    product: { id: 2, name: 'Corte de cabello' },
    provider: { id: 3, display_name: null, user: { first_name: 'Ana', last_name: 'Ruiz' } },
    ...overrides,
  } as SchedulingBookingRow;
}

describe('BookingSchedulingSource (agenda-unificada F1)', () => {
  it('normaliza fecha + hora local de la tienda a UTC y conserva la hora local', () => {
    const event = normalizeBooking(row(), TZ);
    expect(event).toMatchObject({
      id: 'booking:5',
      type: 'booking',
      source_id: 5,
      reference: 'RES-0005',
      title: 'Corte de cabello',
      // Bogotá = UTC-5.
      start: '2026-11-23T14:00:00.000Z',
      end: '2026-11-23T15:30:00.000Z',
      date: '2026-11-23',
      local_start: '09:00',
      local_end: '10:30',
      status: 'confirmed',
      status_label: 'Confirmada',
      status_group: 'confirmed',
      staff: { id: 3, name: 'Ana Ruiz' },
      customer: { id: 9, name: 'María Gómez' },
    });
  });

  it('una reserva que cruza la medianoche termina al día siguiente', () => {
    const event = normalizeBooking(row({ start_time: '22:00', end_time: '01:00' }), TZ);
    expect(event.end_date).toBe('2026-11-24');
    expect(event.end).toBe('2026-11-24T06:00:00.000Z');
    const explicit = normalizeBooking(
      row({ end_date: new Date('2026-11-25T00:00:00.000Z'), end_time: '08:00' }),
      TZ,
    );
    expect(explicit.end_date).toBe('2026-11-25');
  });

  it('agrupa los estados nativos en los grupos comunes', () => {
    expect(bookingStatusesForGroups(['in_progress']).sort()).toEqual(
      ['arriving', 'attending', 'in_progress'].sort(),
    );
    expect(normalizeBooking(row({ status: 'arriving' } as any), TZ).status_group).toBe(
      'in_progress',
    );
  });

  it('arma el filtro: estado, personal, rango y búsqueda', () => {
    const where = buildBookingWhere({
      order: 'asc',
      status_groups: ['pending', 'no_show'],
      staff_ids: [3, 4],
      from: '2026-11-01',
      to: '2026-11-30',
      search: 'ana',
    });
    expect(where).toMatchObject({
      status: { in: ['pending', 'no_show'] },
      provider_id: { in: [3, 4] },
      AND: [
        {
          OR: [
            { date: { gte: new Date('2026-11-01'), lte: new Date('2026-11-30') } },
            { date: new Date('2026-10-31'), end_date: { gte: new Date('2026-11-01') } },
          ],
        },
      ],
    });
    expect(where?.OR).toHaveLength(5);
    expect(buildBookingWhere({ order: 'asc' })).toEqual({});
  });

  it('vista Día: trae la reserva 23:00–01:00 del día anterior que termina en el rango', () => {
    const where = buildBookingWhere({ order: 'asc', from: '2026-11-24', to: '2026-11-24' });
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { date: { gte: new Date('2026-11-24'), lte: new Date('2026-11-24') } },
            { date: new Date('2026-11-23'), end_date: { gte: new Date('2026-11-24') } },
          ],
        },
      ],
    });
    // Sin `from` no hay día anterior que mirar: filtro de fecha simple.
    expect(buildBookingWhere({ order: 'asc', to: '2026-11-24' })).toEqual({
      date: { lte: new Date('2026-11-24') },
    });
  });

  it('pagina en la base: cuenta y lee con el mismo filtro, ordenado y con tope', async () => {
    const prisma = {
      bookings: {
        findMany: jest.fn().mockResolvedValue([row()]),
        count: jest.fn().mockResolvedValue(31),
      },
    };
    const source = new BookingSchedulingSource(prisma as any);
    const page = await source.fetch(
      { store_id: 7, timezone: TZ },
      { order: 'desc', staff_ids: [3] },
      40,
    );
    expect(page).toMatchObject({ total: 31, truncated: false });
    expect(page.events).toHaveLength(1);
    const args = prisma.bookings.findMany.mock.calls[0][0];
    expect(args.take).toBe(40);
    expect(args.orderBy).toEqual([{ date: 'desc' }, { start_time: 'desc' }, { id: 'desc' }]);
    expect(args.where).toEqual({ provider_id: { in: [3] } });
    // El cliente de Prisma de tienda pone el store_id: el adaptador no lo arma a mano.
    expect(prisma.bookings.count).toHaveBeenCalledWith({ where: args.where });
    // Relaciones en la misma consulta (sin N+1).
    expect(Object.keys(args.select)).toEqual(
      expect.arrayContaining(['customer', 'product', 'provider']),
    );
  });
});
