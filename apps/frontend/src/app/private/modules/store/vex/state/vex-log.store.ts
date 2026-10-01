import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { NotificationsApiService } from '../../../../../core/services/notifications.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { VexLogCategory, VexLogEvent } from '../models/vex.models';

/** One row of `GET /store/vex/activity-feed`, the planned wave-1 contract. */
interface ActivityFeedRow {
  category: VexLogCategory;
  title: string;
  description: string;
  created_at: string;
  is_new: boolean;
}

/** Live frame of the shared store channel (`/store/notifications/stream`). */
interface LiveNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  created_at: string;
}

const FEED_LIMIT = 50;
const MAX_EVENTS = 200;

/** Mirrors `VexActivityFeedService.categoryFor`: type prefix → feed category. */
const TYPE_CATEGORY_PREFIXES: Array<{
  prefixes: string[];
  category: VexLogCategory;
}> = [
  {
    prefixes: ['sale', 'order', 'payment', 'invoice', 'quotation'],
    category: 'sale',
  },
  { prefixes: ['stock', 'inventory', 'product'], category: 'inventory' },
  { prefixes: ['cash', 'register', 'payout', 'expense'], category: 'cash' },
];

function categoryFor(type: string): VexLogCategory {
  const lower = (type ?? '').toLowerCase();
  for (const { prefixes, category } of TYPE_CATEGORY_PREFIXES) {
    if (prefixes.some((p) => lower.startsWith(p))) return category;
  }
  return 'alert';
}

function isValidCategory(value: unknown): value is VexLogCategory {
  return (
    value === 'sale' ||
    value === 'inventory' ||
    value === 'cash' ||
    value === 'alert' ||
    value === 'agent'
  );
}

function adaptRow(row: ActivityFeedRow): VexLogEvent | null {
  if (!row || typeof row.title !== 'string') return null;
  return {
    id: crypto.randomUUID(),
    category: isValidCategory(row.category) ? row.category : 'alert',
    title: row.title,
    description: typeof row.description === 'string' ? row.description : '',
    // Genuine instant, never shifted: whoever renders it converts to the
    // store zone (see `timezone` below).
    created_at: new Date(row.created_at),
    is_new: row.is_new === true,
  };
}

function adaptLive(payload: LiveNotification): VexLogEvent | null {
  if (!payload || typeof payload.id !== 'number') return null;
  return {
    id: `sse-${payload.id}`,
    category: categoryFor(payload.type),
    title: payload.title ?? '',
    description: payload.body ?? '',
    created_at: payload.created_at ? new Date(payload.created_at) : new Date(),
    is_new: true,
  };
}

/**
 * The "Bitácora empresarial" over real store data.
 *
 * Initial timeline comes from `GET /store/vex/activity-feed` (domain
 * notifications plus applied Vex/Vexi actions, normalized server-side); live
 * rows prepend over the existing notifications SSE channel, no reload. The
 * store is provided by `VexPageComponent`, so the socket lives exactly as long
 * as the Vex view and closes with it.
 *
 * Dependency: the feed endpoint 404s until vex2-loop registers `VexModule`.
 * Until then the log starts empty and only the live channel fills it — the
 * load failure is silent on purpose (secondary UI must never toast-fail the
 * whole view).
 */
@Injectable()
export class VexLogStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly notificationsApi = inject(NotificationsApiService);
  private readonly settings = inject(StoreSettingsFacade);

  private readonly feedUrl = `${environment.apiUrl}/store/vex/activity-feed`;
  private liveSource: EventSource | null = null;

  private readonly _events = signal<VexLogEvent[]>([]);
  private readonly _active_filter = signal<VexLogCategory | 'all'>('all');

  readonly events = computed(() =>
    [...this._events()].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    ),
  );
  readonly active_filter = this._active_filter.asReadonly();
  readonly filtered_events = computed(() => {
    const filter = this._active_filter();
    const all = this.events();
    return filter === 'all' ? all : all.filter((e) => e.category === filter);
  });
  readonly new_count = computed(
    () => this._events().filter((e) => e.is_new).length,
  );

  /**
   * IANA zone of the active store (`America/Bogota` fallback), the zone feed
   * instants must render in. Seam for the sidebar step:
   * `{{ event.created_at | date:'HH:mm':timezone() }}` — until that template
   * change lands, the (correct) instant renders in the browser zone.
   */
  readonly timezone = this.settings.timezone;

  constructor() {
    this.destroyRef.onDestroy(() => this.closeLive());
    void this.loadFeed();
    this.connectLive();
  }

  setFilter(f: VexLogCategory | 'all'): void {
    this._active_filter.set(f);
  }

  markAllSeen(): void {
    // Local only, by design: the bell owns the persisted `is_read` flag and
    // agent entries carry no read state at all — clearing the bell from the
    // bitácora would surprise.
    this._events.update((list) => list.map((e) => ({ ...e, is_new: false })));
  }

  /**
   * Logs an applied agent write live. The notifications channel never carries
   * agent actions, so whoever lands one from this view (plan approval, tool
   * apply) calls this instead of waiting for a reload.
   */
  prependAgentEvent(title: string, description = ''): void {
    this.prepend({
      id: crypto.randomUUID(),
      category: 'agent',
      title,
      description,
      created_at: new Date(),
      is_new: true,
    });
  }

  private loadFeed(): Promise<void> {
    return firstValueFrom(
      this.http.get<{ data: ActivityFeedRow[] }>(this.feedUrl, {
        params: { limit: String(FEED_LIMIT) },
      }),
    )
      .then((res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        this._events.set(
          rows
            .map(adaptRow)
            .filter((e): e is VexLogEvent => e !== null)
            .slice(0, MAX_EVENTS),
        );
      })
      .catch(() => {
        // Unwired endpoint (see class doc): start empty, live still fills.
      });
  }

  private connectLive(): void {
    this.closeLive();
    const url = this.notificationsApi.getSseUrl();
    if (!url) return;
    // No `onerror` close: EventSource reconnects on its own, and closing here
    // would trade one auto-recovered gap for a permanently dead channel.
    const source = new EventSource(url);
    this.liveSource = source;
    source.onmessage = (event: MessageEvent) => {
      const parsed = this.parseLive(event.data);
      if (parsed) this.prepend(parsed);
    };
  }

  private parseLive(data: unknown): VexLogEvent | null {
    let payload: LiveNotification;
    try {
      payload = JSON.parse(data as string) as LiveNotification;
    } catch {
      return null;
    }
    // Same shared-channel guards as `NotificationsEffects.connectSse$`: the
    // store hub multiplexes non-bell frames (ambient access, order telemetry).
    if (!payload || typeof payload.id !== 'number') return null;
    if (payload.type === 'membership-access') return null;
    if (typeof payload.type === 'string' && payload.type.startsWith('order.')) {
      return null;
    }
    return adaptLive(payload);
  }

  private prepend(event: VexLogEvent): void {
    this._events.update((list) => {
      if (list.some((e) => e.id === event.id)) return list;
      return [event, ...list].slice(0, MAX_EVENTS);
    });
  }

  private closeLive(): void {
    if (this.liveSource) {
      this.liveSource.close();
      this.liveSource = null;
    }
  }
}
