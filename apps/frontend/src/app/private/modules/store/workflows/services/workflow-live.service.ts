import { Injectable } from '@angular/core';
import { Observable, debounceTime, filter, share } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { WorkflowLiveEvent } from '../interfaces/workflow-board.interfaces';

const MAX_BACKOFF_MS = 30_000;
/** Refetches are coalesced over this window so a burst reads once. */
export const LIVE_DEBOUNCE_MS = 500;

/**
 * P5.6: SSE of workflow changes (`GET …/workflows/live/stream`). The stream
 * is shared and reference counted: it opens with the first subscriber and
 * closes when the last one leaves, so a page that is gone costs no connection.
 *
 * The server sends `workflow` events with ids only; pages re-read over REST.
 * EventSource cannot send headers, so the token goes in `?token=` like the
 * other Vendix streams. Reconnection is explicit with backoff and emits a
 * `resync` because events sent while disconnected are lost.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowLiveService {
  private readonly url = `${environment.apiUrl}/store/workflows/live/stream`;

  readonly events$: Observable<WorkflowLiveEvent> = new Observable<WorkflowLiveEvent>(
    (subscriber) => {
      let source: EventSource | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let attempt = 0;
      let stopped = false;

      const retry = () => {
        if (stopped) return;
        attempt += 1;
        timer = setTimeout(open, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1)));
      };

      const open = () => {
        timer = null;
        const token = this.readAccessToken();
        if (!token) {
          retry();
          return;
        }
        const es = new EventSource(`${this.url}?token=${encodeURIComponent(token)}`);
        source = es;
        es.onopen = () => {
          const wasRetry = attempt > 0;
          attempt = 0;
          if (wasRetry) subscriber.next({ kind: 'resync', instance_id: null });
        };
        es.addEventListener('workflow', (message) => {
          const event = this.parse((message as MessageEvent).data);
          if (event) subscriber.next(event);
        });
        es.onerror = () => {
          es.close();
          if (source === es) source = null;
          retry();
        };
      };

      open();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        source?.close();
        source = null;
      };
    },
  ).pipe(share());

  /**
   * Debounced "something changed": for pages that refetch. `matches` narrows
   * which events count (for example the instance being viewed); a `resync`
   * always counts.
   */
  changes(matches: (e: WorkflowLiveEvent) => boolean = () => true): Observable<WorkflowLiveEvent> {
    return this.events$.pipe(
      filter((e) => e.kind === 'resync' || matches(e)),
      debounceTime(LIVE_DEBOUNCE_MS),
    );
  }

  private parse(data: unknown): WorkflowLiveEvent | null {
    if (typeof data !== 'string') return null;
    try {
      const raw = JSON.parse(data) as Partial<WorkflowLiveEvent>;
      if (typeof raw.instance_id !== 'number') return null;
      if (raw.kind !== 'event' && raw.kind !== 'task') return null;
      return {
        kind: raw.kind,
        instance_id: raw.instance_id,
        ...(typeof raw.task_id === 'number' ? { task_id: raw.task_id } : {}),
      };
    } catch {
      return null;
    }
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
