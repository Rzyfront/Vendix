import type { Logger } from '@nestjs/common';

/**
 * QUI-1002 — live-sync event. Emitted AFTER the DB commit whenever a
 * production order is created, started, completed (also partially), cancelled,
 * released or edited. `ProductionSseService` forwards it to the store stream;
 * it is deliberately separate from notifications so it never creates one.
 */
export const PRODUCTION_ORDER_UPDATED_EVENT = 'production_order.updated';

export interface ProductionOrderUpdatedPayload {
  type: typeof PRODUCTION_ORDER_UPDATED_EVENT;
  store_id: number;
  id: number;
  order_id: number | null;
  status: string;
  started_at: string | null;
  produced_at: string | null;
  /** Raw per-order override (the effective value is computed on read). */
  estimated_minutes: number | null;
}

export interface ProductionOrderEventRow {
  id: number;
  store_id?: number | null;
  order_id?: number | null;
  status: string;
  started_at?: Date | string | null;
  produced_at?: Date | string | null;
  estimated_minutes?: number | null;
}

type SyncEmitter = { emit: (event: string, payload: unknown) => unknown };

const toIso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/** Never throws: a failed emission must not break the operation that committed. */
export function emitProductionOrderUpdated(
  emitter: SyncEmitter | undefined,
  logger: Pick<Logger, 'warn'>,
  row: ProductionOrderEventRow,
): void {
  if (!emitter || row.store_id == null) return;
  try {
    const payload: ProductionOrderUpdatedPayload = {
      type: PRODUCTION_ORDER_UPDATED_EVENT,
      store_id: row.store_id,
      id: row.id,
      order_id: row.order_id ?? null,
      status: row.status,
      started_at: toIso(row.started_at),
      produced_at: toIso(row.produced_at),
      estimated_minutes: row.estimated_minutes ?? null,
    };
    emitter.emit(PRODUCTION_ORDER_UPDATED_EVENT, payload);
  } catch (error) {
    logger.warn(
      `production_order.updated emission failed for order #${row.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
