import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import { SseNotificationPayload } from './interfaces/notification-events.interface';

@Injectable()
export class NotificationsSseService {
  private readonly logger = new Logger(NotificationsSseService.name);
  // Per-store subject (broadcast). Used when we want all connected users of a
  // store to receive the event (e.g. order created → all cashiers see it).
  private subjects = new Map<number, Subject<SseNotificationPayload>>();
  private subscriberCounts = new Map<number, number>();
  // Per-store × per-user subject (targeted). Used for notifications that
  // belong to a single user (e.g. "your appointment is starting now" → only
  // the assigned provider sees the bell + hears the sound).
  private userSubjects = new Map<
    number,
    Map<number, Subject<SseNotificationPayload>>
  >();

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

  /**
   * Targeted push to a single user within a store. Returns silently if the
   * user is not currently connected via SSE — web-push delivery is handled
   * separately by `NotificationsPushService.sendToUser`.
   */
  pushToUser(
    store_id: number,
    user_id: number,
    payload: SseNotificationPayload,
  ): void {
    const byUser = this.userSubjects.get(store_id);
    const subject = byUser?.get(user_id);
    if (subject && !subject.closed) {
      subject.next(payload);
    }
  }

  /**
   * Register a per-user subject so `pushToUser` can later target it.
   * Returns the created Subject — the caller wraps it as an Observable.
   */
  getOrCreateForUser(
    store_id: number,
    user_id: number,
  ): Subject<SseNotificationPayload> {
    let byUser = this.userSubjects.get(store_id);
    if (!byUser) {
      byUser = new Map();
      this.userSubjects.set(store_id, byUser);
    }
    if (!byUser.has(user_id)) {
      byUser.set(user_id, new Subject());
    }
    return byUser.get(user_id)!;
  }

  /**
   * Decrement the per-user subscriber count and clean up when zero. Called
   * by the controller on `req.on('close')`.
   */
  unsubscribeUser(store_id: number, user_id: number): void {
    const byUser = this.userSubjects.get(store_id);
    if (!byUser) return;
    const subject = byUser.get(user_id);
    if (subject) {
      subject.complete();
      byUser.delete(user_id);
    }
    if (byUser.size === 0) {
      this.userSubjects.delete(store_id);
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
    const byUser = this.userSubjects.get(store_id);
    if (byUser) {
      for (const sub of byUser.values()) {
        sub.complete();
      }
      this.userSubjects.delete(store_id);
    }
  }
}
