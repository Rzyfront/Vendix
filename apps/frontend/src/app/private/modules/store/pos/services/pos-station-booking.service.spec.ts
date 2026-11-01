import { findUnscheduledStationLine } from './pos-station-booking.service';

// QUI-970: pre-pay guard for station services. Pure function — no TestBed.
describe('findUnscheduledStationLine (QUI-970)', () => {
  const stationProduct: any = { id: 968, name: 'Cambio de aceite', requires_station: true };
  const plainProduct: any = { id: 10, name: 'Shampoo', requires_station: false };

  it('returns null when the cart has no station lines', () => {
    expect(
      findUnscheduledStationLine({ items: [{ product: plainProduct }] } as any),
    ).toBeNull();
  });

  it('asks to schedule when a station line has no booking block', () => {
    const msg = findUnscheduledStationLine({
      items: [{ product: stationProduct, quantity: 1 }],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('Agenda "Cambio de aceite"');
    expect(msg).toContain('estación');
  });

  it('asks to pick a station when the block has none', () => {
    const msg = findUnscheduledStationLine({
      items: [
        {
          product: stationProduct,
          quantity: 1,
          booking: { date: '2026-11-02', start_time: '09:00', end_time: '09:30' },
        },
      ],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('sin estación');
  });

  it('asks to re-confirm when the block has no persisted booking', () => {
    const msg = findUnscheduledStationLine({
      items: [
        {
          product: stationProduct,
          quantity: 1,
          booking: {
            date: '2026-11-02',
            start_time: '09:00',
            end_time: '09:30',
            station_id: 1,
            booking_id: 0,
          },
        },
      ],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('aún no tiene reserva creada');
  });

  it('accepts a station line with a persisted booking block', () => {
    expect(
      findUnscheduledStationLine({
        items: [
          {
            product: stationProduct,
            quantity: 1,
            booking: {
              date: '2026-11-02',
              start_time: '09:00',
              end_time: '09:30',
              station_id: 1,
              booking_id: 38,
            },
          },
        ],
        pendingBookings: [],
      } as any),
    ).toBeNull();
  });

  it('accepts a station line covered by pendingBookings (adopted flow)', () => {
    expect(
      findUnscheduledStationLine({
        items: [{ product: stationProduct, quantity: 1 }],
        pendingBookings: [{ id: 38, product_id: 968 } as any],
      } as any),
    ).toBeNull();
  });

  it('rejects quantity > 1 on station lines (one booking per unit)', () => {
    const msg = findUnscheduledStationLine({
      items: [{ product: stationProduct, quantity: 2 }],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('cantidad 1');
  });
});
