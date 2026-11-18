import { DestroyRef, computed, inject, signal } from '@angular/core';

import {
  AiJobErrorView,
  AiJobRealProgress,
  AiJobStatus,
  describeAiJobError,
} from '../../core/utils/ai-job-error';
import { formatDuration } from './batch-progress-clock';

/**
 * Progress bar state of one AI process (QUI-1020).
 *
 * The bar starts the moment the user launches the process, never sits still
 * and never claims 100 % before the result arrives:
 * - with real progress from the server (`{done,total}`) it follows it, and
 *   creeps toward the next step with the clock so it does not look frozen;
 * - without it, it walks to 90 % in the expected duration: the median of the
 *   last runs of the same kind (scaled by input size) or 25 s by default;
 * - past the expected duration it keeps creeping toward 99 % and says
 *   «Sigue procesando…».
 *
 * Signals only (zoneless). Create it with {@link injectAiJobProgress} in a
 * field initializer so its 500 ms tick is released with the component.
 */

/** Standard expected duration when a kind has no history. */
export const AI_JOB_DEFAULT_EXPECTED_MS = 25_000;
const MIN_EXPECTED_MS = 5_000;
const MAX_EXPECTED_MS = 10 * 60_000;
const HISTORY_KEY = 'vendix:ai-job-durations:v1';
const HISTORY_SIZE = 10;
const TICK_MS = 500;

export type AiJobPhase =
  | 'idle'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed';

export interface AiJobProgressOptions {
  /** History key: the ai-scan `kind` or the legacy queue name. */
  kind: string;
  /** Fixed expected duration; skips the history. */
  expectedMs?: number;
}

export interface AiJobStartOptions {
  /** Input size (files, pages, MB, rows) that scales the expected duration. */
  sizeUnits?: number;
  /**
   * Skip the upload step: for time-only bars that upload nothing, so the label
   * is the processing one and the overtime variant applies.
   */
  phase?: 'processing';
}

/**
 * Percentage for a given moment. Pure, so the curve is tested on its own.
 * Never returns 100: only `complete()` does.
 */
export function aiJobPercent(input: {
  elapsedMs: number;
  expectedMs: number;
  real?: AiJobRealProgress | null;
}): number {
  const expected = Math.max(1, input.expectedMs);
  const elapsed = Math.max(0, input.elapsedMs);
  const byTime =
    elapsed <= expected
      ? (90 * elapsed) / expected
      : 90 + 9 * (1 - Math.exp(-(elapsed - expected) / expected));
  const real = input.real;
  if (!real || real.total <= 0) return Math.min(99, byTime);
  const done = Math.min(Math.max(0, real.done), real.total);
  const realPct = (100 * done) / real.total;
  const nextPct = (100 * Math.min(done + 1, real.total)) / real.total;
  // Follow the real steps; between two steps the clock may advance the bar
  // but never past the next real step.
  return Math.min(99, Math.max(realPct, Math.min(byTime, nextPct - 1)));
}

/** Expected duration of `kind` from the local history, or 25 s. */
export function expectedAiJobMs(kind: string, sizeUnits = 1): number {
  const perUnit = readHistory()[kind];
  if (!perUnit?.length) return AI_JOB_DEFAULT_EXPECTED_MS;
  const sorted = [...perUnit].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return clampExpected(median * Math.max(1, sizeUnits));
}

/** Remembers how long a successful run of `kind` took. */
export function recordAiJobDuration(
  kind: string,
  durationMs: number,
  sizeUnits = 1,
): void {
  if (!(durationMs > 0)) return;
  const history = readHistory();
  const list = [...(history[kind] ?? []), durationMs / Math.max(1, sizeUnits)];
  history[kind] = list.slice(-HISTORY_SIZE);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Private mode or full storage: the 25 s default still works.
  }
}

