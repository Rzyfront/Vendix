import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { NotificationsSseService } from './notifications-sse.service';
import { SseNotificationPayload } from './interfaces/notification-events.interface';

describe('NotificationsSseService', () => {
  let service: NotificationsSseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsSseService],
    }).compile();

    service = module.get<NotificationsSseService>(NotificationsSseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Per-user refcount regression (SSE heap-leak fix, Tier 1 / Paso 3).
  //
  // Before the fix, `unsubscribeUser` completed + deleted the SHARED per-user
  // subject on the FIRST close, so the first tab/device disconnect killed
  // targeted events for that user's remaining open connections. The subject
  // must survive until the LAST connection closes.
  // ---------------------------------------------------------------------------
  describe('per-user subject refcount', () => {
    it('returns the SAME subject for repeated getOrCreateForUser (same store,user)', () => {
      const a = service.getOrCreateForUser(1, 10);
      const b = service.getOrCreateForUser(1, 10);
      expect(b).toBe(a);
    });

    it('keeps the subject alive after the FIRST of two unsubscribes, and tears it down on the LAST', () => {
      // Two connections (e.g. two tabs) for store 1 / user 10 → 2 refs.
      const subject = service.getOrCreateForUser(1, 10);
      service.getOrCreateForUser(1, 10);

      // Observe completion via the public API (no reliance on internals).
      let completed = false;
      subject.subscribe({ complete: () => (completed = true) });

      // First disconnect: one ref remains → subject MUST stay alive.
      service.unsubscribeUser(1, 10);
      expect(completed).toBe(false);
      const userSubjects = (service as any).userSubjects as Map<
        number,
        Map<number, Subject<SseNotificationPayload>>
      >;
      expect(userSubjects.get(1)?.get(10)).toBe(subject);

      // A late-arriving targeted push still reaches the surviving connection.
      const received: SseNotificationPayload[] = [];
      subject.subscribe({ next: (p) => received.push(p) });
      const payload = {
        type: 'booking_check_in',
      } as unknown as SseNotificationPayload;
      service.pushToUser(1, 10, payload);
      expect(received).toContain(payload);

      // Second (last) disconnect: refcount hits 0 → subject completes AND is
      // removed from the Map.
      service.unsubscribeUser(1, 10);
      expect(completed).toBe(true);
      expect((service as any).userSubjects.get(1)).toBeUndefined();
      expect((service as any).userSubscriberCounts.get(1)).toBeUndefined();
    });

    it('a fresh getOrCreateForUser after full teardown yields a NEW subject', () => {
      const first = service.getOrCreateForUser(1, 10);
      service.unsubscribeUser(1, 10);
      const second = service.getOrCreateForUser(1, 10);
      expect(second).not.toBe(first);
    });

    it('is defensive when unsubscribeUser is called without a matching subscription', () => {
      expect(() => service.unsubscribeUser(99, 999)).not.toThrow();
    });
  });
});
