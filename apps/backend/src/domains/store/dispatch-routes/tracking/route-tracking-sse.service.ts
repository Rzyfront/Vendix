import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface TrackingPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recorded_at: string;
}

/**
 * SSE hub for live route tracking: one Subject per routeId, reference-counted
 * and dropped when the last subscriber leaves (no leaks).
 */
@Injectable()
export class RouteTrackingSseService {
  private readonly subjects = new Map<number, Subject<TrackingPosition>>();
  private readonly counts = new Map<number, number>();

  publish(routeId: number, pos: TrackingPosition): void {
    const subject = this.subjects.get(routeId);
    if (subject && !subject.closed) subject.next(pos);
  }

  stream(routeId: number): Observable<TrackingPosition> {
    return new Observable<TrackingPosition>((subscriber) => {
      let subject = this.subjects.get(routeId);
      if (!subject) {
        subject = new Subject<TrackingPosition>();
        this.subjects.set(routeId, subject);
      }
      this.counts.set(routeId, (this.counts.get(routeId) ?? 0) + 1);
      const sub = subject.subscribe(subscriber);

      return () => {
        sub.unsubscribe();
        const left = (this.counts.get(routeId) ?? 1) - 1;
        if (left <= 0) {
          this.counts.delete(routeId);
          this.subjects.get(routeId)?.complete();
          this.subjects.delete(routeId);
        } else {
          this.counts.set(routeId, left);
        }
      };
    });
  }
}
