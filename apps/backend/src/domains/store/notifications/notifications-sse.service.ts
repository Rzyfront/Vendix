import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import { SseNotificationPayload } from './interfaces/notification-events.interface';

@Injectable()
export class NotificationsSseService {
  private readonly logger = new Logger(NotificationsSseService.name);
  private subjects = new Map<number, Subject<SseNotificationPayload>>();
  private subscriberCounts = new Map<number, number>();

  getOrCreate(store_id: number): Subject<SseNotificationPayload> {
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

  push(store_id: number, payload: SseNotificationPayload) {
    const subject = this.subjects.get(store_id);
    if (subject && !subject.closed) {
      subject.next(payload);
    }
  }

  unsubscribe(store_id: number): void {
    const count = (this.subscriberCounts.get(store_id) || 1) - 1;
    if (count <= 0) {
      this.logger.log(
        `All subscribers disconnected for store ${store_id}, cleaning up Subject`,
      );
      this.removeStore(store_id);
      this.subscriberCounts.delete(store_id);
    } else {
      this.subscriberCounts.set(store_id, count);
    }
  }

  removeStore(store_id: number) {
    const subject = this.subjects.get(store_id);
    if (subject) {
      subject.complete();
      this.subjects.delete(store_id);
    }
  }
}
