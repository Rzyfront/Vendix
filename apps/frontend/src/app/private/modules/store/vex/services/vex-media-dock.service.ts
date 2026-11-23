import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export type VexVideoSource = 'YOUTUBE' | 'VIMEO' | 'LOOM' | 'DIRECT_S3';

/** Video as the Vex learning blocks and `GET /store/help/learning-paths/:id` carry it. */
export interface VexVideoRef {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  video_url: string;
  video_source: VexVideoSource;
  external_id?: string | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
}

export interface VexLearningProgress {
  seconds_watched: number;
  completed: boolean;
}

export interface VexLearningPathItem {
  position: number;
  video: VexVideoRef;
  article?: {
    id: number;
    title: string;
    slug: string;
    summary?: string | null;
  } | null;
  progress?: VexLearningProgress | null;
}

export interface VexLearningPath {
  id: number;
  title: string;
  summary?: string | null;
  items: VexLearningPathItem[];
}

export type VexDockState = 'inline' | 'minimized' | 'fullscreen';

export interface VexDockItem {
  video: VexVideoRef;
  position: number;
}

/** Seconds between periodic progress saves while a video plays. */
export const PROGRESS_SAVE_INTERVAL_MS = 15_000;
/** Below this many seconds a saved position is not worth resuming from. */
const MIN_RESUME_SECONDS = 5;

/**
 * Persistent media dock state for `/admin/vex` (Vex Plus F4, T30).
 *
 * Provided by `VexPageComponent`, so it lives exactly as long as the Vex page:
 * the dock survives thread scroll, sending messages and block re-renders, and
 * leaving the page flushes the last position and drops the player.
 *
 * Progress is persisted through the store help API
 * (`POST /store/help/learning-progress`), throttled while playing and flushed
 * on pause, end, video switch and close. Positions restore from
 * `GET /store/help/learning-paths/:id`; the server wins over whatever the
 * persisted block carried when it was created.
 */
