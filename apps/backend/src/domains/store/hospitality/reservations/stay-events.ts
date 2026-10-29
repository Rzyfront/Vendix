/** Hospitality Suite (H4.1) — emitted once per reservation after the commit. */
export const LODGING_CHECKED_IN_EVENT = 'lodging.reservation.checked_in';
export const LODGING_CHECKED_OUT_EVENT = 'lodging.reservation.checked_out';

export interface LodgingStayEvent {
  store_id: number;
  reservation_id: number;
}