function readHistory(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[k] = v.filter((n): n is number => typeof n === 'number' && n > 0);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function clampExpected(ms: number): number {
  return Math.round(Math.min(MAX_EXPECTED_MS, Math.max(MIN_EXPECTED_MS, ms)));
}

export class AiJobProgress {
  private readonly now = signal(0);
  private readonly startedAt = signal<number | null>(null);
  private readonly finishedAt = signal<number | null>(null);
  private readonly phaseState = signal<AiJobPhase>('idle');
  private readonly expectedState = signal(AI_JOB_DEFAULT_EXPECTED_MS);
  private readonly realState = signal<AiJobRealProgress | null>(null);
  private readonly stalledState = signal(false);
  private readonly errorState = signal<AiJobErrorView | null>(null);
  private readonly resumableState = signal(false);
  private sizeUnits = 1;
  private tickId: ReturnType<typeof setInterval> | null = null;

  readonly phase = this.phaseState.asReadonly();
  readonly expectedMs = this.expectedState.asReadonly();
  /** The server flagged the job as stuck (the team was alerted). */
  readonly stalled = this.stalledState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** The wait is remembered: the user may close the screen and come back. */
  readonly resumable = this.resumableState.asReadonly();

  readonly running = computed(() => {
    const p = this.phaseState();
    return p === 'uploading' || p === 'queued' || p === 'processing';
  });
  /** Something to show: running, finished or failed. */
  readonly visible = computed(() => this.phaseState() !== 'idle');

  readonly elapsedMs = computed(() => {
    const start = this.startedAt();
    if (start === null) return 0;
    return Math.max(0, (this.finishedAt() ?? this.now()) - start);
  });

  readonly overtime = computed(
    () => this.running() && this.elapsedMs() > this.expectedState(),
  );

  readonly percent = computed(() => {
    const phase = this.phaseState();
    if (phase === 'idle') return 0;
    if (phase === 'done') return 100;
    return Math.round(
      aiJobPercent({
        elapsedMs: this.elapsedMs(),
        expectedMs: this.expectedState(),
        real: this.realState(),
      }),
    );
  });

  readonly label = computed(() => {
    switch (this.phaseState()) {
      case 'uploading':
        return 'Subiendo archivo…';
      case 'queued':
        return this.overtime() ? 'Sigue en cola…' : 'En cola…';
      case 'processing': {
        if (this.overtime()) return 'Sigue procesando…';
        return this.realState()?.stage || 'Analizando con IA…';
      }
      case 'done':
        return 'Listo';
      case 'failed':
        return this.errorState()?.title ?? 'No se pudo completar';
      default:
        return '';
    }
  });

  /** «paso 2 de 5» when the server reports real steps. */
  readonly stepLabel = computed(() => {
    const real = this.realState();
    if (!real || real.total <= 1 || !this.running()) return null;
    return `paso ${Math.min(real.done + 1, real.total)} de ${real.total}`;
  });

  readonly elapsedLabel = computed(() => formatDuration(this.elapsedMs()));

  constructor(
    private readonly options: AiJobProgressOptions,
    destroyRef?: DestroyRef,
  ) {
    destroyRef?.onDestroy(() => this.dispose());
  }

  /** Starts the bar (called by the service right before the upload). */
  start(opts: AiJobStartOptions = {}): void {
    if (this.running()) return;
    this.sizeUnits = Math.max(1, opts.sizeUnits ?? this.sizeUnits);
    const t = Date.now();
    this.now.set(t);
    this.startedAt.set(t);
    this.finishedAt.set(null);
    this.realState.set(null);
    this.stalledState.set(false);
    this.errorState.set(null);
    this.resumableState.set(false);
    this.expectedState.set(
      this.options.expectedMs ??
        expectedAiJobMs(this.options.kind, this.sizeUnits),
    );
    this.phaseState.set(opts.phase ?? 'uploading');
    this.startTick();
  }

  /** Sets the input size before `start()` (e.g. number of selected files). */
  setSize(sizeUnits: number): void {
    this.sizeUnits = Math.max(1, sizeUnits);
  }

  onUploadStart(): void {
    this.start();
  }

  /** The service remembered the wait (`resumeKey`). */
  onResumable(): void {
    this.resumableState.set(true);
  }

  onEnqueued(): void {
    if (!this.running()) this.start();
    this.phaseState.set('queued');
  }

  /**
   * Re-attached to a job that kept running while the screen was closed: the
   * clock counts from when the user launched it.
   */
  onResumed(startedAtMs: number): void {
    if (!this.running()) this.start();
    this.alignStart(startedAtMs);
    this.phaseState.set('queued');
  }

  onStatus(status: AiJobStatus): void {
    if (!this.running()) return;
    // Align with the server clock: after a reload the job is older than this
    // tab, and the queue wait counts as part of the process.
    if (status.queued_at && status.server_time) {
      const serverElapsed =
        Date.parse(status.server_time) - Date.parse(status.queued_at);
      if (Number.isFinite(serverElapsed) && serverElapsed > 0) {
        this.alignStart(Date.now() - serverElapsed);
      }
    }
    if (status.progress && status.progress.total > 0) {
      this.realState.set({ ...status.progress });
    }
    this.stalledState.set(status.stalled === true);
    if (status.status === 'active') this.phaseState.set('processing');
    else if (status.status === 'waiting' || status.status === 'delayed') {
      this.phaseState.set('queued');
    }
  }

  /** The result arrived: 100 %, and the duration feeds the estimate. */
  onCompleted(): void {
    if (!this.running()) return;
    const t = Date.now();
    this.finishedAt.set(t);
    this.phaseState.set('done');
    this.clearTick();
    const start = this.startedAt();
    if (start !== null) {
      recordAiJobDuration(this.options.kind, t - start, this.sizeUnits);
    }
  }

  onFailed(error: unknown): void {
    this.finishedAt.set(Date.now());
    this.errorState.set(describeAiJobError(error));
    this.phaseState.set('failed');
    this.clearTick();
  }

  /** Back to idle (the user closed the result or picked another file). */
  reset(): void {
    this.clearTick();
    this.startedAt.set(null);
    this.finishedAt.set(null);
    this.realState.set(null);
    this.stalledState.set(false);
    this.errorState.set(null);
    this.phaseState.set('idle');
  }

  dispose(): void {
    this.clearTick();
  }

  private alignStart(startedAtMs: number): void {
    const current = this.startedAt();
    if (!Number.isFinite(startedAtMs)) return;
    if (current === null || startedAtMs < current) {
      this.startedAt.set(startedAtMs);
    }
  }

  private startTick(): void {
    this.clearTick();
    this.tickId = setInterval(() => this.now.set(Date.now()), TICK_MS);
  }

  private clearTick(): void {
    if (this.tickId !== null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
  }
}

/** Field-initializer factory: the tick is released with the component. */
export function injectAiJobProgress(
  options: AiJobProgressOptions,
): AiJobProgress {
  return new AiJobProgress(options, inject(DestroyRef));
}
