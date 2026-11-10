import type { Logger } from '@nestjs/common';

/**
 * QUI-995 — post-commit trigger shared by every write point that creates or
 * adds restaurant sale lines (POS, ecommerce, tables, item changes, order
 * create/edit). The writer emits this event AFTER its transaction commits; the
 * listener in `ProductionSaleLinkService` makes sure each `production` line has
 * its production order. The emit is awaited (so the order exists when the
 * response is built) but a failure never breaks the sale: `ensureForOrder` is
 * idempotent and the next write point heals it.
 */
export const PRODUCTION_SALE_SYNC_EVENT = 'production.sale_sync';

/** Emitted by cancelOrder, before it releases the sale's reservations. */
export const PRODUCTION_SALE_CANCELLED_EVENT = 'production.sale_cancelled';

export interface ProductionSaleCancelledPayload {
  order_id: number;
  store_id: number;
  disposition?: 'release' | 'waste';
  reason?: string;
}

export interface ProductionSaleSyncPayload {
  order_id: number;
  store_id?: number | null;
}

type AsyncEmitter = {
  emitAsync?: (event: string, payload: unknown) => Promise<unknown[]>;
};

export async function requestProductionSaleSync(
  emitter: AsyncEmitter | undefined,
  logger: Pick<Logger, 'warn'>,
  payload: { order_id: number } & object,
  event: string = PRODUCTION_SALE_SYNC_EVENT,
): Promise<void> {
  if (!payload.order_id) return;
  try {
    await emitter?.emitAsync?.(event, payload);
  } catch (error) {
    logger.warn(
      `production sale sync failed for order #${payload.order_id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
