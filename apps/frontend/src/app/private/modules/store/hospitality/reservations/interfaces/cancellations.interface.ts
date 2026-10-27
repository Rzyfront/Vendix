/** H7.4 — sales channel of a reservation (derived from how it was created). */
export type LodgingChannel = 'front_desk' | 'web';
export type LodgingLossType = 'cancelled' | 'no_show';

/** One cancellation or no-show of the period. */
export interface LodgingLossRow {
  reservation_id: number;
  reservation_number: string;
  type: LodgingLossType;
  channel: LodgingChannel;
  guest_name: string;
  occurred_at: string;
  /** Store-civil day of the event (`YYYY-MM-DD`). */
  occurred_on: string;
  arrival_date: string;
  departure_date: string;
  nights: number;
  total_amount: number;
  penalty_amount: number;
  penalty_detail: string | null;
  reason: string | null;
}

export interface LodgingLossesReport {
  from: string;
  to: string;
  timezone: string;
  totals: {
    cancellations: number;
    no_shows: number;
    lost_amount: number;
    penalty_amount: number;
  };
  rows: LodgingLossRow[];
}

export interface LodgingLossesQuery {
  from: string;
  to: string;
  channel?: LodgingChannel;
  type?: LodgingLossType;
}
