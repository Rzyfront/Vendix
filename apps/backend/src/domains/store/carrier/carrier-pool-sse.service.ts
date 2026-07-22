import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Payload broadcast on the carrier pool SSE channel. */
export interface CarrierPoolSsePayload {
  type: string;
}

/**
 * Dedicated SSE hub for the carrier order pool (Repartos).
 *
 * Minimal calque of `NotificationsSseService`: one broadcast `Subject` per
 * `store_id`, reference-counted so the `Subject` is completed and dropped when
 * the last connected carrier disconnects. `push` emits `{ type: 'pool_changed' }`
 * whenever the pool mutates (order published/re-exposed, claimed, or cleaned
 * up on cancel/refund) so every carrier's pool list refreshes in real time.
 *
 * A separate channel from the store notifications SSE: the pool signal must not
 * inflate the bell badge nor be filtered against notification types.
 */
@Injectable()
export class CarrierPoolSseService {
  private readonly logger = new Logger(CarrierPoolSseService.name);
  private subjects = new Map<number, Subject<CarrierPoolSsePayload>>();
  private subscriberCounts = new Map<number, number>();

  getOrCreate(store_id: number): Subject<CarrierPoolSsePayload> {
    if (!this.subjects.has(store_id)) {
      this.subjects.set(store_id, new Subject());
      this.subscriberCounts.set(store_id, 0);
    }
    this.subscriberCounts.set(
      store_id,
      (this.subscriberCounts.get(store_id) || 0) + 1,
    );
    return this.subjects.get(store_id)!;
  }

  push(store_id: number, payload: CarrierPoolSsePayload): void {
    const subject = this.subjects.get(store_id);
    if (subject && !subject.closed) {
      subject.next(payload);
    }
  }

  unsubscribe(store_id: number): void {
    const count = (this.subscriberCounts.get(store_id) || 1) - 1;
    if (count <= 0) {
      const subject = this.subjects.get(store_id);
      if (subject) {
        subject.complete();
        this.subjects.delete(store_id);
      }
      this.subscriberCounts.delete(store_id);
      this.logger.log(
        `All carrier pool subscribers disconnected for store ${store_id}, cleaning up Subject`,
      );
    } else {
      this.subscriberCounts.set(store_id, count);
    }
  }
}
