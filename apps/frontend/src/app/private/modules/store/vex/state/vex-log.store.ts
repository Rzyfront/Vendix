import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { NotificationsApiService } from '../../../../../core/services/notifications.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { VexLogCategory, VexLogEvent } from '../models/vex.models';

/** One row of `GET /store/vex/activity-feed`: stable `notif-<id>` / `agent-<message>-<idx>` ids. */
interface ActivityFeedRow {
  id?: string;
  category: VexLogCategory;
  title: string;
  description: string;
  created_at: string;
  is_new: boolean;
}

/**
 * Live frame of the shared store channel (`/store/notifications/stream`).
 * Persisted notifications carry a numeric id; live-only agent frames
 * (`vex_agent_action`, see `buildAgentLiveEvent` in
 * `VexActivityFeedService`) carry their stable `agent-…` string id — never
 * persisted, so the string never touches the `notifications` table.
 */
interface LiveNotification {
  id: number | string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  data?: {
    agent?: string;
    tool?: string;
    conversation_id?: number;
  };
}

/** Must match `AGENT_LIVE_EVENT_TYPE` in `vex-activity-feed.service.ts`. */
const AGENT_LIVE_EVENT_TYPE = 'vex_agent_action';

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
    // Stable backend id when present (`notif-<id>` / `agent-<m>-<i>`): the
    // same event re-read after a reload collapses onto the live one instead
    // of duplicating. Random only as a rollout fallback for stale backends.
    id:
      typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
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
  if (!payload) return null;
  // Agent frames carry their stable `agent-…` id and their own category; a
  // persisted notification reuses the feed's `notif-<id>` shape so the live
  // row and the later feed row dedupe in `prepend`.
  if (payload.type === AGENT_LIVE_EVENT_TYPE) {
    if (typeof payload.id !== 'string' || !payload.id) return null;
    return {
      id: payload.id,
      category: 'agent',
      title: payload.title ?? '',
      description: payload.body ?? '',
      created_at: payload.created_at ? new Date(payload.created_at) : new Date(),
      is_new: true,
    };
  }
  if (typeof payload.id !== 'number') return null;
  return {
    id: `notif-${payload.id}`,
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
   * instants render in. The sidebar reads it for `formatStoreDateTime`, so
   * the bitácora shows the same clock as the POS of the store.
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
   * Logs an applied agent write live. The notifications channel carries
   * `vex_agent_action` frames for these, so whoever lands one from this view
   * (plan approval, tool apply) calls this only as the fallback for an SSE
   * gap — passing the frame's stable `agent-…` id when it is known so the
   * late frame dedupes instead of duplicating.
   */
  prependAgentEvent(title: string, description = '', stable_id?: string): void {
    this.prepend({
      id:
        typeof stable_id === 'string' && stable_id
          ? stable_id
          : crypto.randomUUID(),
      category: 'agent',
      title,
      description,
      created_at: new Date(),
      is_new: true,
    });
  }

  /**
   * Fallback seam for an applied `tool_result` frame: prepends only when the
   * result actually landed (`applied: true`, same marker the backend feed
   * uses). Proposals and failures never reach the bitácora. The chat store
   * calls this when its stream reports an applied write and no
   * `vex_agent_action` SSE frame is expected (e.g. the socket was down).
   */
  prependAppliedToolResult(result: {
    applied?: unknown;
    title: string;
    description?: string;
    stable_id?: string;
  }): void {
    if (result?.applied !== true) return;
    this.prependAgentEvent(
      result.title,
      result.description ?? '',
      result.stable_id,
    );
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
    // Agent frames are the exception to the numeric-id rule: they are
    // live-only (`agent-…` string ids, never persisted rows).
    if (!payload) return null;
    if (payload.type !== AGENT_LIVE_EVENT_TYPE && typeof payload.id !== 'number') {
      return null;
    }
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
