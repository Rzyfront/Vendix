import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { RouteTrackingService } from './route-tracking.service';
import {
  PositionPublisherState,
  PublishPositionPoint,
} from '../interfaces/route-tracking.interface';

const MAX_BUFFER = 200;
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_THRESHOLD = 20;
const BATCH_SIZE = 50;

/**
 * Publishes the responsible user's GPS position for a dispatch route.
 * Only the responsible (current user === driver) should call `start()`.
 * Buffers in memory (max 200, oldest dropped), flushes every 10 s or at >= 20
 * points in batches of <= 50, pauses while the tab is hidden / offline and
 * stops on 403/409 from the backend. Zoneless: state is a signal.
 */
@Injectable({ providedIn: 'root' })
export class RoutePositionPublisherService {
  private readonly tracking = inject(RouteTrackingService);

  readonly state = signal<PositionPublisherState>('idle');
  /** Last position captured locally (used as the responsible's own dot). */
  readonly lastLocal = signal<{ lat: number; lng: number } | null>(null);

  private routeId: number | null = null;
  private publishFn: ((batch: PublishPositionPoint[]) => Observable<unknown>) | null =
    null;

  /** Route currently being published (null when idle). */
  get currentRouteId(): number | null {
    return this.routeId;
  }
  private watchId: number | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private buffer: PublishPositionPoint[] = [];
  private flushing = false;
  private listening = false;

  private readonly onVisibility = () => {
    if (this.routeId == null) return;
    if (document.visibilityState === 'hidden') {
      this.pauseSending();
    } else {
      this.resumeSending();
    }
  };
  private readonly onOffline = () => {
    if (this.routeId != null) this.pauseSending();
  };
  private readonly onOnline = () => {
    if (this.routeId != null) this.resumeSending();
  };

  start(
    routeId: number,
    publishFn?: (batch: PublishPositionPoint[]) => Observable<unknown>,
  ): void {
    if (this.routeId === routeId && this.state() !== 'idle') return;
    this.stop();
    this.publishFn = publishFn ?? null;
    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      (typeof window !== 'undefined' && window.isSecureContext === false)
    ) {
      this.state.set('unavailable');
      return;
    }
    this.routeId = routeId;
    this.state.set('requesting');
    this.addListeners();

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onFix(pos),
      (err) => this.onGeoError(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.watchId != null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(this.watchId);
    }
    this.watchId = null;
    if (this.flushTimer != null) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.removeListeners();
    this.routeId = null;
    this.publishFn = null;
    this.buffer = [];
    this.flushing = false;
    this.lastLocal.set(null);
    this.state.set('idle');
  }

  private onFix(pos: GeolocationPosition): void {
    if (this.routeId == null) return;
    const c = pos.coords;
    this.lastLocal.set({ lat: c.latitude, lng: c.longitude });
    if (this.state() === 'requesting') this.state.set('active');

    const point: PublishPositionPoint = {
      lat: c.latitude,
      lng: c.longitude,
      recorded_at: new Date(pos.timestamp || Date.now()).toISOString(),
    };
    if (c.accuracy != null && c.accuracy >= 0) point.accuracy = c.accuracy;
    if (c.heading != null && !Number.isNaN(c.heading)) {
      point.heading = ((c.heading % 360) + 360) % 360;
    }
    if (c.speed != null && !Number.isNaN(c.speed) && c.speed >= 0) {
      point.speed = c.speed;
    }
    this.buffer.push(point);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }
    if (this.buffer.length >= FLUSH_THRESHOLD) void this.flush();
  }

  private onGeoError(err: GeolocationPositionError): void {
    if (err.code === 1) {
      // PERMISSION_DENIED
      this.state.set('denied');
    } else if (err.code === 2 && this.lastLocal() == null) {
      this.state.set('unavailable');
    }
    // TIMEOUT or transient error after a fix: keep the current state.
  }

  private pauseSending(): void {
    if (this.state() === 'active' || this.state() === 'requesting') {
      this.state.set('paused');
    }
  }

  private resumeSending(): void {
    if (this.state() !== 'paused') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.state.set(this.lastLocal() ? 'active' : 'requesting');
    void this.flush();
  }

  private canSend(): boolean {
    if (this.routeId == null || this.state() !== 'active') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    return true;
  }

  private async flush(): Promise<void> {
    if (this.flushing || !this.canSend() || this.buffer.length === 0) return;
    const routeId = this.routeId!;
    this.flushing = true;
    try {
      while (this.buffer.length > 0 && this.canSend() && this.routeId === routeId) {
        const batch = this.buffer.slice(0, BATCH_SIZE);
        try {
          await new Promise<void>((resolve, reject) => {
            (this.publishFn
              ? this.publishFn(batch)
              : this.tracking.publishPositions(routeId, batch)
            ).subscribe({
              next: () => resolve(),
              error: (e) => reject(e),
            });
          });
          this.buffer.splice(0, batch.length);
        } catch (e: any) {
          const status = e?.status;
          if (status === 403 || status === 409) {
            this.stop();
          }
          // other errors (network/5xx): keep buffer, retry on next tick
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private addListeners(): void {
    if (this.listening || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    this.listening = true;
  }

  private removeListeners(): void {
    if (!this.listening) return;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
    this.listening = false;
  }
}
