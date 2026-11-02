import { dateFromToday } from '../../private/modules/ecommerce/pages/hotel-booking/hotel-date.util';

/** Query params the PMS search page reads (`HotelSearchComponent`). */
export interface BookingSearchParams {
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
}

/**
 * First search of the booking home: tonight's stay starting tomorrow, two
 * adults. The guest lands on rooms, rates and policies instead of an empty
 * form, and changes the dates from there.
 */
export function defaultBookingSearch(today: () => string = () => dateFromToday(1)): BookingSearchParams {
  const arrival = today();
  const [y, m, d] = arrival.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  const departure = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
    next.getDate(),
  ).padStart(2, '0')}`;
  return { arrival_date: arrival, departure_date: departure, adults: 2, children: 0 };
}

/** Message under the reservation for each check-in state; `null` hides the card. */
export function checkinMessage(state: string | null | undefined): string | null {
  switch (state) {
    case 'available':
      return 'Ahorra tiempo en recepción: registra a los huéspedes y sus documentos antes de llegar.';
    case 'completed':
      return 'Tu check-in en línea está completo. En recepción solo te entregamos la llave.';
    case 'not_confirmed':
      return 'El check-in en línea se habilita cuando se confirme el pago de tu reserva.';
    case 'closed':
      return 'El check-in en línea ya no está disponible para esta reserva.';
    default:
      return null;
  }
}
