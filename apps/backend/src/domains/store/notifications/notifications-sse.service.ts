import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { SseNotificationPayload } from './interfaces/notification-events.interface';

@Injectable()
export class NotificationsSseService {
  private subjects = new Map<number, Subject<SseNotificationPayload>>();

  getOrCreate(store_id: number): Subject<SseNotificationPayload> {
    if (!this.subjects.has(store_id)) {
      this.subjects.set(store_id, new Subject());
    }
    return this.subjects.get(store_id)!;
  }

  push(store_id: number, payload: SseNotificationPayload) {
    const subject = this.subjects.get(store_id);
    if (subject && !subject.closed) {
      subject.next(payload);
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
