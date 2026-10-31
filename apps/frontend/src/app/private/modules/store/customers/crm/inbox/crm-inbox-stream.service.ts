import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { CrmInboxService } from './crm-inbox.service';
import { CrmInboxEvent } from './crm-inbox.interface';

export type CrmStreamState = 'idle' | 'connecting' | 'open' | 'reconnecting';

/** What the inbox should do: apply one event, or re-read everything. */
export type CrmStreamSignal =
  | { kind: 'event'; event: CrmInboxEvent }
  | { kind: 'resync' };

const EVENT_TYPES = ['crm.message', 'crm.conversation'] as const;
const MAX_BACKOFF_MS = 30_000;

/**
 * SSE of the inbox (`GET …/conversations/stream`). Provided by the inbox page,
 * so it lives and dies with it.
 *
 * The server sends named events (`event: crm.message`) with ids and states
 * only; the page re-reads through REST. EventSource cannot send headers, so the
 * token goes in `?token=` like the other Vendix streams. Reconnection is
 * explicit with backoff, and every reconnection emits `resync` because events
 * published while disconnected are lost.
 */
@Injectable()
export class CrmInboxStreamService implements OnDestroy {
  private readonly inbox = inject(CrmInboxService);
  private source: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;

  readonly state = signal<CrmStreamState>('idle');
  private readonly signals$ = new Subject<CrmStreamSignal>();
  readonly signals = this.signals$.asObservable();

  connect(): void {
    this.stopped = false;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    this.clearRetry();
    this.source?.close();
    this.source = null;
    this.state.set('idle');
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.signals$.complete();
  }

  private open(): void {
    const token = this.readAccessToken();
    if (!token) {
      this.scheduleRetry();
      return;
    }
    this.state.set(this.attempt > 0 ? 'reconnecting' : 'connecting');
    const source = new EventSource(
      `${this.inbox.baseUrl}/stream?token=${encodeURIComponent(token)}`,
    );
    this.source = source;

    source.onopen = () => {
      const wasRetry = this.attempt > 0;
      this.attempt = 0;
      this.state.set('open');
      if (wasRetry) this.signals$.next({ kind: 'resync' });
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) =>
        this.handle((message as MessageEvent).data),
      );
    }
    source.onerror = () => {
      source.close();
      if (this.source === source) this.source = null;
      if (!this.stopped) this.scheduleRetry();
    };
  }

  private handle(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const event = JSON.parse(data) as CrmInboxEvent;
      if (typeof event?.conversation_id === 'number') {
        this.signals$.next({ kind: 'event', event });
      }
    } catch {
      // Malformed payload: ignore, the next resync covers it.
    }
  }

  private scheduleRetry(): void {
    this.clearRetry();
    this.attempt += 1;
    this.state.set('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private readAccessToken(): string | null {
    try {
      const raw = localStorage.getItem('vendix_auth_state');
      return raw ? (JSON.parse(raw)?.tokens?.access_token ?? null) : null;
    } catch {
      return null;
    }
  }
}
