import {
  rfmScores,
  rfmSegment,
} from '../../../../../ai-engine/tools/domains/customers.tools';

/** Window the RFM scores are measured over, same default as the agent tool. */
export const CRM_RFM_PERIOD_DAYS = 365;
const DAY_MS = 86_400_000;

/** One row of `CustomersService.getSegmentPopulationForAgent`. */
export interface RfmGroupRow {
  customer_id: number | null;
  _count?: { _all?: number };
  _sum?: { grand_total?: unknown };
  _max?: { created_at?: Date | null };
}

export interface RfmEntry {
  customer_id: number;
  orders: number;
  spent: number;
  last_purchase_at: Date | null;
  recency_days: number;
  scores: { r: number; f: number; m: number };
  segment: string;
}

export function rfmPeriodStart(now: Date): Date {
  return new Date(now.getTime() - CRM_RFM_PERIOD_DAYS * DAY_MS);
}

/**
 * Scores every buyer of the window against the whole population, with the
 * scorer the agent tool uses, so the CRM profile and the `rfm` segment rule
 * always classify a customer the same way.
 */
export function scoreRfmPopulation(
  grouped: RfmGroupRow[],
  now: Date,
): Map<number, RfmEntry> {
  const population = grouped
    .filter((row) => row.customer_id != null)
    .map((row) => {
      const last = row._max?.created_at ?? null;
      const spent = Number(row._sum?.grand_total ?? 0);
      return {
        customer_id: row.customer_id as number,
        orders: row._count?._all ?? 0,
        spent: Number.isFinite(spent) ? spent : 0,
        last_purchase_at: last,
        recency_days: last
          ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY_MS))
          : CRM_RFM_PERIOD_DAYS,
      };
    });
  const sorted = {
    recency: population.map((row) => row.recency_days).sort((a, b) => a - b),
    frequency: population.map((row) => row.orders).sort((a, b) => a - b),
    monetary: population.map((row) => row.spent).sort((a, b) => a - b),
  };
  const entries = new Map<number, RfmEntry>();
  for (const row of population) {
    const scores = rfmScores(sorted, row.recency_days, row.orders, row.spent);
    entries.set(row.customer_id, {
      ...row,
      scores,
      segment: rfmSegment(scores.r, scores.f, scores.m),
    });
  }
  return entries;
}
