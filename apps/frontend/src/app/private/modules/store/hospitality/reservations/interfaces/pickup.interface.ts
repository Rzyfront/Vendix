/** H7.3 — one stay date (or the whole horizon) of the pickup and forecast report. */
export interface LodgingPickupRow {
  /** Active rooms (summed over the horizon in totals). */
  rooms: number;
  /** Nights sold for the date (firm reservations). */
  on_books: number;
  /** Of those, booked in the last 7 days. */
  pickup_7: number;
  /** Of those, booked in the last 30 days. */
  pickup_30: number;
  /** on_books / rooms in %; null without rooms. */
  projected_occupancy_pct: number | null;
}

export interface LodgingPickupDayRow extends LodgingPickupRow {
  stay_date: string;
}

export interface LodgingPickupReport {
  from: string;
  to: string;
  totals: LodgingPickupRow;
  days: LodgingPickupDayRow[];
}
