/** H7.2 — one business day or month of the occupancy, ADR and RevPAR report. */
export interface LodgingPerformanceRow {
  /** `YYYY-MM-DD` for a day, `YYYY-MM` for a month. */
  period: string;
  nights_available: number;
  nights_sold: number;
  room_revenue: number;
  /** null when there are no nights available (no base). */
  occupancy_pct: number | null;
  /** null when there are no nights sold. */
  adr: number | null;
  revpar: number | null;
}

export interface LodgingPerformanceDayRow extends LodgingPerformanceRow {
  /** true: frozen by the night audit; false: live figures. */
  closed: boolean;
}

export interface LodgingPerformanceReport {
  from: string;
  to: string;
  totals: LodgingPerformanceRow;
  days: LodgingPerformanceDayRow[];
  months: LodgingPerformanceRow[];
}
