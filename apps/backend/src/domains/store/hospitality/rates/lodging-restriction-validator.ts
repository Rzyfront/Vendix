import { formatShortDate } from '../reservations/stay-dates';

/**
 * Hospitality Suite (H2.3) — pure stay restriction check, no I/O. Shared by
 * the desk reservation and, later, the web engine, Vexi and the channel ARI.
 *
 * A restriction belongs to one night (`date`) and to every room type
 * (`unit_type_id` null) or one type. Rules:
 * - minimum / maximum stay: read on the arrival night (MLOS by arrival);
 * - closed to arrival: on the arrival date; closed to departure: on the
 *   departure date;
 * - stop-sell: on any night of the stay (the departure night is not sold).
 * When both an all-types and a type row apply, the most restrictive wins.
 */
export interface StayRestriction {
  /** Night, `YYYY-MM-DD`. */
  date: string;
  unit_type_id: number | null;
  min_stay: number | null;
  max_stay: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
}

export interface StayToCheck {
  arrival_date: string;
  departure_date: string;
  /** Sold nights, arrival to the night before departure. */
  nights: readonly string[];
  unit_type: { id: number; name: string };
}

const nightsLabel = (count: number) => `${count} ${count === 1 ? 'noche' : 'noches'}`;

/** Messages of every restriction the stay breaks; empty when it can be sold. */
export function restrictionViolations(
  stay: StayToCheck,
  restrictions: readonly StayRestriction[],
): string[] {
  const applies = restrictions.filter(
    (r) => r.unit_type_id == null || r.unit_type_id === stay.unit_type.id,
  );
  const on = (date: string) => applies.filter((r) => r.date === date);
  const arrival = on(stay.arrival_date);
  const violations: string[] = [];

  const minStays = arrival.map((r) => r.min_stay).filter((v): v is number => v != null);
  const minStay = minStays.length ? Math.max(...minStays) : null;
  if (minStay != null && stay.nights.length < minStay) {
    violations.push(
      `Estancia mínima de ${nightsLabel(minStay)} para llegar el ${formatShortDate(stay.arrival_date)}`,
    );
  }
  const maxStays = arrival.map((r) => r.max_stay).filter((v): v is number => v != null);
  const maxStay = maxStays.length ? Math.min(...maxStays) : null;
  if (maxStay != null && stay.nights.length > maxStay) {
    violations.push(
      `Estancia máxima de ${nightsLabel(maxStay)} para llegar el ${formatShortDate(stay.arrival_date)}`,
    );
  }
  if (arrival.some((r) => r.closed_to_arrival)) {
    violations.push(`No se admiten llegadas el ${formatShortDate(stay.arrival_date)}`);
  }
  if (on(stay.departure_date).some((r) => r.closed_to_departure)) {
    violations.push(`No se admiten salidas el ${formatShortDate(stay.departure_date)}`);
  }
  const stopped = stay.nights.filter((night) => on(night).some((r) => r.stop_sell));
  if (stopped.length) {
    violations.push(
      `Venta cerrada de ${stay.unit_type.name} el ${stopped.map(formatShortDate).join(', ')}`,
    );
  }
  return violations;
}