@Injectable()
export class VexMediaDockService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/help`;

  private readonly queue_state = signal<VexDockItem[]>([]);
  private readonly index_state = signal(0);
  private readonly series_state = signal<{ id: number; title: string } | null>(
    null,
  );
  private readonly progress_state = signal<Record<number, VexLearningProgress>>(
    {},
  );
  /** Seconds the current video has reached (telemetry, not wall clock). */
  private readonly current_seconds_state = signal(0);

  readonly queue = this.queue_state.asReadonly();
  readonly index = this.index_state.asReadonly();
  readonly series = this.series_state.asReadonly();
  readonly state = signal<VexDockState>('inline');
  readonly playing = signal(false);
  /** Last known progress per video id (server restore + live updates). */
  readonly progress = this.progress_state.asReadonly();

  readonly visible = computed(() => this.queue_state().length > 0);
  readonly current = computed<VexDockItem | null>(
    () => this.queue_state()[this.index_state()] ?? null,
  );
  readonly has_next = computed(
    () => this.index_state() < this.queue_state().length - 1,
  );
  readonly has_previous = computed(() => this.index_state() > 0);
  /** Where to resume the current video; `0` when there is nothing worth resuming. */
  readonly resume_at = computed(() => {
    const item = this.current();
    if (!item) return 0;
    const saved = this.progress_state()[item.video.id];
    if (!saved || saved.completed) return 0;
    return saved.seconds_watched >= MIN_RESUME_SECONDS
      ? saved.seconds_watched
      : 0;
  });

  private last_saved_at = 0;
  private last_saved_seconds = -1;
  private readonly path_requests = new Map<number, Promise<void>>();

  ngOnDestroy(): void {
    this.flush();
  }

  /** A single video (the `video` and `help_article` blocks). */
  playVideo(video: VexVideoRef): void {
    this.start([{ video, position: 1 }], 0, null);
  }

  /** A learning path, starting at `startIndex` or the first unfinished video. */
  playPath(path: VexLearningPath, startIndex?: number): void {
    const items = [...path.items].sort((a, b) => a.position - b.position);
    if (items.length === 0) return;
    for (const item of items) {
      if (item.progress) this.mergeProgress(item.video.id, item.progress);
    }
    const first_open = items.findIndex(
      (item) => !this.progress_state()[item.video.id]?.completed,
    );
    const index = Math.min(
      Math.max(startIndex ?? (first_open >= 0 ? first_open : 0), 0),
      items.length - 1,
    );
    this.start(
      items.map((item) => ({ video: item.video, position: item.position })),
      index,
      { id: path.id, title: path.title },
    );
    void this.loadPath(path.id);
  }

  /**
   * Restores saved progress for a path from the server (once per path per
   * page visit). Failures are silent: the block keeps what it carries.
   */
  loadPath(seriesId: number): Promise<void> {
    const cached = this.path_requests.get(seriesId);
    if (cached) return cached;
    const request = firstValueFrom(
      this.http.get<VexLearningPath>(`${this.base}/learning-paths/${seriesId}`),
    )
      .then((path) => {
        for (const item of path?.items ?? []) {
          if (item.progress) this.mergeProgress(item.video.id, item.progress);
        }
      })
      .catch(() => {
        this.path_requests.delete(seriesId);
      });
    this.path_requests.set(seriesId, request);
    return request;
  }

  /** Seeds the progress map from the progress a block was created with. */
  seedProgress(path: VexLearningPath): void {
    for (const item of path.items) {
      if (item.progress) this.mergeProgress(item.video.id, item.progress);
    }
  }

  progressOf(videoId: number): VexLearningProgress | null {
    return this.progress_state()[videoId] ?? null;
  }

  next(): void {
    if (this.has_next()) this.goTo(this.index_state() + 1);
  }

  previous(): void {
    if (this.has_previous()) this.goTo(this.index_state() - 1);
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.queue_state().length) return;
    if (index === this.index_state()) return;
    this.flush();
    this.index_state.set(index);
    this.resetCursor();
    this.playing.set(true);
  }

  minimize(): void {
    this.state.set('minimized');
  }

  restore(): void {
    this.state.set('inline');
  }

  toggleFullscreen(): void {
    this.state.update((s) => (s === 'fullscreen' ? 'inline' : 'fullscreen'));
  }

  close(): void {
    this.flush();
    this.playing.set(false);
    this.queue_state.set([]);
    this.index_state.set(0);
    this.series_state.set(null);
    this.state.set('inline');
    this.resetCursor();
  }

  // ── player telemetry (called by the dock component) ───────────────────

  /** Current playback position in seconds; saves at most every 15 s. */
  reportTime(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.current_seconds_state.set(Math.floor(seconds));
    if (!this.playing()) return;
    if (Date.now() - this.last_saved_at >= PROGRESS_SAVE_INTERVAL_MS) {
      this.flush();
    }
  }

  reportPlaying(playing: boolean): void {
    if (this.playing() === playing) return;
    this.playing.set(playing);
    if (!playing) this.flush();
  }

  /** The video finished: save as completed and advance to the next one. */
  reportEnded(): void {
    const item = this.current();
    if (!item) return;
    this.save(item, this.endSeconds(item), true);
    if (this.has_next()) {
      this.index_state.update((i) => i + 1);
      this.resetCursor();
      this.playing.set(true);
    } else {
      this.playing.set(false);
    }
  }

  /** Manual «Marcar como visto» for players that expose no telemetry. */
  markCurrentDone(): void {
    const item = this.current();
    if (item) this.save(item, this.endSeconds(item), true);
  }

  /** Saves the current position now (pause, switch, close, destroy). */
  flush(): void {
    const item = this.current();
    if (!item) return;
    const seconds = this.current_seconds_state();
    if (seconds <= 0 || seconds === this.last_saved_seconds) return;
    if (this.progress_state()[item.video.id]?.completed) return;
    this.save(item, seconds, false);
  }

  // ── internals ─────────────────────────────────────────────────────────

  private start(
    queue: VexDockItem[],
    index: number,
    series: { id: number; title: string } | null,
  ): void {
    this.flush();
    this.queue_state.set(queue);
    this.index_state.set(index);
    this.series_state.set(series);
    this.resetCursor();
    this.playing.set(true);
    if (this.state() === 'minimized') this.state.set('inline');
  }

  private resetCursor(): void {
    this.current_seconds_state.set(0);
    this.last_saved_seconds = -1;
    this.last_saved_at = Date.now();
  }

  private endSeconds(item: VexDockItem): number {
    const duration = item.video.duration_seconds ?? 0;
    return Math.max(duration, this.current_seconds_state(), 1);
  }

  private mergeProgress(videoId: number, incoming: VexLearningProgress): void {
    this.progress_state.update((all) => {
      const known = all[videoId];
      // Never regress a finished video or a further position with a stale read.
      if (known?.completed && !incoming.completed) return all;
      if (
        known &&
        !incoming.completed &&
        known.seconds_watched > incoming.seconds_watched
      ) {
        return all;
      }
      return { ...all, [videoId]: { ...incoming } };
    });
  }

  private save(item: VexDockItem, seconds: number, completed: boolean): void {
    const rounded = Math.floor(seconds);
    this.last_saved_at = Date.now();
    this.last_saved_seconds = rounded;
    this.mergeProgress(item.video.id, {
      seconds_watched: rounded,
      completed,
    });
    const series = this.series_state();
    void firstValueFrom(
      this.http.post(`${this.base}/learning-progress`, {
        video_id: item.video.id,
        ...(series ? { series_id: series.id } : {}),
        seconds_watched: rounded,
        ...(completed ? { completed: true } : {}),
      }),
    ).catch(() => {
      // Progress is best-effort: the next tick or pause retries.
    });
  }
}
