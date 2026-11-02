import {
  bookingCustomerName,
  bookingProviderName,
  groupBookingsByStart,
} from './booking-stack.util';

// QUI-971: same-hour stacking helpers. Pure functions — no TestBed.
describe('booking-stack.util (QUI-971)', () => {
  const booking = (overrides: any = {}) => ({
    id: 1,
    start_time: '08:00',
    end_time: '08:30',
    ...overrides,
  });

  it('groups bookings sharing the same start time, sorted by start', () => {
    const groups = groupBookingsByStart([
      booking({ id: 3, start_time: '09:00' }),
      booking({ id: 1, start_time: '08:00' }),
      booking({ id: 2, start_time: '08:00' }),
    ]);
    expect(groups.map((g) => g.startKey)).toEqual(['08:00', '09:00']);
    expect(groups[0].bookings.map((b) => b.id)).toEqual([1, 2]);
    expect(groups[1].bookings.map((b) => b.id)).toEqual([3]);
  });

  it('normalizes HH:mm:ss starts to the same group', () => {
    const groups = groupBookingsByStart([
      booking({ id: 1, start_time: '08:00' }),
      booking({ id: 2, start_time: '08:00:00' }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].bookings.map((b) => b.id)).toEqual([1, 2]);
  });

  it('returns [] for null/undefined input', () => {
    expect(groupBookingsByStart(null)).toEqual([]);
    expect(groupBookingsByStart(undefined)).toEqual([]);
  });

  it('resolves customer name with Sin cliente fallback', () => {
    expect(
      bookingCustomerName(booking({ customer: { first_name: 'Ana', last_name: 'Ruiz' } })),
    ).toBe('Ana Ruiz');
    expect(bookingCustomerName(booking({ customer: undefined }))).toBe('Sin cliente');
    expect(bookingCustomerName(booking({ customer: {} }))).toBe('Sin cliente');
    expect(bookingCustomerName(null)).toBe('Sin cliente');
  });

  it('resolves provider name with empty fallback', () => {
    expect(
      bookingProviderName(booking({ provider: { display_name: 'Juan Perez' } })),
    ).toBe('Juan Perez');
    expect(
      bookingProviderName(booking({ provider: { employee: { first_name: 'Juan' } } })),
    ).toBe('Juan');
    expect(bookingProviderName(booking({ provider: undefined }))).toBe('');
    expect(bookingProviderName(null)).toBe('');
  });
});
