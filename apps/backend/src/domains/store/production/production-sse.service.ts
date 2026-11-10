import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject, interval, map, merge } from 'rxjs';
import {
  PRODUCTION_ORDER_UPDATED_EVENT,
  type ProductionOrderUpdatedPayload,
} from './production-order-events';

/**
 * QUI-1002 — one RxJS Subject per store for the live production stream.
 * Separate from NotificationsSseService on purpose: these events never create
 * notifications. Subscriber counting mirrors the notifications service so the
 * last disconnect tears the subject down.
 */
@Injectable()
export class ProductionSseService {
  private readonly logger = new Logger(ProductionSseService.name);
  private subjects = new Map<number, Subject<ProductionOrderUpdatedPayload>>();
  private subscriberCounts = new Map<number, number>();

  getOrCreate(store_id: number): Subject<ProductionOrderUpdatedPayload> {
    if (!this.subjects.has(store_id)) {
      this.subjects.set(store_id, new Subject());
      this.subscriberCounts.set(store_id, 0);
    }
    this.subscriberCounts.set(store_id, (this.subscriberCounts.get(store_id) || 0) + 1);
    return this.subjects.get(store_id)!;
  }

  push(store_id: number, payload: ProductionOrderUpdatedPayload): void {
    const subject = this.subjects.get(store_id);
    if (subject && !subject.closed) {
      subject.next(payload);
    }
  }

  @OnEvent(PRODUCTION_ORDER_UPDATED_EVENT)
  onProductionOrderUpdated(payload: ProductionOrderUpdatedPayload): void {
    if (payload?.store_id == null) return;
    this.push(payload.store_id, payload);
  }

  /**
   * The SSE body of one connection: live `production_order.updated` events
   * plus a 30 s heartbeat. The subscription is released when the request
   * closes. Shared by Producción (`store/production-orders/stream`) and Planta
   * (`store/manufacturing/orders/stream`), each behind its own industry guard.
   */
  stream(
    store_id: number,
    req: { on(event: 'close', listener: () => void): unknown },
  ): Observable<MessageEvent> {
    const subject = this.getOrCreate(store_id);
    req.on('close', () => this.unsubscribe(store_id));
    const live$ = subject.pipe(
      map((payload) => ({ data: JSON.stringify(payload) }) as MessageEvent),
    );
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: `: heartbeat ${Date.now()}` }) as MessageEvent),
    );
    return merge(live$, heartbeat$);
  }

  unsubscribe(store_id: number): void {
    const count = (this.subscriberCounts.get(store_id) || 1) - 1;
    if (count <= 0) {
      this.logger.log(`All production subscribers disconnected for store ${store_id}`);
      const subject = this.subjects.get(store_id);
      if (subject) {
        subject.complete();
        this.subjects.delete(store_id);
      }
      this.subscriberCounts.delete(store_id);
    } else {
      this.subscriberCounts.set(store_id, count);
    }
  }
}
