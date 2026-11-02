import { checkinMessage, defaultBookingSearch } from './booking-page.util';

describe('booking page util', () => {
  it('la primera búsqueda es una noche desde mañana, dos adultos', () => {
    expect(defaultBookingSearch(() => '2026-11-03')).toEqual({
      arrival_date: '2026-11-03',
      departure_date: '2026-11-04',
      adults: 2,
      children: 0,
    });
  });

  it('cruza el fin de mes y de año', () => {
    expect(defaultBookingSearch(() => '2026-12-31').departure_date).toBe('2027-01-01');
  });

  it('explica cada estado del check-in en línea y oculta la tarjeta sin estado', () => {
    expect(checkinMessage('available')).toContain('antes de llegar');
    expect(checkinMessage('completed')).toContain('completo');
    expect(checkinMessage('not_confirmed')).toContain('se confirme el pago');
    expect(checkinMessage('closed')).toContain('ya no está disponible');
    expect(checkinMessage(null)).toBeNull();
  });
});
