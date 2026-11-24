import { isPlanBooking, planReceiptHtml } from './plan-receipt.util';
import type { PlanBookingItinerary } from '../../products/services/service-plans.service';

describe('plan-receipt.util (QUI-1060 F2)', () => {
  const plan: PlanBookingItinerary = {
    booking_id: 1,
    product_id: 10,
    departure_id: 2,
    start_date: '2099-03-10',
    end_date: '2099-03-12',
    duration_days: 3,
    duration_nights: 2,
    pax_adults: 2,
    pax_children: 1,
    total_pax: 3,
    itinerary: [
      { day_number: 1, date: '2099-03-10', activities: [{ start_time: '07:00', title: 'Salida <b>', description: null }] },
      { day_number: 3, date: '2099-03-12', activities: [{ start_time: null, title: 'Regreso', description: 'Al hotel' }] },
    ],
  };

  it('solo las reservas con evento o grupo son de plan', () => {
    expect(isPlanBooking({ departure_id: 2 })).toBe(true);
    expect(isPlanBooking({ pax_adults: 2 })).toBe(true);
    expect(isPlanBooking({ departure_id: null, pax_adults: null })).toBe(false);
    expect(isPlanBooking({})).toBe(false);
  });

  it('muestra evento, regreso, duración, personas e itinerario con fechas reales', () => {
    const html = planReceiptHtml(plan);
    expect(html).toContain('Evento:');
    expect(html).toContain('Regreso:');
    expect(html).toContain('3 días / 2 noches');
    expect(html).toContain('2 adultos y 1 niño');
    expect(html).toContain('Día 1 · ');
    expect(html).toContain('Día 3 · ');
    expect(html).toContain('2099');
    expect(html).toContain('Salida &lt;b&gt;');
    expect(html).not.toContain('Salida <b>');
    expect(html).toContain('Al hotel');
  });

  it('a fecha libre dice «Fecha de inicio» y sin actividades no pinta itinerario', () => {
    const html = planReceiptHtml({ ...plan, departure_id: null, itinerary: [] });
    expect(html).toContain('Fecha de inicio:');
    expect(html).not.toContain('Itinerario');
  });
});
